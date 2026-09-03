-- Migration to clean up pre-assigned coordinators who already exist in public.profiles:
delete from public.pending_coordinator_assignments pc
where exists (
  select 1 from public.profiles p
  where lower(p.email) = lower(pc.email)
);
