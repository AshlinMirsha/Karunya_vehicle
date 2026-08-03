-- Resolve the signed-in user's application role from the database only.
-- @karunya.edu.in users default to students, except explicitly assigned admins.
update public.profiles
set
  role = 'admin',
  bus_id = (select id from public.buses where bus_number = '1'),
  status = 'active'
where lower(email) = 'ashlinmirsha@karunya.edu.in';

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
  if normalized_email = 'ashlinmirsha@karunya.edu.in' then
    assigned_role := 'admin';
    select id into assigned_bus_id from public.buses where bus_number = '1';
  elsif normalized_email in ('manickraja@karunya.edu', 'manickaraja@karunya.edu') then
    assigned_role := 'coordinator';
    select id into assigned_bus_id from public.buses where bus_number = '2';
  elsif normalized_email like '%@karunya.edu.in' then
    if normalized_email = 'lohita@karunya.edu.in' then
      select id into assigned_bus_id from public.buses where bus_number = '1';
    elsif normalized_email = 'beneshamercy@karunya.edu.in' then
      select id into assigned_bus_id from public.buses where bus_number = '2';
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

create or replace function public.current_app_profile()
returns table (
  id uuid,
  email text,
  role public.user_role,
  bus_id uuid,
  bus_number text,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    profile.id,
    profile.email,
    profile.role,
    profile.bus_id,
    bus.bus_number,
    profile.status
  from public.profiles profile
  left join public.buses bus on bus.id = profile.bus_id
  where profile.id = auth.uid()
$$;

grant execute on function public.current_app_profile() to authenticated;
