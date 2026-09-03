-- Migration to make public.profiles the primary source for active coordinators and clean pending table
-- 1. Ensure all active coordinator accounts in public.profiles have role='coordinator', status='active', and correct bus_id
update public.profiles set role = 'coordinator', bus_id = (select id from public.buses where bus_number = '1' limit 1), status = 'active' where lower(email) = 'ashlinmirsha@karunya.edu.in';
update public.profiles set role = 'coordinator', bus_id = (select id from public.buses where bus_number = '2' limit 1), full_name = coalesce(nullif(full_name, ''), 'Dr. Karthik R'), status = 'active' where lower(email) = 'karthikr@karunya.edu';
update public.profiles set role = 'coordinator', bus_id = (select id from public.buses where bus_number = '3' limit 1), full_name = coalesce(nullif(full_name, ''), 'Dr. Gerard Nigel'), status = 'active' where lower(email) = 'gerardnigel@karunya.edu';
update public.profiles set role = 'coordinator', bus_id = (select id from public.buses where bus_number = '3' limit 1), full_name = coalesce(nullif(full_name, ''), 'Dr. Manickaraja'), status = 'active' where lower(email) in ('manickraja@karunya.edu', 'manickaraja@karunya.edu');
update public.profiles set role = 'coordinator', bus_id = (select id from public.buses where bus_number = '4' limit 1), full_name = coalesce(nullif(full_name, ''), 'Dr. Shygil Joy'), status = 'active' where lower(email) = 'shygiljoy@karunya.edu';
update public.profiles set role = 'coordinator', bus_id = (select id from public.buses where bus_number = '7' limit 1), full_name = coalesce(nullif(full_name, ''), 'Dr B Elavarasan'), status = 'active' where lower(email) = 'elavarasan@karunya.edu';
update public.profiles set role = 'coordinator', bus_id = (select id from public.buses where bus_number = '13' limit 1), full_name = coalesce(nullif(full_name, ''), 'Dr. Titus I'), status = 'active' where lower(email) = 'titusi@karunya.edu';

-- 2. Delete active coordinators from pending_coordinator_assignments
delete from public.pending_coordinator_assignments pc
where exists (
  select 1 from public.profiles p
  where lower(p.email) = lower(pc.email)
    and p.role = 'coordinator'
    and p.bus_id is not null
);

-- 3. RLS policy to allow reading coordinator profiles from public.profiles
drop policy if exists "read coordinator profiles" on public.profiles;
create policy "read coordinator profiles"
on public.profiles
for select
to authenticated
using (
  role = 'coordinator'
  or public.current_user_role() = 'admin'
  or coalesce((select lower(p.email) from public.profiles p where p.id = auth.uid()), '') in ('lohita@karunya.edu.in', 'ashlinmirsha@karunya.edu.in')
  or coalesce((select lower(au.email) from auth.users au where au.id = auth.uid()), '') in ('lohita@karunya.edu.in', 'ashlinmirsha@karunya.edu.in')
);

-- 4. Update admin_people_records RPC so public.profiles takes priority over pending table
create or replace function public.admin_people_records()
returns table (
  id uuid, full_name text, register_number text, email text,
  role public.user_role, status text, bus_id uuid, bus_number text, route text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_caller_email text := coalesce(lower(auth.jwt()->>'email'), '');
begin
  if v_caller_email = '' then
    select lower(p.email) into v_caller_email from public.profiles p where p.id = auth.uid();
  end if;
  if v_caller_email = '' then
    select lower(au.email) into v_caller_email from auth.users au where au.id = auth.uid();
  end if;

  if public.current_user_role() <> 'admin'
     and v_caller_email not in ('lohita@karunya.edu.in', 'ashlinmirsha@karunya.edu.in')
  then
    raise exception 'Admin access required';
  end if;

  return query
  with resolved_people as (
    select
      p.id,
      coalesce(nullif(p.full_name, ''), nullif(pc.full_name, ''), p.email) as full_name,
      p.register_number,
      p.email,
      case when p.role = 'coordinator' then 'coordinator'::public.user_role when pc.email is not null then 'coordinator'::public.user_role else p.role end as role,
      p.status,
      coalesce(p.bus_id, pc.bus_id) as bus_id
    from public.profiles p
    left join public.pending_coordinator_assignments pc on pc.email = lower(p.email)

    union all

    select
      null::uuid as id,
      pc.full_name,
      null::text as register_number,
      pc.email,
      'coordinator'::public.user_role as role,
      'pending_login'::text as status,
      pc.bus_id
    from public.pending_coordinator_assignments pc
    where lower(pc.email) not in (select lower(p.email) from public.profiles p)

    union all

    select
      null::uuid as id,
      ps.full_name,
      ps.register_number,
      ps.email,
      'student'::public.user_role as role,
      'pending_login'::text as status,
      ps.bus_id
    from public.pending_student_assignments ps
    where lower(ps.email) not in (select lower(p.email) from public.profiles p)
  )
  select
    rp.id,
    rp.full_name,
    rp.register_number,
    rp.email,
    rp.role,
    rp.status,
    rp.bus_id,
    b.bus_number,
    b.route
  from resolved_people rp
  left join public.buses b on b.id = rp.bus_id
  order by case rp.role when 'admin' then 1 when 'coordinator' then 2 else 3 end,
    b.bus_number nulls last, rp.register_number nulls last, rp.full_name;
end;
$$;

grant execute on function public.admin_people_records() to authenticated;
