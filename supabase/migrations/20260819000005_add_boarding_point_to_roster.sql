-- Migration: Add boarding_point to authorized_student_records RPC

DROP FUNCTION IF EXISTS public.authorized_student_records();

CREATE OR REPLACE FUNCTION public.authorized_student_records()
RETURNS TABLE (
  full_name       TEXT,
  register_number TEXT,
  email           TEXT,
  bus_number      TEXT,
  status          TEXT,
  boarding_point  TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  allowed_bus_id UUID;
BEGIN
  IF public.current_user_role() NOT IN ('admin', 'coordinator') THEN
    RAISE EXCEPTION 'Staff access required';
  END IF;

  SELECT bus_id INTO allowed_bus_id FROM public.profiles WHERE id = auth.uid();

  RETURN QUERY
  SELECT
    p.full_name,
    p.register_number,
    p.email,
    b.bus_number,
    p.status,
    COALESCE(bd.boarding_point, 'Not assigned') AS boarding_point
  FROM public.profiles p
  JOIN public.buses b ON b.id = p.bus_id
  LEFT JOIN public.student_boarding_details bd
    ON bd.student_id = p.id
    AND bd.effective_to IS NULL
  WHERE p.role = 'student'
    AND (public.current_user_role() = 'admin' OR p.bus_id = allowed_bus_id)

  UNION ALL

  SELECT
    pending.full_name,
    pending.register_number,
    pending.email,
    b.bus_number,
    'awaiting first sign-in' AS status,
    'Not assigned' AS boarding_point
  FROM public.pending_student_assignments pending
  JOIN public.buses b ON b.id = pending.bus_id
  WHERE public.current_user_role() = 'admin' OR pending.bus_id = allowed_bus_id

  ORDER BY bus_number, register_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.authorized_student_records() TO authenticated;
