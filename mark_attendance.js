import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const client = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

async function main() {
  const { data: profile } = await client.from('profiles').select('id, bus_id').eq('register_number', 'URK25CS1192').single();
  const { data: session } = await client.from('attendance_sessions').select('id').eq('bus_id', profile.bus_id).eq('session_type', 'Morning').order('created_at', { ascending: false }).limit(1).single();
  
  const { data, error } = await client.from('attendance').insert({
    session_id: session.id,
    student_id: profile.id,
    latitude: 11.0,
    longitude: 77.0
  }).select();
  
  console.log("Inserted:", data, error);
}
main();
