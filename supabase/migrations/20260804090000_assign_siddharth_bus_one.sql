-- Pre-assign Siddharth during the profile trigger because the Auth account is
-- created only on their first Google sign-in.
create or replace function public.create_profile_for_karunya_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  assigned_bus_id uuid;
  assigned_role public.user_role := 'student';
  normalized_email text := lower(new.email);
  assigned_register_number text := upper(split_part(new.email, '@', 1));
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
  elsif normalized_email = 'siddharths25@karunya.edu.in' then
    select id into assigned_bus_id from public.buses where bus_number = '1';
    assigned_register_number := 'URK25CS1192';
  elsif normalized_email not like '%@karunya.edu.in' then
    raise exception 'Only @karunya.edu.in users, and assigned @karunya.edu coordinators, are allowed';
  end if;

  insert into public.profiles (id, email, full_name, role, register_number, bus_id, status)
  values (new.id, normalized_email, coalesce(new.raw_user_meta_data->>'full_name', ''), assigned_role,
    assigned_register_number, assigned_bus_id,
    case when assigned_bus_id is null then 'pending_assignment' else 'active' end);
  return new;
end;
$$;
