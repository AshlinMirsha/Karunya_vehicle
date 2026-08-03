-- Keep students visible to staff before their first Google sign-in creates an
-- auth.users row. The trigger consumes this assignment at first sign-in.
create table if not exists public.pending_student_assignments (
  email text primary key check (email = lower(email) and email like '%@karunya.edu.in'),
  full_name text not null default '',
  register_number text not null unique,
  bus_id uuid not null references public.buses(id),
  status text not null default 'active',
  created_at timestamptz not null default now()
);
alter table public.pending_student_assignments enable row level security;

insert into public.pending_student_assignments (email, full_name, register_number, bus_id, status)
select 'siddharths25@karunya.edu.in', 'Siddharth S', 'URK25CS1192', id, 'active'
from public.buses where bus_number = '1'
on conflict (email) do update set full_name = excluded.full_name, register_number = excluded.register_number,
  bus_id = excluded.bus_id, status = excluded.status;

create or replace function public.create_profile_for_karunya_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  assigned_bus_id uuid;
  assigned_role public.user_role := 'student';
  normalized_email text := lower(new.email);
  assigned_register_number text := upper(split_part(new.email, '@', 1));
  pending_assignment public.pending_student_assignments%rowtype;
begin
  select * into pending_assignment from public.pending_student_assignments where email = normalized_email;
  if found then
    assigned_bus_id := pending_assignment.bus_id;
    assigned_register_number := pending_assignment.register_number;
  elsif normalized_email = 'lohita@karunya.edu.in' then
    assigned_role := 'admin'; select id into assigned_bus_id from public.buses where bus_number = '1';
  elsif normalized_email = 'ashlinmirsha@karunya.edu.in' then
    assigned_role := 'coordinator'; select id into assigned_bus_id from public.buses where bus_number = '1';
  elsif normalized_email in ('manickraja@karunya.edu', 'manickaraja@karunya.edu') then
    assigned_role := 'coordinator'; select id into assigned_bus_id from public.buses where bus_number = '2';
  elsif normalized_email not like '%@karunya.edu.in' then
    raise exception 'Only @karunya.edu.in users, and assigned @karunya.edu coordinators, are allowed';
  end if;
  insert into public.profiles (id, email, full_name, role, register_number, bus_id, status)
  values (new.id, normalized_email, coalesce(nullif(pending_assignment.full_name, ''), new.raw_user_meta_data->>'full_name', ''), assigned_role,
    assigned_register_number, assigned_bus_id, case when assigned_bus_id is null then 'pending_assignment' else 'active' end);
  delete from public.pending_student_assignments where email = normalized_email;
  return new;
end;
$$;

create or replace function public.authorized_student_records()
returns table (full_name text, register_number text, email text, bus_number text, status text)
language plpgsql stable security definer set search_path = public as $$
declare allowed_bus_id uuid;
begin
  if public.current_user_role() not in ('admin', 'coordinator') then raise exception 'Staff access required'; end if;
  select bus_id into allowed_bus_id from public.profiles where id = auth.uid();
  return query
  select p.full_name, p.register_number, p.email, b.bus_number, p.status
  from public.profiles p join public.buses b on b.id = p.bus_id
  where p.role = 'student' and (public.current_user_role() = 'admin' or p.bus_id = allowed_bus_id)
  union all
  select pending.full_name, pending.register_number, pending.email, b.bus_number, 'awaiting first sign-in'
  from public.pending_student_assignments pending join public.buses b on b.id = pending.bus_id
  where public.current_user_role() = 'admin' or pending.bus_id = allowed_bus_id
  order by bus_number, register_number;
end;
$$;

grant execute on function public.authorized_student_records() to authenticated;
