-- Migration: Sync stop numbers and enable auto-cascading stop number updates

-- ── 1. Clean up master boarding point names for Bus 13 ───────────────────────
DO $$
DECLARE
  v_bus_id UUID;
BEGIN
  SELECT id INTO v_bus_id FROM public.buses WHERE bus_number = '13' OR bus_number = 'Bus 13' OR bus_number = 'BUS 13' LIMIT 1;
  IF v_bus_id IS NOT NULL THEN
    UPDATE public.boarding_points
    SET name = 'KUNIYAMUTHUR - Sundarapuram Pirivu', updated_at = now()
    WHERE bus_id = v_bus_id AND lower(name) LIKE 'kuniyamuthur%sundarapuram%piriv%';

    UPDATE public.boarding_points
    SET name = 'KUNIYAMUTHUR - Edayar Palyam Pirivu', updated_at = now()
    WHERE bus_id = v_bus_id AND lower(name) LIKE 'kuniyamuthur%edayar%piriv%';

    UPDATE public.boarding_points
    SET name = 'MALUMICHAMPATTI', updated_at = now()
    WHERE bus_id = v_bus_id AND lower(name) LIKE 'malumichampett%';
  END IF;
END $$;

-- ── 2. Backfill bus_stop_no in student_boarding_details ─────────────────────
UPDATE public.student_boarding_details bd
SET bus_stop_no = bp.stop_no,
    updated_at = now()
FROM public.profiles p, public.boarding_points bp
WHERE bd.student_id = p.id
  AND (bp.bus_id IS NULL OR bp.bus_id = p.bus_id)
  AND bp.is_active = true
  AND bp.stop_no IS NOT NULL
  AND (
    lower(trim(bp.name)) = lower(trim(bd.boarding_point))
    OR regexp_replace(lower(trim(bp.name)), '[\s\-]+', ' ', 'g') = regexp_replace(lower(trim(bd.boarding_point)), '[\s\-]+', ' ', 'g')
    OR (length(trim(bd.boarding_point)) >= 5 AND lower(trim(bp.name)) LIKE lower(trim(bd.boarding_point)) || '%')
    OR (length(trim(bp.name)) >= 5 AND lower(trim(bd.boarding_point)) LIKE lower(trim(bp.name)) || '%')
  );

-- Fallback backfill for any remaining active boarding details
UPDATE public.student_boarding_details bd
SET bus_stop_no = bp.stop_no,
    updated_at = now()
FROM public.boarding_points bp
WHERE bp.is_active = true
  AND bp.stop_no IS NOT NULL
  AND (
    lower(trim(bp.name)) = lower(trim(bd.boarding_point))
    OR regexp_replace(lower(trim(bp.name)), '[\s\-]+', ' ', 'g') = regexp_replace(lower(trim(bd.boarding_point)), '[\s\-]+', ' ', 'g')
    OR (length(trim(bd.boarding_point)) >= 5 AND lower(trim(bp.name)) LIKE lower(trim(bd.boarding_point)) || '%')
    OR (length(trim(bp.name)) >= 5 AND lower(trim(bd.boarding_point)) LIKE lower(trim(bp.name)) || '%')
  );

-- ── 3. Update upsert_boarding_point RPC to cascade stop_no to student_boarding_details ──
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
    WHERE (
      lower(trim(name)) = lower(v_clean_name)
      OR regexp_replace(lower(trim(name)), '[\s\-]+', ' ', 'g') = regexp_replace(lower(v_clean_name), '[\s\-]+', ' ', 'g')
    )
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

  -- Cascade stop_no update to all active student assignments for this boarding point
  IF p_stop_no IS NOT NULL THEN
    UPDATE public.student_boarding_details bd
    SET bus_stop_no = p_stop_no,
        updated_at = now()
    WHERE bd.effective_to IS NULL
      AND (
        lower(trim(bd.boarding_point)) = lower(v_clean_name)
        OR regexp_replace(lower(trim(bd.boarding_point)), '[\s\-]+', ' ', 'g') = regexp_replace(lower(v_clean_name), '[\s\-]+', ' ', 'g')
        OR (length(v_clean_name) >= 5 AND lower(trim(bd.boarding_point)) LIKE lower(v_clean_name) || '%')
        OR (length(trim(bd.boarding_point)) >= 5 AND lower(v_clean_name) LIKE lower(trim(bd.boarding_point)) || '%')
      );
  END IF;

  RETURN v_id;
END;
$$;

-- ── 4. Update upsert_student_boarding RPC ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_student_boarding(
  p_student_id     UUID,
  p_boarding_point TEXT,
  p_bus_stop_no    INTEGER DEFAULT NULL,
  p_effective_from DATE    DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
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
  v_existing_id    UUID;
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

  -- Auto-lookup bus_stop_no if NULL from master boarding_points table using normalized matching
  IF p_bus_stop_no IS NULL THEN
    SELECT stop_no INTO p_bus_stop_no
    FROM public.boarding_points
    WHERE (
      lower(trim(name)) = lower(v_clean_boarding)
      OR regexp_replace(lower(trim(name)), '[\s\-]+', ' ', 'g') = regexp_replace(lower(v_clean_boarding), '[\s\-]+', ' ', 'g')
      OR (length(v_clean_boarding) >= 5 AND lower(trim(name)) LIKE lower(v_clean_boarding) || '%')
      OR (length(trim(name)) >= 5 AND lower(v_clean_boarding) LIKE lower(trim(name)) || '%')
    )
      AND (bus_id IS NULL OR bus_id = v_student_bus_id)
      AND is_active = true
      AND stop_no IS NOT NULL
    ORDER BY CASE WHEN bus_id = v_student_bus_id THEN 1 ELSE 2 END, stop_no ASC NULLS LAST
    LIMIT 1;
  END IF;

  SELECT id INTO v_existing_id
  FROM public.student_boarding_details
  WHERE student_id = p_student_id
    AND effective_to IS NULL
    AND effective_from = p_effective_from;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.student_boarding_details
    SET boarding_point = v_clean_boarding,
        bus_stop_no = p_bus_stop_no,
        comment = v_clean_comment,
        updated_at = now()
    WHERE id = v_existing_id;

    RETURN v_existing_id;
  ELSE
    UPDATE public.student_boarding_details
    SET effective_to = CASE 
                         WHEN effective_from >= p_effective_from THEN effective_from 
                         ELSE v_close_date 
                       END,
        updated_at = now()
    WHERE student_id = p_student_id
      AND effective_to IS NULL;

    INSERT INTO public.student_boarding_details
      (student_id, boarding_point, bus_stop_no, effective_from, effective_to, comment)
    VALUES
      (p_student_id, v_clean_boarding, p_bus_stop_no, p_effective_from, NULL, v_clean_comment)
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
  END IF;
END;
$$;

-- ── 5. Update authorized_attendance_history RPC ────────────────────────────
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
    JOIN public.profiles p ON p.bus_id = s.bus_id AND p.role = 'student' AND p.status = 'active'
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
    CASE WHEN h.has_morning THEN (CASE WHEN h.m_time IS NULL THEN 'ABSENT' ELSE 'PRESENT' END) ELSE NULL END AS morning_status,
    h.m_time AS morning_checked_in_at,
    h.m_lat AS morning_latitude,
    h.m_lon AS morning_longitude,
    CASE WHEN h.has_morning AND h.m_time IS NOT NULL THEN h.m_sub ELSE NULL END AS morning_submission,

    CASE WHEN h.has_evening THEN (CASE WHEN h.e_time IS NULL THEN 'ABSENT' ELSE 'PRESENT' END) ELSE NULL END AS evening_status,
    h.e_time AS evening_checked_in_at,
    h.e_lat AS evening_latitude,
    h.e_lon AS evening_longitude,
    CASE WHEN h.has_evening AND h.e_time IS NOT NULL THEN h.e_sub ELSE NULL END AS evening_submission,

    CASE WHEN h.has_special THEN (CASE WHEN h.sp_time IS NULL THEN 'ABSENT' ELSE 'PRESENT' END) ELSE NULL END AS special_status,
    h.sp_time AS special_checked_in_at,
    h.sp_lat AS special_latitude,
    h.sp_lon AS special_longitude,
    CASE WHEN h.has_special AND h.sp_time IS NOT NULL THEN h.sp_sub ELSE NULL END AS special_submission,

    COALESCE(h.boarding_point, 'Not assigned') AS boarding_point,
    h.bus_stop_no
  FROM history h
  WHERE p_status IS NULL
     OR (h.has_morning AND (CASE WHEN h.m_time IS NULL THEN 'ABSENT' ELSE 'PRESENT' END) = p_status)
     OR (h.has_evening AND (CASE WHEN h.e_time IS NULL THEN 'ABSENT' ELSE 'PRESENT' END) = p_status)
     OR (h.has_special AND (CASE WHEN h.sp_time IS NULL THEN 'ABSENT' ELSE 'PRESENT' END) = p_status)
  ORDER BY h.session_created_at DESC NULLS LAST, h.bus_number, h.register_number
  LIMIT 1000;
END;
$$;

-- ── 6. Update search_students_for_boarding & get_student_boarding RPCs ──────
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
    (bd.id IS NOT NULL) AS has_boarding
  FROM public.profiles p
  LEFT JOIN public.buses b ON b.id = p.bus_id
  LEFT JOIN public.student_boarding_details bd
    ON bd.student_id = p.id
    AND bd.effective_to IS NULL
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

DROP FUNCTION IF EXISTS public.get_student_boarding(UUID);

CREATE OR REPLACE FUNCTION public.get_student_boarding(p_student_id UUID)
RETURNS TABLE (
  id             UUID,
  student_id     UUID,
  boarding_point TEXT,
  bus_stop_no    INTEGER,
  effective_from DATE,
  effective_to   DATE,
  comment        TEXT,
  created_at     TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ,
  is_current     BOOLEAN
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
    COALESCE(
      (
        SELECT bp.stop_no 
        FROM public.boarding_points bp 
        WHERE (
          lower(trim(bp.name)) = lower(trim(b.boarding_point))
          OR regexp_replace(lower(trim(bp.name)), '[\s\-]+', ' ', 'g') = regexp_replace(lower(trim(b.boarding_point)), '[\s\-]+', ' ', 'g')
          OR (length(trim(b.boarding_point)) >= 5 AND lower(trim(bp.name)) LIKE lower(trim(b.boarding_point)) || '%')
          OR (length(trim(bp.name)) >= 5 AND lower(trim(b.boarding_point)) LIKE lower(trim(bp.name)) || '%')
        )
          AND bp.is_active = true
          AND bp.stop_no IS NOT NULL
        ORDER BY bp.stop_no ASC NULLS LAST
        LIMIT 1
      ),
      b.bus_stop_no
    ) AS bus_stop_no,
    b.effective_from,
    b.effective_to,
    b.comment,
    b.created_at,
    b.updated_at,
    (b.effective_to IS NULL
      OR (b.effective_from <= (now() AT TIME ZONE 'Asia/Kolkata')::date
          AND b.effective_to >= (now() AT TIME ZONE 'Asia/Kolkata')::date)) AS is_current
  FROM public.student_boarding_details b
  WHERE b.student_id = p_student_id
  ORDER BY b.effective_from DESC, b.created_at DESC;
END;
$$;

-- ── 7. Grants ───────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.upsert_boarding_point(UUID, TEXT, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_student_boarding(UUID, TEXT, INTEGER, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorized_attendance_history(uuid, timestamptz, timestamptz, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_students_for_boarding(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_boarding(UUID) TO authenticated;
