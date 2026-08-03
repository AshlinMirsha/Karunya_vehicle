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

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const protectedRedirect = consumeProtectedRedirect();
  const roleHome = profile?.role === 'admin' ? '/dashboard' : profile?.role === 'coordinator' ? '/coordinator' : '/student';
  const safeRedirect = protectedRedirect && (
    profile?.role === 'admin'
    || (profile?.role === 'coordinator' && protectedRedirect !== '/dashboard')
    || (profile?.role === 'student' && protectedRedirect !== '/dashboard' && protectedRedirect !== '/coordinator')
  );
  window.location.href = safeRedirect ? protectedRedirect : roleHome;
}

redirectAuthenticatedUser().catch(() => {});
