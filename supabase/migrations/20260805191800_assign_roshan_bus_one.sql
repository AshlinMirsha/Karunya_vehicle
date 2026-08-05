-- Pre-assign Roshan to Bus 1
insert into public.pending_student_assignments (email, full_name, register_number, bus_id, status)
select 'charisroshan@karunya.edu.in', 'Roshan', 'URK25CS1225', id, 'active'
from public.buses where bus_number = '1'
on conflict (email) do update set full_name = excluded.full_name, register_number = excluded.register_number,
  bus_id = excluded.bus_id, status = excluded.status;

-- If Roshan has already logged in once, update his active profile record directly
update public.profiles
set full_name = 'Roshan', register_number = 'URK25CS1225', role = 'student',
  bus_id = (select id from public.buses where bus_number = '1'), status = 'active'
where lower(email) = 'charisroshan@karunya.edu.in';
