-- Migration to clean up inactive coordinators without assigned buses
delete from public.pending_coordinator_assignments pc
where exists (
  select 1 from public.profiles p
  where lower(p.email) = lower(pc.email)
    and p.role = 'student'
);

-- Delete profiles of removed coordinators with no attendance history
delete from public.profiles
where role = 'coordinator'
  and bus_id is null
  and status = 'inactive'
  and not exists (select 1 from public.attendance_sessions s where s.created_by = public.profiles.id)
  and not exists (select 1 from public.attendance a where a.student_id = public.profiles.id);

-- Demote any remaining inactive unassigned coordinators to student role
update public.profiles
set role = 'student'
where role = 'coordinator'
  and bus_id is null
  and status = 'inactive';
