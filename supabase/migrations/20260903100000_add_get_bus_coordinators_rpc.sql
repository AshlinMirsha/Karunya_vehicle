-- Security Definer RPC to retrieve all bus coordinators (both active profiles and pending assignments) bypassing client RLS restrictions
create or replace function public.get_bus_coordinators()
returns table (
  id uuid,
  full_name text,
  email text,
  role public.user_role,
  bus_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select
    p.id,
    coalesce(nullif(p.full_name, ''), p.email) as full_name,
    p.email,
    p.role,
    p.bus_id
  from public.profiles p
  where p.role in ('coordinator', 'admin') and p.bus_id is not null

  union all

  select
    null::uuid as id,
    pc.full_name,
    pc.email,
    'coordinator'::public.user_role as role,
    pc.bus_id
  from public.pending_coordinator_assignments pc
  where lower(pc.email) not in (select lower(p.email) from public.profiles p where p.role in ('coordinator', 'admin'));
end;
$$;

grant execute on function public.get_bus_coordinators() to authenticated;
