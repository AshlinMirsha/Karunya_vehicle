-- Cleanup pending_student_assignments for students who already have an active profile in public.profiles
DELETE FROM public.pending_student_assignments
WHERE lower(email) IN (
  SELECT lower(email) 
  FROM public.profiles 
  WHERE role = 'student'
);
