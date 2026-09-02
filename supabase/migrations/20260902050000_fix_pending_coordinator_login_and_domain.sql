-- Migration to support pre-assigned bus coordinators, allow @karunya.edu faculty domain sign-ins, and configure coordinator assignments:
-- lohita@karunya.edu.in -> ADMIN
-- ashlinmirsha@karunya.edu.in -> COORDINATOR (Bus 1)
-- gerardnigel@karunya.edu -> COORDINATOR (Bus 3)

-- 1. Create table for pending coordinator assignments before their first Google OAuth login
create table if not exists public.pending_coordinator_assignments (
  email text primary key check (email = lower(email)),
  full_name text not null default '',
  bus_id uuid not null references public.buses(id),
  status text not null default 'active',
  created_at timestamptz not null default now()
);

alter table public.pending_coordinator_assignments enable row level security;

drop policy if exists "admins manage pending coordinator assignments" on public.pending_coordinator_assignments;
create policy "admins manage pending coordinator assignments" on public.pending_coordinator_assignments
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- 2. Relax profiles_email_check constraint on public.profiles to allow @karunya.edu.in and @karunya.edu domains
alter table public.profiles drop constraint if exists profiles_email_check;
alter table public.profiles add constraint profiles_email_check check (
  email like '%@karunya.edu.in' or email like '%@karunya.edu'
);

-- Pre-assign Dr. Gerard Nigel to Bus 3 in pending_coordinator_assignments
insert into public.pending_coordinator_assignments (email, full_name, bus_id, status)
select 'gerardnigel@karunya.edu', 'Dr. Gerard Nigel', id, 'active'
from public.buses where bus_number = '3'
on conflict (email) do update set
  full_name = excluded.full_name,
  bus_id = excluded.bus_id,
  status = 'active';

-- Set test and coordinator account roles in public.profiles
update public.profiles
set role = 'admin', bus_id = null, status = 'active'
where lower(email) = 'lohita@karunya.edu.in';

update public.profiles
set role = 'coordinator',
    bus_id = (select id from public.buses where bus_number = '1' limit 1),
    status = 'active'
where lower(email) = 'ashlinmirsha@karunya.edu.in';

update public.profiles
set role = 'coordinator',
    bus_id = (select id from public.buses where bus_number = '3' limit 1),
    full_name = 'Dr. Gerard Nigel',
    status = 'active'
where lower(email) = 'gerardnigel@karunya.edu';

-- 3. Update create_profile_for_karunya_user trigger function
create or replace function public.create_profile_for_karunya_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  assigned_bus_id uuid;
  assigned_role public.user_role := 'student';
  normalized_email text := lower(new.email);
  assigned_register_number text := upper(split_part(new.email, '@', 1));
  assigned_full_name text := coalesce(new.raw_user_meta_data->>'full_name', '');
  pending_student public.pending_student_assignments%rowtype;
  pending_coord public.pending_coordinator_assignments%rowtype;
begin
  -- 1. Check pending coordinator assignments
  select * into pending_coord from public.pending_coordinator_assignments where email = normalized_email;
  if found then
    assigned_role := 'coordinator';
    assigned_bus_id := pending_coord.bus_id;
    assigned_full_name := coalesce(nullif(pending_coord.full_name, ''), assigned_full_name);
    delete from public.pending_coordinator_assignments where email = normalized_email;
  else
    -- 2. Check pending student assignments
    select * into pending_student from public.pending_student_assignments where email = normalized_email;
    if found then
      assigned_bus_id := pending_student.bus_id;
      assigned_register_number := pending_student.register_number;
      assigned_full_name := coalesce(nullif(pending_student.full_name, ''), assigned_full_name);
      delete from public.pending_student_assignments where email = normalized_email;
    elsif normalized_email = 'lohita@karunya.edu.in' then
      assigned_role := 'admin';
      assigned_bus_id := null;
    elsif normalized_email = 'ashlinmirsha@karunya.edu.in' then
      assigned_role := 'coordinator';
      select id into assigned_bus_id from public.buses where bus_number = '1' limit 1;
    elsif normalized_email = 'gerardnigel@karunya.edu' then
      assigned_role := 'coordinator';
      assigned_full_name := coalesce(nullif(assigned_full_name, ''), 'Dr. Gerard Nigel');
      select id into assigned_bus_id from public.buses where bus_number = '3' limit 1;
    elsif normalized_email in ('manickraja@karunya.edu', 'manickaraja@karunya.edu') then
      assigned_role := 'coordinator';
      select id into assigned_bus_id from public.buses where bus_number = '3' limit 1;
    elsif normalized_email = 'karthikr@karunya.edu' then
      assigned_role := 'coordinator';
      select id into assigned_bus_id from public.buses where bus_number = '2' limit 1;
    elsif normalized_email = 'titusi@karunya.edu' then
      assigned_role := 'coordinator';
      select id into assigned_bus_id from public.buses where bus_number = '13' limit 1;
    elsif normalized_email like '%@karunya.edu' then
      assigned_role := 'coordinator';
    elsif normalized_email not like '%@karunya.edu.in' then
      raise exception 'Only @karunya.edu.in or @karunya.edu accounts are allowed';
    end if;
  end if;

  insert into public.profiles (id, email, full_name, role, register_number, bus_id, status)
  values (
    new.id,
    normalized_email,
    assigned_full_name,
    assigned_role,
    assigned_register_number,
    assigned_bus_id,
    case when assigned_bus_id is null and assigned_role = 'student' then 'pending_assignment' else 'active' end
  )
  on conflict (id) do update set
    role = excluded.role,
    bus_id = coalesce(public.profiles.bus_id, excluded.bus_id),
    status = 'active';

  return new;
end;
$$;

-- 4. RPC for assigning coordinator atomically by admin
create or replace function public.assign_coordinator(p_email text, p_full_name text, p_bus_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_normalized_email text := lower(trim(p_email));
  v_auth_id uuid;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'Admin access required';
  end if;

  -- 1. Insert/update pending_coordinator_assignments
  insert into public.pending_coordinator_assignments (email, full_name, bus_id, status)
  values (v_normalized_email, coalesce(trim(p_full_name), ''), p_bus_id, 'active')
  on conflict (email) do update set
    full_name = excluded.full_name,
    bus_id = excluded.bus_id,
    status = 'active';

  -- 2. If profile exists in public.profiles, update it
  update public.profiles
  set
    role = 'coordinator',
    bus_id = p_bus_id,
    full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
    status = 'active'
  where lower(email) = v_normalized_email;

  -- 3. If auth.users entry exists but profile is missing, create profile directly
  select id into v_auth_id from auth.users where lower(email) = v_normalized_email limit 1;
  if v_auth_id is not null then
    insert into public.profiles (id, email, full_name, role, register_number, bus_id, status)
    values (
      v_auth_id,
      v_normalized_email,
      coalesce(nullif(trim(p_full_name), ''), v_normalized_email),
      'coordinator',
      upper(split_part(v_normalized_email, '@', 1)),
      p_bus_id,
      'active'
    )
    on conflict (id) do update set
      role = 'coordinator',
      bus_id = p_bus_id,
      full_name = coalesce(nullif(trim(p_full_name), ''), public.profiles.full_name),
      status = 'active';

    delete from public.pending_coordinator_assignments where email = v_normalized_email;
  end if;

  return jsonb_build_object('success', true, 'message', 'Coordinator assigned successfully.');
end;
$$;

grant execute on function public.assign_coordinator(text, text, uuid) to authenticated;

-- 5. Dynamic profile resolver and auto-healer RPC current_app_profile (Safe against missing tables)
create or replace function public.current_app_profile()
returns table (
  id uuid,
  email text,
  role public.user_role,
  bus_id uuid,
  bus_number text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_meta jsonb;
  v_normalized_email text;
  v_assigned_bus_id uuid;
  v_assigned_role public.user_role := 'student';
  v_assigned_reg_no text;
  v_assigned_full_name text;
  v_pending_student public.pending_student_assignments%rowtype;
  v_pending_coord public.pending_coordinator_assignments%rowtype;
  v_has_pending_coord_table boolean := false;
  v_has_pending_student_table boolean := false;
begin
  if v_user_id is null then
    return;
  end if;

  select exists (
    select 1 from information_schema.tables where table_schema = 'public' and table_name = 'pending_coordinator_assignments'
  ) into v_has_pending_coord_table;

  select exists (
    select 1 from information_schema.tables where table_schema = 'public' and table_name = 'pending_student_assignments'
  ) into v_has_pending_student_table;

  -- Step A: Sync pending coordinator assignment if table exists
  if v_has_pending_coord_table then
    begin
      select email into v_normalized_email from public.profiles where id = v_user_id;
      if v_normalized_email is null then
        select lower(au.email) into v_normalized_email from auth.users au where au.id = v_user_id;
      end if;

      if v_normalized_email is not null then
        select * into v_pending_coord from public.pending_coordinator_assignments where email = v_normalized_email;
        if found then
          insert into public.profiles (id, email, full_name, role, register_number, bus_id, status)
          values (
            v_user_id,
            v_normalized_email,
            coalesce(nullif(v_pending_coord.full_name, ''), v_normalized_email),
            'coordinator',
            upper(split_part(v_normalized_email, '@', 1)),
            v_pending_coord.bus_id,
            'active'
          )
          on conflict (id) do update set
            role = 'coordinator',
            bus_id = v_pending_coord.bus_id,
            full_name = case when excluded.full_name <> '' then excluded.full_name else public.profiles.full_name end,
            status = 'active';

          delete from public.pending_coordinator_assignments where email = v_normalized_email;
        end if;
      end if;
    exception when others then
      null;
    end;
  end if;

  -- Step B: Return existing profile if present
  if exists (select 1 from public.profiles p where p.id = v_user_id) then
    return query
    select
      p.id,
      p.email,
      p.role,
      p.bus_id,
      b.bus_number,
      p.status
    from public.profiles p
    left join public.buses b on b.id = p.bus_id
    where p.id = v_user_id;
    return;
  end if;

  -- Step C: Auto-create profile from auth.users if missing
  select au.email, au.raw_user_meta_data into v_email, v_meta
  from auth.users au
  where au.id = v_user_id;

  if v_email is not null then
    v_normalized_email := lower(v_email);
    v_assigned_reg_no := upper(split_part(v_normalized_email, '@', 1));
    v_assigned_full_name := coalesce(v_meta->>'full_name', '');

    if v_has_pending_student_table then
      begin
        select * into v_pending_student from public.pending_student_assignments where email = v_normalized_email;
        if found then
          v_assigned_bus_id := v_pending_student.bus_id;
          v_assigned_reg_no := v_pending_student.register_number;
          v_assigned_full_name := coalesce(nullif(v_pending_student.full_name, ''), v_assigned_full_name);
          delete from public.pending_student_assignments where email = v_normalized_email;
        end if;
      exception when others then null;
      end;
    end if;

    if v_assigned_bus_id is null then
      if v_normalized_email = 'lohita@karunya.edu.in' then
        v_assigned_role := 'admin';
        v_assigned_bus_id := null;
      elsif v_normalized_email = 'ashlinmirsha@karunya.edu.in' then
        v_assigned_role := 'coordinator';
        select b.id into v_assigned_bus_id from public.buses b where b.bus_number = '1' limit 1;
      elsif v_normalized_email = 'gerardnigel@karunya.edu' then
        v_assigned_role := 'coordinator';
        v_assigned_full_name := coalesce(nullif(v_assigned_full_name, ''), 'Dr. Gerard Nigel');
        select b.id into v_assigned_bus_id from public.buses b where b.bus_number = '3' limit 1;
      elsif v_normalized_email in ('manickraja@karunya.edu', 'manickaraja@karunya.edu') then
        v_assigned_role := 'coordinator';
        select b.id into v_assigned_bus_id from public.buses b where b.bus_number = '3' limit 1;
      elsif v_normalized_email = 'karthikr@karunya.edu' then
        v_assigned_role := 'coordinator';
        select b.id into v_assigned_bus_id from public.buses b where b.bus_number = '2' limit 1;
      elsif v_normalized_email = 'titusi@karunya.edu' then
        v_assigned_role := 'coordinator';
        select b.id into v_assigned_bus_id from public.buses b where b.bus_number = '13' limit 1;
      elsif v_normalized_email like '%@karunya.edu' then
        v_assigned_role := 'coordinator';
      end if;
    end if;

    insert into public.profiles (id, email, full_name, role, register_number, bus_id, status)
    values (
      v_user_id,
      v_normalized_email,
      v_assigned_full_name,
      v_assigned_role,
      v_assigned_reg_no,
      v_assigned_bus_id,
      case when v_assigned_bus_id is null and v_assigned_role = 'student' then 'pending_assignment' else 'active' end
    )
    on conflict (id) do update set
      role = excluded.role,
      bus_id = coalesce(public.profiles.bus_id, excluded.bus_id),
      status = 'active';
  end if;

  return query
  select
    p.id,
    p.email,
    p.role,
    p.bus_id,
    b.bus_number,
    p.status
  from public.profiles p
  left join public.buses b on b.id = p.bus_id
  where p.id = v_user_id;
end;
$$;

grant execute on function public.current_app_profile() to authenticated;

-- 6. Update admin_people_records() function
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

  union all

  select null::uuid as id, pending_coord.full_name, null::text as register_number, pending_coord.email,
    'coordinator'::public.user_role as role, 'pending_login'::text as status, pending_coord.bus_id, bus.bus_number, bus.route
  from public.pending_coordinator_assignments pending_coord
  left join public.buses bus on bus.id = pending_coord.bus_id
  where pending_coord.email not in (select p.email from public.profiles p)

  union all

  select null::uuid as id, pending_stu.full_name, pending_stu.register_number, pending_stu.email,
    'student'::public.user_role as role, 'pending_login'::text as status, pending_stu.bus_id, bus.bus_number, bus.route
  from public.pending_student_assignments pending_stu
  left join public.buses bus on bus.id = pending_stu.bus_id
  where pending_stu.email not in (select p.email from public.profiles p)

  order by case role when 'admin' then 1 when 'coordinator' then 2 else 3 end,
    bus_number nulls last, register_number nulls last, full_name;
end;
$$;

grant execute on function public.admin_people_records() to authenticated;

-- 7. Repair existing auth.users rows
do $$
declare
  u record;
  assigned_bus_id uuid;
  assigned_role public.user_role;
  normalized_email text;
  assigned_register_number text;
  assigned_full_name text;
  pending_student public.pending_student_assignments%rowtype;
  pending_coord public.pending_coordinator_assignments%rowtype;
begin
  for u in select id, email, raw_user_meta_data from auth.users where id not in (select id from public.profiles) loop
    normalized_email := lower(u.email);
    assigned_role := 'student';
    assigned_bus_id := null;
    assigned_register_number := upper(split_part(normalized_email, '@', 1));
    assigned_full_name := coalesce(u.raw_user_meta_data->>'full_name', '');

    select * into pending_coord from public.pending_coordinator_assignments where email = normalized_email;
    if found then
      assigned_role := 'coordinator';
      assigned_bus_id := pending_coord.bus_id;
      assigned_full_name := coalesce(nullif(pending_coord.full_name, ''), assigned_full_name);
      delete from public.pending_coordinator_assignments where email = normalized_email;
    else
      select * into pending_student from public.pending_student_assignments where email = normalized_email;
      if found then
        assigned_bus_id := pending_student.bus_id;
        assigned_register_number := pending_student.register_number;
        assigned_full_name := coalesce(nullif(pending_student.full_name, ''), assigned_full_name);
        delete from public.pending_student_assignments where email = normalized_email;
      elsif normalized_email = 'lohita@karunya.edu.in' then
        assigned_role := 'admin';
        assigned_bus_id := null;
      elsif normalized_email = 'ashlinmirsha@karunya.edu.in' then
        assigned_role := 'coordinator';
        select id into assigned_bus_id from public.buses where bus_number = '1' limit 1;
      elsif normalized_email = 'gerardnigel@karunya.edu' then
        assigned_role := 'coordinator';
        assigned_full_name := coalesce(nullif(assigned_full_name, ''), 'Dr. Gerard Nigel');
        select id into assigned_bus_id from public.buses where bus_number = '3' limit 1;
      elsif normalized_email in ('manickraja@karunya.edu', 'manickaraja@karunya.edu') then
        assigned_role := 'coordinator';
        select id into assigned_bus_id from public.buses where bus_number = '3' limit 1;
      elsif normalized_email = 'karthikr@karunya.edu' then
        assigned_role := 'coordinator';
        select id into assigned_bus_id from public.buses where bus_number = '2' limit 1;
      elsif normalized_email = 'titusi@karunya.edu' then
        assigned_role := 'coordinator';
        select id into assigned_bus_id from public.buses where bus_number = '13' limit 1;
      elsif normalized_email like '%@karunya.edu' then
        assigned_role := 'coordinator';
      end if;
    end if;

    insert into public.profiles (id, email, full_name, role, register_number, bus_id, status)
    values (
      u.id,
      normalized_email,
      assigned_full_name,
      assigned_role,
      assigned_register_number,
      assigned_bus_id,
      case when assigned_bus_id is null and assigned_role = 'student' then 'pending_assignment' else 'active' end
    )
    on conflict (id) do update set
      role = excluded.role,
      bus_id = coalesce(public.profiles.bus_id, excluded.bus_id),
      status = 'active';
  end loop;
end;
$$;
