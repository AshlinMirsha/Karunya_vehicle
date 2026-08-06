-- Fix the cron job schedule and pass x-cron-secret directly in pg_net headers.

SELECT cron.unschedule('karunya-morning-qr');
SELECT cron.unschedule('karunya-evening-qr');

-- Morning Cron (05:00 AM IST / 23:30 UTC)
SELECT cron.schedule('karunya-morning-qr', '30 23 * * *', $$
  SELECT net.http_post(
    url := 'https://kkbzofddkfusblyplnca.supabase.co/functions/v1/daily-qr',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '7860d3ddc07148092371dc9b7ace274446a375a3733ccb7b86a62e3c097d88fd'
    ),
    body := '{"sessionTypes":["Morning"]}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);

-- Evening Cron (03:00 PM IST / 09:30 UTC)
SELECT cron.schedule('karunya-evening-qr', '30 9 * * *', $$
  SELECT net.http_post(
    url := 'https://kkbzofddkfusblyplnca.supabase.co/functions/v1/daily-qr',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '7860d3ddc07148092371dc9b7ace274446a375a3733ccb7b86a62e3c097d88fd'
    ),
    body := '{"sessionTypes":["Evening"]}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);
