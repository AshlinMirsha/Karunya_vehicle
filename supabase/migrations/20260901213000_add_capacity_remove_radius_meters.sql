-- Add capacity column, set latitude/longitude defaults, and remove radius_meters from public.buses table
alter table public.buses add column if not exists capacity integer not null default 60;
alter table public.buses drop column if not exists radius_meters;

alter table public.buses alter column latitude set default 0.0;
alter table public.buses alter column longitude set default 0.0;
alter table public.buses alter column latitude drop not null;
alter table public.buses alter column longitude drop not null;

-- Update admin_bus_records RPC function to return capacity instead of radius_meters
create or replace function public.admin_bus_records()
returns table (
  id uuid,
  bus_number text,
  route text,
  capacity integer
)
language sql
stable
security definer
set search_path = public
as $$
  select public.ensure_current_user_admin();

  select bus.id, bus.bus_number, bus.route, bus.capacity
  from public.buses bus
  order by bus.bus_number
$$;
