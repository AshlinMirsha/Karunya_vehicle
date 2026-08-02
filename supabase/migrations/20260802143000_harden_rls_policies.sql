-- Restrict operational data to each user's assigned bus; admins retain global access.
drop policy if exists "staff read buses" on public.buses;
create policy "read assigned bus" on public.buses for select to authenticated using (
  public.current_user_role() = 'admin'
  or id = (select bus_id from public.profiles where id = auth.uid())
);

drop policy if exists "students read own attendance" on public.attendance;
create policy "read authorized attendance" on public.attendance for select to authenticated using (
  student_id = auth.uid()
  or public.current_user_role() = 'admin'
  or (
    public.current_user_role() = 'coordinator'
    and exists (
      select 1 from public.attendance_sessions session
      where session.id = attendance.session_id
        and session.bus_id = (select bus_id from public.profiles where id = auth.uid())
    )
  )
);
