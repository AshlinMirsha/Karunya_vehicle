import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://kkbzofddkfusblyplnca.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_i-3vcpnMbc2p5_CX7TJyKA_h2E4CUFf';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
