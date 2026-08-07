import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://kkbzofddkfusblyplnca.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_i-3vcpnMbc2p5_CX7TJyKA_h2E4CUFf';

// Keep the bearer session in this browser tab rather than a shared persistent cookie.
// State-changing requests still require a verified JWT and same-origin server check.
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: window.sessionStorage,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});
