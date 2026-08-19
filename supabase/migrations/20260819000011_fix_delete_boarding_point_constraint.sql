-- Migration: Fix delete_boarding_point effective_to check constraint violation

DROP FUNCTION IF EXISTS public.delete_boarding_point(UUID);

CREATE OR REPLACE FUNCTION public.delete_boarding_point(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT := public.current_user_role();
  v_user_bus_id UUID;
  v_point_name TEXT;
  v_bp_bus_id UUID;
BEGIN
  IF v_role NOT IN ('admin', 'coordinator') THEN
    RAISE EXCEPTION 'Staff access required';
  END IF;

  SELECT p.bus_id INTO v_user_bus_id FROM public.profiles p WHERE p.id = auth.uid();

  SELECT name, bus_id INTO v_point_name, v_bp_bus_id
  FROM public.boarding_points
  WHERE id = p_id
    AND (v_role = 'admin' OR bus_id = v_user_bus_id OR bus_id IS NULL);

  IF v_point_name IS NULL THEN
    -- Fallback: check if boarding point exists regardless of bus_id for deletion
    SELECT name INTO v_point_name FROM public.boarding_points WHERE id = p_id;
  END IF;

  IF v_point_name IS NULL THEN
    RAISE EXCEPTION 'Boarding point not found';
  END IF;

  -- Soft delete the master boarding point
  UPDATE public.boarding_points
  SET is_active = false, updated_at = now()
  WHERE id = p_id;

  -- Close active student boarding assignments for students who had this boarding point
  -- Safely ensure effective_to >= effective_from to avoid violating boarding_dates_check constraint
  UPDATE public.student_boarding_details bd
  SET effective_to = CASE 
                       WHEN bd.effective_from >= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN bd.effective_from 
                       ELSE ((now() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 day')::date
                     END,
      bus_stop_no = NULL,
      updated_at = now()
  WHERE bd.effective_to IS NULL
    AND (
      lower(trim(bd.boarding_point)) = lower(trim(v_point_name))
      OR regexp_replace(lower(trim(bd.boarding_point)), '[\s\-]+', ' ', 'g') = regexp_replace(lower(trim(v_point_name)), '[\s\-]+', ' ', 'g')
      OR (length(trim(v_point_name)) >= 5 AND lower(trim(bd.boarding_point)) LIKE lower(trim(v_point_name)) || '%')
      OR (length(trim(bd.boarding_point)) >= 5 AND lower(trim(v_point_name)) LIKE lower(trim(bd.boarding_point)) || '%')
    );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_boarding_point(UUID) TO authenticated;
