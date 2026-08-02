insert into public.buses (bus_number, route, latitude, longitude, radius_meters)
values ('1', 'Karunya Campus Test Route', 10.9362, 76.7437, 500)
on conflict (bus_number) do update set route = excluded.route, latitude = excluded.latitude, longitude = excluded.longitude, radius_meters = excluded.radius_meters;

create or replace function public.create_profile_for_karunya_user() returns trigger language plpgsql security definer set search_path = public as $$
declare assigned_bus_id uuid;
begin
  if new.email not like '%@karunya.edu.in' then raise exception 'Only @karunya.edu.in accounts are allowed'; end if;
  if lower(new.email) = 'lohita@karunya.edu.in' then select id into assigned_bus_id from public.buses where bus_number = '1'; end if;
  insert into public.profiles (id, email, full_name, register_number, bus_id, status)
  values (new.id, lower(new.email), case when lower(new.email) = 'lohita@karunya.edu.in' then 'LOHIT A' else coalesce(new.raw_user_meta_data->>'full_name','') end, case when lower(new.email) = 'lohita@karunya.edu.in' then 'URK25CS6024' else upper(split_part(new.email,'@',1)) end, assigned_bus_id, case when assigned_bus_id is null then 'pending_assignment' else 'active' end);
  return new;
end;
$$;

update public.profiles
set full_name = 'LOHIT A', register_number = 'URK25CS6024', bus_id = (select id from public.buses where bus_number = '1'), status = 'active'
where lower(email) = 'lohita@karunya.edu.in';
