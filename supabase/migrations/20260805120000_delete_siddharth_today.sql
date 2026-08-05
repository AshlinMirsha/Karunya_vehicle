delete from public.attendance
where student_id = (select id from public.profiles where register_number = 'URK25CS1192')
  and checked_in_at >= '2026-08-04 00:00:00+00';

delete from public.attendance_sessions
where created_at >= '2026-08-04 00:00:00+00' 
  and session_type in ('Morning', 'Evening', 'Special');
