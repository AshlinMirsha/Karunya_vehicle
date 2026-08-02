const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const safeAvatarUrl = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.toString() : 'https://via.placeholder.com/32'; }
  catch { return 'https://via.placeholder.com/32'; }
};

export function renderNavbar(user = null, activeRole = null) {
  const container = document.getElementById('navbar-container');
  if (!container) return;

  const userName = escapeHtml(user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Karunya User');
  const avatarUrl = escapeHtml(safeAvatarUrl(user?.user_metadata?.avatar_url));
  const authBadge = user
    ? `<div class="nav-status-badge">
         <img src="${avatarUrl}" alt="Profile" width="24" height="24" class="rounded-circle me-1" referrerpolicy="no-referrer" onerror="this.src='https://via.placeholder.com/24'">
         <span>${userName}</span>
         <span class="badge bg-info text-dark ms-1" style="font-size: 0.7rem;">${escapeHtml(activeRole || 'Student')}</span>
         <button id="btn-logout-nav" class="btn btn-link text-white-50 p-0 ms-2" style="font-size: 0.8rem; text-decoration: none;"><i class="fa-solid fa-power-off"></i></button>
       </div>`
    : `<div class="nav-status-badge">
         <span class="nav-status-dot"></span>
         <span>Not Signed In</span>
       </div>`;

  container.innerHTML = `
    <header class="navbar-wrapper">
      <div class="glass-nav-floating d-flex align-items-center justify-content-between">
        <a class="d-flex align-items-center gap-3 text-decoration-none" href="/">
          <img src="../Logo.png" alt="Karunya Bus Attendance" height="36" width="32">
          <div class="d-flex flex-column">
            <span class="fw-bold text-white fs-6 mb-0" style="letter-spacing: -0.01em;">Karunya Institute of Technology and Sciences</span>
            <small class="text-white-50" style="font-size: 0.72rem;">Bus Attendance Management System</small>
          </div>
        </a>

        <div class="d-flex align-items-center gap-3">
          ${authBadge}
        </div>
      </div>
    </header>
  `;

  const logoutBtn = document.getElementById('btn-logout-nav');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (window.handleLogout) {
        await window.handleLogout();
      }
    });
  }
}
