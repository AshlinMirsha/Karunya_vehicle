-- Keep Ashmii's profile correct whether she has already signed in or joins later.
update public.profiles
set full_name = 'Ashmii', register_number = 'URK25CS1194', role = 'student',
  bus_id = (select id from public.buses where bus_number = '1'), status = 'active'
where lower(email) = 'ashmigifta@karunya.edu.in';

create or replace function public.create_profile_for_karunya_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  assigned_bus_id uuid;
  assigned_role public.user_role := 'student';
  normalized_email text := lower(new.email);
  assigned_name text := coalesce(new.raw_user_meta_data->>'full_name', '');
  assigned_register_number text := upper(split_part(normalized_email, '@', 1));
begin
  if normalized_email = 'lohita@karunya.edu.in' then
    assigned_role := 'admin';
    select id into assigned_bus_id from public.buses where bus_number = '1';
  elsif normalized_email = 'ashlinmirsha@karunya.edu.in' then
    assigned_role := 'coordinator';
    select id into assigned_bus_id from public.buses where bus_number = '1';
  elsif normalized_email in ('manickraja@karunya.edu', 'manickaraja@karunya.edu') then
    assigned_role := 'coordinator';
    select id into assigned_bus_id from public.buses where bus_number = '2';
  elsif normalized_email = 'ashmigifta@karunya.edu.in' then
    assigned_name := 'Ashmii';
    assigned_register_number := 'URK25CS1194';
    select id into assigned_bus_id from public.buses where bus_number = '1';
  elsif normalized_email not like '%@karunya.edu.in' then
    raise exception 'Only @karunya.edu.in users, and assigned @karunya.edu coordinators, are allowed';
  end if;

  insert into public.profiles (id, email, full_name, role, register_number, bus_id, status)
  values (new.id, normalized_email, assigned_name, assigned_role, assigned_register_number, assigned_bus_id,
    case when assigned_bus_id is null then 'pending_assignment' else 'active' end);
  return new;
end;
$$;
