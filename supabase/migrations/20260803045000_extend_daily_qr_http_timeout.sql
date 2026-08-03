select cron.alter_job(
  job_id := 1,
  command := $$
    select net.http_post(
      url := 'https://kkbzofddkfusblyplnca.supabase.co/functions/v1/daily-qr',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'bus_cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $$
);

select cron.alter_job(
  job_id := 2,
  command := $$
    select net.http_post(
      url := 'https://kkbzofddkfusblyplnca.supabase.co/functions/v1/daily-qr',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'bus_cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $$
);
