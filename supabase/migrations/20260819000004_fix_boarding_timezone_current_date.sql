-- Migration: Fix timezone shift bug in boarding details (UTC vs IST current date)

-- ── 1. Fix search_students_for_boarding ─────────────────────────────────────
-- Match bd.effective_to IS NULL for active record so IST date additions are visible immediately
DROP FUNCTION IF EXISTS public.search_students_for_boarding(TEXT);
DROP FUNCTION IF EXISTS public.search_students_for_boarding(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.search_students_for_boarding(
  p_query  TEXT,
  p_bus_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id              UUID,
  full_name       TEXT,
  email           TEXT,
  register_number TEXT,
  bus_number      TEXT,
  status          TEXT,
  boarding_point  TEXT,
  bus_stop_no     INTEGER,
  has_boarding    BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT := public.current_user_role();
  v_user_bus_id UUID;
  v_target_bus_id UUID;
BEGIN
  IF v_role NOT IN ('admin', 'coordinator') THEN
    RAISE EXCEPTION 'Staff access required';
  END IF;

  SELECT p.bus_id INTO v_user_bus_id FROM public.profiles p WHERE p.id = auth.uid();

  IF v_role = 'coordinator' THEN
    v_target_bus_id := v_user_bus_id;
  ELSE
    v_target_bus_id := COALESCE(p_bus_id, NULL);
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.email,
    p.register_number,
    b.bus_number,
    p.status,
    bd.boarding_point,
    bd.bus_stop_no,
    (bd.id IS NOT NULL) AS has_boarding
  FROM public.profiles p
  LEFT JOIN public.buses b ON b.id = p.bus_id
  LEFT JOIN public.student_boarding_details bd
    ON bd.student_id = p.id
    AND bd.effective_to IS NULL
  WHERE p.role = 'student'
    AND (v_target_bus_id IS NULL OR p.bus_id = v_target_bus_id)
    AND (
      p.email ILIKE '%' || trim(p_query) || '%'
      OR p.full_name ILIKE '%' || trim(p_query) || '%'
      OR p.register_number ILIKE '%' || trim(p_query) || '%'
    )
  ORDER BY p.full_name
  LIMIT 20;
END;
$$;

-- ── 2. Fix get_student_boarding ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_student_boarding(UUID);

CREATE OR REPLACE FUNCTION public.get_student_boarding(p_student_id UUID)
RETURNS TABLE (
  id             UUID,
  student_id     UUID,
  boarding_point TEXT,
  bus_stop_no    INTEGER,
  effective_from DATE,
  effective_to   DATE,
  comment        TEXT,
  created_at     TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ,
  is_current     BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.current_user_role() NOT IN ('admin', 'coordinator') THEN
    RAISE EXCEPTION 'Staff access required';
  END IF;
  RETURN QUERY
  SELECT
    b.id,
    b.student_id,
    b.boarding_point,
    b.bus_stop_no,
    b.effective_from,
    b.effective_to,
    b.comment,
    b.created_at,
    b.updated_at,
    (b.effective_to IS NULL
      OR (b.effective_from <= (now() AT TIME ZONE 'Asia/Kolkata')::date
          AND b.effective_to >= (now() AT TIME ZONE 'Asia/Kolkata')::date)) AS is_current
  FROM public.student_boarding_details b
  WHERE b.student_id = p_student_id
  ORDER BY b.effective_from DESC, b.created_at DESC;
END;
$$;

-- ── 3. Fix upsert_student_boarding default date ──────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_student_boarding(
  p_student_id     UUID,
  p_boarding_point TEXT,
  p_bus_stop_no    INTEGER DEFAULT NULL,
  p_effective_from DATE    DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  p_comment        TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_id         UUID;
  v_role           TEXT := public.current_user_role();
  v_user_bus_id    UUID;
  v_student_bus_id UUID;
  v_close_date     DATE := p_effective_from - INTERVAL '1 day';
  v_clean_boarding TEXT := trim(p_boarding_point);
  v_clean_comment  TEXT := NULLIF(trim(COALESCE(p_comment, '')), '');
BEGIN
  IF v_role NOT IN ('admin', 'coordinator') THEN
    RAISE EXCEPTION 'Staff access required';
  END IF;

  IF v_clean_boarding = '' OR v_clean_boarding IS NULL THEN
    RAISE EXCEPTION 'Boarding point cannot be empty';
  END IF;
  IF p_effective_from IS NULL THEN
    RAISE EXCEPTION 'Effective from date is required';
  END IF;

  SELECT bus_id INTO v_student_bus_id FROM public.profiles WHERE id = p_student_id AND role = 'student';
  IF v_student_bus_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_student_id AND role = 'student') THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  IF v_role = 'coordinator' THEN
    SELECT bus_id INTO v_user_bus_id FROM public.profiles WHERE id = auth.uid();
    IF v_user_bus_id IS NULL OR v_student_bus_id IS DISTINCT FROM v_user_bus_id THEN
      RAISE EXCEPTION 'Coordinator can only assign boarding points for students on their assigned bus';
    END IF;
  END IF;

  UPDATE public.student_boarding_details
  SET effective_to = v_close_date, updated_at = now()
  WHERE student_id = p_student_id
    AND effective_to IS NULL
    AND effective_from < p_effective_from;

  INSERT INTO public.student_boarding_details
    (student_id, boarding_point, bus_stop_no, effective_from, effective_to, comment)
  VALUES
    (p_student_id, v_clean_boarding, p_bus_stop_no, p_effective_from, NULL, v_clean_comment)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION public.get_student_boarding(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_students_for_boarding(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_student_boarding(UUID, TEXT, INTEGER, DATE, TEXT) TO authenticated;
