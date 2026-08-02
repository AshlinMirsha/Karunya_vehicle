import { supabase } from '../supabase/client.js';
import { showToast } from '../components/toast.js';
export async function loginWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/` } });
  if (error) showToast(error.message, 'danger');
}
export async function logoutUser() { await supabase.auth.signOut(); window.location.href = '/'; }
window.handleLogout = logoutUser;
