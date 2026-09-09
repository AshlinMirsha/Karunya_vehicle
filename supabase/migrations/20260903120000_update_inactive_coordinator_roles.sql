-- Migration to clean up inactive coordinator entries and sync roles
delete from public.pending_coordinator_assignments pc
where lower(pc.email) in ('manickraja@karunya.edu', 'manickaraja@karunya.edu');

-- Delete profiles of unassigned inactive coordinators who have no attendance sessions
delete from public.profiles p
where p.role = 'coordinator'
  and p.bus_id is null
  and p.status = 'inactive'
  and not exists (select 1 from public.attendance_sessions s where s.created_by = p.id)
  and not exists (select 1 from public.attendance a where a.student_id = p.id);

-- Demote any remaining inactive unassigned coordinators to student role
update public.profiles
set role = 'student'
where role = 'coordinator'
  and bus_id is null
  and status = 'inactive';
