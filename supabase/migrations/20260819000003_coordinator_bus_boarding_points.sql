-- Migration: Add bus_id to boarding_points and enable Bus Coordinator management

-- ── 1. Table structure ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.boarding_points (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id      UUID        REFERENCES public.buses(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL CHECK (trim(name) <> ''),
  stop_no     INTEGER,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.boarding_points
  ADD COLUMN IF NOT EXISTS bus_id UUID REFERENCES public.buses(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_boarding_points_bus_id ON public.boarding_points(bus_id);

-- Drop old unique constraints/indexes and create bus-scoped unique index
DROP INDEX IF EXISTS idx_boarding_points_name_key;
ALTER TABLE public.boarding_points DROP CONSTRAINT IF EXISTS boarding_points_name_key;
DROP INDEX IF EXISTS idx_boarding_points_bus_name;

CREATE UNIQUE INDEX idx_boarding_points_bus_name
  ON public.boarding_points (COALESCE(bus_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(trim(name)))
  WHERE is_active = true;

-- ── 2. RLS policies ───────────────────────────────────────────────────────────
ALTER TABLE public.boarding_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage boarding points" ON public.boarding_points;
DROP POLICY IF EXISTS "staff and students read active boarding points" ON public.boarding_points;
DROP POLICY IF EXISTS "coordinators manage bus boarding points" ON public.boarding_points;
DROP POLICY IF EXISTS "students read bus boarding points" ON public.boarding_points;

-- Admins: full access
CREATE POLICY "admins manage boarding points"
  ON public.boarding_points FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- Coordinators: full access for points on their assigned bus
CREATE POLICY "coordinators manage bus boarding points"
  ON public.boarding_points FOR ALL TO authenticated
  USING (
    public.current_user_role() = 'coordinator'
    AND (bus_id IS NULL OR bus_id = (SELECT bus_id FROM public.profiles WHERE id = auth.uid()))
  )
  WITH CHECK (
    public.current_user_role() = 'coordinator'
    AND (bus_id IS NULL OR bus_id = (SELECT bus_id FROM public.profiles WHERE id = auth.uid()))
  );

-- Students: read active points for their assigned bus
CREATE POLICY "students read bus boarding points"
  ON public.boarding_points FOR SELECT TO authenticated
  USING (
    is_active = true
    AND (
      bus_id IS NULL
      OR bus_id = (SELECT bus_id FROM public.profiles WHERE id = auth.uid())
    )
  );

-- ── 3. RPC: get_boarding_points ───────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_boarding_points();
DROP FUNCTION IF EXISTS public.get_boarding_points(UUID);

CREATE OR REPLACE FUNCTION public.get_boarding_points(p_bus_id UUID DEFAULT NULL)
RETURNS TABLE (
  id         UUID,
  bus_id     UUID,
  name       TEXT,
  stop_no    INTEGER,
  is_active  BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT := public.current_user_role();
  v_user_bus_id UUID;
  v_target_bus_id UUID;
BEGIN
  SELECT p.bus_id INTO v_user_bus_id FROM public.profiles p WHERE p.id = auth.uid();

  IF v_role = 'coordinator' THEN
    v_target_bus_id := v_user_bus_id;
  ELSIF v_role = 'student' THEN
    v_target_bus_id := v_user_bus_id;
  ELSE
    v_target_bus_id := COALESCE(p_bus_id, NULL);
  END IF;

  RETURN QUERY
  SELECT b.id, b.bus_id, b.name, b.stop_no, b.is_active, b.created_at
  FROM public.boarding_points b
  WHERE b.is_active = true
    AND (v_target_bus_id IS NULL OR b.bus_id IS NULL OR b.bus_id = v_target_bus_id)
  ORDER BY b.stop_no ASC NULLS LAST, b.name ASC;
END;
$$;

-- ── 4. RPC: upsert_boarding_point ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.upsert_boarding_point(UUID, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.upsert_boarding_point(UUID, TEXT, INTEGER, UUID);

CREATE OR REPLACE FUNCTION public.upsert_boarding_point(
  p_id      UUID DEFAULT NULL,
  p_name    TEXT DEFAULT NULL,
  p_stop_no INTEGER DEFAULT NULL,
  p_bus_id  UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_role TEXT := public.current_user_role();
  v_user_bus_id UUID;
  v_target_bus_id UUID;
  v_clean_name TEXT := trim(COALESCE(p_name, ''));
BEGIN
  IF v_role NOT IN ('admin', 'coordinator') THEN
    RAISE EXCEPTION 'Staff access required';
  END IF;

  IF v_clean_name = '' THEN
    RAISE EXCEPTION 'Boarding point name cannot be empty';
  END IF;

  SELECT p.bus_id INTO v_user_bus_id FROM public.profiles p WHERE p.id = auth.uid();

  IF v_role = 'coordinator' THEN
    IF v_user_bus_id IS NULL THEN
      RAISE EXCEPTION 'Coordinator has no assigned bus';
    END IF;
    v_target_bus_id := v_user_bus_id;
  ELSE
    v_target_bus_id := COALESCE(p_bus_id, v_user_bus_id);
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.boarding_points
    SET name = v_clean_name,
        stop_no = p_stop_no,
        bus_id = COALESCE(v_target_bus_id, bus_id),
        is_active = true,
        updated_at = now()
    WHERE id = p_id
      AND (v_role = 'admin' OR bus_id = v_user_bus_id)
    RETURNING id INTO v_id;
  ELSE
    SELECT id INTO v_id FROM public.boarding_points
    WHERE lower(name) = lower(v_clean_name)
      AND (bus_id IS NOT DISTINCT FROM v_target_bus_id);

    IF v_id IS NOT NULL THEN
      UPDATE public.boarding_points
      SET name = v_clean_name,
          stop_no = p_stop_no,
          is_active = true,
          updated_at = now()
      WHERE id = v_id;
    ELSE
      INSERT INTO public.boarding_points (name, stop_no, bus_id)
      VALUES (v_clean_name, p_stop_no, v_target_bus_id)
      RETURNING id INTO v_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- ── 5. RPC: delete_boarding_point ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_boarding_point(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT := public.current_user_role();
  v_user_bus_id UUID;
BEGIN
  IF v_role NOT IN ('admin', 'coordinator') THEN
    RAISE EXCEPTION 'Staff access required';
  END IF;

  SELECT p.bus_id INTO v_user_bus_id FROM public.profiles p WHERE p.id = auth.uid();

  UPDATE public.boarding_points
  SET is_active = false, updated_at = now()
  WHERE id = p_id
    AND (v_role = 'admin' OR bus_id = v_user_bus_id);

  RETURN true;
END;
$$;

-- ── 6. RPC: upsert_student_boarding (allowing Coordinators for bus students) ──
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

-- ── 7. RPC: search_students_for_boarding ─────────────────────────────────────
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
    AND bd.effective_from <= CURRENT_DATE
    AND (bd.effective_to IS NULL OR bd.effective_to >= CURRENT_DATE)
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

-- ── 8. Grants ─────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_boarding_points(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_boarding_point(UUID, TEXT, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_boarding_point(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_student_boarding(UUID, TEXT, INTEGER, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_students_for_boarding(TEXT, UUID) TO authenticated;
