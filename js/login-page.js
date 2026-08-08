import { supabase } from '../supabase/client.js';
import { consumeProtectedRedirect, loginWithGoogle } from './auth.js';

const loginButton = document.getElementById('btn-google-login');
if (loginButton) {
  const initialMarkup = loginButton.innerHTML;
  loginButton.onclick = async () => {
    loginButton.disabled = true;
    loginButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> Authenticating...';
    try {
      await loginWithGoogle();
    } finally {
      loginButton.disabled = false;
      loginButton.innerHTML = initialMarkup;
    }
  };
}

async function redirectAuthenticatedUser() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  let profile = null;
  try {
    const { data: rpcProfile } = await supabase.rpc('current_app_profile').maybeSingle();
    profile = rpcProfile;
  } catch (e) {
    console.warn('RPC current_app_profile failed on login page:', e);
  }

  if (!profile?.role) {
    try {
      const { data: dbProfile } = await supabase.from('profiles').select('id, email, role, bus_id, status').eq('id', user.id).maybeSingle();
      if (dbProfile) profile = dbProfile;
    } catch (e) {
      console.warn('Fallback DB profiles query failed on login page:', e);
    }
  }

  if (!profile?.role) {
    const metaRole = user.user_metadata?.role;
    profile = { role: metaRole || 'student' };
  }

  const protectedRedirect = consumeProtectedRedirect();
  const roleHome = profile?.role === 'admin' ? '/admin' : profile?.role === 'coordinator' ? '/coordinator' : '/student';
  const safeRedirect = protectedRedirect && (
    profile?.role === 'admin'
    || (profile?.role === 'coordinator' && !['/admin', '/dashboard'].includes(protectedRedirect))
    || (profile?.role === 'student' && !['/admin', '/dashboard', '/coordinator'].includes(protectedRedirect))
  );
  window.location.href = safeRedirect ? protectedRedirect : roleHome;
}

redirectAuthenticatedUser().catch(() => {});
