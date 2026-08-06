import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async () => {
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Query cron.job to verify both schedules exist
  const { data: jobs, error } = await client.from('cron_job_view').select('*').catch(() => ({ data: null, error: 'view check' }));

  return new Response(JSON.stringify({
    jobs,
    error,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
