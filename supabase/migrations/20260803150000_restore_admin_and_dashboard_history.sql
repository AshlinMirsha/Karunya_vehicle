-- Restore the Admin role after the coordinator-only experiment.  Role lookup
-- remains database-backed; browser email/domain checks never grant privilege.
alter table public.profiles drop constraint if exists profiles_role_no_admin_check;
alter table public.profiles add constraint profiles_role_with_admin_check
check (role in ('student', 'coordinator', 'admin'));

update public.profiles
set role = 'admin', bus_id = (select id from public.buses where bus_number = '1'), status = 'active'
where lower(email) = 'lohita@karunya.edu.in';

create or replace function public.create_profile_for_karunya_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  assigned_bus_id uuid;
  assigned_role public.user_role := 'student';
  normalized_email text := lower(new.email);
begin
  if normalized_email = 'lohita@karunya.edu.in' then
    assigned_role := 'admin';
    select id into assigned_bus_id from public.buses where bus_number = '1';
  elsif normalized_email = 'ashlinmirsha@karunya.edu.in' then
    assigned_role := 'coordinator';
    select id into assigned_bus_id from public.buses where bus_number = '1';
  elsif normalized_email in ('manickraja@karunya.edu', 'manickaraja@karunya.edu') then
    assigned_role := 'coordinator';
    select id into assigned_bus_id from public.buses where bus_number = '2';
  elsif normalized_email not like '%@karunya.edu.in' then
    raise exception 'Only @karunya.edu.in users, and assigned @karunya.edu coordinators, are allowed';
  end if;

  insert into public.profiles (id, email, full_name, role, register_number, bus_id, status)
  values (new.id, normalized_email, coalesce(new.raw_user_meta_data->>'full_name', ''), assigned_role,
    upper(split_part(normalized_email, '@', 1)), assigned_bus_id,
    case when assigned_bus_id is null then 'pending_assignment' else 'active' end);
  return new;
end;
$$;

drop policy if exists "read assigned bus" on public.buses;
create policy "read authorized buses" on public.buses for select to authenticated using (
  public.current_user_role() = 'admin'
  or id = (select bus_id from public.profiles where id = auth.uid())
);

drop policy if exists "read own profile" on public.profiles;
create policy "read own or admin profiles" on public.profiles for select to authenticated using (
  id = auth.uid() or public.current_user_role() = 'admin'
);

drop policy if exists "read authorized attendance" on public.attendance;
create policy "read authorized attendance" on public.attendance for select to authenticated using (
  student_id = auth.uid() or public.current_user_role() = 'admin' or (
    public.current_user_role() = 'coordinator' and exists (
      select 1 from public.attendance_sessions session
      where session.id = attendance.session_id
        and session.bus_id = (select bus_id from public.profiles where id = auth.uid())
    )
  )
);

drop policy if exists "read authorized attendance sessions" on public.attendance_sessions;
create policy "read authorized attendance sessions" on public.attendance_sessions for select to authenticated using (
  public.current_user_role() = 'admin' or (
    public.current_user_role() = 'coordinator' and bus_id = (select bus_id from public.profiles where id = auth.uid())
  ) or exists (select 1 from public.attendance where attendance.session_id = attendance_sessions.id and attendance.student_id = auth.uid())
);

create or replace function public.authorized_bus_records()
returns table (id uuid, bus_number text, route text)
language sql stable security definer set search_path = public as $$
  select bus.id, bus.bus_number, bus.route from public.buses bus
  where public.current_user_role() = 'admin'
     or bus.id = (select bus_id from public.profiles where id = auth.uid())
  order by bus.bus_number;
$$;

create or replace function public.attendance_dashboard_summary()
returns table (student_count integer, bus_count integer, checkins_today integer)
language plpgsql stable security definer set search_path = public as $$
declare allowed_bus_id uuid;
begin
  if public.current_user_role() not in ('admin', 'coordinator') then raise exception 'Staff access required'; end if;
  select bus_id into allowed_bus_id from public.profiles where id = auth.uid();
  return query select
    (select count(*)::integer from public.profiles profile where profile.role = 'student'
      and (public.current_user_role() = 'admin' or profile.bus_id = allowed_bus_id)),
    (select count(*)::integer from public.buses bus where public.current_user_role() = 'admin' or bus.id = allowed_bus_id),
    (select count(*)::integer from public.attendance attendance join public.attendance_sessions session on session.id = attendance.session_id
      where attendance.checked_in_at >= date_trunc('day', now())
        and (public.current_user_role() = 'admin' or session.bus_id = allowed_bus_id));
end;
$$;

-- A record is present when a student checked in for a completed session; all
-- other active students assigned to that session's bus are absent.
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
    where s.expires_at <= now()
      and (p_bus_id is null or s.bus_id = p_bus_id)
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

grant execute on function public.authorized_bus_records() to authenticated;
grant execute on function public.attendance_dashboard_summary() to authenticated;
grant execute on function public.authorized_attendance_history(uuid, timestamptz, timestamptz, text) to authenticated;
