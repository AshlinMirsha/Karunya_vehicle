-- Migration: Add boarding_points master table and management RPCs

-- ── 1. Table ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.boarding_points (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL UNIQUE CHECK (trim(name) <> ''),
  stop_no     INTEGER,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for ordering
CREATE INDEX IF NOT EXISTS idx_boarding_points_stop_name ON public.boarding_points(stop_no, name);

-- ── 2. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.boarding_points ENABLE ROW LEVEL SECURITY;

-- Admins: full access
CREATE POLICY "admins manage boarding points"
  ON public.boarding_points
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- Coordinators and Students: read active boarding points
CREATE POLICY "staff and students read active boarding points"
  ON public.boarding_points
  FOR SELECT TO authenticated
  USING (is_active = true);

-- ── 3. updated_at trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_boarding_points_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_boarding_points_updated_at ON public.boarding_points;
CREATE TRIGGER trg_boarding_points_updated_at
  BEFORE UPDATE ON public.boarding_points
  FOR EACH ROW EXECUTE FUNCTION public.set_boarding_points_updated_at();

-- ── 4. RPC: get_boarding_points ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_boarding_points()
RETURNS TABLE (
  id         UUID,
  name       TEXT,
  stop_no    INTEGER,
  is_active  BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT b.id, b.name, b.stop_no, b.is_active, b.created_at
  FROM public.boarding_points b
  WHERE b.is_active = true
  ORDER BY b.stop_no ASC NULLS LAST, b.name ASC;
END;
$$;

-- ── 5. RPC: upsert_boarding_point ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_boarding_point(
  p_id      UUID DEFAULT NULL,
  p_name    TEXT DEFAULT NULL,
  p_stop_no INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_clean_name TEXT := trim(COALESCE(p_name, ''));
BEGIN
  IF public.current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF v_clean_name = '' THEN
    RAISE EXCEPTION 'Boarding point name cannot be empty';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.boarding_points
    SET name = v_clean_name,
        stop_no = p_stop_no,
        is_active = true,
        updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    -- Check if inactive record exists with same name, reactivate if so
    SELECT id INTO v_id FROM public.boarding_points WHERE lower(name) = lower(v_clean_name);
    IF v_id IS NOT NULL THEN
      UPDATE public.boarding_points
      SET name = v_clean_name,
          stop_no = p_stop_no,
          is_active = true,
          updated_at = now()
      WHERE id = v_id;
    ELSE
      INSERT INTO public.boarding_points (name, stop_no)
      VALUES (v_clean_name, p_stop_no)
      RETURNING id INTO v_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- ── 6. RPC: delete_boarding_point ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_boarding_point(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  UPDATE public.boarding_points
  SET is_active = false, updated_at = now()
  WHERE id = p_id;

  RETURN true;
END;
$$;

-- ── 7. Grants ─────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_boarding_points() TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_boarding_point(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_boarding_point(UUID) TO authenticated;
