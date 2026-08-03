create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('karunya-morning-qr', '30 23 * * *', $$
  select net.http_post(
    url := 'https://kkbzofddkfusblyplnca.supabase.co/functions/v1/daily-qr',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'bus_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);

select cron.schedule('karunya-evening-qr', '30 9 * * *', $$
  select net.http_post(
    url := 'https://kkbzofddkfusblyplnca.supabase.co/functions/v1/daily-qr',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'bus_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);
