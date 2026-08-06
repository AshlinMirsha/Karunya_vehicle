import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async () => {
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: s } = await client.from('attendance_sessions').select('*').order('created_at', { ascending: false }).limit(20);
  return new Response(JSON.stringify({ sessions: s }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
