-- Patch: Remove actual_boarding_point column from student_boarding_details
-- The column was included in the initial migration but is no longer required.

-- ── 1. Drop the column ────────────────────────────────────────────────────────
ALTER TABLE public.student_boarding_details
  DROP COLUMN IF EXISTS actual_boarding_point;

-- ── 2. Re-create get_student_boarding without actual_boarding_point ───────────
-- Must DROP first because the return type (OUT columns) is changing.
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
    (b.effective_from <= CURRENT_DATE
      AND (b.effective_to IS NULL OR b.effective_to >= CURRENT_DATE)) AS is_current
  FROM public.student_boarding_details b
  WHERE b.student_id = p_student_id
  ORDER BY b.effective_from DESC, b.created_at DESC;
END;
$$;

-- ── 3. Re-create upsert_student_boarding without actual_boarding_point ────────
-- Drop the old overload with 6 params first to avoid signature clash
DROP FUNCTION IF EXISTS public.upsert_student_boarding(UUID, TEXT, TEXT, INTEGER, DATE, TEXT);

CREATE OR REPLACE FUNCTION public.upsert_student_boarding(
  p_student_id     UUID,
  p_boarding_point TEXT,
  p_bus_stop_no    INTEGER DEFAULT NULL,
  p_effective_from DATE    DEFAULT CURRENT_DATE,
  p_comment        TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_id         UUID;
  v_close_date     DATE := p_effective_from - INTERVAL '1 day';
  v_clean_boarding TEXT := trim(p_boarding_point);
  v_clean_comment  TEXT := NULLIF(trim(COALESCE(p_comment, '')), '');
BEGIN
  IF public.current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF v_clean_boarding = '' OR v_clean_boarding IS NULL THEN
    RAISE EXCEPTION 'Boarding point cannot be empty';
  END IF;
  IF p_effective_from IS NULL THEN
    RAISE EXCEPTION 'Effective from date is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_student_id AND role = 'student') THEN
    RAISE EXCEPTION 'Student not found';
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

GRANT EXECUTE ON FUNCTION public.upsert_student_boarding(UUID, TEXT, INTEGER, DATE, TEXT) TO authenticated;
