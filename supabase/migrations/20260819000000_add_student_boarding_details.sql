-- Migration: Add student_boarding_details table and supporting RPCs
-- Relationship: student_boarding_details.student_id → profiles.id
-- Existing profiles, attendance, and QR flow are NOT touched.

-- ── 1. Table ──────────────────────────────────────────────────────────────────
CREATE TABLE public.student_boarding_details (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  boarding_point        TEXT        NOT NULL CHECK (trim(boarding_point) <> ''),
  bus_stop_no           INTEGER,
  effective_from        DATE        NOT NULL,
  effective_to          DATE,
  comment               TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT boarding_dates_check CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- ── 2. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX idx_boarding_details_student
  ON public.student_boarding_details(student_id);

-- DB-enforced: only ONE active (effective_to IS NULL) record per student at a time
CREATE UNIQUE INDEX idx_boarding_one_active_per_student
  ON public.student_boarding_details(student_id)
  WHERE effective_to IS NULL;

-- ── 3. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.student_boarding_details ENABLE ROW LEVEL SECURITY;

-- Admins: full CRUD
CREATE POLICY "admins manage boarding details"
  ON public.student_boarding_details
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- Students: read their own record only
CREATE POLICY "students read own boarding"
  ON public.student_boarding_details
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- Coordinators: read boarding records of students on their assigned bus
CREATE POLICY "coordinators read bus boarding"
  ON public.student_boarding_details
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'coordinator'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = student_boarding_details.student_id
        AND p.bus_id = (SELECT bus_id FROM public.profiles WHERE id = auth.uid())
    )
  );

-- ── 4. updated_at trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_boarding_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_boarding_updated_at
  BEFORE UPDATE ON public.student_boarding_details
  FOR EACH ROW EXECUTE FUNCTION public.set_boarding_updated_at();

-- ── 5. RPC: get_student_boarding ──────────────────────────────────────────────
-- Fetches full boarding history (newest first), with is_current flag.
CREATE OR REPLACE FUNCTION public.get_student_boarding(p_student_id UUID)
RETURNS TABLE (
  id                    UUID,
  student_id            UUID,
  boarding_point        TEXT,
  bus_stop_no           INTEGER,
  effective_from        DATE,
  effective_to          DATE,
  comment               TEXT,
  created_at            TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ,
  is_current            BOOLEAN
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

-- ── 6. RPC: upsert_student_boarding ──────────────────────────────────────────
-- Admin-only. Closes the existing active record then inserts a new one.
-- Old records are NEVER overwritten or deleted.
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

  -- Verify student exists
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_student_id AND role = 'student') THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  -- Close existing active record only if the new record starts later
  UPDATE public.student_boarding_details
  SET effective_to = v_close_date, updated_at = now()
  WHERE student_id = p_student_id
    AND effective_to IS NULL
    AND effective_from < p_effective_from;

  -- Insert new record
  INSERT INTO public.student_boarding_details
    (student_id, boarding_point, bus_stop_no, effective_from, effective_to, comment)
  VALUES
    (p_student_id, v_clean_boarding, p_bus_stop_no, p_effective_from, NULL, v_clean_comment)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- ── 7. RPC: search_students_for_boarding ─────────────────────────────────────
-- Admin-only student search; also returns the current active boarding point.
CREATE OR REPLACE FUNCTION public.search_students_for_boarding(p_query TEXT)
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
BEGIN
  IF public.current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
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
GRANT EXECUTE ON FUNCTION public.get_student_boarding(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_student_boarding(UUID, TEXT, INTEGER, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_students_for_boarding(TEXT) TO authenticated;
