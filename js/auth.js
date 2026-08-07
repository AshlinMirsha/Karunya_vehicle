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

// Global Inactivity Timeout (5 minutes) & Absolute Session Timeout (1 hour)
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const ABSOLUTE_TIMEOUT_MS = 60 * 60 * 1000;
let idleTimer = null;

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    showToast('Session expired due to inactivity.', 'warning');
    logoutUser();
  }, INACTIVITY_TIMEOUT_MS);
}

function startInactivityMonitor() {
  ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'].forEach(event => {
    document.addEventListener(event, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();
}

async function enforceAbsoluteSessionLimit() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const loginTime = parseInt(window.sessionStorage.getItem('session_login_time') || '0', 10);
    const now = Date.now();
    if (!loginTime) {
      window.sessionStorage.setItem('session_login_time', now.toString());
    } else if (now - loginTime > ABSOLUTE_TIMEOUT_MS) {
      window.sessionStorage.removeItem('session_login_time');
      showToast('Maximum session lifetime reached. Please sign in again.', 'warning');
      logoutUser();
      return;
    }
    startInactivityMonitor();
  } else {
    window.sessionStorage.removeItem('session_login_time');
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    window.sessionStorage.setItem('session_login_time', Date.now().toString());
    startInactivityMonitor();
  } else if (event === 'SIGNED_OUT') {
    window.sessionStorage.removeItem('session_login_time');
    clearTimeout(idleTimer);
  }
});

enforceAbsoluteSessionLimit().catch(() => {});

