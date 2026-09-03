-- Migration to sync and restore all faculty coordinator bus assignments in both profiles and pending_coordinator_assignments

-- 1. Ensure Bus 7 exists if missing
insert into public.buses (bus_number, route, capacity, latitude, longitude)
values ('7', 'Annur, Kariyampalayam, Kovilpalayam, Kurumbapalayam, Kappikadai Stop, Viswasapuram, Saravanampatti, SRP Mill, Prozone Mall, Ramakrishna Mill, Bharathi', 60, 0.0, 0.0)
on conflict (bus_number) do update set capacity = coalesce(public.buses.capacity, 60);

-- 2. Populate / update pending_coordinator_assignments for all faculty coordinators
insert into public.pending_coordinator_assignments (email, full_name, bus_id, status)
values
  ('ashlinmirsha@karunya.edu.in', 'Ashlin Mirsha', (select id from public.buses where bus_number = '1' limit 1), 'active'),
  ('karthikr@karunya.edu', 'Dr. Karthik R', (select id from public.buses where bus_number = '2' limit 1), 'active'),
  ('gerardnigel@karunya.edu', 'Dr. Gerard Nigel', (select id from public.buses where bus_number = '3' limit 1), 'active'),
  ('manickraja@karunya.edu', 'Dr. Manickaraja', (select id from public.buses where bus_number = '3' limit 1), 'active'),
  ('shygiljoy@karunya.edu', 'Dr. Shygil Joy', (select id from public.buses where bus_number = '4' limit 1), 'active'),
  ('elavarasan@karunya.edu', 'Dr B Elavarasan', (select id from public.buses where bus_number = '7' limit 1), 'active'),
  ('titusi@karunya.edu', 'Dr. Titus I', (select id from public.buses where bus_number = '13' limit 1), 'active')
on conflict (email) do update set
  full_name = excluded.full_name,
  bus_id = excluded.bus_id,
  status = 'active';

-- 3. Sync public.profiles table so all existing profiles have their role and bus_id set correctly
update public.profiles p
set
  role = 'coordinator',
  bus_id = pc.bus_id,
  full_name = coalesce(nullif(pc.full_name, ''), p.full_name),
  status = 'active'
from public.pending_coordinator_assignments pc
where lower(p.email) = lower(pc.email);

-- Explicitly update each known coordinator email in public.profiles to be 100% sure
update public.profiles set role = 'coordinator', bus_id = (select id from public.buses where bus_number = '1' limit 1), status = 'active' where lower(email) = 'ashlinmirsha@karunya.edu.in';
update public.profiles set role = 'coordinator', bus_id = (select id from public.buses where bus_number = '2' limit 1), full_name = 'Dr. Karthik R', status = 'active' where lower(email) = 'karthikr@karunya.edu';
update public.profiles set role = 'coordinator', bus_id = (select id from public.buses where bus_number = '3' limit 1), full_name = 'Dr. Gerard Nigel', status = 'active' where lower(email) = 'gerardnigel@karunya.edu';
update public.profiles set role = 'coordinator', bus_id = (select id from public.buses where bus_number = '3' limit 1), full_name = 'Dr. Manickaraja', status = 'active' where lower(email) in ('manickraja@karunya.edu', 'manickaraja@karunya.edu');
update public.profiles set role = 'coordinator', bus_id = (select id from public.buses where bus_number = '4' limit 1), full_name = 'Dr. Shygil Joy', status = 'active' where lower(email) = 'shygiljoy@karunya.edu';
update public.profiles set role = 'coordinator', bus_id = (select id from public.buses where bus_number = '7' limit 1), full_name = 'Dr B Elavarasan', status = 'active' where lower(email) = 'elavarasan@karunya.edu';
update public.profiles set role = 'coordinator', bus_id = (select id from public.buses where bus_number = '13' limit 1), full_name = 'Dr. Titus I', status = 'active' where lower(email) = 'titusi@karunya.edu';
