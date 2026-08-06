-- Create Bus 13 if it doesn't exist with dummy latitude/longitude.
insert into public.buses (bus_number, route, latitude, longitude)
values ('13', 'NOT ASSIGNED', 0.0, 0.0)
on conflict (bus_number) do nothing;

-- Add Dr. Titus to allowed coordinator emails
alter table public.profiles drop constraint if exists profiles_email_check;
alter table public.profiles add constraint profiles_email_check check (
  email like '%@karunya.edu.in'
  or (
    role = 'coordinator'
    and lower(email) in (
      'manickraja@karunya.edu',
      'manickaraja@karunya.edu',
      'karthikr@karunya.edu',
      'titusi@karunya.edu'
    )
  )
);

-- Update the trigger function for new sign-ups.
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
  elsif normalized_email = 'titusi@karunya.edu' then
    assigned_role := 'coordinator'; select id into assigned_bus_id from public.buses where bus_number = '13';
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

-- Update Dr. Titus to be coordinator of Bus 13 if they already exist in profiles.
update public.profiles
set
  full_name = 'Dr. TITUS',
  role = 'coordinator',
  bus_id = (select id from public.buses where bus_number = '13'),
  status = 'active'
where lower(email) = 'titusi@karunya.edu';
