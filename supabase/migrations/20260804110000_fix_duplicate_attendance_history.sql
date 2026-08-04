-- Group attendance sessions by date and session type to prevent duplicate records
-- if multiple sessions are accidentally created for the same bus on the same day.
create or replace function public.authorized_attendance_history(
  p_bus_id uuid default null, p_date_from timestamptz default null,
  p_date_to timestamptz default null, p_status text default null
)
returns table (student_id uuid, full_name text, register_number text, bus_number text,
  session_type text, checked_in_at timestamptz, status text)
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
      s.session_type,
      date(s.created_at at time zone 'Asia/Kolkata') as session_date,
      array_agg(s.id) as session_ids,
      max(s.created_at) as session_created_at
    from public.attendance_sessions s
    where (p_bus_id is null or s.bus_id = p_bus_id)
      and (p_date_from is null or s.created_at >= p_date_from)
      and (p_date_to is null or s.created_at <= p_date_to)
      and (public.current_user_role() = 'admin' or s.bus_id = allowed_bus_id)
    group by s.bus_id, s.session_type, date(s.created_at at time zone 'Asia/Kolkata')
  ), history as (
    select
      p.id as student_id,
      p.full_name,
      p.register_number,
      b.bus_number,
      s.session_type,
      (
        select max(a.checked_in_at)
        from public.attendance a
        where a.student_id = p.id and a.session_id = any(s.session_ids)
      ) as checked_in_at,
      s.session_created_at
    from sessions s
    join public.buses b on b.id = s.bus_id
    join public.profiles p on p.bus_id = s.bus_id and p.role = 'student' and p.status = 'active'
  )
  select
    h.student_id,
    h.full_name,
    h.register_number,
    h.bus_number,
    h.session_type,
    h.checked_in_at,
    case when h.checked_in_at is null then 'ABSENT' else 'PRESENT' end status
  from history h
  where p_status is null or (case when h.checked_in_at is null then 'ABSENT' else 'PRESENT' end) = p_status
  order by coalesce(h.checked_in_at, h.session_created_at) desc nulls last, h.bus_number, h.register_number
  limit 1000;
end;
$$;
