-- Keep this seeded student active on Bus 1 whether the account already exists
-- or is created later through Karunya Google sign-in.
update public.profiles
set
  full_name = 'R A BENESHA MERCY RAMESH',
  register_number = 'URK25CS1176',
  role = 'student',
  bus_id = (select id from public.buses where bus_number = '1'),
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
  if new.email not like '%@karunya.edu.in' then
    raise exception 'Only @karunya.edu.in accounts are allowed';
  end if;

  if normalized_email in ('lohita@karunya.edu.in', 'ashlinmirsha@karunya.edu.in', 'beneshamercy@karunya.edu.in') then
    select id into assigned_bus_id from public.buses where bus_number = '1';
  end if;

  if normalized_email = 'ashlinmirsha@karunya.edu.in' then
    assigned_role := 'admin';
  end if;

  insert into public.profiles (id, email, full_name, role, register_number, bus_id, status)
  values (
    new.id,
    normalized_email,
    case normalized_email
      when 'beneshamercy@karunya.edu.in' then 'R A BENESHA MERCY RAMESH'
      else coalesce(new.raw_user_meta_data->>'full_name', '')
    end,
    assigned_role,
    case normalized_email
      when 'beneshamercy@karunya.edu.in' then 'URK25CS1176'
      else upper(split_part(new.email, '@', 1))
    end,
    assigned_bus_id,
    case when assigned_bus_id is null then 'pending_assignment' else 'active' end
  );
  return new;
end;
$$;
