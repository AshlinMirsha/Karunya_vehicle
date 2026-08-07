-- Secure RPC to fetch email logs safely for authorized staff
CREATE OR REPLACE FUNCTION public.authorized_email_logs()
RETURNS TABLE (
  id uuid,
  bus_number text,
  session_type text,
  created_at timestamptz,
  email_status text,
  email_error text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE allowed_bus_id uuid;
BEGIN
  IF public.current_user_role() NOT IN ('admin', 'coordinator') THEN 
    RAISE EXCEPTION 'Staff access required'; 
  END IF;

  SELECT bus_id INTO allowed_bus_id FROM public.profiles WHERE id = auth.uid();

  RETURN QUERY
  SELECT 
    s.id,
    b.bus_number,
    s.session_type,
    s.created_at,
    COALESCE(s.email_status, 'sent'),
    s.email_error
  FROM public.attendance_sessions s
  JOIN public.buses b ON b.id = s.bus_id
  WHERE (public.current_user_role() = 'admin' OR s.bus_id = allowed_bus_id)
    AND s.created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
  ORDER BY s.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.authorized_email_logs() TO authenticated;
