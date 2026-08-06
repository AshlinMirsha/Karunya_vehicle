import { supabase } from '../supabase/client.js';
import { renderNavbar } from '../components/navbar.js';
import { showToast } from '../components/toast.js';
import { rememberProtectedRedirect } from './auth.js';

// ─── Helpers ───────────────────────────────────────────────────────────────
const text = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value ?? ''); };
const cell = (value) => { const td = document.createElement('td'); td.textContent = String(value ?? '—'); return td; };
const row = (values) => { const tr = document.createElement('tr'); values.forEach((v) => tr.append(cell(v))); return tr; };

// ─── Live location tracking ────────────────────────────────────────────────
let coordinatorLocationWatchId = null;
let lastReportedCoordinates = null;
let lastReportedTimestamp = 0;

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function stopLiveLocationTracking() {
  if (coordinatorLocationWatchId !== null) {
    navigator.geolocation.clearWatch(coordinatorLocationWatchId);
    coordinatorLocationWatchId = null;
    lastReportedCoordinates = null;
    lastReportedTimestamp = 0;
  }
}
function startLiveLocationTracking(busId) {
  stopLiveLocationTracking();
  if (!navigator.geolocation) { showToast('Geolocation is not supported by your browser.', 'danger'); return; }
  coordinatorLocationWatchId = navigator.geolocation.watchPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      const now = Date.now();
      if (lastReportedCoordinates) {
        const dist = calculateDistanceMeters(lastReportedCoordinates.latitude, lastReportedCoordinates.longitude, latitude, longitude);
        if (dist < 10 && now - lastReportedTimestamp < 15000) return;
      }
      try {
        const { error } = await supabase.functions.invoke('attendance-api', { body: { action: 'update-coordinator-location', busId, latitude, longitude } });
        if (error) throw error;
        lastReportedCoordinates = { latitude, longitude };
        lastReportedTimestamp = now;
      } catch { showToast('Unable to share live location with server.', 'warning'); }
    },
    (error) => {
      const msgs = { [error.PERMISSION_DENIED]: 'Location permission required.', [error.POSITION_UNAVAILABLE]: 'GPS unavailable.', [error.TIMEOUT]: 'GPS request timed out.' };
      showToast(msgs[error.code] || 'Error tracking location.', 'danger');
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}
window.addEventListener('beforeunload', stopLiveLocationTracking);

// ─── Date helpers ─────────────────────────────────────────────────────────
const getTodayISTDateStr = () => {
  // Get current date in IST (UTC+5:30)
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
};

// Bug fix: use T23:59:59 not T23:59 to avoid off-by-one excluding late-night sessions
const setTodayDefaults = () => {
  const localDate = getTodayISTDateStr();
  const fromEl = document.getElementById('filter-date-from');
  const toEl   = document.getElementById('filter-date-to');
  if (fromEl) fromEl.value = `${localDate}T00:00`;
  if (toEl)   toEl.value   = `${localDate}T23:59:59`;
};

const addOption = (select, value, label) => {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  select.append(opt);
};

// ─── Attendance status cell ───────────────────────────────────────────────
const getTodayDateStr = () => getTodayISTDateStr();

const statusCell = (status, time, lat, lon, sessionDateStr) => {
  const td = document.createElement('td');
  if (status === 'PRESENT') {
    const timeText = time ? new Date(time).toLocaleTimeString('en-IN', { timeStyle: 'short' }) : '';
    td.innerHTML = `PRESENT <span class="text-muted small">(${timeText})</span>` +
      (lat && lon ? ` <a href="https://maps.google.com/?q=${lat},${lon}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-info ms-2 py-0 px-2" style="font-size:0.75rem;border-color:rgba(var(--bs-info-rgb),.3)">Map</a>` : '');
  } else if (status === 'ABSENT') {
    td.innerHTML = `<span class="text-danger">ABSENT</span>`;
  } else {
    td.innerHTML = sessionDateStr === getTodayDateStr()
      ? `<span class="text-muted small fst-italic">Coming soon</span>`
      : '—';
  }
  return td;
};

// ─── Attendance table renderer (Bug fix: colSpan = 7) ────────────────────
const renderRows = (records) => {
  const body = document.getElementById('attendance-list');
  if (!body) return;
  if (!records.length) {
    const empty = row(['No attendance records match these filters.']);
    empty.firstElementChild.colSpan = 7; // ← fixed from 6
    body.replaceChildren(empty);
    return;
  }
  body.replaceChildren(...records.map((r) => {
    const tr = document.createElement('tr');
    tr.append(
      cell(r.full_name || 'Unnamed'),
      cell(r.register_number || '—'),
      cell(`Bus ${r.bus_number}`),
      cell(r.session_date ? new Date(r.session_date).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'),
      statusCell(r.morning_status, r.morning_checked_in_at, r.morning_latitude, r.morning_longitude, r.session_date),
      statusCell(r.evening_status, r.evening_checked_in_at, r.evening_latitude, r.evening_longitude, r.session_date),
      statusCell(r.special_status, r.special_checked_in_at, r.special_latitude, r.special_longitude, r.session_date)
    );
    return tr;
  }));
};

// ─── Email delivery log (for both admin and coordinator) ──────────────────
const renderSessionStatus = async (buses) => {
  const body = document.getElementById('session-status-list');
  if (!body) return;

  const todayIST = getTodayISTDateStr();
  const { data: sessions, error } = await supabase
    .from('attendance_sessions')
    .select('id, bus_id, session_type, created_at, email_status, email_error, profiles(email)')
    .gte('created_at', `${todayIST}T00:00:00+05:30`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) { body.innerHTML = `<tr><td colspan="5" class="text-muted text-center py-2">Could not load email log.</td></tr>`; return; }
  if (!sessions?.length) { body.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No QR sessions generated today yet.</td></tr>`; return; }

  body.replaceChildren(...sessions.map((session) => {
    const bus = buses.find((b) => b.id === session.bus_id);
    const busLabel = bus ? `Bus ${bus.bus_number}` : 'Unknown';
    const coordEmail = session.profiles?.email ?? '—';
    const timeLabel = new Date(session.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short', dateStyle: 'short' });
    const statusBadge =
      session.email_status === 'sent'    ? `<span class="badge bg-success">Sent</span>` :
      session.email_status === 'failed'  ? `<span class="badge bg-danger" title="${session.email_error ?? ''}">Failed</span>` :
                                           `<span class="badge bg-warning text-dark">Pending</span>`;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${busLabel}</td><td>${session.session_type}</td><td>${timeLabel}</td><td class="small">${coordEmail}</td><td>${statusBadge}${session.email_error ? `<br><small class="text-danger">${session.email_error.slice(0, 80)}</small>` : ''}</td>`;
    return tr;
  }));
};

// ─── Admin: people directory ──────────────────────────────────────────────
const renderAdminDirectory = async (buses) => {
  const { data: people, error } = await supabase.rpc('admin_people_records');
  if (error) return showToast('Directory could not be loaded.', 'danger');
  const section = document.createElement('section');
  section.className = 'glass-panel p-4 mt-4 mb-4';
  section.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-3">
      <div><h2 class="h5 fw-bold mb-1">People &amp; bus assignments</h2><p class="text-muted small mb-0">All students, coordinators, and their bus details.</p></div>
      <div class="d-flex gap-2">
        <select class="form-select" id="directory-role">
          <option value="">All roles</option><option value="student">Students</option>
          <option value="coordinator">Coordinators</option><option value="admin">Admins</option>
        </select>
        <select class="form-select" id="directory-bus"><option value="">All buses</option></select>
      </div>
    </div>
    <div class="table-responsive">
      <table class="table table-dark-custom align-middle mb-0">
        <thead><tr><th>Role</th><th>Name</th><th>Reg. No.</th><th>Email</th><th>Bus</th><th>Route</th><th>Status</th></tr></thead>
        <tbody id="directory-list"></tbody>
      </table>
    </div>`;
  document.querySelector('main').append(section);
  const roleFilter = section.querySelector('#directory-role');
  const busFilter  = section.querySelector('#directory-bus');
  buses.forEach((b) => addOption(busFilter, b.id, `Bus ${b.bus_number}`));
  const draw = () => {
    const filtered = (people ?? []).filter((p) =>
      (!roleFilter.value || p.role === roleFilter.value) &&
      (!busFilter.value  || p.bus_id === busFilter.value)
    );
    const tbody = section.querySelector('#directory-list');
    if (!filtered.length) {
      const e = row(['No people match.']); e.firstElementChild.colSpan = 7; tbody.replaceChildren(e); return;
    }
    tbody.replaceChildren(...filtered.map((p) => row([
      p.role, p.full_name || '—', p.register_number || '—', p.email,
      p.bus_number ? `Bus ${p.bus_number}` : 'Unassigned', p.route || '—', p.status,
    ])));
  };
  roleFilter.addEventListener('change', draw);
  busFilter.addEventListener('change', draw);
  draw();
};

// ─── Coordinator: student roster ──────────────────────────────────────────
const renderStudentRoster = async () => {
  const { data: students, error } = await supabase.rpc('authorized_student_records');
  if (error) return showToast('Student roster could not be loaded.', 'danger');
  const section = document.createElement('section');
  section.className = 'glass-panel p-4 mt-4 mb-4';
  section.innerHTML = `<h2 class="h5 fw-bold mb-1">Assigned students</h2>
    <p class="text-muted small mb-3">Active students and those awaiting first sign-in.</p>
    <div class="table-responsive">
      <table class="table table-dark-custom align-middle mb-0">
        <thead><tr><th>Name</th><th>Reg. No.</th><th>Email</th><th>Bus</th><th>Status</th></tr></thead>
        <tbody id="student-roster-list"></tbody>
      </table>
    </div>`;
  document.querySelector('main').append(section);
  const tbody = section.querySelector('#student-roster-list');
  if (!(students ?? []).length) {
    const e = row(['No students assigned.']); e.firstElementChild.colSpan = 5; tbody.replaceChildren(e); return;
  }
  tbody.replaceChildren(...students.map((s) => {
    const statusBadge = s.status === 'active'
      ? `<span class="badge bg-success">Active</span>`
      : `<span class="badge bg-warning text-dark">${s.status}</span>`;
    const tr = row([s.full_name || '—', s.register_number || '—', s.email, `Bus ${s.bus_number}`]);
    const statusTd = document.createElement('td');
    statusTd.innerHTML = statusBadge;
    tr.append(statusTd);
    return tr;
  }));
};

// ─── Admin: student management actions ───────────────────────────────────
const initAdminStudentManagement = (buses) => {
  // Populate bus dropdowns in the admin management forms
  const busSelects = ['add-student-bus', 'move-student-bus', 'add-coord-bus'];
  busSelects.forEach((id) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.replaceChildren();
    addOption(sel, '', 'Select bus…');
    buses.forEach((b) => addOption(sel, b.id, `Bus ${b.bus_number} — ${b.route}`));
  });

  const setMsg = (id, msg, isError = false) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.className = `mt-2 small ${isError ? 'text-danger' : 'text-success'}`; }
  };

  const invokeAdmin = async (action, body, msgId) => {
    const { data, error } = await supabase.functions.invoke('attendance-api', { body: { action, ...body } });
    const msg = data?.message || error?.message || (error ? 'An error occurred.' : 'Done.');
    const isError = !!error || !data?.message?.toLowerCase().includes('success') && !data?.message?.toLowerCase().includes('successfully');
    setMsg(msgId, msg, isError);
    if (!isError) showToast(msg, 'success');
    return !error;
  };

  document.getElementById('btn-add-student')?.addEventListener('click', async () => {
    const fullName      = document.getElementById('add-student-name')?.value.trim();
    const email         = document.getElementById('add-student-email')?.value.trim().toLowerCase();
    const registerNumber = document.getElementById('add-student-regnumber')?.value.trim().toUpperCase();
    const busId         = document.getElementById('add-student-bus')?.value;
    if (!fullName || !email || !registerNumber || !busId) return setMsg('add-student-msg', 'All fields are required.', true);
    await invokeAdmin('add-student', { fullName, email, registerNumber, busId }, 'add-student-msg');
  });

  document.getElementById('btn-move-student')?.addEventListener('click', async () => {
    const studentEmail = document.getElementById('move-student-email')?.value.trim().toLowerCase();
    const newBusId     = document.getElementById('move-student-bus')?.value;
    if (!studentEmail || !newBusId) return setMsg('move-student-msg', 'Email and target bus are required.', true);
    const ok = await invokeAdmin('move-student', { studentEmail, newBusId }, 'move-student-msg');
    if (ok) document.getElementById('move-student-email').value = '';
  });

  document.getElementById('btn-remove-student')?.addEventListener('click', async () => {
    const studentEmail = document.getElementById('remove-student-email')?.value.trim().toLowerCase();
    if (!studentEmail) return setMsg('remove-student-msg', 'Email is required.', true);
    if (!confirm(`Remove ${studentEmail} from their bus? This will set them inactive.`)) return;
    const ok = await invokeAdmin('remove-student', { studentEmail }, 'remove-student-msg');
    if (ok) document.getElementById('remove-student-email').value = '';
  });

  document.getElementById('btn-add-coordinator')?.addEventListener('click', async () => {
    const fullName = document.getElementById('add-coord-name')?.value.trim();
    const email    = document.getElementById('add-coord-email')?.value.trim().toLowerCase();
    const busId    = document.getElementById('add-coord-bus')?.value;
    if (!fullName || !email || !busId) return setMsg('add-coord-msg', 'All fields are required.', true);
    await invokeAdmin('add-coordinator', { fullName, email, busId }, 'add-coord-msg');
  });
};

// ─── PDF export ───────────────────────────────────────────────────────────
const initPdfExport = () => {
  document.getElementById('btn-export-pdf')?.addEventListener('click', () => {
    window.print();
  });
};

// ─── Main init ────────────────────────────────────────────────────────────
export async function initOperationsDashboard(expectedRole) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { rememberProtectedRedirect(); return location.replace('/'); }
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile, error: profileError } = await supabase.rpc('current_app_profile').single();
  if (!user || profileError || !profile?.role) {
    showToast('Your profile could not be verified. Please sign in again.', 'danger'); return;
  }
  if (profile.role !== expectedRole) {
    return location.replace(profile.role === 'admin' ? '/admin' : profile.role === 'coordinator' ? '/coordinator' : '/student');
  }

  renderNavbar(user, expectedRole === 'admin' ? 'Admin' : 'Coordinator');
  document.body.classList.add('role-authorized');

  const canGenerateQr = expectedRole === 'coordinator';
  document.getElementById('qr-panel')?.toggleAttribute('hidden', !canGenerateQr);
  // Admin-only management panel
  document.getElementById('admin-student-mgmt')?.toggleAttribute('hidden', expectedRole !== 'admin');

  const [busesResult, summaryResult] = await Promise.all([
    supabase.rpc('authorized_bus_records'),
    supabase.rpc('attendance_dashboard_summary'),
  ]);
  if (busesResult.error || summaryResult.error) {
    showToast('Dashboard data could not be loaded. Please refresh.', 'danger'); return;
  }

  const buses = busesResult.data ?? [];
  const summary = summaryResult.data?.[0] ?? {};

  // Updated stats — active, pending, total
  const active  = summary.student_count_active  ?? summary.student_count ?? 0;
  const pending = summary.student_count_pending ?? 0;
  const total   = summary.student_count_total   ?? active;

  text('stat-total-students',   total);
  text('stat-students-active',  active);
  text('stat-students-pending', pending);
  text('stat-active-buses',     summary.bus_count ?? buses.length);
  text('stat-today-attendance', summary.present_today ?? 0);
  text('stat-morning-checkins', summary.morning_checkins ?? 0);
  text('stat-evening-checkins', summary.evening_checkins ?? 0);

  // Bus filter dropdown
  const busFilter = document.getElementById('filter-bus');
  if (busFilter) {
    busFilter.replaceChildren();
    addOption(busFilter, '', expectedRole === 'admin' ? 'All buses' : 'My assigned bus');
    buses.forEach((b) => addOption(busFilter, b.id, `Bus ${b.bus_number} — ${b.route}`));
    if (expectedRole === 'coordinator' && profile.bus_id) busFilter.value = profile.bus_id;
  }

  // Attendance history loader
  const loadHistory = async () => {
    const searchVal = document.getElementById('filter-search')?.value.trim() || null;
    const dateToRaw = document.getElementById('filter-date-to')?.value || null;
    // Ensure seconds are included to avoid off-by-one (Bug fix)
    const dateTo = dateToRaw && !dateToRaw.includes(':') ? `${dateToRaw}T23:59:59` :
                   dateToRaw && dateToRaw.match(/T\d{2}:\d{2}$/) ? `${dateToRaw}:59` : dateToRaw;
    const { data, error } = await supabase.rpc('authorized_attendance_history', {
      p_bus_id:    busFilter?.value || null,
      p_date_from: document.getElementById('filter-date-from')?.value || null,
      p_date_to:   dateTo,
      p_status:    document.getElementById('filter-status')?.value || null,
      p_search:    searchVal,
      p_day_type:  document.getElementById('filter-day-type')?.value || null,
    });
    if (error) { showToast('Attendance history could not be loaded.', 'danger'); return; }
    const records = data ?? [];
    text('stat-history-count', records.length);
    renderRows(records);
  };

  // Search with debounce
  let searchTimeout;
  const searchInput = document.getElementById('filter-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      if (searchInput.value.trim().length > 0) {
        document.getElementById('filter-date-from').value = '';
        document.getElementById('filter-date-to').value   = '';
      }
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(loadHistory, 300);
    });
  }

  ['filter-bus', 'filter-date-from', 'filter-date-to', 'filter-status', 'filter-day-type']
    .forEach((id) => document.getElementById(id)?.addEventListener('change', loadHistory));

  // Clear filters button
  document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
    setTodayDefaults();
    if (document.getElementById('filter-status')) document.getElementById('filter-status').value = '';
    if (searchInput) searchInput.value = '';
    if (busFilter) busFilter.value = expectedRole === 'coordinator' ? (profile.bus_id || '') : '';
    const dayType = document.getElementById('filter-day-type');
    if (dayType) dayType.value = '';
    loadHistory();
  });

  // Quick filter buttons
  document.getElementById('quick-filters')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const filter = btn.dataset.filter;
    const df = document.getElementById('filter-date-from');
    const dt = document.getElementById('filter-date-to');
    const st = document.getElementById('filter-status');
    const dy = document.getElementById('filter-day-type');
    if (filter === 'today')    { setTodayDefaults(); if (dy) dy.value = ''; }
    else if (filter === 'weekdays') { if (df) df.value = ''; if (dt) dt.value = ''; if (dy) dy.value = 'weekday'; }
    else if (filter === 'weekends') { if (df) df.value = ''; if (dt) dt.value = ''; if (dy) dy.value = 'weekend'; }
    else if (filter === 'present')  { if (st) st.value = 'PRESENT'; }
    else if (filter === 'absent')   { if (st) st.value = 'ABSENT'; }
    loadHistory();
  });

  // PDF export
  initPdfExport();

  // Load data
  setTodayDefaults();
  await loadHistory();

  // Email delivery log (both roles)
  await renderSessionStatus(buses);

  // Role-specific extras
  if (expectedRole === 'admin') {
    initAdminStudentManagement(buses);
    await renderAdminDirectory(buses);
  } else {
    await renderStudentRoster();
  }

  // ─── QR generation (coordinator only) ──────────────────────────────
  if (!canGenerateQr) return;
  const qrBus = document.getElementById('select-qr-bus');
  if (qrBus) {
    qrBus.replaceChildren();
    const myBus = buses.find((b) => b.id === profile.bus_id);
    if (myBus) addOption(qrBus, myBus.id, `Bus ${myBus.bus_number} — ${myBus.route}`);
    qrBus.value    = profile.bus_id || '';
    qrBus.disabled = true;
  }

  document.getElementById('btn-generate-qr')?.addEventListener('click', async () => {
    const emailQr = document.getElementById('check-email-qr')?.checked ?? false;
    const { data, error } = await supabase.functions.invoke('attendance-api', {
      body: {
        action:      'create-session',
        busId:       qrBus.value,
        sessionType: document.getElementById('select-session')?.value,
        emailQr,
      },
    });
    if (error || !data?.token || !data?.expiresAt) {
      const msg = data?.message || error?.message || 'QR session could not be created.';
      return showToast(msg, 'danger');
    }
    startLiveLocationTracking(qrBus.value);
    const dur = new Date(data.expiresAt).getTime() - Date.now();
    if (dur > 0) setTimeout(stopLiveLocationTracking, dur);

    const display = document.getElementById('qr-code-display');
    if (display) {
      display.replaceChildren();
      new window.QRCode(display, { text: `${location.origin}/checkin?token=${encodeURIComponent(data.token)}`, width: 220, height: 220 });
    }
    text('qr-url-text', `Expires ${new Date(data.expiresAt).toLocaleTimeString('en-IN')}`);

    showToast(
      emailQr ? (data.emailSent ? 'QR created and emailed.' : 'QR created, email could not be sent.') : 'Secure QR session created.',
      emailQr && !data.emailSent ? 'warning' : 'success'
    );

    // Refresh email log after QR creation
    await renderSessionStatus(buses);
  });
}
