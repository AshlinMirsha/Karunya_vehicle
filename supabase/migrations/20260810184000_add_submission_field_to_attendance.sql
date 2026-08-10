-- Migration: Add submission column to public.attendance and update authorized_attendance_history RPC
ALTER TABLE public.attendance 
ADD COLUMN IF NOT EXISTS submission text DEFAULT 'Self' CHECK (submission IN ('Self', 'Manual'));

-- Safely backfill existing null submission records to 'Self'
UPDATE public.attendance 
SET submission = 'Self' 
WHERE submission IS NULL;

-- Update authorized_attendance_history RPC to return session submission methods
DROP FUNCTION IF EXISTS public.authorized_attendance_history(uuid, timestamptz, timestamptz, text, text, text);

CREATE OR REPLACE FUNCTION public.authorized_attendance_history(
  p_bus_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_day_type text DEFAULT NULL
)
RETURNS TABLE (
  student_id uuid,
  full_name text,
  register_number text,
  bus_number text,
  session_date date,
  morning_status text,
  morning_checked_in_at timestamptz,
  morning_latitude double precision,
  morning_longitude double precision,
  morning_submission text,
  evening_status text,
  evening_checked_in_at timestamptz,
  evening_latitude double precision,
  evening_longitude double precision,
  evening_submission text,
  special_status text,
  special_checked_in_at timestamptz,
  special_latitude double precision,
  special_longitude double precision,
  special_submission text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE 
  allowed_bus_id uuid;
BEGIN
  IF public.current_user_role() NOT IN ('admin', 'coordinator') THEN 
    RAISE EXCEPTION 'Staff access required'; 
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('PRESENT', 'ABSENT') THEN 
    RAISE EXCEPTION 'Invalid attendance status'; 
  END IF;
  IF p_day_type IS NOT NULL AND p_day_type NOT IN ('weekday', 'weekend') THEN 
    RAISE EXCEPTION 'Invalid day type'; 
  END IF;

  SELECT bus_id INTO allowed_bus_id FROM public.profiles WHERE id = auth.uid();
  IF public.current_user_role() = 'coordinator' AND p_bus_id IS NOT NULL AND p_bus_id <> allowed_bus_id THEN
    RAISE EXCEPTION 'Coordinator access is limited to the assigned bus';
  END IF;

  RETURN QUERY
  WITH sessions AS (
    SELECT
      s.bus_id,
      date(s.created_at AT TIME ZONE 'Asia/Kolkata') AS session_date,
      array_remove(array_agg(s.id) FILTER (WHERE s.session_type = 'Morning'), NULL) AS morning_session_ids,
      array_remove(array_agg(s.id) FILTER (WHERE s.session_type = 'Evening'), NULL) AS evening_session_ids,
      array_remove(array_agg(s.id) FILTER (WHERE s.session_type = 'Special'), NULL) AS special_session_ids,
      max(s.created_at) AS session_created_at
    FROM public.attendance_sessions s
    WHERE (p_bus_id IS NULL OR s.bus_id = p_bus_id)
      AND (p_date_from IS NULL OR s.created_at >= p_date_from)
      AND (p_date_to IS NULL OR s.created_at <= p_date_to)
      AND (public.current_user_role() = 'admin' OR s.bus_id = allowed_bus_id)
      AND (p_day_type IS NULL 
           OR (p_day_type = 'weekday' AND extract(isodow FROM s.created_at AT TIME ZONE 'Asia/Kolkata') BETWEEN 1 AND 5)
           OR (p_day_type = 'weekend' AND extract(isodow FROM s.created_at AT TIME ZONE 'Asia/Kolkata') BETWEEN 6 AND 7))
    GROUP BY s.bus_id, date(s.created_at AT TIME ZONE 'Asia/Kolkata')
  ), history AS (
    SELECT
      p.id AS student_id,
      p.full_name,
      p.register_number,
      b.bus_number,
      s.session_date,
      s.session_created_at,
      coalesce(array_length(s.morning_session_ids, 1), 0) > 0 AS has_morning,
      coalesce(array_length(s.evening_session_ids, 1), 0) > 0 AS has_evening,
      coalesce(array_length(s.special_session_ids, 1), 0) > 0 AS has_special,
      (SELECT a.checked_in_at FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.morning_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS m_time,
      (SELECT a.latitude FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.morning_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS m_lat,
      (SELECT a.longitude FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.morning_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS m_lon,
      (SELECT a.submission FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.morning_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS m_sub,

      (SELECT a.checked_in_at FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.evening_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS e_time,
      (SELECT a.latitude FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.evening_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS e_lat,
      (SELECT a.longitude FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.evening_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS e_lon,
      (SELECT a.submission FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.evening_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS e_sub,

      (SELECT a.checked_in_at FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.special_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS sp_time,
      (SELECT a.latitude FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.special_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS sp_lat,
      (SELECT a.longitude FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.special_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS sp_lon,
      (SELECT a.submission FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.special_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS sp_sub
    FROM sessions s
    JOIN public.buses b ON b.id = s.bus_id
    JOIN public.profiles p ON p.bus_id = s.bus_id AND p.role = 'student' AND p.status = 'active'
    WHERE p_search IS NULL 
       OR EXISTS (
         SELECT 1 FROM unnest(string_to_array(p_search, ',')) term
         WHERE trim(term) <> '' AND (
           p.full_name ILIKE '%' || trim(term) || '%'
           OR p.register_number ILIKE '%' || trim(term) || '%'
         )
       )
  )
  SELECT
    h.student_id,
    h.full_name,
    h.register_number,
    h.bus_number,
    h.session_date,
    CASE WHEN h.has_morning THEN (CASE WHEN h.m_time IS NULL THEN 'ABSENT' ELSE 'PRESENT' END) ELSE NULL END AS morning_status,
    h.m_time AS morning_checked_in_at,
    h.m_lat AS morning_latitude,
    h.m_lon AS morning_longitude,
    CASE WHEN h.has_morning AND h.m_time IS NOT NULL THEN coalesce(h.m_sub, 'Self') ELSE NULL END AS morning_submission,

    CASE WHEN h.has_evening THEN (CASE WHEN h.e_time IS NULL THEN 'ABSENT' ELSE 'PRESENT' END) ELSE NULL END AS evening_status,
    h.e_time AS evening_checked_in_at,
    h.e_lat AS evening_latitude,
    h.e_lon AS evening_longitude,
    CASE WHEN h.has_evening AND h.e_time IS NOT NULL THEN coalesce(h.e_sub, 'Self') ELSE NULL END AS evening_submission,

    CASE WHEN h.has_special THEN (CASE WHEN h.sp_time IS NULL THEN 'ABSENT' ELSE 'PRESENT' END) ELSE NULL END AS special_status,
    h.sp_time AS special_checked_in_at,
    h.sp_lat AS special_latitude,
    h.sp_lon AS special_longitude,
    CASE WHEN h.has_special AND h.sp_time IS NOT NULL THEN coalesce(h.sp_sub, 'Self') ELSE NULL END AS special_submission
  FROM history h
  WHERE p_status IS NULL
     OR (h.has_morning AND (CASE WHEN h.m_time IS NULL THEN 'ABSENT' ELSE 'PRESENT' END) = p_status)
     OR (h.has_evening AND (CASE WHEN h.e_time IS NULL THEN 'ABSENT' ELSE 'PRESENT' END) = p_status)
     OR (h.has_special AND (CASE WHEN h.sp_time IS NULL THEN 'ABSENT' ELSE 'PRESENT' END) = p_status)
  ORDER BY h.session_created_at DESC NULLS LAST, h.bus_number, h.register_number
  LIMIT 1000;
END;
$$;

GRANT EXECUTE ON FUNCTION public.authorized_attendance_history(uuid, timestamptz, timestamptz, text, text, text) TO authenticated;
