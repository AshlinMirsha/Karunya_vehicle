-- Pre-assign Sylvia M to Bus 1
insert into public.pending_student_assignments (email, full_name, register_number, bus_id, status)
select 'sylviam@karunya.edu.in', 'Sylvia M', 'URK25CS1233', id, 'active'
from public.buses where bus_number = '1'
on conflict (email) do update set full_name = excluded.full_name, register_number = excluded.register_number,
  bus_id = excluded.bus_id, status = excluded.status;

-- If Sylvia has already logged in once, update her active profile record directly
update public.profiles
set full_name = 'Sylvia M', register_number = 'URK25CS1233', role = 'student',
  bus_id = (select id from public.buses where bus_number = '1'), status = 'active'
where lower(email) = 'sylviam@karunya.edu.in';
