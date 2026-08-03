-- Attendance history must be visible immediately after a QR session is made.
-- A student without a check-in is reported as ABSENT so the existing status
-- filter remains useful both during and after the session window.
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
    select s.id, s.bus_id, s.session_type, s.created_at
    from public.attendance_sessions s
    where (p_bus_id is null or s.bus_id = p_bus_id)
      and (p_date_from is null or s.created_at >= p_date_from)
      and (p_date_to is null or s.created_at <= p_date_to)
      and (public.current_user_role() = 'admin' or s.bus_id = allowed_bus_id)
  ), history as (
    select p.id student_id, p.full_name, p.register_number, b.bus_number, s.session_type,
      a.checked_in_at, case when a.id is null then 'ABSENT' else 'PRESENT' end status
    from sessions s
    join public.buses b on b.id = s.bus_id
    join public.profiles p on p.bus_id = s.bus_id and p.role = 'student' and p.status = 'active'
    left join public.attendance a on a.session_id = s.id and a.student_id = p.id
  ) select * from history where p_status is null or history.status = p_status
  order by checked_in_at desc nulls last, bus_number, register_number limit 1000;
end;
$$;

grant execute on function public.authorized_attendance_history(uuid, timestamptz, timestamptz, text) to authenticated;
