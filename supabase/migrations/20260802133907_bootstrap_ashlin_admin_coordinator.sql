update public.profiles
set role = 'admin', bus_id = (select id from public.buses where bus_number = '1'), status = 'active'
where lower(email) = 'ashlinmirsha@karunya.edu.in';

create or replace function public.create_profile_for_karunya_user() returns trigger language plpgsql security definer set search_path = public as $$
declare assigned_bus_id uuid; assigned_role public.user_role := 'student';
begin
  if new.email not like '%@karunya.edu.in' then raise exception 'Only @karunya.edu.in accounts are allowed'; end if;
  if lower(new.email) in ('lohita@karunya.edu.in','ashlinmirsha@karunya.edu.in') then select id into assigned_bus_id from public.buses where bus_number = '1'; end if;
  if lower(new.email) = 'ashlinmirsha@karunya.edu.in' then assigned_role := 'admin'; end if;
  insert into public.profiles (id,email,full_name,role,register_number,bus_id,status)
  values (new.id,lower(new.email),coalesce(new.raw_user_meta_data->>'full_name',''),assigned_role,upper(split_part(new.email,'@',1)),assigned_bus_id,case when assigned_bus_id is null then 'pending_assignment' else 'active' end);
  return new;
end;
$$;
