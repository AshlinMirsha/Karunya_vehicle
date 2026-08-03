import { supabase } from '../supabase/client.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const initialFromName = (value) => String(value || 'K').trim().charAt(0).toUpperCase() || 'K';

export function renderNavbar(user = null, activeRole = null) {
  const container = document.getElementById('navbar-container');
  if (!container) return;

  const userName = escapeHtml(user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Karunya User');
  const avatarInitial = escapeHtml(initialFromName(user?.user_metadata?.full_name || user?.email?.split('@')[0]));
  const authBadge = user
    ? `<div class="nav-status-badge">
         <span class="nav-initial-avatar" aria-label="${userName} profile photo">${avatarInitial}</span>
         <span class="nav-user-name">${userName}</span>
         <span class="badge bg-info text-dark ms-1" style="font-size: 0.7rem;">${escapeHtml(activeRole || 'Student')}</span>
         <button id="btn-logout-nav" class="btn btn-link text-white-50 p-0 ms-2 nav-logout" aria-label="Switch account" title="Switch account"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4m4-4 4-3-4-3m4 3H9"/></svg><span>Switch account</span></button>
       </div>`
    : `<div class="nav-status-badge">
         <span class="nav-status-dot"></span>
         <span>Not Signed In</span>
       </div>`;

  container.innerHTML = `
    <header class="navbar-wrapper">
      <div class="glass-nav-floating d-flex align-items-center justify-content-between">
        <button id="brand-easter-egg" type="button" class="navbar-brand-button d-flex align-items-center gap-3 text-decoration-none" aria-label="Karunya Bus Attendance">
          <img src="../Logo.png" alt="Karunya Bus Attendance" height="36" width="32">
          <div class="d-flex flex-column">
            <span class="fw-bold text-white fs-6 mb-0" style="letter-spacing: -0.01em;">Karunya Institute of Technology and Sciences</span>
            <small class="text-white-50" style="font-size: 0.72rem;">Bus Attendance Management System</small>
          </div>
        </button>

        <div class="d-flex align-items-center gap-3">
          ${authBadge}
        </div>
      </div>
    </header>
    <dialog id="brand-easter-egg-dialog" class="brand-easter-egg-dialog" aria-labelledby="brand-easter-egg-title">
      <button type="button" class="brand-easter-egg-close" aria-label="Close">×</button>
      <p class="brand-easter-egg-kicker">A small thank you</p>
      <h2 id="brand-easter-egg-title">App made by Lohit for Mirsha</h2>
      <p>Built with care for the Karunya bus attendance team.</p>
    </dialog>
  `;

  const brandButton = document.getElementById('brand-easter-egg');
  const easterEggDialog = document.getElementById('brand-easter-egg-dialog');
  const easterEggMessages = new Map([
    [5, 'App made by Lohit for Mirsha'],
    [6, 'Benesha Kalutha'],
    [10, 'Mirsha Kalutha'],
  ]);
  let logoTaps = 0;
  let tapReset;
  brandButton?.addEventListener('click', () => {
    logoTaps += 1;
    window.clearTimeout(tapReset);
    tapReset = window.setTimeout(() => {
      const message = easterEggMessages.get(logoTaps);
      if (message) {
        const title = easterEggDialog?.querySelector('#brand-easter-egg-title');
        if (title) title.textContent = message;
        easterEggDialog?.showModal();
      }
      logoTaps = 0;
    }, 1200);
  });
  easterEggDialog?.querySelector('.brand-easter-egg-close')?.addEventListener('click', () => easterEggDialog.close());

  const logoutBtn = document.getElementById('btn-logout-nav');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      logoutBtn.disabled = true;
      logoutBtn.setAttribute('aria-busy', 'true');
      logoutBtn.querySelector('span').textContent = 'Switching…';
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (!error) { window.location.replace('/'); return; }
      logoutBtn.disabled = false;
      logoutBtn.removeAttribute('aria-busy');
      logoutBtn.querySelector('span').textContent = 'Try again';
    });
  }
}
