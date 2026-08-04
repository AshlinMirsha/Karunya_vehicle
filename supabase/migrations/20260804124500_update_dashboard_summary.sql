drop function if exists public.attendance_dashboard_summary();

create or replace function public.attendance_dashboard_summary()
returns table (
  student_count integer,
  bus_count integer,
  present_today integer,
  morning_checkins integer,
  evening_checkins integer
)
language plpgsql stable security definer set search_path = public as $$
declare allowed_bus_id uuid;
begin
  if public.current_user_role() not in ('admin', 'coordinator') then raise exception 'Staff access required'; end if;
  select bus_id into allowed_bus_id from public.profiles where id = auth.uid();
  return query select
    (select count(*)::integer from public.profiles profile where profile.role = 'student'
      and (public.current_user_role() = 'admin' or profile.bus_id = allowed_bus_id)),
    (select count(*)::integer from public.buses bus where public.current_user_role() = 'admin' or bus.id = allowed_bus_id),
    (select count(distinct attendance.student_id)::integer from public.attendance attendance join public.attendance_sessions session on session.id = attendance.session_id
      where attendance.checked_in_at >= date_trunc('day', now())
        and (public.current_user_role() = 'admin' or session.bus_id = allowed_bus_id)),
    (select count(*)::integer from public.attendance attendance join public.attendance_sessions session on session.id = attendance.session_id
      where attendance.checked_in_at >= date_trunc('day', now()) and session.session_type = 'Morning'
        and (public.current_user_role() = 'admin' or session.bus_id = allowed_bus_id)),
    (select count(*)::integer from public.attendance attendance join public.attendance_sessions session on session.id = attendance.session_id
      where attendance.checked_in_at >= date_trunc('day', now()) and session.session_type = 'Evening'
        and (public.current_user_role() = 'admin' or session.bus_id = allowed_bus_id));
end;
$$;
