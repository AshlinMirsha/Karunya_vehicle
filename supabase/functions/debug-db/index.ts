import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  
  const { data: admin } = await client.from('profiles').select('id').eq('role', 'admin').limit(1).single();
  const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  // Wait, I can't easily impersonate without a JWT, let's just query history manually.
  
  const { data: s } = await client.from('attendance_sessions').select('*').order('created_at', { ascending: false }).limit(20);
  const { data: a } = await client.from('attendance').select('*, profiles(*)').order('checked_in_at', { ascending: false }).limit(20);
  
  return new Response(JSON.stringify({ sessions: s, attendance: a }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
