-- RPC function to securely return email delivery logs for staff dashboards

create or replace function public.authorized_session_email_logs()
returns table (
  id uuid,
  bus_id uuid,
  bus_number text,
  session_type text,
  created_at timestamptz,
  email_status text,
  email_error text,
  coordinator_email text
)
language plpgsql stable security definer set search_path = public as $$
declare allowed_bus_id uuid;
begin
  if public.current_user_role() not in ('admin', 'coordinator') then
    raise exception 'Staff access required';
  end if;

  -- Qualify prof.bus_id explicitly to prevent PL/pgSQL ambiguous variable error (42702)
  select prof.bus_id into allowed_bus_id
  from public.profiles prof
  where prof.id = auth.uid();

  return query
  select
    s.id,
    s.bus_id,
    b.bus_number,
    s.session_type,
    s.created_at,
    s.email_status,
    s.email_error,
    coalesce(p.email, '—') as coordinator_email
  from public.attendance_sessions s
  join public.buses b on b.id = s.bus_id
  left join public.profiles p on p.id = s.created_by
  where (public.current_user_role() = 'admin' or s.bus_id = allowed_bus_id)
  order by s.created_at desc
  limit 50;
end;
$$;

grant execute on function public.authorized_session_email_logs() to authenticated;
