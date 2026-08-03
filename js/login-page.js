import { supabase } from '../supabase/client.js';
import { consumeProtectedRedirect, loginWithGoogle } from './auth.js';

const ADMIN_EMAILS = new Set(['ashlinmirsha@karunya.edu.in']);

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

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const isAdmin = profile?.role === 'admin' || ADMIN_EMAILS.has(user.email?.toLowerCase() ?? '');
  const protectedRedirect = consumeProtectedRedirect();
  const roleHome = isAdmin ? '/dashboard' : profile?.role === 'coordinator' ? '/coordinator' : '/student';
  const safeRedirect = protectedRedirect && (
    isAdmin
    || (profile?.role === 'coordinator' && protectedRedirect !== '/dashboard')
    || (profile?.role === 'student' && protectedRedirect !== '/dashboard' && protectedRedirect !== '/coordinator')
  );
  window.location.href = safeRedirect ? protectedRedirect : roleHome;
}

redirectAuthenticatedUser().catch(() => {});
