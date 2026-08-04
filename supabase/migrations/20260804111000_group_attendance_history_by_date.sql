drop function if exists public.authorized_attendance_history(uuid, timestamptz, timestamptz, text);

create function public.authorized_attendance_history(
  p_bus_id uuid default null, p_date_from timestamptz default null,
  p_date_to timestamptz default null, p_status text default null
)
returns table (
  student_id uuid,
  full_name text,
  register_number text,
  bus_number text,
  session_date date,
  morning_status text,
  morning_checked_in_at timestamptz,
  morning_latitude double precision,
  morning_longitude double precision,
  evening_status text,
  evening_checked_in_at timestamptz,
  evening_latitude double precision,
  evening_longitude double precision
)
language plpgsql stable security definer set search_path = public as $$
declare allowed_bus_id uuid;
begin
  if public.current_user_role() not in ('admin', 'coordinator') then raise exception 'Staff access required'; end if;
  if p_status is not null and p_status not in ('PRESENT', 'ABSENT') then raise exception 'Invalid attendance status'; end if;
  select bus_id into allowed_bus_id from public.profiles where id = auth.uid();
  if public.current_user_role() = 'coordinator' and p_bus_id is not null and p_bus_id <> allowed_bus_id then
    raise exception 'Coordinator access is limited to the assigned bus';
  end if;
  return query
  with sessions as (
    select
      s.bus_id,
      date(s.created_at at time zone 'Asia/Kolkata') as session_date,
      array_remove(array_agg(s.id) filter (where s.session_type = 'Morning'), null) as morning_session_ids,
      array_remove(array_agg(s.id) filter (where s.session_type = 'Evening'), null) as evening_session_ids,
      max(s.created_at) as session_created_at
    from public.attendance_sessions s
    where (p_bus_id is null or s.bus_id = p_bus_id)
      and (p_date_from is null or s.created_at >= p_date_from)
      and (p_date_to is null or s.created_at <= p_date_to)
      and (public.current_user_role() = 'admin' or s.bus_id = allowed_bus_id)
    group by s.bus_id, date(s.created_at at time zone 'Asia/Kolkata')
  ), history as (
    select
      p.id as student_id,
      p.full_name,
      p.register_number,
      b.bus_number,
      s.session_date,
      s.session_created_at,
      coalesce(array_length(s.morning_session_ids, 1), 0) > 0 as has_morning,
      coalesce(array_length(s.evening_session_ids, 1), 0) > 0 as has_evening,
      (select a.checked_in_at from public.attendance a where a.student_id = p.id and a.session_id = any(s.morning_session_ids) order by a.checked_in_at desc limit 1) as m_time,
      (select a.latitude from public.attendance a where a.student_id = p.id and a.session_id = any(s.morning_session_ids) order by a.checked_in_at desc limit 1) as m_lat,
      (select a.longitude from public.attendance a where a.student_id = p.id and a.session_id = any(s.morning_session_ids) order by a.checked_in_at desc limit 1) as m_lon,
      (select a.checked_in_at from public.attendance a where a.student_id = p.id and a.session_id = any(s.evening_session_ids) order by a.checked_in_at desc limit 1) as e_time,
      (select a.latitude from public.attendance a where a.student_id = p.id and a.session_id = any(s.evening_session_ids) order by a.checked_in_at desc limit 1) as e_lat,
      (select a.longitude from public.attendance a where a.student_id = p.id and a.session_id = any(s.evening_session_ids) order by a.checked_in_at desc limit 1) as e_lon
    from sessions s
    join public.buses b on b.id = s.bus_id
    join public.profiles p on p.bus_id = s.bus_id and p.role = 'student' and p.status = 'active'
  )
  select
    h.student_id,
    h.full_name,
    h.register_number,
    h.bus_number,
    h.session_date,
    case when h.has_morning then (case when h.m_time is null then 'ABSENT' else 'PRESENT' end) else null end as morning_status,
    h.m_time as morning_checked_in_at,
    h.m_lat as morning_latitude,
    h.m_lon as morning_longitude,
    case when h.has_evening then (case when h.e_time is null then 'ABSENT' else 'PRESENT' end) else null end as evening_status,
    h.e_time as evening_checked_in_at,
    h.e_lat as evening_latitude,
    h.e_lon as evening_longitude
  from history h
  where p_status is null
     or (h.has_morning and (case when h.m_time is null then 'ABSENT' else 'PRESENT' end) = p_status)
     or (h.has_evening and (case when h.e_time is null then 'ABSENT' else 'PRESENT' end) = p_status)
  order by h.session_created_at desc nulls last, h.bus_number, h.register_number
  limit 1000;
end;
$$;
