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

const statusCell = (status, time, lat, lon, sessionDateStr, sessionType = null) => {
  const td = document.createElement('td');
  if (status === 'PRESENT') {
    const timeText = time ? new Date(time).toLocaleTimeString('en-IN', { timeStyle: 'short' }) : '';
    td.innerHTML = `PRESENT <span class="text-muted small">(${timeText})</span> <a href="https://maps.google.com/?q=${lat},${lon}" target="_blank" class="btn btn-sm btn-outline-info ms-2 py-0 px-2" style="font-size: 0.75rem; border-color: rgba(var(--bs-info-rgb), 0.3);">View map</a>`;
  } else if (status === 'ABSENT') {
    if (sessionDateStr === getTodayDateStr()) {
      const currentHour = new Date().getHours();
      const isFutureSession = (sessionType === 'morning' && currentHour < 5) || (sessionType === 'evening' && currentHour < 15);
      if (isFutureSession) {
        td.innerHTML = `<span class="text-muted small fst-italic">Coming soon</span>`;
      } else {
        td.innerHTML = `<span class="text-danger">ABSENT</span>`;
      }
    } else {
      td.innerHTML = `<span class="text-danger">ABSENT</span>`;
    }
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
      statusCell(record.morning_status, record.morning_checked_in_at, record.morning_latitude, record.morning_longitude, record.session_date, 'morning'),
      statusCell(record.evening_status, record.evening_checked_in_at, record.evening_latitude, record.evening_longitude, record.session_date, 'evening'),
      statusCell(record.special_status, record.special_checked_in_at, record.special_latitude, record.special_longitude, record.session_date, 'special')
    );
    return tr;
  }));
};

const addOption = (select, value, label) => {
  const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
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
  const summary = summaryResult.data?.[0] ?? { student_count_total: 0, student_count_active: 0, student_count_pending: 0, bus_count: 0, present_today: 0, morning_checkins: 0, evening_checkins: 0 };
  text('stat-total-students', summary.student_count_total ?? 0);
  if (document.getElementById('stat-students-active')) text('stat-students-active', summary.student_count_active ?? 0);
  if (document.getElementById('stat-students-pending')) text('stat-students-pending', summary.student_count_pending ?? 0);
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
      p_day_type: null,
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

  ['filter-bus', 'filter-date-from', 'filter-date-to', 'filter-status'].forEach((id) => document.getElementById(id)?.addEventListener('change', loadHistory));

  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    setTodayDefaults();
    document.getElementById('filter-status').value = '';
    if (searchInput) searchInput.value = '';
    busFilter.value = expectedRole === 'coordinator' ? profile.bus_id : '';
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
      
      if (filter === 'today') {
        setTodayDefaults();
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
  setupStudentManagementControls(buses);
  if (expectedRole === 'admin') {
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
    const sessionType = document.getElementById('select-session').value;
    const { data, error } = await supabase.functions.invoke('attendance-api', {
      body: { action: 'create-session', busId: qrBus.value, sessionType, emailQr: false }
    });
    if (error || !data?.token || !data?.expiresAt) {
      let errorMessage = 'QR session could not be created.';
      if (error?.context && typeof error.context.clone === 'function') {
        const body = await error.context.clone().json().catch(() => null);
        if (body?.message) errorMessage = body.message;
      }
      if (errorMessage === 'QR session could not be created.' && data?.message) errorMessage = data.message;
      if (errorMessage === 'QR session could not be created.' && error?.message) errorMessage = error.message;
      return showToast(errorMessage, 'danger');
    }
    const display = document.getElementById('qr-code-display'); display.replaceChildren();
    new window.QRCode(display, { text: `${location.origin}/checkin?token=${encodeURIComponent(data.token)}`, width: 220, height: 220 });
    text('qr-url-text', `Active Session: Bus ${myBus ? myBus.bus_number : ''} (${sessionType}) • Expires ${new Date(data.expiresAt).toLocaleTimeString('en-IN')}`);
    showToast(`Manual QR session generated for ${sessionType}!`, 'success');
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

      <!-- Security Settings & Admin Transfer -->
      <div class="col-md-7">
        <div class="card bg-dark-custom text-white border-0 p-3 h-100">
          <h6 class="fw-bold text-info mb-3"><i class="fa-solid fa-gear me-2"></i>Security Settings</h6>
          <div class="row g-3">
            <div class="col-md-12">
              <label class="form-label small text-white-50 mb-1">Security Alerts Email Destination</label>
              <div class="input-group input-group-sm mb-2">
                <input type="email" id="input-security-email" class="form-control" placeholder="admin@karunya.edu.in">
                <button id="btn-save-email" class="btn btn-info text-dark">Save</button>
              </div>
            </div>
            <div class="col-md-12 mt-2">
              <label class="form-label small text-white-50 mb-1">Transfer Admin Role</label>
              <div class="input-group input-group-sm">
                <input type="email" id="input-transfer-admin" class="form-control" placeholder="newadmin@karunya.edu.in">
                <button id="btn-transfer-admin" class="btn btn-outline-warning">Transfer Access</button>
              </div>
              <small class="text-warning d-block mt-1">This transfers ALL admin rights to this user.</small>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Security Intrusion & Tamper Logs -->
    <div class="row g-4 mt-2">
      <div class="col-md-12">
        <div class="card bg-dark-custom text-white border-0 p-3 h-100">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h6 class="fw-bold text-warning mb-0"><i class="fa-solid fa-shield-halved me-2"></i>Security Alert Logs</h6>
            <div class="btn-group" role="group">
              <input type="radio" class="btn-check" name="alertTabs" id="tab-active" checked>
              <label class="btn btn-sm btn-outline-warning" for="tab-active">Active</label>
              
              <input type="radio" class="btn-check" name="alertTabs" id="tab-archived">
              <label class="btn btn-sm btn-outline-secondary" for="tab-archived">Archived</label>
            </div>
          </div>
          <div class="table-responsive" style="max-height: 220px; overflow-y: auto;">
            <table class="table table-dark-custom align-middle mb-0 small">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor / Info</th>
                  <th>Incident Type</th>
                  <th>Outcome</th>
                  <th class="text-end">Action</th>
                </tr>
              </thead>
              <tbody id="security-alerts-list">
                <tr><td colspan="5" class="text-center text-muted">Loading security events…</td></tr>
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

  const loadAlerts = async () => {
    const isArchived = section.querySelector('#tab-archived').checked;
    const { data: alerts, error } = await supabase.rpc('get_security_alerts');
    if (error) {
      alertsBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Failed to load security logs.</td></tr>`;
      return;
    }
    
    const filteredAlerts = (alerts || []).filter(a => (isArchived ? a.resolved === true : a.resolved !== true));
    
    if (filteredAlerts.length === 0) {
      alertsBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No ${isArchived ? 'archived' : 'active'} security incidents.</td></tr>`;
      return;
    }
    
    alertsBody.replaceChildren(...filteredAlerts.map(alert => {
      const tr = document.createElement('tr');
      const timeLabel = new Date(alert.created_at).toLocaleString('en-IN', { timeStyle: 'short', dateStyle: 'short' });
      const ipSuffix = alert.ip_address ? ` [IP: ${alert.ip_address}]` : '';
      const actorLabel = (alert.email ? `${alert.full_name || 'Student'} (${alert.email})` : 'Restricted system boundary probe') + ipSuffix;
      
      let badgeClass = 'bg-warning text-dark';
      if (alert.outcome === 'tampered') badgeClass = 'bg-danger';
      else if (alert.outcome === 'unauthorized_route') badgeClass = 'bg-danger-subtle text-danger border border-danger-subtle';
      
      const trContent = [
        cell(timeLabel),
        cell(actorLabel),
        cell(alert.action),
        cell(''),
        cell('') // actions cell
      ];
      trContent[3].innerHTML = `<span class="badge ${badgeClass}">${alert.outcome}</span>`;
      trContent[4].className = 'text-end';
      
      if (!isArchived) {
        trContent[4].innerHTML = `<button class="btn btn-xs btn-outline-success py-0 px-2 small-resolve" style="font-size:0.7rem;">Resolve</button>`;
        trContent[4].querySelector('.small-resolve').onclick = async () => {
          const { error: resErr } = await supabase.rpc('resolve_security_alert', { p_id: alert.id });
          if (resErr) return showToast('Failed to resolve alert.', 'danger');
          showToast('Alert resolved.', 'success');
          loadAlerts();
        };
      } else {
        trContent[4].innerHTML = `<button class="btn btn-xs btn-outline-danger py-0 px-2 small-clear" style="font-size:0.7rem;">Clear</button>`;
        trContent[4].querySelector('.small-clear').onclick = async () => {
          if(!confirm('Permanently delete this archived alert?')) return;
          const { error: delErr } = await supabase.rpc('clear_security_alert', { p_id: alert.id });
          if (delErr) return showToast('Failed to clear alert.', 'danger');
          showToast('Alert deleted.', 'success');
          loadAlerts();
        };
      }
      
      tr.append(...trContent);
      return tr;
    }));
  };

  section.querySelector('#tab-active').addEventListener('change', loadAlerts);
  section.querySelector('#tab-archived').addEventListener('change', loadAlerts);
  
  // Settings Management
  const loadSettings = async () => {
    const { data: email, error } = await supabase.rpc('get_system_setting', { p_key: 'security_email_to' });
    if (!error && email) {
      section.querySelector('#input-security-email').value = email;
    }
  };
  
  section.querySelector('#btn-save-email').onclick = async () => {
    const newEmail = section.querySelector('#input-security-email').value.trim();
    if (!newEmail) return showToast('Enter a valid email', 'warning');
    const { error } = await supabase.rpc('update_system_setting', { p_key: 'security_email_to', p_value: newEmail });
    if (error) return showToast('Failed to update email setting', 'danger');
    showToast('Security email updated successfully', 'success');
  };

  section.querySelector('#btn-transfer-admin').onclick = async () => {
    const newAdmin = section.querySelector('#input-transfer-admin').value.trim();
    if (!newAdmin) return showToast('Enter new admin email', 'warning');
    if (!confirm(`Are you absolutely sure you want to transfer your admin access to ${newAdmin}? You will become a student and lose access.`)) return;
    const { error } = await supabase.rpc('transfer_admin_access', { p_new_email: newAdmin });
    if (error) return showToast('Transfer failed: ' + error.message, 'danger');
    showToast('Admin access transferred! You will be logged out.', 'success');
    setTimeout(() => location.reload(), 2000);
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
  await Promise.all([loadAlerts(), loadBannedIps(), loadSettings()]);
};

const setupStudentManagementControls = (buses) => {
  const addStudentBus = document.getElementById('add-student-bus');
  const moveStudentBus = document.getElementById('move-student-bus');
  const addCoordBus = document.getElementById('add-coord-bus');

  if (addStudentBus) {
    addStudentBus.replaceChildren();
    buses.forEach((b) => addOption(addStudentBus, b.id, `Bus ${b.bus_number} — ${b.route}`));
  }
  if (moveStudentBus) {
    moveStudentBus.replaceChildren();
    buses.forEach((b) => addOption(moveStudentBus, b.id, `Bus ${b.bus_number} — ${b.route}`));
  }
  if (addCoordBus) {
    addCoordBus.replaceChildren();
    buses.forEach((b) => addOption(addCoordBus, b.id, `Bus ${b.bus_number} — ${b.route}`));
  }

  const btnAddStudent = document.getElementById('btn-add-student');
  if (btnAddStudent) {
    btnAddStudent.onclick = async () => {
      const name = document.getElementById('add-student-name')?.value?.trim();
      const email = document.getElementById('add-student-email')?.value?.trim()?.toLowerCase();
      const regNumber = document.getElementById('add-student-regnumber')?.value?.trim();
      const busId = addStudentBus?.value;
      const msg = document.getElementById('add-student-msg');

      if (!name || !email || !regNumber || !busId) {
        showToast('All student fields are required.', 'danger');
        return;
      }

      const { data, error } = await supabase.functions.invoke('attendance-api', {
        body: { action: 'add-student', fullName: name, email, registerNumber: regNumber, busId }
      });
      if (error || data?.message !== 'Student added successfully.') {
        const err = error?.context?.message || data?.message || error?.message || 'Could not add student.';
        if (msg) msg.innerHTML = `<span class="text-danger">${err}</span>`;
        showToast(err, 'danger');
      } else {
        if (msg) msg.innerHTML = '<span class="text-success">Student added successfully!</span>';
        showToast('Student added successfully.', 'success');
        document.getElementById('add-student-name').value = '';
        document.getElementById('add-student-email').value = '';
        document.getElementById('add-student-regnumber').value = '';
      }
    };
  }

  const btnMoveStudent = document.getElementById('btn-move-student');
  if (btnMoveStudent) {
    btnMoveStudent.onclick = async () => {
      const email = document.getElementById('move-student-email')?.value?.trim()?.toLowerCase();
      const newBusId = moveStudentBus?.value;
      const msg = document.getElementById('move-student-msg');
      if (!email || !newBusId) {
        showToast('Student email and target bus are required.', 'danger');
        return;
      }
      const { data, error } = await supabase.functions.invoke('attendance-api', {
        body: { action: 'move-student', studentEmail: email, newBusId }
      });
      if (error || data?.message !== 'Student moved to new bus successfully.') {
        const err = error?.context?.message || data?.message || error?.message || 'Could not move student.';
        if (msg) msg.innerHTML = `<span class="text-danger">${err}</span>`;
        showToast(err, 'danger');
      } else {
        if (msg) msg.innerHTML = '<span class="text-success">Student moved successfully!</span>';
        showToast('Student moved successfully.', 'success');
        document.getElementById('move-student-email').value = '';
      }
    };
  }

  const btnRemoveStudent = document.getElementById('btn-remove-student');
  if (btnRemoveStudent) {
    btnRemoveStudent.onclick = async () => {
      const email = document.getElementById('remove-student-email')?.value?.trim()?.toLowerCase();
      const msg = document.getElementById('remove-student-msg');
      if (!email) {
        showToast('Student email is required.', 'danger');
        return;
      }
      const { data, error } = await supabase.functions.invoke('attendance-api', {
        body: { action: 'remove-student', studentEmail: email }
      });
      if (error || data?.message !== 'Student removed from bus.') {
        const err = error?.context?.message || data?.message || error?.message || 'Could not remove student.';
        if (msg) msg.innerHTML = `<span class="text-danger">${err}</span>`;
        showToast(err, 'danger');
      } else {
        if (msg) msg.innerHTML = '<span class="text-success">Student removed from bus.</span>';
        showToast('Student removed from bus.', 'info');
        document.getElementById('remove-student-email').value = '';
      }
    };
  }

  const btnAddCoord = document.getElementById('btn-add-coordinator');
  if (btnAddCoord) {
    btnAddCoord.onclick = async () => {
      const name = document.getElementById('add-coord-name')?.value?.trim();
      const email = document.getElementById('add-coord-email')?.value?.trim()?.toLowerCase();
      const busId = addCoordBus?.value;
      const msg = document.getElementById('add-coord-msg');
      if (!name || !email || !busId) {
        showToast('Name, email, and bus are required.', 'danger');
        return;
      }
      const { data, error } = await supabase.functions.invoke('attendance-api', {
        body: { action: 'add-coordinator', fullName: name, email, busId }
      });
      if (error) {
        const err = error?.context?.message || data?.message || error?.message || 'Could not add coordinator.';
        if (msg) msg.innerHTML = `<span class="text-danger">${err}</span>`;
        showToast(err, 'danger');
      } else {
        if (msg) msg.innerHTML = `<span class="text-success">${data?.message || 'Coordinator updated successfully.'}</span>`;
        showToast('Coordinator updated successfully.', 'success');
        document.getElementById('add-coord-name').value = '';
        document.getElementById('add-coord-email').value = '';
      }
    };
  }

  const btnSubmitOverride = document.getElementById('btn-submit-override');
  if (btnSubmitOverride) {
    btnSubmitOverride.onclick = async () => {
      const email = document.getElementById('override-student-email')?.value?.trim()?.toLowerCase();
      const sessionType = document.getElementById('override-session-type')?.value;
      const status = document.getElementById('override-status')?.value;
      const remark = document.getElementById('override-remark')?.value?.trim();
      const msg = document.getElementById('override-msg');

      if (!email) {
        showToast('Student email is required.', 'danger');
        return;
      }
      if (!remark || remark.length < 3) {
        showToast('A reason/comment (at least 3 characters) is mandatory for manual override.', 'warning');
        if (msg) msg.innerHTML = '<span class="text-warning">Reason/comment is mandatory.</span>';
        return;
      }

      btnSubmitOverride.disabled = true;
      btnSubmitOverride.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting…';

      const { data, error } = await supabase.functions.invoke('attendance-api', {
        body: { action: 'manual-override-attendance', studentEmail: email, sessionType, status, remark }
      });

      btnSubmitOverride.disabled = false;
      btnSubmitOverride.innerHTML = 'Submit Override';

      if (error || !data?.message) {
        let err = 'Could not record manual attendance.';
        if (error?.context && typeof error.context.clone === 'function') {
          const body = await error.context.clone().json().catch(() => null);
          if (body?.message) err = body.message;
        }
        if (err === 'Could not record manual attendance.' && data?.message) err = data.message;
        if (msg) msg.innerHTML = `<span class="text-danger">${err}</span>`;
        showToast(err, 'danger');
      } else {
        if (msg) msg.innerHTML = `<span class="text-success">${data.message}</span>`;
        showToast(data.message, 'success');
        document.getElementById('override-remark').value = '';
      }
    };
  }
};
