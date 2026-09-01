-- 1. Truncate existing rate limit cooldown table to clear any active locks on coordinators
truncate table public.attendance_request_limits;

-- 2. Update consume_attendance_rate_limit to allow up to 100 session creations per window
create or replace function public.consume_attendance_rate_limit(p_actor_id uuid, p_action text)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_limit public.attendance_request_limits%rowtype;
  max_attempts integer := case p_action when 'create-session' then 100 when 'mark-attendance' then 100 else 0 end;
  window_duration interval := case p_action when 'create-session' then interval '15 minutes' else interval '10 minutes' end;
  cooldown_duration interval := interval '10 minutes';
begin
  if p_actor_id is null or max_attempts = 0 then
    return query select true, 0;
    return;
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

  update public.attendance_request_limits set attempts = attempts + 1
  where actor_id = p_actor_id and action = p_action;

  return query select true, 0;
  return;
end;
$$;

-- 3. Ensure Ashlin Mirsha profile is correctly linked to Bus 1 in public.profiles
do $$
declare
  b1_id uuid;
begin
  select id into b1_id from public.buses where bus_number = '1' limit 1;

  if b1_id is not null then
    update public.profiles
    set
      role = 'coordinator',
      bus_id = b1_id,
      status = 'active'
    where lower(email) = 'ashlinmirsha@karunya.edu.in';
  end if;
end;
$$;
