-- Fix the cron job to use CRON_SECRET from vault correctly.
-- The original schedule used bus_cron_secret from vault, but that vault entry
-- does not exist. We update the cron job to read from the correct secret name
-- or use a pg_net approach with a hardcoded placeholder that reads from the
-- environment variable via the vault.
--
-- Since the CRON_SECRET env var is set in Edge Function secrets (not the DB vault),
-- we update the cron schedule to use a pg_net HTTP call that passes the correct
-- header value from the vault secret 'cron_secret' which we create here.

-- Step 1: Store the cron secret in vault using the same key name the cron reads.
-- We use 'cron_secret' as the canonical vault name going forward.
-- (The vault.create_secret function inserts an encrypted row that can be read with
--  vault.decrypted_secrets or decrypted_secret from vault)

-- First, delete any stale job
select cron.unschedule('karunya-morning-qr');
select cron.unschedule('karunya-evening-qr');

-- Re-create the morning cron job (23:30 UTC = 05:00 IST).
-- The CRON_SECRET env var value starts with 7860d3...
-- We read it from vault secret named 'cron_secret' which we'll set below.
-- For the DB-side cron, we pass the vault secret as the header value.

-- Note: Supabase project-level Edge Function secrets (CRON_SECRET) are NOT accessible
-- from the Postgres side via pg_cron. The pg_cron job can only read from vault.decrypted_secrets.
-- So we must ensure the vault secret 'cron_secret' exists and its value matches CRON_SECRET.

-- Create the vault secret 'cron_secret' if it doesn't exist.
-- The actual value must match what is stored as CRON_SECRET in Edge Function secrets.
-- IMPORTANT: Replace '<CRON_SECRET_VALUE>' with the actual value from Supabase Dashboard.
-- Go to: Dashboard -> Settings -> Edge Functions -> Secrets -> CRON_SECRET -> (copy value)

-- DO NOT run this migration via supabase db push (it cannot connect).
-- Run the SQL below manually in the Supabase SQL Editor:

-- 1. Add vault secret (replace the value with your actual CRON_SECRET):
-- INSERT INTO vault.secrets (name, secret)
-- VALUES ('cron_secret', '<YOUR_CRON_SECRET_VALUE_HERE>')
-- ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret;

-- 2. Update cron schedules to use the correct vault key:
select cron.schedule('karunya-morning-qr', '30 23 * * *', $$
  select net.http_post(
    url := 'https://kkbzofddkfusblyplnca.supabase.co/functions/v1/daily-qr',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{"sessionTypes":["Morning"]}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);

select cron.schedule('karunya-evening-qr', '30 9 * * *', $$
  select net.http_post(
    url := 'https://kkbzofddkfusblyplnca.supabase.co/functions/v1/daily-qr',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{"sessionTypes":["Evening"]}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);
