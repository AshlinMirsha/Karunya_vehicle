create or replace function public.ensure_current_user_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  ) then
    raise exception 'Admin access required';
  end if;
end;
$$;

create or replace function public.admin_bus_records()
returns table (
  id uuid,
  bus_number text,
  route text,
  radius_meters integer
)
language sql
stable
security definer
set search_path = public
as $$
  select public.ensure_current_user_admin();

  select bus.id, bus.bus_number, bus.route, bus.radius_meters
  from public.buses bus
  order by bus.bus_number
$$;

create or replace function public.admin_student_records(p_bus_id uuid default null)
returns table (
  id uuid,
  full_name text,
  register_number text,
  email text,
  status text,
  bus_id uuid,
  bus_number text
)
language sql
stable
security definer
set search_path = public
as $$
  select public.ensure_current_user_admin();

  select
    profile.id,
    profile.full_name,
    profile.register_number,
    profile.email,
    profile.status,
    profile.bus_id,
    bus.bus_number
  from public.profiles profile
  left join public.buses bus on bus.id = profile.bus_id
  where profile.role = 'student'
    and (p_bus_id is null or profile.bus_id = p_bus_id)
  order by bus.bus_number, profile.register_number
$$;

create or replace function public.admin_coordinator_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select public.ensure_current_user_admin();

  select count(*)::integer
  from public.profiles
  where role in ('admin', 'coordinator')
$$;

grant execute on function public.ensure_current_user_admin() to authenticated;
grant execute on function public.admin_bus_records() to authenticated;
grant execute on function public.admin_student_records(uuid) to authenticated;
grant execute on function public.admin_coordinator_count() to authenticated;
