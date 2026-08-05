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
