import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async () => {
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Query pg_cron job table via RPC if available or check via postgres inspection
  const { data: jobs, error: jobsErr } = await client
    .rpc('run_sql', { query: `SELECT jobid, schedule, command, active FROM cron.job;` })
    .catch(() => ({ data: null, error: 'RPC disabled' }));

  return new Response(JSON.stringify({ jobs, jobsErr }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
