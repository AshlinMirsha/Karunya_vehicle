
-- 1. Unassign admin from default bus (Bus 1/2) so they have access to all buses.
update public.profiles set bus_id = null where role = 'admin';

-- 2. Create Bus 3 if it doesn't exist with dummy latitude/longitude.
insert into public.buses (bus_number, route, latitude, longitude)
values ('3', 'NOT ASSIGNED', 0.0, 0.0)
on conflict (bus_number) do nothing;

-- 3. Update Manickaraja to be coordinator of Bus 3.
update public.profiles
set bus_id = (select id from public.buses where bus_number = '3')
where lower(email) in ('manickraja@karunya.edu', 'manickaraja@karunya.edu');

-- 4. Add Karthik R to allowed coordinator emails
alter table public.profiles drop constraint if exists profiles_email_check;
alter table public.profiles add constraint profiles_email_check check (
  email like '%@karunya.edu.in'
  or (
    role = 'coordinator'
    and lower(email) in ('manickraja@karunya.edu', 'manickaraja@karunya.edu', 'karthikr@karunya.edu')
  )
);

-- 5. Update Karthik R to be coordinator of Bus 2 if they already exist in profiles.
update public.profiles
set
  role = 'coordinator',
  bus_id = (select id from public.buses where bus_number = '2'),
  status = 'active'
where lower(email) = 'karthikr@karunya.edu';

-- 6. Update the trigger function for new sign-ups.
create or replace function public.create_profile_for_karunya_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  assigned_bus_id uuid;
  assigned_role public.user_role := 'student';
  normalized_email text := lower(new.email);
  assigned_register_number text := upper(split_part(new.email, '@', 1));
  pending_assignment public.pending_student_assignments%rowtype;
begin
  select * into pending_assignment from public.pending_student_assignments where email = normalized_email;
  if found then
    assigned_bus_id := pending_assignment.bus_id;
    assigned_register_number := pending_assignment.register_number;
  elsif normalized_email = 'lohita@karunya.edu.in' then
    assigned_role := 'admin';
    -- Admins get bus_id = NULL for all buses
  elsif normalized_email = 'ashlinmirsha@karunya.edu.in' then
    assigned_role := 'coordinator'; select id into assigned_bus_id from public.buses where bus_number = '1';
  elsif normalized_email in ('manickraja@karunya.edu', 'manickaraja@karunya.edu') then
    assigned_role := 'coordinator'; select id into assigned_bus_id from public.buses where bus_number = '3';
  elsif normalized_email = 'karthikr@karunya.edu' then
    assigned_role := 'coordinator'; select id into assigned_bus_id from public.buses where bus_number = '2';
  elsif normalized_email not like '%@karunya.edu.in' then
    raise exception 'Only @karunya.edu.in users, and assigned @karunya.edu coordinators, are allowed';
  end if;
  insert into public.profiles (id, email, full_name, role, register_number, bus_id, status)
  values (new.id, normalized_email, coalesce(nullif(pending_assignment.full_name, ''), new.raw_user_meta_data->>'full_name', ''), assigned_role,
    assigned_register_number, assigned_bus_id, case when assigned_bus_id is null and assigned_role = 'student' then 'pending_assignment' else 'active' end);
  delete from public.pending_student_assignments where email = normalized_email;
  return new;
end;
$$;

-- 7. Insert the 42 students for Bus 2 into pending_student_assignments
insert into public.pending_student_assignments (email, full_name, register_number, bus_id, status)
select * from (values
  ('kanimozhid@karunya.edu.in', 'KANIMOZHI D', 'PRK25BT1003', (select id from public.buses where bus_number = '2'), 'active'),
  ('intamilkarthikas@karunya.edu.in', 'INTAMIL KARTHIKA', 'PRK25FS1021', (select id from public.buses where bus_number = '2'), 'active'),
  ('charulathab@karunya.edu.in', 'CHARULATHA B', 'PRK25FZ2004', (select id from public.buses where bus_number = '2'), 'active'),
  ('sreesangavika@karunya.edu.in', 'SREE SANGAVIKA S', 'PRK25MS1056', (select id from public.buses where bus_number = '2'), 'active'),
  ('gobbianank@karunya.edu.in', 'GOBBIANAN KG', 'PRK25MS1074', (select id from public.buses where bus_number = '2'), 'active'),
  ('kanishkad@karunya.edu.in', 'KANISHKA D', 'PRK25MS1082', (select id from public.buses where bus_number = '2'), 'active'),
  ('srashini@karunya.edu.in', 'RASHINI S', 'RRK25BM1003', (select id from public.buses where bus_number = '2'), 'active'),
  ('aravindk23@karunya.edu.in', 'ARAVIND KJ', 'ULK23CS7001', (select id from public.buses where bus_number = '2'), 'active'),
  ('mahalakshmis@karunya.edu.in', 'MAHALAKSHMI S', 'URK23BT1050', (select id from public.buses where bus_number = '2'), 'active'),
  ('revanths23@karunya.edu.in', 'REVANTH S', 'URK23CS7080', (select id from public.buses where bus_number = '2'), 'active'),
  ('rcatherine23@karunya.edu.in', 'R CATHERINE SHEKINAH', 'URK23EC1020', (select id from public.buses where bus_number = '2'), 'active'),
  ('thejandrav@karunya.edu.in', 'THEJANDRA V', 'URK23EC6036', (select id from public.buses where bus_number = '2'), 'active'),
  ('rakshand@karunya.edu.in', 'RAKSHAN D', 'URK23EC6044', (select id from public.buses where bus_number = '2'), 'active'),
  ('pavithram23@karunya.edu.in', 'PAVITHRA M', 'URK23EE3014', (select id from public.buses where bus_number = '2'), 'active'),
  ('praneethe@karunya.edu.in', 'PRANEETH E', 'URK24AI1036', (select id from public.buses where bus_number = '2'), 'active'),
  ('ruwanroy@karunya.edu.in', 'RUWAN ROY', 'URK24AI1111', (select id from public.buses where bus_number = '2'), 'active'),
  ('bhuvaneshd@karunya.edu.in', 'BHUVANESH D', 'URK24CO2012', (select id from public.buses where bus_number = '2'), 'active'),
  ('arunpalanisamy@karunya.edu.in', 'ARUN PALANISAMY A A', 'URK24CS1169', (select id from public.buses where bus_number = '2'), 'active'),
  ('dharaneeshward@karunya.edu.in', 'DHARANEESHWAR D', 'URK24DS3027', (select id from public.buses where bus_number = '2'), 'active'),
  ('judahfonarcus@karunya.edu.in', 'JUDAH FONARCUS C', 'URK24MP1012', (select id from public.buses where bus_number = '2'), 'active'),
  ('mukkamalaameyasri@karunya.edu.in', 'MUKKAMALA AMEYASRI SOHAM', 'URK25AC1057', (select id from public.buses where bus_number = '2'), 'active'),
  ('naveeng25@karunya.edu.in', 'NAVEEN G', 'URK25AI1130', (select id from public.buses where bus_number = '2'), 'active'),
  ('christopherjino@karunya.edu.in', 'CHRISTOPHER JINO SJ', 'URK25BM1022', (select id from public.buses where bus_number = '2'), 'active'),
  ('rithushrees@karunya.edu.in', 'RITHUSHREE S', 'URK25BT4007', (select id from public.buses where bus_number = '2'), 'active'),
  ('dharshiniv25@karunya.edu.in', 'DHARSHINI V', 'URK25CM4034', (select id from public.buses where bus_number = '2'), 'active'),
  ('akshayan25@karunya.edu.in', 'AKSHAYA N.A.S', 'URK25CM4058', (select id from public.buses where bus_number = '2'), 'active'),
  ('nithins25@karunya.edu.in', 'NITHIN S', 'URK25CS1223', (select id from public.buses where bus_number = '2'), 'active'),
  ('ashwins25@karunya.edu.in', 'S ASHWIN', 'URK25CS7019', (select id from public.buses where bus_number = '2'), 'active'),
  ('sashwin25@karunya.edu.in', 'ASHWIN S', 'URK25CS7068', (select id from public.buses where bus_number = '2'), 'active'),
  ('sanjitha@karunya.edu.in', 'SANJITH A S', 'URK25CS7126', (select id from public.buses where bus_number = '2'), 'active'),
  ('rathimeenab@karunya.edu.in', 'RATHIMEENA B', 'URK25CS7134', (select id from public.buses where bus_number = '2'), 'active'),
  ('christymatthewp@karunya.edu.in', 'CHRISTY MATTHEW P', 'URK25FS1010', (select id from public.buses where bus_number = '2'), 'active'),
  ('subakinig@karunya.edu.in', 'SUBAKINI G', 'URK25FS1011', (select id from public.buses where bus_number = '2'), 'active'),
  ('akarshanak@karunya.edu.in', 'AKARSHANA K', 'URK25FS1035', (select id from public.buses where bus_number = '2'), 'active'),
  ('hariharand26@karunya.edu.in', 'HARIHARAN D K', 'URK26CM4034', (select id from public.buses where bus_number = '2'), 'active'),
  ('steffinad@karunya.edu.in', 'STEFFINA D', 'URK26CS1221', (select id from public.buses where bus_number = '2'), 'active'),
  ('rajav@karunya.edu.in', 'RAJA V', 'URK26CS5045', (select id from public.buses where bus_number = '2'), 'active'),
  ('sgmiithun@karunya.edu.in', 'S G MIITHUN', 'URK26CS7053', (select id from public.buses where bus_number = '2'), 'active'),
  ('immanueljames@karunya.edu.in', 'IMMANUEL JAMES D', 'URK26CS7148', (select id from public.buses where bus_number = '2'), 'active'),
  ('dharshanrajas@karunya.edu.in', 'DHARSHANRAJA S', 'URK26CSD053', (select id from public.buses where bus_number = '2'), 'active'),
  ('sgmirthula@karunya.edu.in', 'S G MIRTHULA', 'URK26EC1025', (select id from public.buses where bus_number = '2'), 'active'),
  ('jasontejus@karunya.edu.in', 'JASON TEJUS R', 'URK26EC1053', (select id from public.buses where bus_number = '2'), 'active')
) as t(email, full_name, register_number, bus_id, status)
on conflict (email) do update set
  full_name = excluded.full_name,
  register_number = excluded.register_number,
  bus_id = excluded.bus_id,
  status = excluded.status;


-- 8. Also update any students who might already exist in profiles
update public.profiles
set bus_id = (select id from public.buses where bus_number = '2')
where lower(email) in (
  'kanimozhid@karunya.edu.in',
  'intamilkarthikas@karunya.edu.in',
  'charulathab@karunya.edu.in',
  'sreesangavika@karunya.edu.in',
  'gobbianank@karunya.edu.in',
  'kanishkad@karunya.edu.in',
  'srashini@karunya.edu.in',
  'aravindk23@karunya.edu.in',
  'mahalakshmis@karunya.edu.in',
  'revanths23@karunya.edu.in',
  'rcatherine23@karunya.edu.in',
  'thejandrav@karunya.edu.in',
  'rakshand@karunya.edu.in',
  'pavithram23@karunya.edu.in',
  'praneethe@karunya.edu.in',
  'ruwanroy@karunya.edu.in',
  'bhuvaneshd@karunya.edu.in',
  'arunpalanisamy@karunya.edu.in',
  'dharaneeshward@karunya.edu.in',
  'judahfonarcus@karunya.edu.in',
  'mukkamalaameyasri@karunya.edu.in',
  'naveeng25@karunya.edu.in',
  'christopherjino@karunya.edu.in',
  'rithushrees@karunya.edu.in',
  'dharshiniv25@karunya.edu.in',
  'akshayan25@karunya.edu.in',
  'nithins25@karunya.edu.in',
  'ashwins25@karunya.edu.in',
  'sashwin25@karunya.edu.in',
  'sanjitha@karunya.edu.in',
  'rathimeenab@karunya.edu.in',
  'christymatthewp@karunya.edu.in',
  'subakinig@karunya.edu.in',
  'akarshanak@karunya.edu.in',
  'hariharand26@karunya.edu.in',
  'steffinad@karunya.edu.in',
  'rajav@karunya.edu.in',
  'sgmiithun@karunya.edu.in',
  'immanueljames@karunya.edu.in',
  'dharshanrajas@karunya.edu.in',
  'sgmirthula@karunya.edu.in',
  'jasontejus@karunya.edu.in'
);
