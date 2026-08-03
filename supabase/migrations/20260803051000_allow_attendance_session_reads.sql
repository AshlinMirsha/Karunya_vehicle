-- Nested attendance reads need session visibility; without this policy Supabase
-- returns an attendance row while hiding its session and bus relationship.
create policy "read authorized attendance sessions"
on public.attendance_sessions
for select
to authenticated
using (
  public.current_user_role() = 'admin'
  or (
    public.current_user_role() = 'coordinator'
    and bus_id = (select bus_id from public.profiles where id = auth.uid())
  )
  or exists (
    select 1
    from public.attendance
    where attendance.session_id = attendance_sessions.id
      and attendance.student_id = auth.uid()
  )
);
