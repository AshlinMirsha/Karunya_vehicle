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

  const isStaff = activeRole === 'Admin' || activeRole === 'Coordinator';
  let navItems = '';
  if (activeRole === 'Admin') {
    navItems = `
      <div class="collapse navbar-collapse justify-content-center" id="mainNavbarCollapse">
        <ul class="navbar-nav align-items-center gap-1 my-2 my-lg-0">
          <li class="nav-item">
            <a class="nav-link text-white px-3 py-1 rounded-3 active fw-medium" href="#top">Dashboard</a>
          </li>
          <li class="nav-item">
            <a class="nav-link text-white-50 px-3 py-1 rounded-3 fw-medium text-hover-white" href="#attendance-section">Attendance</a>
          </li>
          <li class="nav-item dropdown">
            <a class="nav-link text-white-50 px-3 py-1 rounded-3 fw-medium dropdown-toggle text-hover-white" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">
              People
            </a>
            <ul class="dropdown-menu dropdown-menu-dark glass-dropdown shadow-lg border-secondary rounded-3">
              <li>
                <button class="dropdown-item d-flex align-items-center gap-2 py-2 text-white-50 text-hover-white" type="button" data-bs-toggle="offcanvas" data-bs-target="#sidebarAssignedStudents">
                  <span>👥</span> View Students
                </button>
              </li>
              <li>
                <button class="dropdown-item d-flex align-items-center gap-2 py-2 text-white-50 text-hover-white" type="button" data-bs-toggle="modal" data-bs-target="#modalAddCoordinator">
                  <span>👔</span> Coordinator
                </button>
              </li>
              <li>
                <button class="dropdown-item d-flex align-items-center gap-2 py-2 text-white-50 text-hover-white" type="button" data-bs-toggle="offcanvas" data-bs-target="#sidebarStudentMgmt">
                  <span>⚙️</span> Edit Users
                </button>
              </li>
            </ul>
          </li>
          <li class="nav-item dropdown">
            <a class="nav-link text-white-50 px-3 py-1 rounded-3 fw-medium dropdown-toggle text-hover-white" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">
              Buses
            </a>
            <ul class="dropdown-menu dropdown-menu-dark glass-dropdown shadow-lg border-secondary rounded-3">
              <li>
                <a class="dropdown-item d-flex align-items-center gap-2 py-2 text-white-50 text-hover-white" href="#admin-directory-section">
                  <span>🚌</span> Bus Details
                </a>
              </li>
              <li>
                <button class="dropdown-item d-flex align-items-center gap-2 py-2 text-white-50 text-hover-white" type="button" data-bs-toggle="offcanvas" data-bs-target="#sidebarStudentMgmt">
                  <span>🔄</span> Bus Assignments
                </button>
              </li>
            </ul>
          </li>
          <li class="nav-item">
            <a class="nav-link text-white-50 px-3 py-1 rounded-3 fw-medium text-hover-white" href="#reports-section">Reports</a>
          </li>
        </ul>
      </div>
    `;
  } else if (activeRole === 'Coordinator') {
    navItems = `
      <div class="collapse navbar-collapse justify-content-center" id="mainNavbarCollapse">
        <ul class="navbar-nav align-items-center gap-1 my-2 my-lg-0">
          <li class="nav-item">
            <a class="nav-link text-white px-3 py-1 rounded-3 active fw-medium" href="#top">Dashboard</a>
          </li>
          <li class="nav-item">
            <a class="nav-link text-white-50 px-3 py-1 rounded-3 fw-medium text-hover-white" href="#attendance-section">Attendance</a>
          </li>
          <li class="nav-item">
            <button class="nav-link btn btn-link text-white-50 px-3 py-1 rounded-3 fw-medium text-hover-white text-decoration-none" type="button" data-bs-toggle="offcanvas" data-bs-target="#sidebarAssignedStudents">
              Students
            </button>
          </li>
          <li class="nav-item">
            <a class="nav-link text-white-50 px-3 py-1 rounded-3 fw-medium text-hover-white" href="#reports-section">Reports</a>
          </li>
        </ul>
      </div>
    `;
  }

  const mobileToggler = isStaff
    ? `<button class="navbar-toggler text-white border-secondary d-lg-none ms-auto me-2 p-1" type="button" data-bs-toggle="collapse" data-bs-target="#mainNavbarCollapse" aria-controls="mainNavbarCollapse" aria-expanded="false" aria-label="Toggle navigation">
        <span class="navbar-toggler-icon"></span>
       </button>`
    : '';

  container.innerHTML = `
    <header class="navbar-wrapper">
      <nav class="navbar navbar-expand-lg glass-nav-floating p-2 px-3">
        <div class="container-fluid p-0 d-flex align-items-center justify-content-between">
          <button id="brand-easter-egg" type="button" class="navbar-brand-button d-flex align-items-center gap-3 text-decoration-none" aria-label="Karunya Bus Attendance">
            <img src="../Logo.png" alt="Karunya Bus Attendance" height="36" width="32">
            <div class="d-flex flex-column">
              <span class="fw-bold text-white fs-6 mb-0" style="letter-spacing: -0.01em;">Karunya Institute of Technology and Sciences</span>
              <small class="text-white-50" style="font-size: 0.72rem;">Bus Attendance Management System</small>
            </div>
          </button>

          ${mobileToggler}
          ${navItems}

          <div class="d-flex align-items-center gap-2 ms-auto ms-lg-0">
            ${activeRole === 'Admin' ? `
              <a id="admin-nav-notification-btn" href="#admin-activities-section" class="btn btn-outline-warning btn-sm position-relative d-inline-flex align-items-center gap-1 text-decoration-none px-2 py-1 rounded-pill" title="Notifications & Recent Activities" aria-label="Notifications">
                <span class="fs-6">🔔</span>
                <span id="nav-unread-badge" class="badge bg-danger rounded-pill px-2 py-1" style="font-size: 0.7rem;" hidden>0</span>
              </a>
            ` : ''}
            ${authBadge}
          </div>
        </div>
      </nav>
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
