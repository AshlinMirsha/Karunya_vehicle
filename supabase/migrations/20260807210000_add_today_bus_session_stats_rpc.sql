-- Secure RPC to compute today's live session stats for a bus safely
CREATE OR REPLACE FUNCTION public.get_today_bus_session_stats(p_bus_id uuid)
RETURNS TABLE (
  session_type text,
  session_id uuid,
  total_students integer,
  present_count integer,
  absent_count integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  start_of_day_utc timestamptz;
  bus_total integer;
BEGIN
  -- Calculate 00:00:00 IST today in UTC
  start_of_day_utc := (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata');

  -- Count active students on this bus
  SELECT count(*)::integer INTO bus_total
  FROM public.profiles
  WHERE bus_id = p_bus_id AND role = 'student' AND status = 'active';

  RETURN QUERY
  SELECT 
    s.session_type,
    s.id AS session_id,
    bus_total AS total_students,
    count(distinct a.student_id)::integer AS present_count,
    greatest(0, bus_total - count(distinct a.student_id)::integer) AS absent_count
  FROM public.attendance_sessions s
  LEFT JOIN public.attendance a ON a.session_id = s.id AND a.status = 'PRESENT'
  WHERE s.bus_id = p_bus_id
    AND s.created_at >= start_of_day_utc
  GROUP BY s.id, s.session_type;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_today_bus_session_stats(uuid) TO authenticated;
