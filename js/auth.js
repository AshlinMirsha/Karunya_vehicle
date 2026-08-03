import { supabase } from '../supabase/client.js';
import { showToast } from '../components/toast.js';

const SAFE_REDIRECT_PATTERN = /^\/(?:checkin|student|coordinator|admin|dashboard)(?:[/?#]|$)/;

export function rememberProtectedRedirect(path = `${window.location.pathname}${window.location.search}${window.location.hash}`) {
  if (SAFE_REDIRECT_PATTERN.test(path)) window.localStorage.setItem('postLoginRedirect', path);
}

export function consumeProtectedRedirect() {
  const path = window.localStorage.getItem('postLoginRedirect');
  window.localStorage.removeItem('postLoginRedirect');
  return path && SAFE_REDIRECT_PATTERN.test(path) ? path : null;
}

export async function loginWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/` } });
  if (error) showToast(error.message, 'danger');
}
export async function logoutUser() { await supabase.auth.signOut(); window.location.href = '/'; }
window.handleLogout = logoutUser;
