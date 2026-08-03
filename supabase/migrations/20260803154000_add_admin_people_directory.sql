-- Admin-only directory for students and coordinators with their bus assignment.
create or replace function public.admin_people_records()
returns table (
  id uuid, full_name text, register_number text, email text,
  role public.user_role, status text, bus_id uuid, bus_number text, route text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'Admin access required'; end if;
  return query
  select profile.id, profile.full_name, profile.register_number, profile.email,
    profile.role, profile.status, profile.bus_id, bus.bus_number, bus.route
  from public.profiles profile
  left join public.buses bus on bus.id = profile.bus_id
  order by case profile.role when 'admin' then 1 when 'coordinator' then 2 else 3 end,
    bus.bus_number nulls last, profile.register_number nulls last, profile.full_name;
end;
$$;

grant execute on function public.admin_people_records() to authenticated;
