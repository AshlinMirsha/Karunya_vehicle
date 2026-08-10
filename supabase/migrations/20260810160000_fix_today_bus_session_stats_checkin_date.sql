-- Migration: Update get_today_bus_session_stats to reliably detect today's sessions created since IST midnight
DROP FUNCTION IF EXISTS public.get_today_bus_session_stats(uuid);

CREATE OR REPLACE FUNCTION public.get_today_bus_session_stats(p_bus_id uuid DEFAULT NULL)
RETURNS TABLE (
  session_type text,
  session_exists boolean,
  total_students integer,
  present_count integer,
  absent_count integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  start_of_today_ist timestamptz;
  bus_total integer;
  has_morning boolean := false;
  has_evening boolean := false;
  m_present integer := 0;
  e_present integer := 0;
BEGIN
  -- Get start of today (00:00:00 IST) in timestamptz
  start_of_today_ist := date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';

  -- Count total active students assigned (to specific bus or all buses if p_bus_id is NULL)
  SELECT count(*)::integer INTO bus_total
  FROM public.profiles
  WHERE (p_bus_id IS NULL OR bus_id = p_bus_id) AND role = 'student' AND status = 'active';

  -- Check if Morning / Evening sessions exist today (created since 00:00:00 IST today)
  SELECT 
    bool_or(s.session_type = 'Morning'),
    bool_or(s.session_type = 'Evening')
  INTO has_morning, has_evening
  FROM public.attendance_sessions s
  WHERE (p_bus_id IS NULL OR s.bus_id = p_bus_id)
    AND s.created_at >= start_of_today_ist;

  IF has_morning IS NULL THEN has_morning := false; END IF;
  IF has_evening IS NULL THEN has_evening := false; END IF;

  -- Count distinct present students for Morning session today
  IF has_morning THEN
    SELECT count(distinct a.student_id)::integer INTO m_present
    FROM public.attendance a
    JOIN public.attendance_sessions s ON a.session_id = s.id
    WHERE (p_bus_id IS NULL OR s.bus_id = p_bus_id)
      AND s.session_type = 'Morning'
      AND s.created_at >= start_of_today_ist
      AND a.status = 'PRESENT';
  END IF;

  -- Count distinct present students for Evening session today
  IF has_evening THEN
    SELECT count(distinct a.student_id)::integer INTO e_present
    FROM public.attendance a
    JOIN public.attendance_sessions s ON a.session_id = s.id
    WHERE (p_bus_id IS NULL OR s.bus_id = p_bus_id)
      AND s.session_type = 'Evening'
      AND s.created_at >= start_of_today_ist
      AND a.status = 'PRESENT';
  END IF;

  IF m_present IS NULL THEN m_present := 0; END IF;
  IF e_present IS NULL THEN e_present := 0; END IF;

  RETURN QUERY VALUES
    ('Morning'::text, has_morning, bus_total, m_present, greatest(0, bus_total - m_present)),
    ('Evening'::text, has_evening, bus_total, e_present, greatest(0, bus_total - e_present));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_today_bus_session_stats(uuid) TO authenticated;
