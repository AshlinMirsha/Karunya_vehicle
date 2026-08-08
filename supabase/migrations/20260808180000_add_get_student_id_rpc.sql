create or replace function public.get_student_by_register_number(p_reg text)
returns table (
  id uuid,
  bus_id uuid,
  email text,
  full_name text,
  register_number text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() not in ('admin', 'coordinator') then
    raise exception 'Staff access required';
  end if;

  return query
  select p.id, p.bus_id, p.email, p.full_name, p.register_number
  from public.profiles p
  where lower(p.register_number) = lower(trim(p_reg))
    and p.role = 'student'
  limit 1;
end;
$$;
