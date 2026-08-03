-- Current role model: only students and bus coordinators are valid.
-- The historical enum value 'admin' may exist, but live profiles cannot use it.
drop function if exists public.admin_coordinator_count();
drop function if exists public.admin_student_records(uuid);
drop function if exists public.admin_bus_records();
drop function if exists public.ensure_current_user_admin();
drop function if exists public.admin_attendance_sheet();

update public.profiles
set
  role = 'coordinator',
  bus_id = (select id from public.buses where bus_number = '1'),
  status = 'active'
where lower(email) = 'ashlinmirsha@karunya.edu.in';

update public.profiles
set
  role = 'coordinator',
  bus_id = (select id from public.buses where bus_number = '2'),
  status = 'active'
where lower(email) in ('manickraja@karunya.edu', 'manickaraja@karunya.edu');

alter table public.profiles drop constraint if exists profiles_role_no_admin_check;
alter table public.profiles add constraint profiles_role_no_admin_check
check (role in ('student', 'coordinator'));

drop policy if exists "admins manage profiles" on public.profiles;
drop policy if exists "read own profile" on public.profiles;
drop policy if exists "admins manage buses" on public.buses;
drop policy if exists "read assigned bus" on public.buses;
drop policy if exists "read authorized attendance" on public.attendance;
drop policy if exists "read authorized attendance sessions" on public.attendance_sessions;

create policy "read assigned bus"
on public.buses
for select
to authenticated
using (
  id = (select bus_id from public.profiles where id = auth.uid())
);

create policy "read own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "read authorized attendance"
on public.attendance
for select
to authenticated
using (
  student_id = auth.uid()
  or (
    public.current_user_role() = 'coordinator'
    and exists (
      select 1
      from public.attendance_sessions session
      where session.id = attendance.session_id
        and session.bus_id = (select bus_id from public.profiles where id = auth.uid())
    )
  )
);

create policy "read authorized attendance sessions"
on public.attendance_sessions
for select
to authenticated
using (
  (
    public.current_user_role() = 'coordinator'
    and bus_id = (select bus_id from public.profiles where id = auth.uid())
  )
  or exists (
    select 1
    from public.attendance
    where attendance.session_id = attendance_sessions.id
      and attendance.student_id = auth.uid()
  )
);

create or replace function public.create_profile_for_karunya_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_bus_id uuid;
  assigned_role public.user_role := 'student';
  normalized_email text := lower(new.email);
begin
  if normalized_email = 'ashlinmirsha@karunya.edu.in' then
    assigned_role := 'coordinator';
    select id into assigned_bus_id from public.buses where bus_number = '1';
  elsif normalized_email in ('manickraja@karunya.edu', 'manickaraja@karunya.edu') then
    assigned_role := 'coordinator';
    select id into assigned_bus_id from public.buses where bus_number = '2';
  elsif normalized_email like '%@karunya.edu.in' then
    if normalized_email = 'lohita@karunya.edu.in' then
      select id into assigned_bus_id from public.buses where bus_number = '1';
    elsif normalized_email = 'beneshamercy@karunya.edu.in' then
      select id into assigned_bus_id from public.buses where bus_number = '2';
    end if;
  else
    raise exception 'Students must use @karunya.edu.in; only assigned coordinators may use @karunya.edu';
  end if;

  insert into public.profiles (id, email, full_name, role, register_number, bus_id, status)
  values (
    new.id,
    normalized_email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    assigned_role,
    upper(split_part(normalized_email, '@', 1)),
    assigned_bus_id,
    case when assigned_bus_id is null then 'pending_assignment' else 'active' end
  );
  return new;
end;
$$;
