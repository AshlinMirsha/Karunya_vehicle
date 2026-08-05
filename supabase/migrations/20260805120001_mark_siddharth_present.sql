do $$
declare
  v_student_id uuid;
  v_session_id uuid;
begin
  select id into v_student_id from public.profiles where register_number = 'URK25CS1192';
  
  select id into v_session_id from public.attendance_sessions 
  where bus_id = (select bus_id from public.profiles where id = v_student_id)
    and session_type = 'Morning' 
  order by created_at desc limit 1;

  if v_student_id is not null and v_session_id is not null then
    insert into public.attendance (session_id, student_id, checked_in_at, latitude, longitude)
    values (v_session_id, v_student_id, now(), 11.0, 77.0)
    on conflict do nothing;
  end if;
end $$;
