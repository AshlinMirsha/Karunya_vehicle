import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const client = createClient('https://kkbzofddkfusblyplnca.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data, error } = await client.rpc('authorized_attendance_history', {});
  console.log("History for today:", JSON.stringify(data.filter(d => d.session_date === '2026-08-05'), null, 2));
}
main();
