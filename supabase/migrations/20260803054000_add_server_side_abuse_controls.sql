create table public.attendance_request_limits (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('create-session', 'mark-attendance')),
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  cooldown_until timestamptz,
  primary key (actor_id, action)
);

alter table public.attendance_request_limits enable row level security;

create table public.security_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  outcome text not null check (outcome in ('allowed', 'denied', 'rate_limited', 'invalid')),
  created_at timestamptz not null default now()
);

alter table public.security_audit_events enable row level security;

create or replace function public.consume_attendance_rate_limit(p_actor_id uuid, p_action text)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_limit public.attendance_request_limits%rowtype;
  max_attempts integer := case p_action when 'create-session' then 5 when 'mark-attendance' then 6 else 0 end;
  window_duration interval := case p_action when 'create-session' then interval '15 minutes' else interval '10 minutes' end;
  cooldown_duration interval := interval '10 minutes';
begin
  if p_actor_id is null or max_attempts = 0 then
    raise exception 'Invalid rate-limit request';
  end if;

  select * into current_limit from public.attendance_request_limits
  where actor_id = p_actor_id and action = p_action for update;

  if not found then
    insert into public.attendance_request_limits (actor_id, action, attempts) values (p_actor_id, p_action, 1);
    return query select true, 0;
    return;
  end if;

  if current_limit.cooldown_until is not null and current_limit.cooldown_until > now() then
    return query select false, ceil(extract(epoch from current_limit.cooldown_until - now()))::integer;
    return;
  end if;

  if current_limit.window_started_at <= now() - window_duration then
    update public.attendance_request_limits set window_started_at = now(), attempts = 1, cooldown_until = null
    where actor_id = p_actor_id and action = p_action;
    return query select true, 0;
    return;
  end if;

  if current_limit.attempts >= max_attempts then
    update public.attendance_request_limits set cooldown_until = now() + cooldown_duration
    where actor_id = p_actor_id and action = p_action;
    return query select false, ceil(extract(epoch from cooldown_duration))::integer;
    return;
  end if;

  update public.attendance_request_limits set attempts = attempts + 1, cooldown_until = null
  where actor_id = p_actor_id and action = p_action;
  return query select true, 0;
end;
$$;

grant execute on function public.consume_attendance_rate_limit(uuid, text) to service_role;
