create extension if not exists pgcrypto;

create type public.user_role as enum ('student', 'coordinator', 'admin');
create type public.attendance_status as enum ('PRESENT');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique check (email like '%@karunya.edu.in'),
  full_name text not null default '',
  role public.user_role not null default 'student',
  register_number text unique,
  bus_id uuid,
  status text not null default 'pending_assignment',
  created_at timestamptz not null default now()
);
create table public.buses (id uuid primary key default gen_random_uuid(), bus_number text not null unique, route text not null, latitude double precision not null, longitude double precision not null, radius_meters integer not null default 500 check (radius_meters between 25 and 5000), created_at timestamptz not null default now());
alter table public.profiles add constraint profiles_bus_id_fkey foreign key (bus_id) references public.buses(id);
create table public.attendance_sessions (id uuid primary key default gen_random_uuid(), bus_id uuid not null references public.buses(id), session_type text not null check (session_type in ('Morning','Evening')), token_hash text not null unique, expires_at timestamptz not null, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now());
create table public.attendance (id uuid primary key default gen_random_uuid(), session_id uuid not null references public.attendance_sessions(id), student_id uuid not null references public.profiles(id), latitude double precision not null, longitude double precision not null, status public.attendance_status not null default 'PRESENT', checked_in_at timestamptz not null default now(), unique(session_id, student_id));

alter table public.profiles enable row level security; alter table public.buses enable row level security; alter table public.attendance_sessions enable row level security; alter table public.attendance enable row level security;
create or replace function public.current_user_role() returns public.user_role language sql stable security definer set search_path = public as $$ select role from public.profiles where id = auth.uid() $$;
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.current_user_role() = 'admin');
create policy "admins manage profiles" on public.profiles for all to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "staff read buses" on public.buses for select to authenticated using (true);
create policy "admins manage buses" on public.buses for all to authenticated using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "students read own attendance" on public.attendance for select to authenticated using (student_id = auth.uid() or public.current_user_role() in ('admin','coordinator'));

create or replace function public.create_profile_for_karunya_user() returns trigger language plpgsql security definer set search_path = public as $$ begin if new.email not like '%@karunya.edu.in' then raise exception 'Only @karunya.edu.in accounts are allowed'; end if; insert into public.profiles(id,email,full_name,register_number) values (new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''),upper(split_part(new.email,'@',1))); return new; end; $$;
create trigger create_profile_after_signup after insert on auth.users for each row execute function public.create_profile_for_karunya_user();
