import { supabase } from '../supabase/client.js';
import { renderNavbar } from '../components/navbar.js';
import { showToast } from '../components/toast.js';
import { rememberProtectedRedirect } from './auth.js';

const text = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = String(value); };
const cell = (value) => { const element = document.createElement('td'); element.textContent = String(value ?? '—'); return element; };
const row = (values) => { const element = document.createElement('tr'); values.forEach((value) => element.append(cell(value))); return element; };
const dateValue = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const getTodayDateStr = () => {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  return new Date(now - tzOffset).toISOString().slice(0, 10);
};

const statusCell = (status, time, lat, lon, sessionDateStr) => {
  const td = document.createElement('td');
  if (status === 'PRESENT') {
    const timeText = time ? new Date(time).toLocaleTimeString('en-IN', { timeStyle: 'short' }) : '';
    td.innerHTML = `PRESENT <span class="text-muted small">(${timeText})</span> <a href="https://maps.google.com/?q=${lat},${lon}" target="_blank" class="btn btn-sm btn-outline-info ms-2 py-0 px-2" style="font-size: 0.75rem; border-color: rgba(var(--bs-info-rgb), 0.3);">View map</a>`;
  } else if (status === 'ABSENT') {
    td.innerHTML = `<span class="text-danger">ABSENT</span>`;
  } else {
    if (sessionDateStr === getTodayDateStr()) {
      td.innerHTML = `<span class="text-muted small fst-italic">Coming soon</span>`;
    } else {
      td.textContent = '—';
    }
  }
  return td;
};

const renderRows = (records) => {
  const body = document.getElementById('attendance-list');
  if (!records.length) {
    const empty = row(['No attendance records match these filters.']);
    empty.firstElementChild.colSpan = 6;
    body.replaceChildren(empty);
    return;
  }
  body.replaceChildren(...records.map((record) => {
    const tr = document.createElement('tr');
    tr.append(
      cell(record.full_name || 'Unnamed student'),
      cell(record.register_number || '—'),
      cell(`Bus ${record.bus_number}`),
      cell(record.session_date ? new Date(record.session_date).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'),
      statusCell(record.morning_status, record.morning_checked_in_at, record.morning_latitude, record.morning_longitude, record.session_date),
      statusCell(record.evening_status, record.evening_checked_in_at, record.evening_latitude, record.evening_longitude, record.session_date),
      statusCell(record.special_status, record.special_checked_in_at, record.special_latitude, record.special_longitude, record.session_date)
    );
    return tr;
  }));
};

const addOption = (select, value, label) => {
  const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
};

const renderSessionStatus = async (buses) => {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  const localISODate = new Date(now - tzOffset).toISOString().slice(0, 10);
  
  const { data: sessions, error } = await supabase
    .from('attendance_sessions')
    .select('id, bus_id, session_type, created_at, email_status, email_error')
    .gte('created_at', `${localISODate}T00:00:00Z`)
    .order('created_at', { ascending: false });
    
  if (error) return;

  const section = document.createElement('section');
  section.className = 'glass-panel p-4 mt-4';
  section.innerHTML = `
    <h2 class="h5 fw-bold mb-1">Today's QR Email Delivery Status</h2>
    <p class="text-muted small mb-3">Status of QR emails sent to coordinators today.</p>
    <div class="table-responsive">
      <table class="table table-dark-custom align-middle mb-0">
        <thead>
          <tr>
            <th>Time</th>
            <th>Bus</th>
            <th>Session</th>
            <th>Email Status</th>
            <th>Error Info</th>
          </tr>
        </thead>
        <tbody id="session-status-list"></tbody>
      </table>
    </div>
  `;
  
  const main = document.querySelector('main');
  // insert before the first glass-panel section that is not the main stats row
  main.insertBefore(section, main.querySelector('section.glass-panel'));
  
  const body = section.querySelector('#session-status-list');
  if (!sessions || sessions.length === 0) {
    const empty = row(['No QR sessions generated today yet.']);
    empty.firstElementChild.colSpan = 5;
    body.replaceChildren(empty);
    return;
  }
  
  body.replaceChildren(...sessions.map(session => {
    const bus = buses.find(b => b.id === session.bus_id);
    const busLabel = bus ? `Bus ${bus.bus_number}` : 'Unknown Bus';
    const timeLabel = new Date(session.created_at).toLocaleTimeString('en-IN', { timeStyle: 'short' });
    
    let statusHtml = '';
    if (session.email_status === 'sent') {
      statusHtml = '<span class="badge bg-success">Sent</span>';
    } else if (session.email_status === 'failed') {
      statusHtml = '<span class="badge bg-danger">Failed</span>';
    } else {
      statusHtml = '<span class="badge bg-warning text-dark">Pending</span>';
    }
    
    const tr = document.createElement('tr');
    tr.append(
      cell(timeLabel),
      cell(busLabel),
      cell(session.session_type),
      cell(''),
      cell(session.email_error || '—')
    );
    tr.children[3].innerHTML = statusHtml;
    return tr;
  }));
};

const renderAdminDirectory = async (buses) => {
  const { data: people, error } = await supabase.rpc('admin_people_records');
  if (error) return showToast('Student and coordinator records could not be loaded.', 'danger');
  const section = document.createElement('section');
  section.className = 'glass-panel p-4 mt-4';
  section.innerHTML = `<div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-3"><div><h2 class="h5 fw-bold mb-1">People and bus assignments</h2><p class="text-muted small mb-0">Students, coordinators, and their assigned bus details.</p></div><div class="d-flex gap-2"><select class="form-select" id="directory-role"><option value="">All people</option><option value="student">Students</option><option value="coordinator">Coordinators</option><option value="admin">Admins</option></select><select class="form-select" id="directory-bus"><option value="">All buses</option></select></div></div><div class="table-responsive"><table class="table table-dark-custom align-middle mb-0"><thead><tr><th>Role</th><th>Name</th><th>Register number</th><th>Email</th><th>Bus</th><th>Route</th><th>Status</th></tr></thead><tbody id="directory-list"></tbody></table></div>`;
  document.querySelector('main').append(section);
  const roleFilter = section.querySelector('#directory-role');
  const busFilter = section.querySelector('#directory-bus');
  buses.forEach((bus) => addOption(busFilter, bus.id, `Bus ${bus.bus_number}`));
  const draw = () => {
    const filtered = (people ?? []).filter((person) => (!roleFilter.value || person.role === roleFilter.value) && (!busFilter.value || person.bus_id === busFilter.value));
    const body = section.querySelector('#directory-list');
    if (!filtered.length) {
      const empty = row(['No people match these filters.']); empty.firstElementChild.colSpan = 7; body.replaceChildren(empty); return;
    }
    body.replaceChildren(...filtered.map((person) => row([
      person.role, person.full_name || '—', person.register_number || '—', person.email, person.bus_number ? `Bus ${person.bus_number}` : 'Unassigned', person.route || '—', person.status,
    ])));
  };
  roleFilter.addEventListener('change', draw); busFilter.addEventListener('change', draw); draw();
};

const renderStudentRoster = async () => {
  const { data: students, error } = await supabase.rpc('authorized_student_records');
  if (error) return showToast('Assigned student roster could not be loaded.', 'danger');
  const section = document.createElement('section');
  section.className = 'glass-panel p-4 mt-4';
  section.innerHTML = '<h2 class="h5 fw-bold mb-1">Assigned students</h2><p class="text-muted small mb-3">Active students and pre-assigned students awaiting their first sign-in.</p><div class="table-responsive"><table class="table table-dark-custom align-middle mb-0"><thead><tr><th>Name</th><th>Register number</th><th>Email</th><th>Bus</th><th>Status</th></tr></thead><tbody id="student-roster-list"></tbody></table></div>';
  document.querySelector('main').append(section);
  const body = section.querySelector('#student-roster-list');
  if (!(students ?? []).length) {
    const empty = row(['No students are assigned to this bus.']); empty.firstElementChild.colSpan = 5; body.replaceChildren(empty); return;
  }
  body.replaceChildren(...students.map((student) => row([
    student.full_name || '—', student.register_number || '—', student.email, `Bus ${student.bus_number}`, student.status,
  ])));
};

export async function initOperationsDashboard(expectedRole) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { rememberProtectedRedirect(); return location.replace('/'); }
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile, error: profileError } = await supabase.rpc('current_app_profile').single();
  if (!user || profileError || !profile?.role) { showToast('Your profile could not be verified. Please sign in again.', 'danger'); return; }
  if (profile.role !== expectedRole) return location.replace(profile.role === 'admin' ? '/admin' : profile.role === 'coordinator' ? '/coordinator' : '/student');

  renderNavbar(user, expectedRole === 'admin' ? 'Admin' : 'Coordinator');
  document.body.classList.add('role-authorized');
  const canGenerateQr = expectedRole === 'coordinator';
  document.getElementById('qr-panel')?.toggleAttribute('hidden', !canGenerateQr);

  const [busesResult, summaryResult] = await Promise.all([
    supabase.rpc('authorized_bus_records'),
    supabase.rpc('attendance_dashboard_summary'),
  ]);
  if (busesResult.error || summaryResult.error) {
    showToast('Dashboard data could not be loaded. Please refresh.', 'danger');
    return;
  }
  const buses = busesResult.data ?? [];
  const summary = summaryResult.data?.[0] ?? { student_count: 0, bus_count: 0, present_today: 0, morning_checkins: 0, evening_checkins: 0 };
  text('stat-total-students', summary.student_count ?? 0);
  if (document.getElementById('stat-active-buses')) text('stat-active-buses', summary.bus_count ?? buses.length);
  text('stat-today-attendance', summary.present_today ?? 0);
  if (document.getElementById('stat-morning-checkins')) text('stat-morning-checkins', summary.morning_checkins ?? 0);
  if (document.getElementById('stat-evening-checkins')) text('stat-evening-checkins', summary.evening_checkins ?? 0);

  const busFilter = document.getElementById('filter-bus');
  busFilter.replaceChildren();
  addOption(busFilter, '', expectedRole === 'admin' ? 'All buses' : 'My assigned bus');
  buses.forEach((bus) => addOption(busFilter, bus.id, `Bus ${bus.bus_number} — ${bus.route}`));
  if (expectedRole === 'coordinator' && profile.bus_id) busFilter.value = profile.bus_id;

  const loadHistory = async () => {
    const searchVal = document.getElementById('filter-search')?.value.trim() || null;
    const { data, error } = await supabase.rpc('authorized_attendance_history', {
      p_bus_id: busFilter.value || null,
      p_date_from: document.getElementById('filter-date-from').value || null,
      p_date_to: document.getElementById('filter-date-to').value || null,
      p_status: document.getElementById('filter-status').value || null,
      p_search: searchVal,
      p_day_type: document.getElementById('filter-day-type')?.value || null,
    });
    if (error) { showToast('Attendance history could not be loaded.', 'danger'); return; }
    const records = data ?? [];
    text('stat-history-count', records.length);
    renderRows(records);
  };
  const setTodayDefaults = () => {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISODate = new Date(now - tzOffset).toISOString().slice(0, 10);
    document.getElementById('filter-date-from').value = `${localISODate}T00:00`;
    document.getElementById('filter-date-to').value = `${localISODate}T23:59`;
  };

  let searchTimeout;
  const searchInput = document.getElementById('filter-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      if (searchInput.value.trim().length > 0) {
        document.getElementById('filter-date-from').value = '';
        document.getElementById('filter-date-to').value = '';
      }
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(loadHistory, 300);
    });
  }

  ['filter-bus', 'filter-date-from', 'filter-date-to', 'filter-status', 'filter-day-type'].forEach((id) => document.getElementById(id)?.addEventListener('change', loadHistory));

  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    setTodayDefaults();
    document.getElementById('filter-status').value = '';
    if (searchInput) searchInput.value = '';
    busFilter.value = expectedRole === 'coordinator' ? profile.bus_id : '';
    const dayType = document.getElementById('filter-day-type');
    if (dayType) dayType.value = '';
    loadHistory();
  });

  const quickFilters = document.getElementById('quick-filters');
  if (quickFilters) {
    quickFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const filter = btn.dataset.filter;
      
      const df = document.getElementById('filter-date-from');
      const dt = document.getElementById('filter-date-to');
      const st = document.getElementById('filter-status');
      const dy = document.getElementById('filter-day-type');
      const search = document.getElementById('filter-search');
      
      // Clear specific filters when running a quick filter to ensure it works nicely
      if (filter === 'today') {
        setTodayDefaults();
        if (dy) dy.value = '';
      } else if (filter === 'weekdays') {
        df.value = ''; dt.value = '';
        if (dy) dy.value = 'weekday';
      } else if (filter === 'weekends') {
        df.value = ''; dt.value = '';
        if (dy) dy.value = 'weekend';
      } else if (filter === 'present') {
        st.value = 'PRESENT';
      } else if (filter === 'absent') {
        st.value = 'ABSENT';
      }
      
      loadHistory();
    });
  }

  setTodayDefaults();
  await loadHistory();

  await renderStudentRoster();
  if (expectedRole === 'admin') {
    await renderSessionStatus(buses);
    await renderAdminDirectory(buses);
    await renderSecurityDashboard();
  }

  if (!canGenerateQr) return;
  const qrBus = document.getElementById('select-qr-bus');
  qrBus.replaceChildren();
  const myBus = buses.find(b => b.id === profile.bus_id);
  if (myBus) {
    addOption(qrBus, myBus.id, `Bus ${myBus.bus_number} — ${myBus.route}`);
  }
  qrBus.value = profile.bus_id || '';
  qrBus.disabled = true;
  document.getElementById('btn-generate-qr').onclick = async () => {
    const emailQr = document.getElementById('check-email-qr')?.checked || false;
    const { data, error } = await supabase.functions.invoke('attendance-api', { body: { action: 'create-session', busId: qrBus.value, sessionType: document.getElementById('select-session').value, emailQr } });
    if (error || !data?.token || !data?.expiresAt) {
      const errorMessage = error?.context?.message || data?.message || error?.message || 'QR session could not be created.';
      return showToast(errorMessage, 'danger');
    }
    const display = document.getElementById('qr-code-display'); display.replaceChildren();
    new window.QRCode(display, { text: `${location.origin}/checkin?token=${encodeURIComponent(data.token)}`, width: 220, height: 220 });
    text('qr-url-text', `Expires ${new Date(data.expiresAt).toLocaleTimeString('en-IN')}`);
    
    if (emailQr) {
      if (data.emailSent) {
        showToast('Secure QR session created and emailed successfully.', 'success');
      } else {
        showToast('Secure QR session created, but the email could not be sent.', 'warning');
      }
    } else {
      showToast('Secure QR session created.', 'success');
    }
  };
}

const renderSecurityDashboard = async () => {
  const section = document.createElement('section');
  section.className = 'glass-panel p-4 mt-4';
  section.innerHTML = `
    <h2 class="h5 fw-bold mb-1">Security & Storage Operations Center</h2>
    <p class="text-muted small mb-4">Monitor system alerts, manage IP access bans, and maintain database storage capacity.</p>
    
    <!-- Row for Storage Warning & Purge Control -->
    <div class="row g-4 mb-4">
      <div class="col-md-6">
        <div class="card bg-dark-custom text-white border-0 p-3 h-100">
          <h6 class="fw-bold text-warning mb-2"><i class="fa-solid fa-database me-2"></i>Database Storage Capacity</h6>
          <p class="small text-white-50 mb-3">Supabase free tier provides <strong>500 MB</strong> of database storage. As check-ins grow, consider purging historic attendance data to maintain free tier eligibility.</p>
          <div class="progress mb-2" style="height: 10px; background: rgba(255,255,255,0.1);">
            <div id="db-storage-progress" class="progress-bar bg-info" role="progressbar" style="width: 5%;" aria-valuenow="5" aria-valuemin="0" aria-valuemax="100"></div>
          </div>
          <div class="d-flex justify-content-between small text-white-50">
            <span>Estimated usage: ~15MB</span>
            <span>Limit: 500MB</span>
          </div>
        </div>
      </div>
      
      <div class="col-md-6">
        <div class="card bg-dark-custom text-white border-0 p-3 h-100">
          <h6 class="fw-bold text-danger mb-2"><i class="fa-solid fa-trash-can me-2"></i>Purge Historic Records</h6>
          <p class="small text-danger-emphasis mb-3"><strong>⚠️ WARNING:</strong> Export database logs via CSV from the history table above before purging. Purged data is permanently deleted.</p>
          <div class="row g-2 align-items-center">
            <div class="col-md-5">
              <input type="datetime-local" id="purge-start" class="form-control form-control-sm" placeholder="Start Date">
            </div>
            <div class="col-md-5">
              <input type="datetime-local" id="purge-end" class="form-control form-control-sm" placeholder="End Date">
            </div>
            <div class="col-md-2">
              <button id="btn-purge-data" class="btn btn-sm btn-danger w-100">Purge</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- IP Ban Controls -->
    <div class="row g-4 mb-4">
      <div class="col-md-5">
        <div class="card bg-dark-custom text-white border-0 p-3 h-100">
          <h6 class="fw-bold text-danger mb-3"><i class="fa-solid fa-ban me-2"></i>Ban IP Address</h6>
          <div class="input-group input-group-sm mb-3">
            <input type="text" id="input-ban-ip" class="form-control" placeholder="Enter IP address (e.g. 192.168.1.5)">
            <button id="btn-ban-ip" class="btn btn-danger">Ban IP</button>
          </div>
          <h6 class="fw-bold small text-white-50 mb-2">Banned IP List</h6>
          <div class="overflow-y-auto" style="max-height: 150px;">
            <ul id="banned-ip-list" class="list-group list-group-flush small bg-transparent">
              <li class="list-group-item text-muted bg-transparent border-0 px-0">No active IP bans.</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Security Intrusion & Tamper Logs -->
      <div class="col-md-7">
        <div class="card bg-dark-custom text-white border-0 p-3 h-100">
          <h6 class="fw-bold text-warning mb-3"><i class="fa-solid fa-shield-halved me-2"></i>Security Alert Logs</h6>
          <div class="table-responsive" style="max-height: 220px; overflow-y: auto;">
            <table class="table table-dark-custom align-middle mb-0 small">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor / Info</th>
                  <th>Incident Type</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody id="security-alerts-list">
                <tr><td colspan="4" class="text-center text-muted">Loading security events…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
  document.querySelector('main').append(section);

  const purgeBtn = section.querySelector('#btn-purge-data');
  const banBtn = section.querySelector('#btn-ban-ip');
  const ipInput = section.querySelector('#input-ban-ip');
  const alertsBody = section.querySelector('#security-alerts-list');
  const bannedList = section.querySelector('#banned-ip-list');

  // Load Security Alerts
  const loadAlerts = async () => {
    const { data: alerts, error } = await supabase.rpc('get_security_alerts');
    if (error) {
      alertsBody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">Failed to load security logs.</td></tr>`;
      return;
    }
    if (!alerts || alerts.length === 0) {
      alertsBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No security incidents logged.</td></tr>`;
      return;
    }
    alertsBody.replaceChildren(...alerts.map(alert => {
      const tr = document.createElement('tr');
      const timeLabel = new Date(alert.created_at).toLocaleString('en-IN', { timeStyle: 'short', dateStyle: 'short' });
      const actorLabel = alert.email ? `${alert.full_name || 'Student'} (${alert.email})` : 'Restricted system boundary probe';
      
      let badgeClass = 'bg-warning text-dark';
      if (alert.outcome === 'tampered') badgeClass = 'bg-danger';
      else if (alert.outcome === 'unauthorized_route') badgeClass = 'bg-danger-subtle text-danger border border-danger-subtle';
      
      const trContent = [
        cell(timeLabel),
        cell(actorLabel),
        cell(alert.action),
        cell('')
      ];
      trContent[3].innerHTML = `<span class="badge ${badgeClass}">${alert.outcome}</span>`;
      tr.append(...trContent);
      return tr;
    }));
  };

  // Load Banned IPs
  const loadBannedIps = async () => {
    const { data: bans, error } = await supabase.from('ip_bans').select('*').order('banned_at', { ascending: false });
    if (error || !bans || bans.length === 0) {
      bannedList.innerHTML = `<li class="list-group-item text-muted bg-transparent border-0 px-0">No active IP bans.</li>`;
      return;
    }
    bannedList.replaceChildren(...bans.map(ban => {
      const li = document.createElement('li');
      li.className = 'list-group-item bg-transparent text-white border-0 px-0 d-flex justify-content-between align-items-center';
      li.innerHTML = `
        <span><i class="fa-solid fa-circle text-danger me-2" style="font-size:0.5rem;"></i>${ban.ip} <span class="text-muted small">(${new Date(ban.banned_at).toLocaleDateString('en-IN')})</span></span>
        <button class="btn btn-xs btn-outline-danger py-0 px-2 small-unban" data-ip="${ban.ip}">Unban</button>
      `;
      li.querySelector('.small-unban').onclick = async () => {
        const { error: delErr } = await supabase.from('ip_bans').delete().eq('ip', ban.ip);
        if (delErr) {
          showToast('Could not unban IP.', 'danger');
        } else {
          showToast(`IP ${ban.ip} unbanned successfully.`, 'success');
          loadBannedIps();
        }
      };
      return li;
    }));
  };

  // Ban IP trigger
  banBtn.onclick = async () => {
    const ip = ipInput.value.trim();
    if (!ip) return showToast('Please enter a valid IP address.', 'warning');
    const { error } = await supabase.from('ip_bans').insert({ ip });
    if (error) {
      showToast('Could not ban IP address (possibly already banned).', 'danger');
    } else {
      showToast(`IP ${ip} banned successfully.`, 'success');
      ipInput.value = '';
      loadBannedIps();
    }
  };

  // Purge historic records trigger
  purgeBtn.onclick = async () => {
    const startVal = section.querySelector('#purge-start').value;
    const endVal = section.querySelector('#purge-end').value;
    if (!startVal || !endVal) return showToast('Please select both start and end date ranges for purging.', 'warning');
    
    if (!confirm('Are you absolutely sure you want to permanently delete all attendance records in this range? Ensure you exported them to CSV first.')) return;
    
    purgeBtn.disabled = true;
    const { data: result, error } = await supabase.rpc('delete_attendance_range', { p_start_date: new Date(startVal).toISOString(), p_end_date: new Date(endVal).toISOString() });
    
    purgeBtn.disabled = false;
    if (error) {
      showToast('Purging failed: ' + error.message, 'danger');
    } else {
      const counts = result?.[0] ?? { deleted_attendance: 0, deleted_sessions: 0 };
      showToast(`Purged ${counts.deleted_attendance} attendance records and ${counts.deleted_sessions} sessions successfully.`, 'success');
      section.querySelector('#purge-start').value = '';
      section.querySelector('#purge-end').value = '';
    }
  };

  // Initial runs
  await Promise.all([loadAlerts(), loadBannedIps()]);
};
