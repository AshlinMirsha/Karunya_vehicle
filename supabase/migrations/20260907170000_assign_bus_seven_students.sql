-- Ensure Bus 7 exists in public.buses
insert into public.buses (bus_number, route, capacity, latitude, longitude)
values ('7', 'Annur, Kariyampalayam, Kovilpalayam, Kurumbapalayam, Kappikadai Stop, Viswasapuram, Saravanampatti, SRP Mill, Prozone Mall, Ramakrishna Mill, Bharathi', 60, 0.0, 0.0)
on conflict (bus_number) do update set capacity = coalesce(public.buses.capacity, 60);

-- Assign 7 students to Bus No. 7
do $$
declare
  b7_id uuid;
begin
  select id into b7_id from public.buses where bus_number = '7' limit 1;

  -- 1. Insert/update pending_student_assignments
  insert into public.pending_student_assignments (email, full_name, register_number, bus_id, status)
  values
    ('mohanbharathik@karunya.edu.in', 'MOHANBHARATHI K', 'URK26CE7018', b7_id, 'active'),
    ('jasvinjennet@karunya.edu.in', 'JASVIN JENNET J', 'URK22CS3021', b7_id, 'active'),
    ('anatania@karunya.edu.in', 'A NATANIA JENORRA', 'URK26BT4016', b7_id, 'active'),
    ('sanjithac@karunya.edu.in', 'SANJITHA C R', 'URK26BM2028', b7_id, 'active'),
    ('davidprakash@karunya.edu.in', 'DAVID PRAKASH P', 'PRK26TZ2006', b7_id, 'active'),
    ('nahshonvikas@karunya.edu.in', 'NAHSHON VIKAS R', 'URK26CS1106', b7_id, 'active'),
    ('shinyrubavathy@karunya.edu.in', 'SHINY RUBAVATHY P', 'URK26HS1023', b7_id, 'active')
  on conflict (email) do update set
    full_name = excluded.full_name,
    register_number = excluded.register_number,
    bus_id = excluded.bus_id,
    status = 'active';

  -- 2. Update existing active profiles for signed-in students
  update public.profiles p
  set
    bus_id = b7_id,
    full_name = coalesce(nullif(psa.full_name, ''), p.full_name),
    register_number = coalesce(nullif(psa.register_number, ''), p.register_number),
    status = 'active'
  from public.pending_student_assignments psa
  where lower(p.email) = lower(psa.email)
    and psa.bus_id = b7_id;
end;
$$;
