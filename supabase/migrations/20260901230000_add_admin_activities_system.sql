-- Create admin_activities table for tracking administrative & system management actions
create table if not exists public.admin_activities (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  actor_role text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  entity_name text,
  details jsonb default '{}'::jsonb,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.admin_activities enable row level security;

-- Admin-only policies
drop policy if exists "Admins can view admin_activities" on public.admin_activities;
create policy "Admins can view admin_activities" on public.admin_activities
  for select using (public.current_user_role() = 'admin');

drop policy if exists "Admins can update admin_activities" on public.admin_activities;
create policy "Admins can update admin_activities" on public.admin_activities
  for update using (public.current_user_role() = 'admin');

-- Function to get unread admin activities count
create or replace function public.get_unread_admin_activities_count()
returns integer
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then return 0; end if;
  return (select count(*)::integer from public.admin_activities where is_read = false);
end;
$$;

grant execute on function public.get_unread_admin_activities_count() to authenticated;
