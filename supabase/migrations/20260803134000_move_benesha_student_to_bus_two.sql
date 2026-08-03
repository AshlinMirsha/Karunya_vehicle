-- Move only Benesha Mercy's student account from Bus 1 to Bus 2.
update public.profiles
set
  role = 'student',
  bus_id = (select id from public.buses where bus_number = '2'),
  status = 'active'
where lower(email) = 'beneshamercy@karunya.edu.in';

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
  if normalized_email = 'manickraja@karunya.edu' then
    assigned_role := 'coordinator';
    select id into assigned_bus_id from public.buses where bus_number = '2';
  elsif normalized_email like '%@karunya.edu.in' then
    if normalized_email in ('lohita@karunya.edu.in', 'ashlinmirsha@karunya.edu.in') then
      select id into assigned_bus_id from public.buses where bus_number = '1';
    elsif normalized_email = 'beneshamercy@karunya.edu.in' then
      select id into assigned_bus_id from public.buses where bus_number = '2';
    end if;
    if normalized_email = 'ashlinmirsha@karunya.edu.in' then
      assigned_role := 'coordinator';
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
