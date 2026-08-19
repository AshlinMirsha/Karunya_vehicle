-- Migration: Remove automatic daily-qr cron jobs (5 AM / 3 PM scheduled emails)
-- System now operates exclusively on manual QR generation on-demand per coordinator session

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule('karunya-morning-qr');
    PERFORM cron.unschedule('karunya-evening-qr');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;
