create or replace function public.student_attendance_history()
returns table (
  status public.attendance_status,
  checked_in_at timestamptz,
  session_type text,
  bus_number text
)
language sql
security definer
set search_path = public
as $$
  select attendance.status, attendance.checked_in_at, session.session_type, bus.bus_number
  from public.attendance attendance
  join public.attendance_sessions session on session.id = attendance.session_id
  join public.buses bus on bus.id = session.bus_id
  where attendance.student_id = auth.uid()
  order by attendance.checked_in_at desc
  limit 25;
$$;

create or replace function public.admin_attendance_sheet()
returns table (
  student_id uuid,
  full_name text,
  register_number text,
  status public.attendance_status,
  checked_in_at timestamptz,
  session_type text,
  bus_number text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Only administrators can read the attendance sheet';
  end if;

  return query
  select attendance.student_id, profile.full_name, profile.register_number, attendance.status,
    attendance.checked_in_at, session.session_type, bus.bus_number
  from public.attendance attendance
  join public.profiles profile on profile.id = attendance.student_id
  join public.attendance_sessions session on session.id = attendance.session_id
  join public.buses bus on bus.id = session.bus_id
  order by attendance.checked_in_at desc
  limit 200;
end;
$$;

grant execute on function public.student_attendance_history() to authenticated;
grant execute on function public.admin_attendance_sheet() to authenticated;
