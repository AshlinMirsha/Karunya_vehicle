-- A coordinator can see only student profiles assigned to the same bus. The
-- bus is derived from auth.uid(), never supplied by the browser.
create policy "coordinators read assigned students"
on public.profiles
for select
to authenticated
using (
  public.current_user_role() = 'coordinator'
  and role = 'student'
  and bus_id = (
    select bus_id
    from public.profiles
    where id = auth.uid()
  )
);
