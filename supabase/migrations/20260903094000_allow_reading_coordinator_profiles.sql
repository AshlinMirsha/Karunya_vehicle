-- Migration to allow reading coordinator profiles for fleet and directory management views

drop policy if exists "read coordinator profiles" on public.profiles;
create policy "read coordinator profiles"
on public.profiles
for select
to authenticated
using (
  role = 'coordinator'
  or public.current_user_role() = 'admin'
  or coalesce((select lower(email) from public.profiles where id = auth.uid()), '') in ('lohita@karunya.edu.in', 'ashlinmirsha@karunya.edu.in')
  or coalesce((select lower(email) from auth.users where id = auth.uid()), '') in ('lohita@karunya.edu.in', 'ashlinmirsha@karunya.edu.in')
);
