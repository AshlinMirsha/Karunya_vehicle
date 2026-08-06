import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async () => {
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Test calling authorized_session_email_logs
  const { data: rpcData, error: rpcError } = await client.rpc('authorized_session_email_logs');

  return new Response(JSON.stringify({
    rpcData,
    rpcError,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
