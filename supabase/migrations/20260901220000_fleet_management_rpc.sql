-- Migration to update authorized_bus_records RPC to include capacity column

alter table public.buses add column if not exists capacity integer not null default 60;
alter table public.buses alter column latitude set default 0.0;
alter table public.buses alter column longitude set default 0.0;
alter table public.buses alter column latitude drop not null;
alter table public.buses alter column longitude drop not null;

create or replace function public.authorized_bus_records()
returns table (id uuid, bus_number text, route text, capacity integer)
language sql stable security definer set search_path = public as $$
  select bus.id, bus.bus_number, bus.route, bus.capacity from public.buses bus
  where public.current_user_role() = 'admin'
     or bus.id = (select bus_id from public.profiles where id = auth.uid())
  order by bus.bus_number;
$$;

grant execute on function public.authorized_bus_records() to authenticated;
