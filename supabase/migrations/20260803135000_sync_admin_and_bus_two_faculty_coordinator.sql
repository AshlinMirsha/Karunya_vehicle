-- Sync test/admin access and Bus 2 faculty coordinator email handling.
alter table public.profiles drop constraint if exists profiles_email_check;
alter table public.profiles add constraint profiles_email_check check (
  email like '%@karunya.edu.in'
  or (
    role = 'coordinator'
    and lower(email) in ('manickraja@karunya.edu', 'manickaraja@karunya.edu')
  )
);

update public.profiles
set
  role = 'admin',
  bus_id = (select id from public.buses where bus_number = '1'),
  status = 'active'
where lower(email) = 'ashlinmirsha@karunya.edu.in';

update public.profiles
set
  role = 'coordinator',
  bus_id = (select id from public.buses where bus_number = '2'),
  status = 'active'
where lower(email) in ('manickraja@karunya.edu', 'manickaraja@karunya.edu');

create or replace function public.create_profile_for_karunya_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_bus_id uuid;
  assigned_role public.user_role := 'student';
  normalized_email text := lower(new.email);
begin
  if normalized_email in ('manickraja@karunya.edu', 'manickaraja@karunya.edu') then
    assigned_role := 'coordinator';
    select id into assigned_bus_id from public.buses where bus_number = '2';
  elsif normalized_email like '%@karunya.edu.in' then
    if normalized_email in ('lohita@karunya.edu.in', 'ashlinmirsha@karunya.edu.in') then
      select id into assigned_bus_id from public.buses where bus_number = '1';
    elsif normalized_email = 'beneshamercy@karunya.edu.in' then
      select id into assigned_bus_id from public.buses where bus_number = '2';
    end if;
    if normalized_email = 'ashlinmirsha@karunya.edu.in' then
      assigned_role := 'admin';
    end if;
  else
    raise exception 'Students must use @karunya.edu.in; only the assigned coordinator may use @karunya.edu';
  end if;

  insert into public.profiles (id, email, full_name, role, register_number, bus_id, status)
  values (
    new.id,
    normalized_email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    assigned_role,
    upper(split_part(normalized_email, '@', 1)),
    assigned_bus_id,
    case when assigned_bus_id is null then 'pending_assignment' else 'active' end
  );
  return new;
end;
$$;
