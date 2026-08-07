import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async () => {
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Query pg_cron job table via RPC if available or check via postgres inspection
  const [{ data: jobs, error: jobsErr }, { data: titusProfile, error: titusErr }, { data: bus13, error: bus13Err }] = await Promise.all([
    client.rpc('run_sql', { query: `SELECT jobid, schedule, command, active FROM cron.job;` }).catch(() => ({ data: null, error: 'RPC disabled' })),
    client.from('profiles').select('*').eq('email', 'titusi@karunya.edu').maybeSingle(),
    client.from('buses').select('*').eq('bus_number', '13').maybeSingle(),
  ]);

  return new Response(JSON.stringify({ jobs, jobsErr, titusProfile, titusErr, bus13, bus13Err }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
