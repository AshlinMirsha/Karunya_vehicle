-- Migration: update attendance_dashboard_summary to include pending sign-in students
-- Also adds security hardening CHECK constraints (OWASP A03)

-- ─── 1. Update dashboard summary to expose activated vs pending counts ──────
drop function if exists public.attendance_dashboard_summary();

create or replace function public.attendance_dashboard_summary()
returns table (
  student_count_active  integer,
  student_count_pending integer,
  student_count_total   integer,
  bus_count             integer,
  present_today         integer,
  morning_checkins      integer,
  evening_checkins      integer
)
language plpgsql stable security definer set search_path = public as $$
declare allowed_bus_id uuid;
begin
  if public.current_user_role() not in ('admin', 'coordinator') then
    raise exception 'Staff access required';
  end if;
  select bus_id into allowed_bus_id from public.profiles where id = auth.uid();
  return query select
    -- Active students (have signed in, profile exists)
    (select count(*)::integer from public.profiles p
      where p.role = 'student' and p.status = 'active'
        and (public.current_user_role() = 'admin' or p.bus_id = allowed_bus_id)),
    -- Pending students (pre-added, awaiting first sign-in)
    (select count(*)::integer from public.pending_student_assignments psa
      where (public.current_user_role() = 'admin' or psa.bus_id = allowed_bus_id)),
    -- Total (active + pending)
    (select count(*)::integer from public.profiles p
      where p.role = 'student' and p.status = 'active'
        and (public.current_user_role() = 'admin' or p.bus_id = allowed_bus_id))
    +
    (select count(*)::integer from public.pending_student_assignments psa
      where (public.current_user_role() = 'admin' or psa.bus_id = allowed_bus_id)),
    -- Bus count
    (select count(*)::integer from public.buses bus
      where public.current_user_role() = 'admin' or bus.id = allowed_bus_id),
    -- Present today (distinct students with any check-in today in IST)
    (select count(distinct a.student_id)::integer
      from public.attendance a
      join public.attendance_sessions s on s.id = a.session_id
      where a.checked_in_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
        and (public.current_user_role() = 'admin' or s.bus_id = allowed_bus_id)),
    -- Morning check-ins today
    (select count(*)::integer
      from public.attendance a
      join public.attendance_sessions s on s.id = a.session_id
      where a.checked_in_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
        and s.session_type = 'Morning'
        and (public.current_user_role() = 'admin' or s.bus_id = allowed_bus_id)),
    -- Evening check-ins today
    (select count(*)::integer
      from public.attendance a
      join public.attendance_sessions s on s.id = a.session_id
      where a.checked_in_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
        and s.session_type = 'Evening'
        and (public.current_user_role() = 'admin' or s.bus_id = allowed_bus_id));
end;
$$;

grant execute on function public.attendance_dashboard_summary() to authenticated;

-- ─── 2. OWASP A03: DB-level length CHECK constraints ────────────────────────
alter table public.profiles
  drop constraint if exists profiles_full_name_length,
  add constraint profiles_full_name_length check (length(full_name) <= 100),
  drop constraint if exists profiles_register_number_len,
  add constraint profiles_register_number_len check (length(register_number) <= 30);

alter table public.pending_student_assignments
  drop constraint if exists pending_full_name_length,
  add constraint pending_full_name_length check (length(full_name) <= 100),
  drop constraint if exists pending_register_number_len,
  add constraint pending_register_number_len check (length(register_number) <= 30);

-- ─── 3. Admin write RLS policies ─────────────────────────────────────────────
-- Allow admin to update profiles (move students between buses, change status)
drop policy if exists "admins manage profiles" on public.profiles;
create policy "admins manage profiles" on public.profiles
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- Allow admin to insert/update/delete pending_student_assignments
drop policy if exists "admins manage pending assignments" on public.pending_student_assignments;
create policy "admins manage pending assignments" on public.pending_student_assignments
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- Allow coordinators to read their own bus's pending assignments
drop policy if exists "coordinators read pending assignments" on public.pending_student_assignments;
create policy "coordinators read pending assignments" on public.pending_student_assignments
  for select to authenticated
  using (
    public.current_user_role() = 'coordinator'
    and bus_id = (select bus_id from public.profiles where id = auth.uid())
  );
