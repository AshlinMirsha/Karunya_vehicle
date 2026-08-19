-- Migration: Update authorized_attendance_history RPC to include all assigned students (active, pending, etc.)
-- Fixes attendance history query so students with pending status or updated records are not excluded.

DROP FUNCTION IF EXISTS public.authorized_attendance_history(uuid, timestamptz, timestamptz, text, text, text);

CREATE OR REPLACE FUNCTION public.authorized_attendance_history(
  p_bus_id UUID DEFAULT NULL,
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to TIMESTAMPTZ DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_day_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  student_id UUID,
  full_name TEXT,
  register_number TEXT,
  bus_number TEXT,
  session_date DATE,
  morning_status TEXT,
  morning_checked_in_at TIMESTAMPTZ,
  morning_latitude DOUBLE PRECISION,
  morning_longitude DOUBLE PRECISION,
  morning_submission TEXT,
  evening_status TEXT,
  evening_checked_in_at TIMESTAMPTZ,
  evening_latitude DOUBLE PRECISION,
  evening_longitude DOUBLE PRECISION,
  evening_submission TEXT,
  special_status TEXT,
  special_checked_in_at TIMESTAMPTZ,
  special_latitude DOUBLE PRECISION,
  special_longitude DOUBLE PRECISION,
  special_submission TEXT,
  boarding_point TEXT,
  bus_stop_no INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE 
  allowed_bus_id UUID;
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
      bd.boarding_point,
      COALESCE(
        (
          SELECT bp.stop_no 
          FROM public.boarding_points bp 
          WHERE (
            lower(trim(bp.name)) = lower(trim(bd.boarding_point))
            OR regexp_replace(lower(trim(bp.name)), '[\s\-]+', ' ', 'g') = regexp_replace(lower(trim(bd.boarding_point)), '[\s\-]+', ' ', 'g')
            OR (length(trim(bd.boarding_point)) >= 5 AND lower(trim(bp.name)) LIKE lower(trim(bd.boarding_point)) || '%')
            OR (length(trim(bp.name)) >= 5 AND lower(trim(bd.boarding_point)) LIKE lower(trim(bp.name)) || '%')
          )
            AND (bp.bus_id IS NULL OR bp.bus_id = p.bus_id)
            AND bp.is_active = true
            AND bp.stop_no IS NOT NULL
          ORDER BY CASE WHEN bp.bus_id = p.bus_id THEN 1 ELSE 2 END, bp.stop_no ASC NULLS LAST
          LIMIT 1
        ),
        bd.bus_stop_no
      ) AS bus_stop_no,
      coalesce(array_length(s.morning_session_ids, 1), 0) > 0 AS has_morning,
      coalesce(array_length(s.evening_session_ids, 1), 0) > 0 AS has_evening,
      coalesce(array_length(s.special_session_ids, 1), 0) > 0 AS has_special,
      (SELECT a.checked_in_at FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.morning_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS m_time,
      (SELECT a.latitude FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.morning_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS m_lat,
      (SELECT a.longitude FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.morning_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS m_lon,
      (SELECT CASE WHEN a.submission = 'Manual' OR a.remark IS NOT NULL THEN 'Manual' ELSE COALESCE(a.submission, 'Self') END FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.morning_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS m_sub,

      (SELECT a.checked_in_at FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.evening_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS e_time,
      (SELECT a.latitude FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.evening_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS e_lat,
      (SELECT a.longitude FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.evening_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS e_lon,
      (SELECT CASE WHEN a.submission = 'Manual' OR a.remark IS NOT NULL THEN 'Manual' ELSE COALESCE(a.submission, 'Self') END FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.evening_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS e_sub,

      (SELECT a.checked_in_at FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.special_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS sp_time,
      (SELECT a.latitude FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.special_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS sp_lat,
      (SELECT a.longitude FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.special_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS sp_lon,
      (SELECT CASE WHEN a.submission = 'Manual' OR a.remark IS NOT NULL THEN 'Manual' ELSE COALESCE(a.submission, 'Self') END FROM public.attendance a WHERE a.student_id = p.id AND a.session_id = ANY(s.special_session_ids) ORDER BY a.checked_in_at DESC LIMIT 1) AS sp_sub
    FROM sessions s
    JOIN public.buses b ON b.id = s.bus_id
    JOIN public.profiles p ON p.bus_id = s.bus_id AND p.role = 'student' AND (p.status IS NULL OR p.status <> 'inactive')
    LEFT JOIN public.student_boarding_details bd
      ON bd.student_id = p.id AND bd.effective_to IS NULL
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
    CASE WHEN h.has_morning THEN (CASE WHEN h.m_time IS NOT NULL THEN 'PRESENT' ELSE 'ABSENT' END) ELSE 'NOT_CONDUCTED' END AS morning_status,
    h.m_time AS morning_checked_in_at,
    h.m_lat AS morning_latitude,
    h.m_lon AS morning_longitude,
    h.m_sub AS morning_submission,

    CASE WHEN h.has_evening THEN (CASE WHEN h.e_time IS NOT NULL THEN 'PRESENT' ELSE 'ABSENT' END) ELSE 'NOT_CONDUCTED' END AS evening_status,
    h.e_time AS evening_checked_in_at,
    h.e_lat AS evening_latitude,
    h.e_lon AS evening_longitude,
    h.e_sub AS evening_submission,

    CASE WHEN h.has_special THEN (CASE WHEN h.sp_time IS NOT NULL THEN 'PRESENT' ELSE 'ABSENT' END) ELSE 'NOT_CONDUCTED' END AS special_status,
    h.sp_time AS special_checked_in_at,
    h.sp_lat AS special_latitude,
    h.sp_lon AS special_longitude,
    h.sp_sub AS special_submission,

    h.boarding_point,
    h.bus_stop_no
  FROM history h
  WHERE (
    p_status IS NULL OR (
      (p_status = 'PRESENT' AND (
        (h.has_morning AND h.m_time IS NOT NULL) OR
        (h.has_evening AND h.e_time IS NOT NULL) OR
        (h.has_special AND h.sp_time IS NOT NULL)
      ))
      OR
      (p_status = 'ABSENT' AND (
        (h.has_morning AND h.m_time IS NULL) OR
        (h.has_evening AND h.e_time IS NULL) OR
        (h.has_special AND h.sp_time IS NULL)
      ))
    )
  )
  ORDER BY h.session_created_at DESC, h.full_name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.authorized_attendance_history(uuid, timestamptz, timestamptz, text, text, text) TO authenticated;
