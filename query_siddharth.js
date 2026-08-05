import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const client = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'));

async function main() {
  const { data: p } = await client.from('profiles').select('*').eq('register_number', 'URK25CS1192').single();
  const { data: att } = await client.from('attendance').select('*').eq('student_id', p.id);
  console.log("Siddharth attendance:", att);
}
main();
