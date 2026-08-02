select net.http_post(
  url := 'https://kkbzofddkfusblyplnca.supabase.co/functions/v1/daily-qr',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'bus_cron_secret')),
  body := '{}'::jsonb
);
