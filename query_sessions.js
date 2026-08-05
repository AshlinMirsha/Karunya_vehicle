import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const client = createClient('https://kkbzofddkfusblyplnca.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data, error } = await client.rpc('run_sql', { query: `
    SELECT id, bus_id, session_type, created_at, email_status
    FROM attendance_sessions
    WHERE created_at >= '2026-08-04 00:00:00+00'
    ORDER BY created_at DESC;
  ` }).catch(() => ({}));
  console.log("Sessions:", data || error);
}
main();
