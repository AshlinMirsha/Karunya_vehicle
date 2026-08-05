import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SUPABASE_URL = 'https://kkbzofddkfusblyplnca.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data, error } = await client.rpc('run_sql', { query: 'SELECT * FROM cron.job' }).catch(() => ({}));
  console.log("Cron:", data || error);
}
main();
