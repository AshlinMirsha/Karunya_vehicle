-- Fix profiles_email_check constraint to allow faculty @karunya.edu emails regardless of role state when unassigned
alter table public.profiles drop constraint if exists profiles_email_check;
alter table public.profiles add constraint profiles_email_check check (
  email like '%@karunya.edu.in'
  or lower(email) in (
    'manickraja@karunya.edu',
    'manickaraja@karunya.edu',
    'karthikr@karunya.edu',
    'titusi@karunya.edu'
  )
);
