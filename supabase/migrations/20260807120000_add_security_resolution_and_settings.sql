-- Migration: Security Dashboard Resolution & System Settings

-- 1. Update security_audit_events
ALTER TABLE public.security_audit_events
ADD COLUMN IF NOT EXISTS resolved boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS ip_address text;

-- 2. Create system_settings table
CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Protect system_settings (Admin only can manage)
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage system_settings" ON public.system_settings
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- Set default security email
INSERT INTO public.system_settings (key, value)
VALUES ('security_email_to', 'lohita@karunya.edu.in')
ON CONFLICT (key) DO NOTHING;

-- 3. Update get_security_alerts RPC
DROP FUNCTION IF EXISTS public.get_security_alerts();

CREATE OR REPLACE FUNCTION public.get_security_alerts()
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  actor_id uuid,
  full_name text,
  email text,
  ip_address text,
  action text,
  outcome text,
  resolved boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT 
    sae.id,
    sae.created_at,
    sae.actor_id,
    p.full_name,
    p.email,
    sae.ip_address,
    sae.action,
    sae.outcome,
    sae.resolved
  FROM public.security_audit_events sae
  LEFT JOIN public.profiles p ON p.id = sae.actor_id
  ORDER BY sae.created_at DESC
  LIMIT 100;
END;
$$;

-- 4. RPCs to resolve and clear alerts
CREATE OR REPLACE FUNCTION public.resolve_security_alert(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  UPDATE public.security_audit_events SET resolved = true WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_security_alert(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  DELETE FROM public.security_audit_events WHERE id = p_id;
END;
$$;

-- 5. RPC to transfer admin access
CREATE OR REPLACE FUNCTION public.transfer_admin_access(p_new_email text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_admin_id uuid;
  v_new_admin_id uuid;
BEGIN
  IF public.current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Only the current admin can transfer access';
  END IF;

  v_current_admin_id := auth.uid();

  -- Find the user with the given email
  SELECT id INTO v_new_admin_id FROM public.profiles WHERE lower(email) = lower(p_new_email);

  IF v_new_admin_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found. They must sign in first.', p_new_email;
  END IF;

  IF v_new_admin_id = v_current_admin_id THEN
    RAISE EXCEPTION 'You are already the admin.';
  END IF;

  -- Demote current admin to student and clear bus assignment
  UPDATE public.profiles SET role = 'student', bus_id = NULL WHERE id = v_current_admin_id;

  -- Promote new user to admin
  UPDATE public.profiles SET role = 'admin', bus_id = NULL WHERE id = v_new_admin_id;

END;
$$;

-- 6. pg_cron extension and scheduled job to delete archived (resolved) alerts older than 7 days
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Schedule the cleanup job to run every Sunday at 00:00 (weekly)
SELECT cron.schedule('weekly-security-log-cleanup', '0 0 * * 0', $$
  DELETE FROM public.security_audit_events
  WHERE resolved = true AND created_at < now() - interval '7 days';
$$);

-- 7. RPC to get and set system settings
CREATE OR REPLACE FUNCTION public.get_system_setting(p_key text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_value text;
BEGIN
  IF public.current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  SELECT value INTO v_value FROM public.system_settings WHERE key = p_key;
  RETURN v_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_system_setting(p_key text, p_value text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  INSERT INTO public.system_settings (key, value)
  VALUES (p_key, p_value)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$;
