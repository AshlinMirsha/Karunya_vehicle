-- Pre-assign LAVANYA.M (RRK26AO1001) to Bus 13 and activate profile
insert into public.pending_student_assignments (email, full_name, register_number, bus_id, status)
select 'lavanyam26@karunya.edu.in', 'LAVANYA.M', 'RRK26AO1001', id, 'active'
from public.buses where bus_number = '13'
on conflict (email) do update set 
  full_name = excluded.full_name, 
  register_number = excluded.register_number,
  bus_id = excluded.bus_id, 
  status = excluded.status;

-- If LAVANYA.M has already logged in once, update her active profile record directly
update public.profiles
set 
  full_name = 'LAVANYA.M', 
  register_number = 'RRK26AO1001', 
  role = 'student',
  bus_id = (select id from public.buses where bus_number = '13'), 
  status = 'active'
where lower(email) = 'lavanyam26@karunya.edu.in';
