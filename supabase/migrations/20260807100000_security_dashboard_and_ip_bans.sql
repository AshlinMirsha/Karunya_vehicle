-- Drop the existing constraint and add the new values to check constraint
alter table public.security_audit_events drop constraint if exists security_audit_events_outcome_check;
alter table public.security_audit_events add constraint security_audit_events_outcome_check
check (outcome in ('allowed', 'denied', 'rate_limited', 'invalid', 'tampered', 'unauthorized_route'));

-- Create the ip_bans table
create table if not exists public.ip_bans (
  ip text primary key,
  banned_at timestamptz not null default now(),
  banned_by uuid references public.profiles(id) on delete set null
);

-- Enable RLS
alter table public.ip_bans enable row level security;

-- Policies for ip_bans
drop policy if exists "Admins manage IP bans" on public.ip_bans;
create policy "Admins manage IP bans" on public.ip_bans
for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "Everyone authenticated reads IP bans" on public.ip_bans;
create policy "Everyone authenticated reads IP bans" on public.ip_bans
for select to authenticated
using (true);

-- RPC to get security logs/alerts
create or replace function public.get_security_alerts()
returns table (
  id uuid,
  actor_id uuid,
  email text,
  full_name text,
  action text,
  outcome text,
  created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'admin' then raise exception 'Unauthorized'; end if;
  return query
  select
    ae.id,
    ae.actor_id,
    p.email,
    p.full_name,
    ae.action,
    ae.outcome,
    ae.created_at
  from public.security_audit_events ae
  left join public.profiles p on p.id = ae.actor_id
  order by ae.created_at desc limit 200;
end;
$$;

-- RPC to delete attendance records by date range
create or replace function public.delete_attendance_range(p_start_date timestamptz, p_end_date timestamptz)
returns table (deleted_attendance integer, deleted_sessions integer)
language plpgsql security definer set search_path = public as $$
declare
  v_att_count integer := 0;
  v_sess_count integer := 0;
begin
  if public.current_user_role() <> 'admin' then raise exception 'Unauthorized'; end if;
  
  delete from public.attendance
  where checked_in_at >= p_start_date and checked_in_at <= p_end_date;
  get diagnostics v_att_count = row_count;
  
  delete from public.attendance_sessions
  where created_at >= p_start_date and created_at <= p_end_date;
  get diagnostics v_sess_count = row_count;
  
  return query select v_att_count, v_sess_count;
end;
$$;

grant execute on function public.get_security_alerts() to authenticated;
grant execute on function public.delete_attendance_range(timestamptz, timestamptz) to authenticated;
