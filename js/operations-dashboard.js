import { supabase } from '../supabase/client.js';
import { renderNavbar } from '../components/navbar.js';
import { showToast } from '../components/toast.js';
import { rememberProtectedRedirect } from './auth.js';
import { initReports } from './reports.js';

let currentAppProfile = null;
const text = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = String(value); };
const cell = (value) => { const element = document.createElement('td'); element.textContent = String(value ?? '—'); return element; };
const row = (values) => { const element = document.createElement('tr'); values.forEach((value) => element.append(cell(value))); return element; };
const dateValue = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const getTodayDateStr = () => {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  return new Date(now - tzOffset).toISOString().slice(0, 10);
};

const statusCell = (status, time, lat, lon, sessionDateStr, sessionType = null, submission = null) => {
  const td = document.createElement('td');
  if (status === 'PRESENT') {
    const timeText = time ? new Date(time).toLocaleTimeString('en-IN', { timeStyle: 'short' }) : '';
    const subText = (submission && String(submission).trim().toLowerCase() === 'manual') ? 'Manual' : 'Self';
    const badgeBg = subText === 'Manual' ? 'bg-warning text-dark' : 'bg-info text-dark';
    td.innerHTML = `PRESENT <span class="text-muted small">(${timeText})</span> <span class="badge ${badgeBg} ms-1 py-1 px-2" style="font-size: 0.7rem;">${subText}</span> <a href="https://maps.google.com/?q=${lat},${lon}" target="_blank" class="btn btn-sm btn-outline-info ms-1 py-0 px-2" style="font-size: 0.75rem; border-color: rgba(var(--bs-info-rgb), 0.3);">View map</a>`;
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

const renderRows = (records, isCoordinator = false, currentStopSort = 'none') => {
  const body = document.getElementById('attendance-list');
  if (!body) return;

  const colSpanCount = isCoordinator ? 8 : 7;

  if (!records.length) {
    const empty = row(['No attendance records match these filters.']);
    empty.firstElementChild.colSpan = colSpanCount;
    body.replaceChildren(empty);
    return;
  }

  let displayRecords = [...records];
  if (isCoordinator && currentStopSort !== 'none') {
    if (currentStopSort === 'asc') {
      displayRecords.sort((a, b) => {
        const sa = (a.bus_stop_no !== null && a.bus_stop_no !== undefined) ? Number(a.bus_stop_no) : 999999;
        const sb = (b.bus_stop_no !== null && b.bus_stop_no !== undefined) ? Number(b.bus_stop_no) : 999999;
        if (sa !== sb) return sa - sb;
        return (a.full_name || '').localeCompare(b.full_name || '');
      });
    } else if (currentStopSort === 'desc') {
      displayRecords.sort((a, b) => {
        const sa = (a.bus_stop_no !== null && a.bus_stop_no !== undefined) ? Number(a.bus_stop_no) : -1;
        const sb = (b.bus_stop_no !== null && b.bus_stop_no !== undefined) ? Number(b.bus_stop_no) : -1;
        if (sa !== sb) return sb - sa;
        return (a.full_name || '').localeCompare(b.full_name || '');
      });
    }
  }

  body.replaceChildren(...displayRecords.map((record) => {
    const tr = document.createElement('tr');
    const dateTd = cell(record.session_date ? new Date(record.session_date).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');
    dateTd.classList.add('text-center');

    const mCell = statusCell(record.morning_status, record.morning_checked_in_at, record.morning_latitude, record.morning_longitude, record.session_date, 'morning', record.morning_submission);
    const eCell = statusCell(record.evening_status, record.evening_checked_in_at, record.evening_latitude, record.evening_longitude, record.session_date, 'evening', record.evening_submission);
    const spCell = statusCell(record.special_status, record.special_checked_in_at, record.special_latitude, record.special_longitude, record.session_date, 'special', record.special_submission);
    const nameTd = cell(record.full_name || 'Unnamed student');
    const regTd = cell(record.register_number || '—');

    if (isCoordinator) {
      // 1. Name 2. Reg No 3. Stop No 4. Stop Name 5. Date 6. Morning 7. Evening 8. Special
      const stopNoVal = (record.bus_stop_no !== null && record.bus_stop_no !== undefined) ? `#${record.bus_stop_no}` : '—';
      const stopNoTd = cell(stopNoVal);
      const stopNameTd = cell(record.boarding_point || 'Not assigned');
      tr.append(nameTd, regTd, stopNoTd, stopNameTd, dateTd, mCell, eCell, spCell);
    } else {
      // Admin: 1. Name 2. Reg No 3. Bus 4. Date 5. Morning 6. Evening 7. Special
      const busTd = cell(`Bus ${record.bus_number}`);
      tr.append(nameTd, regTd, busTd, dateTd, mCell, eCell, spCell);
    }
    return tr;
  }));
};

const addOption = (select, value, label) => {
  const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
};



let globalRefreshAdminViews = null;

const renderAdminDirectory = async (buses) => {
  let people = null;
  const { data, error } = await supabase.rpc('admin_people_records');
  if (!error && Array.isArray(data)) {
    people = data;
  } else {
    console.warn('admin_people_records RPC error, falling back to direct table queries:', error);
    try {
      const busMap = new Map((buses || []).map(b => [b.id, b]));
      const { data: dbProfiles } = await supabase.from('profiles').select('id, full_name, register_number, email, role, status, bus_id');
      const { data: pendingCoords } = await supabase.from('pending_coordinator_assignments').select('*').catch(() => ({ data: null }));
      const pendingMap = new Map((pendingCoords || []).map(pc => [pc.email.toLowerCase(), pc]));

      const list = (dbProfiles || []).map(p => {
        const pc = pendingMap.get(p.email?.toLowerCase());
        const effectiveBusId = p.bus_id || pc?.bus_id || null;
        const effectiveRole = pc ? 'coordinator' : p.role;
        return {
          id: p.id,
          full_name: pc?.full_name || p.full_name,
          register_number: p.register_number,
          email: p.email,
          role: effectiveRole,
          status: p.status,
          bus_id: effectiveBusId,
          bus_number: busMap.get(effectiveBusId)?.bus_number || null,
          route: busMap.get(effectiveBusId)?.route || null
        };
      });

      (pendingCoords || []).forEach(pc => {
        if (!list.some(item => item.email.toLowerCase() === pc.email.toLowerCase())) {
          list.push({
            id: null,
            full_name: pc.full_name,
            register_number: null,
            email: pc.email,
            role: 'coordinator',
            status: 'pending_login',
            bus_id: pc.bus_id,
            bus_number: busMap.get(pc.bus_id)?.bus_number || null,
            route: busMap.get(pc.bus_id)?.route || null
          });
        }
      });

      people = list;
    } catch (e) {
      console.warn('Fallback direct directory query failed:', e);
    }
  }

  if (!people) {
    showToast('Student and coordinator records could not be loaded.', 'danger');
    return [];
  }
  let section = document.getElementById('admin-directory-section');
  if (!section) {
    section = document.createElement('section');
    section.id = 'admin-directory-section';
    section.className = 'glass-panel p-4 mt-4';
    document.querySelector('main')?.append(section);
  }
  section.innerHTML = `<div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3"><div><h2 class="h5 fw-bold mb-1">People and bus assignments</h2><p class="text-muted small mb-0">Students, coordinators, and their assigned bus details.</p></div><div class="d-flex flex-wrap align-items-center gap-2"><button type="button" class="btn btn-glass-primary btn-sm d-inline-flex align-items-center gap-1" data-bs-toggle="modal" data-bs-target="#modalAddCoordinator"><span>➕</span> Coordinator</button><select class="form-select form-select-sm w-auto" id="directory-role"><option value="">All people</option><option value="coordinator">Coordinators</option><option value="student">Students</option><option value="admin">Admins</option></select><select class="form-select form-select-sm w-auto" id="directory-bus"><option value="">All buses</option></select></div></div><div class="table-responsive" style="max-height: 450px; overflow-y: auto;"><table class="table table-dark-custom align-middle mb-0"><thead><tr><th>Role</th><th>Name</th><th>Register number</th><th>Email</th><th>Bus</th><th>Route</th><th>Status</th><th class="text-end">Actions</th></tr></thead><tbody id="directory-list"></tbody></table></div>`;
  
  const roleFilter = section.querySelector('#directory-role');
  const busFilter = section.querySelector('#directory-bus');
  (buses || []).forEach((bus) => addOption(busFilter, bus.id, `Bus ${bus.bus_number}`));

  const draw = () => {
    const filtered = (people ?? []).filter((person) => (!roleFilter.value || person.role === roleFilter.value) && (!busFilter.value || person.bus_id === busFilter.value));
    const body = section.querySelector('#directory-list');
    if (!filtered.length) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = `<td colspan="8" class="text-center text-muted py-3">No people match these filters.</td>`;
      body.replaceChildren(emptyRow);
      return;
    }
    body.replaceChildren(...filtered.map((person) => {
      const tr = document.createElement('tr');
      const actionCell = person.role === 'coordinator'
        ? `<button class="btn btn-outline-danger btn-sm btn-remove-coord-row" data-email="${person.email}">Remove</button>`
        : '—';

      tr.innerHTML = `
        <td><span class="badge ${person.role === 'admin' ? 'bg-danger' : person.role === 'coordinator' ? 'bg-warning text-dark' : 'bg-primary'}">${person.role}</span></td>
        <td>${person.full_name || '—'}</td>
        <td>${person.register_number || '—'}</td>
        <td>${person.email}</td>
        <td>${person.bus_number ? `Bus ${person.bus_number}` : 'Unassigned'}</td>
        <td>${person.route || '—'}</td>
        <td><span class="badge bg-secondary">${person.status}</span></td>
        <td class="text-end">${actionCell}</td>
      `;

      if (person.role === 'coordinator') {
        tr.querySelector('.btn-remove-coord-row')?.addEventListener('click', async () => {
          if (confirm(`Remove coordinator privileges for ${person.full_name || person.email}?`)) {
            await handleRemoveCoordinator(person.email);
          }
        });
      }
      return tr;
    }));
  };
  roleFilter.addEventListener('change', draw);
  busFilter.addEventListener('change', draw);
  draw();

  return people ?? [];
};

const renderAdminBusFleet = async (buses, people = []) => {
  let section = document.getElementById('admin-bus-fleet-section');
  if (!section) {
    section = document.createElement('section');
    section.id = 'admin-bus-fleet-section';
    section.className = 'glass-panel p-4 mt-4';
    const directorySection = document.getElementById('admin-directory-section');
    if (directorySection) {
      directorySection.before(section);
    } else {
      document.querySelector('main')?.append(section);
    }
  }

  let allCoords = [];
  try {
    const { data: rpcCoords, error: rpcErr } = await supabase.rpc('get_bus_coordinators');
    if (!rpcErr && Array.isArray(rpcCoords) && rpcCoords.length) {
      allCoords = rpcCoords;
    }
  } catch (e) {
    console.warn('get_bus_coordinators RPC unavailable, falling back to direct table queries:', e);
  }

  if (!allCoords.length) {
    try {
      const { data: dbCoords } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, bus_id')
        .eq('role', 'coordinator')
        .not('bus_id', 'is', null);

      if (dbCoords && dbCoords.length) {
        allCoords.push(...dbCoords.filter(p => p.role === 'coordinator' || p.role === 'admin'));
      }
    } catch (e) {
      console.warn('Could not fetch coordinators from profiles table:', e);
    }

    try {
      const { data: pendingCoords } = await supabase
        .from('pending_coordinator_assignments')
        .select('*');

      if (pendingCoords && pendingCoords.length) {
        pendingCoords.forEach(pc => {
          const existingIdx = allCoords.findIndex(c => c.email.toLowerCase() === pc.email.toLowerCase());
          if (existingIdx !== -1) {
            allCoords[existingIdx].bus_id = allCoords[existingIdx].bus_id || pc.bus_id;
            allCoords[existingIdx].full_name = allCoords[existingIdx].full_name || pc.full_name;
          } else {
            allCoords.push({
              id: null,
              full_name: pc.full_name,
              email: pc.email,
              role: 'coordinator',
              bus_id: pc.bus_id
            });
          }
        });
      }
    } catch (e) {
      console.warn('Could not fetch pending coordinators:', e);
    }
  }

  if (!allCoords.length && people && people.length) {
    allCoords = people.filter(p => p.bus_id && (p.role === 'coordinator' || p.role === 'admin'));
  }

  section.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3">
      <div>
        <h2 class="h5 fw-bold mb-1">🚌 Bus Routes &amp; Fleet Management</h2>
        <p class="text-muted small mb-0">Manage campus bus routes, seating capacities, and assigned coordinators.</p>
      </div>
      <button class="btn btn-glass-primary btn-sm" data-bs-toggle="offcanvas" data-bs-target="#sidebarStudentMgmt">
        ➕ Add New Bus
      </button>
    </div>
    <div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
      <table class="table table-dark-custom align-middle mb-0">
        <thead>
          <tr>
            <th>Bus Number</th>
            <th>Route Description</th>
            <th>Capacity</th>
            <th>Assigned Coordinator(s)</th>
            <th class="text-end">Actions</th>
          </tr>
        </thead>
        <tbody id="bus-fleet-list"></tbody>
      </table>
    </div>
  `;

  const tbody = section.querySelector('#bus-fleet-list');
  if (!buses || !buses.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No bus routes configured yet. Click "Add New Bus" to create one.</td></tr>`;
    return;
  }

  tbody.replaceChildren(...buses.map((bus) => {
    const tr = document.createElement('tr');
    const busCoords = allCoords.filter(c => c.bus_id === bus.id);
    const coordDisplay = busCoords.length
      ? busCoords.map(c => `<span class="badge bg-warning text-dark me-1" title="${c.email}">${c.full_name || c.email}</span>`).join('')
      : `<span class="text-muted small">Unassigned</span>`;

    tr.innerHTML = `
      <td><strong class="text-warning">Bus ${bus.bus_number}</strong></td>
      <td>${bus.route || '—'}</td>
      <td><span class="badge bg-info text-dark">${bus.capacity ?? 60} seats</span></td>
      <td>${coordDisplay}</td>
      <td class="text-end">
        <div class="btn-group btn-group-sm">
          <button class="btn btn-outline-info btn-edit-bus" data-id="${bus.id}">✏️ Edit</button>
          <button class="btn btn-outline-danger btn-delete-bus" data-id="${bus.id}">🗑️ Delete</button>
        </div>
      </td>
    `;

    tr.querySelector('.btn-edit-bus')?.addEventListener('click', () => openEditBusModal(bus));
    tr.querySelector('.btn-delete-bus')?.addEventListener('click', () => confirmAndDeleteBus(bus));
    return tr;
  }));
};

const openEditBusModal = (bus) => {
  const modalEl = document.getElementById('modalEditBus');
  if (!modalEl) return;
  document.getElementById('edit-bus-id').value = bus.id;
  document.getElementById('edit-bus-number').value = bus.bus_number;
  document.getElementById('edit-bus-capacity').value = bus.capacity ?? 60;
  document.getElementById('edit-bus-route').value = bus.route || '';
  const msg = document.getElementById('edit-bus-msg');
  if (msg) msg.innerHTML = '';
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
};

const confirmAndDeleteBus = async (bus) => {
  if (!confirm(`Are you sure you want to delete Bus ${bus.bus_number} (${bus.route || 'No route description'})?\n\nThis action cannot be undone.`)) {
    return;
  }
  showToast(`Deleting Bus ${bus.bus_number}…`, 'info');
  const { data, error } = await supabase.functions.invoke('attendance-api', {
    body: { action: 'delete-bus', busId: bus.id }
  });
  if (error || !data?.message) {
    let err = data?.message;
    if (!err && error) {
      try {
        if (typeof error.context?.json === 'function') {
          const resBody = await error.context.json();
          err = resBody?.message;
        }
      } catch (_) {}
      if (!err && error.message && !error.message.includes('non-2xx')) err = error.message;
    }
    err = err || 'Could not delete bus.';
    showToast(err, 'danger');
    alert(`Bus Deletion Failed:\n\n${err}`);
  } else {
    showToast(data.message, 'success');
    if (typeof globalRefreshAdminViews === 'function') {
      await globalRefreshAdminViews();
    }
  }
};

const renderStudentRoster = async () => {
  const { data: students, error } = await supabase.rpc('authorized_student_records');
  if (error) return showToast('Assigned student roster could not be loaded.', 'danger');
  
  let section = document.getElementById('sidebarAssignedStudents');
  if (!section) {
    section = document.createElement('div');
    section.id = 'sidebarAssignedStudents';
    section.className = 'offcanvas offcanvas-end glass-sidebar';
    section.tabIndex = -1;
    section.style.cssText = 'width: 750px; max-width: 95vw;';
    section.innerHTML = `
      <div class="offcanvas-header p-3">
        <div>
          <h5 class="offcanvas-title fw-bold mb-0">👥 Students (<span id="student-roster-count">${(students ?? []).length}</span>)</h5>
          <small class="text-muted">Assigned student roster &amp; management</small>
        </div>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
      </div>
      <div class="offcanvas-body p-3">
        <ul class="nav nav-tabs border-secondary mb-3" id="coord-student-tabs" role="tablist">
          <li class="nav-item" role="presentation">
            <button class="nav-link active text-white" id="tab-btn-assigned-students" data-bs-toggle="tab" data-bs-target="#tab-assigned-students" type="button" role="tab">
              📋 Assigned Students
            </button>
          </li>
          <li class="nav-item" role="presentation">
            <button class="nav-link text-white-50" id="tab-btn-edit-students" data-bs-toggle="tab" data-bs-target="#tab-edit-students" type="button" role="tab">
              ✏️ Edit Students
            </button>
          </li>
          <li class="nav-item" role="presentation">
            <button class="nav-link text-white-50" id="tab-btn-import-csv" data-bs-toggle="tab" data-bs-target="#tab-import-csv" type="button" role="tab">
              📥 Import CSV
            </button>
          </li>
        </ul>

        <div class="tab-content" id="coord-student-tab-content">
          <!-- Tab 1: Assigned Students -->
          <div class="tab-pane fade show active" id="tab-assigned-students" role="tabpanel">
            <div class="table-responsive">
              <table class="table align-middle mb-0">
                <thead><tr><th>Name</th><th>Register number</th><th>Email</th><th>Boarding Point</th><th>Bus</th><th>Status</th></tr></thead>
                <tbody id="student-roster-list"></tbody>
              </table>
            </div>
          </div>

          <!-- Tab 2: Edit Students -->
          <div class="tab-pane fade" id="tab-edit-students" role="tabpanel">
            <div class="card bg-transparent border border-secondary mb-4 p-3">
              <h6 class="fw-semibold mb-3">Add / update student</h6>
              <div class="row g-2 align-items-end">
                <div class="col-md-6"><label class="form-label small" for="add-student-name">Full name</label><input id="add-student-name" type="text" class="form-control" placeholder="Mohammed Sadiq A" maxlength="100"></div>
                <div class="col-md-6"><label class="form-label small" for="add-student-email">Email (@karunya.edu.in)</label><input id="add-student-email" type="email" class="form-control" placeholder="student@karunya.edu.in" maxlength="254"></div>
                <div class="col-md-6"><label class="form-label small" for="add-student-regnumber">Register number</label><input id="add-student-regnumber" type="text" class="form-control" placeholder="URK25CS1001" maxlength="30"></div>
                <div class="col-md-6"><label class="form-label small" for="add-student-bus">Bus</label><select id="add-student-bus" class="form-select"></select></div>
                <div class="col-md-12 mt-2"><button id="btn-add-student" class="btn btn-glass-primary w-100">Add Student</button></div>
              </div>
              <div id="add-student-msg" class="mt-2 small"></div>
            </div>

            <div class="card bg-transparent border border-secondary mb-4 p-3">
              <h6 class="fw-semibold mb-3">Remove student from bus</h6>
              <div class="row g-2 align-items-end">
                <div class="col-md-12"><label class="form-label small" for="remove-student-email">Student email</label><input id="remove-student-email" type="email" class="form-control" placeholder="student@karunya.edu.in"></div>
                <div class="col-md-12 mt-2"><button id="btn-remove-student" class="btn btn-outline-danger w-100">Remove Student</button></div>
              </div>
              <div id="remove-student-msg" class="mt-2 small"></div>
            </div>
          </div>

          <!-- Tab 3: Import CSV -->
          <div class="tab-pane fade" id="tab-import-csv" role="tabpanel">
            <div class="card bg-transparent border border-secondary mb-4 p-3">
              <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
                <div>
                  <h6 class="fw-bold mb-1">📥 Bulk Import Students (CSV)</h6>
                  <p class="text-muted small mb-0">Upload a CSV file to add multiple students to your bus.</p>
                </div>
                <button id="btn-download-csv-template" class="btn btn-outline-info btn-sm">
                  📄 Download Template
                </button>
              </div>

              <div class="mb-3">
                <label for="csv-file-input" class="form-label small fw-semibold">Select CSV File</label>
                <input class="form-control" type="file" id="csv-file-input" accept=".csv,text/csv">
              </div>

              <div id="csv-preview-container" class="mb-3" hidden>
                <div class="d-flex justify-content-between align-items-center mb-2">
                  <span class="small fw-semibold text-light" id="csv-preview-count">CSV Preview</span>
                  <span id="csv-validation-badge" class="badge bg-secondary">Awaiting validation</span>
                </div>
                <div class="table-responsive" style="max-height: 250px; overflow-y: auto;">
                  <table class="table table-dark-custom align-middle mb-0 small">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Student Name</th>
                        <th>Student ID</th>
                        <th>Email</th>
                        <th>Validation Status</th>
                      </tr>
                    </thead>
                    <tbody id="csv-preview-tbody"></tbody>
                  </table>
                </div>
              </div>

              <div class="d-flex gap-2">
                <button id="btn-import-csv-submit" class="btn btn-glass-primary w-100" disabled>
                  🚀 Import Students
                </button>
              </div>
              <div id="csv-import-msg" class="mt-3"></div>
            </div>
          </div>
        </div>
      </div>`;
    document.body.append(section);
  }
  
  const countEl = section.querySelector('#student-roster-count');
  if (countEl) countEl.textContent = String((students ?? []).length);

  const body = section.querySelector('#student-roster-list');
  const totalCount = (students ?? []).length;
  if (!totalCount) {
    const empty = row(['No students are assigned.']); empty.firstElementChild.colSpan = 6; body.replaceChildren(empty); return;
  }
  body.replaceChildren(...students.map((student) => row([
    student.full_name || '—',
    student.register_number || '—',
    student.email,
    student.boarding_point || 'Not assigned',
    `Bus ${student.bus_number}`,
    student.status,
  ])));
};

const updateCardElements = (presentElementIds, absentElementIds, presentCount, absentCount) => {
  presentElementIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = String(presentCount);
      el.className = 'fw-bold text-success fs-5';
    }
  });

  absentElementIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = String(absentCount);
      el.className = 'fw-bold text-danger fs-5';
    }
  });
};

// Reset a session card to "to be loaded" — used when the BC has not yet generated a QR for that session.
const resetCardElementsToLoading = (presentElementIds, absentElementIds) => {
  [...presentElementIds, ...absentElementIds].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = 'to be loaded';
      el.className = 'fw-bold text-muted fst-italic';
    }
  });
};

const updateSessionStatsCards = async (profile, defaultCount = 0, summary = null, busIdOverride = null) => {
  try {
    const busId = (busIdOverride !== undefined && busIdOverride !== null)
      ? (busIdOverride || null)
      : (profile?.role === 'admin' ? null : profile?.bus_id);

    let stats = null;
    try {
      const { data, error } = await supabase.rpc('get_today_bus_session_stats', { p_bus_id: busId });
      if (!error && data?.length) {
        stats = data;
      } else if (error) {
        console.warn('get_today_bus_session_stats RPC call error:', error);
      }
    } catch (e) {
      console.warn('Failed RPC get_today_bus_session_stats:', e);
    }

    // Do not render temporary fallback counts while network data is still loading/in-flight
    if (!stats && (!summary || (!summary.student_count_active && !summary.present_today))) {
      return;
    }

    const fnStat = stats?.find(s => s.session_type === 'Morning');
    const anStat = stats?.find(s => s.session_type === 'Evening');

    const domActiveCount = parseInt(document.getElementById('stat-students-active')?.textContent || '0', 10);
    const totalStudents = fnStat?.total_students || summary?.student_count_active || summary?.student_count_total || defaultCount || (domActiveCount > 0 ? domActiveCount : 0);

    // Morning card: only show numbers if the BC has actually created a QR/session for today morning.
    // session_exists = false means no QR generated yet → keep card as "to be loaded".
    if (fnStat?.session_exists === true) {
      const mPresent = fnStat.present_count ?? 0;
      const mAbsent = fnStat.absent_count ?? Math.max(0, totalStudents - mPresent);
      updateCardElements(
        ['stat-morning-checkins', 'stat-fn-present'],
        ['stat-morning-absent', 'stat-fn-absent'],
        mPresent,
        mAbsent
      );
    } else {
      // No morning QR session yet — reset to "to be loaded"
      resetCardElementsToLoading(
        ['stat-morning-checkins', 'stat-fn-present'],
        ['stat-morning-absent', 'stat-fn-absent']
      );
    }

    // Evening card: same logic.
    if (anStat?.session_exists === true) {
      const ePresent = anStat.present_count ?? 0;
      const eAbsent = anStat.absent_count ?? Math.max(0, totalStudents - ePresent);
      updateCardElements(
        ['stat-evening-checkins', 'stat-an-present'],
        ['stat-evening-absent', 'stat-an-absent'],
        ePresent,
        eAbsent
      );
    } else {
      // No evening QR session yet — reset to "to be loaded"
      resetCardElementsToLoading(
        ['stat-evening-checkins', 'stat-an-present'],
        ['stat-evening-absent', 'stat-an-absent']
      );
    }
  } catch (err) {
    console.error('Error in updateSessionStatsCards:', err);
  }
};

const fetchStudentActualAttendance = async ({ email, registerNumber, studentId, busId, dateStr, sessionType }) => {
  if (!dateStr) return '--';

  const cleanRegNo = (registerNumber || '').trim().toUpperCase();
  const cleanEmail = (email || '').trim().toLowerCase();

  // Method 1: Query authorized_attendance_history RPC (the authoritative function powering dashboard table)
  try {
    const { data: historyData, error: rpcErr } = await supabase.rpc('authorized_attendance_history', {
      p_bus_id: busId || null,
      p_date_from: null,
      p_date_to: null,
      p_status: null,
      p_search: cleanRegNo || cleanEmail || null,
      p_day_type: null
    });

    if (!rpcErr && historyData?.length) {
      // Filter records matching the selected session date (YYYY-MM-DD)
      const dateMatches = historyData.filter(h => h && h.session_date === dateStr);
      const studentHist = dateMatches.find(h => {
        const hReg = (h.register_number || '').trim().toUpperCase();
        const hEmail = (h.email || '').trim().toLowerCase();
        return (cleanRegNo && hReg === cleanRegNo) ||
               (studentId && h.student_id === studentId) ||
               (cleanEmail && hEmail === cleanEmail);
      }) || historyData.find(h => {
        const hReg = (h.register_number || '').trim().toUpperCase();
        return (cleanRegNo && hReg === cleanRegNo);
      });

      if (studentHist) {
        let statusVal = null;
        if (sessionType === 'Morning') statusVal = studentHist.morning_status;
        else if (sessionType === 'Evening') statusVal = studentHist.evening_status;
        else if (sessionType === 'Special') statusVal = studentHist.special_status;

        if (statusVal === 'PRESENT' || statusVal === 'ABSENT') {
          return statusVal;
        }
      }
    }
  } catch (e) {
    console.warn('authorized_attendance_history RPC query error:', e);
  }

  // Method 2: Fallback direct query on profiles -> attendance_sessions -> attendance
  try {
    let targetStudentId = studentId;
    let targetBusId = busId;

    if (!targetStudentId || !targetBusId) {
      if (cleanRegNo) {
        const { data: p } = await supabase.from('profiles').select('id, bus_id').ilike('register_number', cleanRegNo).maybeSingle();
        if (p) {
          targetStudentId = targetStudentId || p.id;
          targetBusId = targetBusId || p.bus_id;
        }
      }
      if ((!targetStudentId || !targetBusId) && cleanEmail) {
        const { data: p } = await supabase.from('profiles').select('id, bus_id').eq('email', cleanEmail).maybeSingle();
        if (p) {
          targetStudentId = targetStudentId || p.id;
          targetBusId = targetBusId || p.bus_id;
        }
      }
    }

    if (targetStudentId) {
      const { data: attList } = await supabase
        .from('attendance')
        .select('id, status, checked_in_at, session_id, attendance_sessions(id, bus_id, session_type, created_at)')
        .eq('student_id', targetStudentId);

      if (attList?.length) {
        const matchedAtt = attList.find(a => {
          const sess = a.attendance_sessions;
          if (!sess || sess.session_type !== sessionType) return false;
          
          const sessDate = new Date(sess.created_at);
          const istOffset = 5.5 * 60 * 60 * 1000;
          const istDate = new Date(sessDate.getTime() + istOffset);
          const sessDateStr = istDate.toISOString().slice(0, 10);

          return sessDateStr === dateStr;
        });

        if (matchedAtt) {
          return matchedAtt.status || 'PRESENT';
        }
      }
    }
  } catch (err) {
    console.warn('Direct attendance table query error:', err);
  }

  return 'ABSENT';
};

const updateActualStatusUI = async () => {
  const actualStatusInput = document.getElementById('override-actual-status');
  if (!actualStatusInput) return;

  const studentSelect = document.getElementById('override-student-select');
  const studentEmailInput = document.getElementById('override-student-email');
  const dateInput = document.getElementById('override-date');
  const sessionSelect = document.getElementById('override-session-type');

  const selectedOpt = studentSelect?.options?.[studentSelect.selectedIndex];
  const studentId = selectedOpt?.dataset?.id || '';
  const busId = selectedOpt?.dataset?.busId || '';
  let registerNumber = selectedOpt?.dataset?.reg || '';
  if (!registerNumber && selectedOpt?.textContent) {
    const textParts = selectedOpt.textContent.split('—');
    if (textParts.length > 1 && textParts[0].trim().toUpperCase().startsWith('URK')) {
      registerNumber = textParts[0].trim().toUpperCase();
    }
  }
  const email = (studentEmailInput?.value || studentSelect?.value)?.trim()?.toLowerCase();
  const dateStr = dateInput?.value;
  const sessionType = sessionSelect?.value || 'Morning';

  if ((!email && !registerNumber) || !dateStr) {
    actualStatusInput.value = '--';
    actualStatusInput.className = 'form-control bg-dark-subtle text-muted fw-bold';
    return;
  }

  actualStatusInput.value = 'Fetching…';
  actualStatusInput.className = 'form-control bg-dark-subtle text-muted fw-bold';

  const status = await fetchStudentActualAttendance({
    email,
    registerNumber,
    studentId,
    busId,
    dateStr,
    sessionType
  });

  actualStatusInput.value = status;
  if (status === 'PRESENT') {
    actualStatusInput.className = 'form-control bg-dark-subtle text-success fw-bold';
  } else if (status === 'ABSENT') {
    actualStatusInput.className = 'form-control bg-dark-subtle text-danger fw-bold';
  } else {
    actualStatusInput.className = 'form-control bg-dark-subtle text-warning fw-bold';
  }
};

const populateOverrideStudentDropdown = async (profile) => {
  const select = document.getElementById('override-student-select');
  if (!select) return;

  try {
    let studentList = [];

    // Stage 1: Call authorized_student_records RPC (SECURITY DEFINER, pre-existing on Supabase Cloud)
    try {
      const { data: records } = await supabase.rpc('authorized_student_records');
      if (records?.length) {
        studentList = records.filter(r => r.register_number);
      }
    } catch (e) {
      console.warn('authorized_student_records RPC query error:', e);
    }

    // Stage 2: Fallback to authorized_attendance_history RPC (SECURITY DEFINER, pre-existing on Supabase Cloud)
    if (!studentList.length) {
      try {
        const busIdVal = profile?.role === 'coordinator' ? profile.bus_id : null;
        const { data: historyData } = await supabase.rpc('authorized_attendance_history', {
          p_bus_id: busIdVal,
          p_date_from: null,
          p_date_to: null,
          p_status: null,
          p_search: null,
        });

        if (historyData?.length) {
          const studentMap = new Map();
          historyData.forEach(item => {
            if (item.register_number && !studentMap.has(item.register_number)) {
              studentMap.set(item.register_number, {
                id: item.student_id,
                register_number: item.register_number,
                full_name: item.full_name,
                email: item.email || `${String(item.register_number).toLowerCase()}@karunya.edu.in`,
              });
            }
          });
          studentList = Array.from(studentMap.values());
        }
      } catch (e) {
        console.warn('authorized_attendance_history RPC query error:', e);
      }
    }

    select.replaceChildren();

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '-- Select Student (Register No. & Name) --';
    select.append(defaultOpt);

    if (studentList.length) {
      studentList.forEach(s => {
        const opt = document.createElement('option');
        const realEmail = s.email || `${String(s.register_number || '').toLowerCase()}@karunya.edu.in`;
        opt.value = realEmail;
        if (s.id) opt.dataset.id = s.id;
        if (s.bus_id) opt.dataset.busId = s.bus_id;
        if (s.register_number) opt.dataset.reg = s.register_number;
        opt.dataset.email = realEmail;
        const reg = s.register_number ? `${s.register_number}` : 'No Reg';
        opt.textContent = `${reg} — ${s.full_name || s.email}`;
        select.append(opt);
      });
    } else {
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = 'No active students found';
      select.append(emptyOpt);
    }

    const emailInput = document.getElementById('override-student-email');
    const updateAutoFilledEmail = () => {
      if (!emailInput) return;
      const selectedOpt = select.options[select.selectedIndex];
      emailInput.value = selectedOpt?.value || selectedOpt?.dataset?.email || '';
    };

    select.onchange = () => {
      updateAutoFilledEmail();
      updateActualStatusUI();
    };
    updateAutoFilledEmail();
    updateActualStatusUI();
  } catch (err) {
    console.error('Error populating override student dropdown:', err);
  }
};

export async function initOperationsDashboard(expectedRole) {
  try {
    document.body.classList.add('role-authorized');
    if (expectedRole === 'coordinator' && location.hash) {
      history.replaceState(null, '', location.pathname);
      window.scrollTo(0, 0);
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { rememberProtectedRedirect(); return location.replace('/'); }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { rememberProtectedRedirect(); return location.replace('/'); }

    let profile = null;
    try {
      const { data: rpcProfile } = await supabase.rpc('current_app_profile').maybeSingle();
      profile = rpcProfile;
    } catch (e) {
      console.warn('RPC current_app_profile failed, attempting fallback query', e);
    }

    if (!profile?.role) {
      try {
        const { data: dbProfile } = await supabase.from('profiles').select('id, email, role, bus_id, status').eq('id', user.id).maybeSingle();
        if (dbProfile) profile = dbProfile;
      } catch (e) {
        console.warn('Fallback DB profiles query failed', e);
      }
    }

    if (!profile?.role) {
      const metaRole = user.user_metadata?.role;
      if (metaRole === expectedRole) {
        profile = { id: user.id, email: user.email, role: expectedRole };
      } else {
        rememberProtectedRedirect();
        return location.replace('/');
      }
    }

    if (profile.role !== expectedRole) {
      return location.replace(profile.role === 'admin' ? '/admin' : profile.role === 'coordinator' ? '/coordinator' : '/student');
    }

    currentAppProfile = profile;
    window.currentAppProfile = profile;

    renderNavbar(user, expectedRole === 'admin' ? 'Admin' : 'Coordinator');
    const canGenerateQr = expectedRole === 'coordinator';
    document.getElementById('qr-panel')?.toggleAttribute('hidden', !canGenerateQr);

    const headerDateText = document.getElementById('header-date-text');
    if (headerDateText) {
      const today = new Date();
      headerDateText.textContent = today.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
    }

    let buses = [];
    let summary = { student_count_total: 0, student_count_active: 0, student_count_pending: 0, bus_count: 0, present_today: 0, morning_checkins: 0, evening_checkins: 0 };
    
    try {
      const [busesResult, summaryResult] = await Promise.all([
        supabase.rpc('authorized_bus_records'),
        supabase.rpc('attendance_dashboard_summary'),
      ]);
      buses = busesResult.data ?? [];
      if (summaryResult.data?.[0]) summary = summaryResult.data[0];
    } catch (err) {
      console.error('Error loading dashboard summary data:', err);
    }

    if (!buses.length) {
      try {
        const { data: dbBuses } = await supabase.from('buses').select('id, bus_number, route').order('bus_number');
        if (dbBuses?.length) buses = dbBuses;
      } catch (e) {
        console.warn('Fallback buses query failed:', e);
      }
    }

    let myBus = buses.find(b => b.id === profile.bus_id);
    if (!myBus && expectedRole === 'coordinator' && buses.length > 0) {
      myBus = buses[0];
      if (!profile.bus_id) profile.bus_id = myBus.id;
    }

    if (!summary.student_count_total || summary.student_count_total === 0) {
      try {
        let countQ = supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student');
        if (profile?.bus_id) countQ = countQ.eq('bus_id', profile.bus_id);
        const { count } = await countQ;
        if (count && count > 0) {
          summary.student_count_total = count;
          summary.student_count_active = count;
        }
      } catch (e) {
        console.warn('Count fallback error:', e);
      }
    }

    text('stat-total-students', summary.student_count_total ?? 0);
    if (document.getElementById('stat-students-active')) text('stat-students-active', summary.student_count_active ?? 0);
    if (document.getElementById('stat-students-pending')) text('stat-students-pending', summary.student_count_pending ?? 0);
    if (document.getElementById('stat-active-buses')) text('stat-active-buses', summary.bus_count ?? buses.length);
    if (document.getElementById('stat-today-attendance')) text('stat-today-attendance', summary.present_today ?? 0);

  try {
    await updateSessionStatsCards(profile, summary.student_count_active ?? 0, summary);
  } catch (err) {
    console.error('Failed to update session stats cards:', err);
  }

  try {
    await populateOverrideStudentDropdown(profile);
  } catch (err) {
    console.error('Failed to populate override student dropdown:', err);
  }

  const overrideDateInput = document.getElementById('override-date');
  if (overrideDateInput && !overrideDateInput.value) {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISODate = new Date(now - tzOffset).toISOString().slice(0, 10);
    overrideDateInput.value = localISODate;
  }
  if (overrideDateInput) {
    overrideDateInput.onchange = updateActualStatusUI;
    overrideDateInput.oninput = updateActualStatusUI;
  }

  const sessionTypeSelect = document.getElementById('override-session-type');
  if (sessionTypeSelect) {
    sessionTypeSelect.onchange = updateActualStatusUI;
  }

  updateActualStatusUI();

  const busBadgeEl = document.getElementById('header-bus-badge');
  if (busBadgeEl) {
    if (expectedRole === 'coordinator' && myBus) {
      busBadgeEl.textContent = `Bus ${myBus.bus_number} Access`;
    } else if (expectedRole === 'coordinator') {
      busBadgeEl.textContent = `Bus 1 Access`;
    } else if (expectedRole === 'admin') {
      busBadgeEl.textContent = `All Buses Access`;
    }
  }

  const busFilter = document.getElementById('filter-bus');
  busFilter.replaceChildren();
  addOption(busFilter, '', expectedRole === 'admin' ? 'All buses' : 'My assigned bus');
  buses.forEach((bus) => addOption(busFilter, bus.id, `Bus ${bus.bus_number} — ${bus.route}`));
  if (expectedRole === 'coordinator' && profile.bus_id) busFilter.value = profile.bus_id;

  const loadHistory = async () => {
    const searchVal = document.getElementById('filter-search')?.value.trim() || null;
    const dateFromRaw = document.getElementById('filter-date-from')?.value;
    const dateToRaw = document.getElementById('filter-date-to')?.value;
    const statusRaw = document.getElementById('filter-status')?.value;

    let dateFrom = null;
    let dateTo = null;

    if (dateFromRaw && dateFromRaw.trim() !== '') {
      const v = dateFromRaw.trim();
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
        dateFrom = new Date(`${v}:00+05:30`).toISOString();
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        dateFrom = new Date(`${v}T00:00:00+05:30`).toISOString();
      } else {
        dateFrom = v;
      }
    }

    if (dateToRaw && dateToRaw.trim() !== '') {
      const v = dateToRaw.trim();
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
        dateTo = new Date(`${v}:59.999+05:30`).toISOString();
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        dateTo = new Date(`${v}T23:59:59.999+05:30`).toISOString();
      } else {
        dateTo = v;
      }
    }

    const statusVal = (statusRaw && statusRaw.trim() !== '') ? statusRaw.trim() : null;
    const busIdVal = (busFilter?.value && busFilter.value.trim() !== '') ? busFilter.value.trim() : null;

    const { data, error } = await supabase.rpc('authorized_attendance_history', {
      p_bus_id: busIdVal,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_status: statusVal,
      p_search: searchVal,
      p_day_type: null,
    });
    if (error) { showToast('Attendance history could not be loaded.', 'danger'); return; }

    const records = data ?? [];

    await updateSessionStatsCards(profile, 0, null, busIdVal);

    if (document.getElementById('stat-history-count')) text('stat-history-count', records.length);
    const printDateEl = document.getElementById('print-date-val');
    if (printDateEl) {
      const fromVal = document.getElementById('filter-date-from')?.value;
      const toVal = document.getElementById('filter-date-to')?.value;
      if (fromVal && toVal && fromVal.slice(0, 10) === toVal.slice(0, 10)) {
        printDateEl.textContent = new Date(fromVal).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
      } else if (fromVal || toVal) {
        const fromStr = fromVal ? new Date(fromVal).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Beginning';
        const toStr = toVal ? new Date(toVal).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Today';
        printDateEl.textContent = `${fromStr} – ${toStr}`;
      } else {
        printDateEl.textContent = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
      }
    }
    renderRows(records, expectedRole === 'coordinator', stopSortDir);
  };

  let stopSortDir = 'none';
  const thSortStopNo = document.getElementById('th-sort-stop-no');
  if (thSortStopNo) {
    thSortStopNo.onclick = () => {
      if (stopSortDir === 'none') stopSortDir = 'asc';
      else if (stopSortDir === 'asc') stopSortDir = 'desc';
      else stopSortDir = 'none';

      const iconEl = document.getElementById('sort-stop-icon');
      if (iconEl) {
        iconEl.textContent = stopSortDir === 'asc' ? '🔼' : (stopSortDir === 'desc' ? '🔽' : '↕️');
      }
      loadHistory();
    };
  }

  const setTodayDefaults = () => {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISODate = new Date(now - tzOffset).toISOString().slice(0, 10);
    document.getElementById('filter-date-from').value = `${localISODate}T00:00`;
    document.getElementById('filter-date-to').value = `${localISODate}T23:59`;
  };

  const quickFilterContainer = document.getElementById('quick-filters');
  if (quickFilterContainer) {
    quickFilterContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      const filterType = btn.getAttribute('data-filter');
      if (filterType === 'today') {
        setTodayDefaults();
        document.getElementById('filter-status').value = '';
      } else if (filterType === 'present') {
        document.getElementById('filter-date-from').value = '';
        document.getElementById('filter-date-to').value = '';
        document.getElementById('filter-status').value = 'PRESENT';
      } else if (filterType === 'absent') {
        document.getElementById('filter-date-from').value = '';
        document.getElementById('filter-date-to').value = '';
        document.getElementById('filter-status').value = 'ABSENT';
      }
      loadHistory();
    });
  }

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

  document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value = '';
    document.getElementById('filter-status').value = '';
    if (searchInput) searchInput.value = '';
    busFilter.value = expectedRole === 'coordinator' ? profile.bus_id : '';
    loadHistory();
  });

  try {
    await loadHistory();
  } catch (err) {
    console.error('Failed initial loadHistory call:', err);
  }

  const refreshDashboard = async () => {
    try {
      await loadHistory();
    } catch (err) {
      console.error('Error auto-refreshing dashboard:', err);
    }
  };

  // Realtime subscription for instant auto-updates when students scan attendance
  const attendanceChannel = supabase
    .channel('realtime:attendance-live-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => {
      refreshDashboard();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_sessions' }, () => {
      refreshDashboard();
    })
    .subscribe();

  window.addEventListener('beforeunload', () => {
    supabase.removeChannel(attendanceChannel);
  });

  const btnExportExcel = document.getElementById('btn-export-excel');
  if (btnExportExcel) {
    btnExportExcel.onclick = async () => {
      const table = document.getElementById('attendance-print-table');
      if (!table) return;

      const headers = ['Student Name', 'Register Number', 'Bus', 'Date', 'Morning (FN)', 'Evening (AN)', 'Special'];
      const rows = [headers];

      const tbody = document.getElementById('attendance-list');
      const trs = tbody.querySelectorAll('tr');
      trs.forEach(tr => {
        const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.replace(/\n+/g, ' ').trim());
        if (tds.length >= 7) {
          rows.push(tds);
        }
      });

      if (rows.length <= 1) {
        showToast('No records available to export.', 'warning');
        return;
      }

      if (!window.XLSX) {
        await new Promise((resolve) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
          s.onload = resolve;
          s.onerror = resolve;
          document.head.appendChild(s);
        });
      }

      if (window.XLSX) {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 15 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Attendance Report');
        const dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `Karunya_Bus_Attendance_${dateStr}.xlsx`);
        showToast('Excel report downloaded successfully.', 'success');
      } else {
        const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.map(val => `"${val.replace(/"/g, '""')}"`).join(',')).join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `Karunya_Bus_Attendance_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('Attendance report exported as CSV.', 'info');
      }
    };
  }

  const btnExportPdf = document.getElementById('btn-export-pdf');
  if (btnExportPdf) {
    btnExportPdf.onclick = () => {
      void document.body.offsetHeight;
      setTimeout(() => {
        window.print();
      }, 150);
    };
  }

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
  setupCSVImportHandlers();

  // ── Populate Reports section bus filter & initialise report UI ────────
  try {
    const rptBusSel = document.getElementById('rpt-dr-bus');
    if (rptBusSel && expectedRole === 'admin') {
      buses.forEach((b) => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = `Bus ${b.bus_number} — ${b.route}`;
        rptBusSel.appendChild(opt);
      });
    }
    await initReports(profile);
  } catch (rptErr) {
    console.error('Failed to initialise reports section:', rptErr);
  }

  renderBoardingManagement(expectedRole, profile, buses);

  if (expectedRole === 'admin') {
    const people = await renderAdminDirectory(buses);
    await renderAdminBusFleet(buses, people);
    await renderSecurityDashboard();
    await initAdminActivitiesSystem();

    globalRefreshAdminViews = async () => {
      let { data: newBuses } = await supabase.rpc('authorized_bus_records');
      if (!newBuses || !newBuses.length) {
        const { data: dbBuses } = await supabase.from('buses').select('id, bus_number, route, capacity').order('bus_number');
        newBuses = dbBuses ?? [];
      }

      ['add-student-bus', 'move-student-bus', 'add-coord-bus', 'delete-bus-select', 'filter-bus', 'rpt-dr-bus'].forEach((id) => {
        const select = document.getElementById(id);
        if (select) {
          const currentVal = select.value;
          select.replaceChildren();
          if (id === 'filter-bus') addOption(select, '', 'All buses');
          else if (id === 'rpt-dr-bus') addOption(select, '', 'All Buses');
          (newBuses || []).forEach((b) => addOption(select, b.id, `Bus ${b.bus_number} — ${b.route}`));
          if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
            select.value = currentVal;
          }
        }
      });

      if (document.getElementById('stat-active-buses')) text('stat-active-buses', newBuses.length);

      const refreshedPeople = await renderAdminDirectory(newBuses);
      await renderAdminBusFleet(newBuses, refreshedPeople);
    };
  }

  if (!canGenerateQr) return;
  const qrBus = document.getElementById('select-qr-bus');
  if (qrBus) {
    qrBus.replaceChildren();
    if (buses.length) {
      buses.forEach(b => addOption(qrBus, b.id, `Bus ${b.bus_number} — ${b.route}`));
    } else if (myBus) {
      addOption(qrBus, myBus.id, `Bus ${myBus.bus_number} — ${myBus.route}`);
    }
    const targetBusId = profile.bus_id || myBus?.id || buses[0]?.id || '';
    qrBus.value = targetBusId;
    if (expectedRole === 'coordinator' && buses.length <= 1) {
      qrBus.disabled = true;
    }
  }
  document.getElementById('btn-generate-qr').onclick = async () => {
    const sessionType = document.getElementById('select-session').value;
    const { data, error } = await supabase.functions.invoke('attendance-api', {
      body: { action: 'create-session', busId: qrBus.value, sessionType, emailQr: false }
    });
    if (error || !data?.token || !data?.expiresAt) {
      let errorMessage = 'QR session could not be created.';
      try {
        if (typeof error?.context?.json === 'function') {
          const resBody = await error.context.json();
          if (resBody?.message) errorMessage = resBody.message;
        } else if (typeof error?.context?.clone === 'function') {
          const resBody = await error.context.clone().json();
          if (resBody?.message) errorMessage = resBody.message;
        }
      } catch (_) {}
      if (errorMessage === 'QR session could not be created.' && data?.message) errorMessage = data.message;
      if (errorMessage === 'QR session could not be created.' && error?.message) errorMessage = error.message;
      return showToast(errorMessage, 'danger');
    }
    const display = document.getElementById('qr-code-display'); display.replaceChildren();
    new window.QRCode(display, { text: `${location.origin}/checkin?token=${encodeURIComponent(data.token)}`, width: 220, height: 220 });
    text('qr-url-text', `Active Session: Bus ${myBus ? myBus.bus_number : ''} (${sessionType}) • Expires ${new Date(data.expiresAt).toLocaleTimeString('en-IN')}`);
    showToast(`Manual QR session generated for ${sessionType}!`, 'success');
    await updateSessionStatsCards(profile, summary.student_count_active ?? 0);
  };
  } catch (err) {
    console.error('initOperationsDashboard error:', err);
  }
}

// ── Boarding Point Management ────────────────────────────────────────────────
const renderBoardingManagement = (expectedRole = 'admin', profile = null, buses = []) => {
  const section = document.getElementById('boarding-mgmt-section');
  if (!section) return;

  // Tab 1: Student Assignment Elements
  const searchInput      = section.querySelector('#boarding-search-input');
  const searchBtn        = section.querySelector('#boarding-search-btn');
  const searchMsg        = section.querySelector('#boarding-search-msg');
  const resultsDiv       = section.querySelector('#boarding-search-results');
  const searchBody       = section.querySelector('#boarding-search-body');
  const detailPanel      = section.querySelector('#boarding-detail-panel');
  const detailName       = section.querySelector('#boarding-detail-name');
  const detailEmail      = section.querySelector('#boarding-detail-email');
  const curPoint         = section.querySelector('#boarding-cur-point');
  const curStop          = section.querySelector('#boarding-cur-stop');
  const curFrom          = section.querySelector('#boarding-cur-from');
  const historyBody      = section.querySelector('#boarding-history-body');
  const selectDropdown   = section.querySelector('#boarding-select-dropdown');
  const customNameCol    = section.querySelector('#boarding-custom-name-col');
  const formPoint        = section.querySelector('#boarding-form-point');
  const formStop         = section.querySelector('#boarding-form-stop');
  const formFrom         = section.querySelector('#boarding-form-from');
  const formComment      = section.querySelector('#boarding-form-comment');
  const formSaveBtn      = section.querySelector('#boarding-form-save');
  const formMsg          = section.querySelector('#boarding-form-msg');
  const closeBtn         = section.querySelector('#boarding-close-detail');

  // Tab 2: Master Boarding Points Elements
  const masterBusCol      = section.querySelector('#master-bus-col');
  const masterBusSelect   = section.querySelector('#master-point-bus');
  const masterNameInput   = section.querySelector('#master-point-name');
  const masterStopInput   = section.querySelector('#master-point-stop');
  const masterIdInput     = section.querySelector('#master-point-id');
  const masterSaveBtn     = section.querySelector('#btn-save-master-point');
  const masterCancelBtn   = section.querySelector('#btn-cancel-master-point');
  const masterMsg         = section.querySelector('#master-point-msg');
  const masterListBody    = section.querySelector('#master-points-list-body');
  const masterFormTitle   = section.querySelector('#master-form-title');

  let masterPointsList    = [];
  let selectedStudentId   = null;
  let selectedStudentName = '';

  const userBusId = profile?.bus_id || null;

  // Setup Bus Selector in Tab 2
  if (masterBusSelect && masterBusCol) {
    if (expectedRole === 'coordinator') {
      masterBusCol.setAttribute('hidden', '');
    } else {
      masterBusCol.removeAttribute('hidden');
      masterBusSelect.innerHTML = '<option value="">-- All Buses --</option>';
      (buses || []).forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = `Bus ${b.bus_number} — ${b.route}`;
        masterBusSelect.appendChild(opt);
      });
      masterBusSelect.onchange = () => loadMasterBoardingPoints();
    }
  }

  const todayStr = (() => { const n = new Date(); return new Date(n - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })();
  if (formFrom) formFrom.value = todayStr;

  const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const getActiveBusIdFilter = () => {
    if (expectedRole === 'coordinator') return userBusId;
    return masterBusSelect?.value || null;
  };

  // ── Load Master Boarding Points List ───────────────────────────────────────
  const loadMasterBoardingPoints = async () => {
    if (!masterListBody) return;
    masterListBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Loading master list…</td></tr>';

    try {
      const busIdFilter = getActiveBusIdFilter();
      const { data: points, error } = await supabase.rpc('get_boarding_points', { p_bus_id: busIdFilter });
      if (error) {
        masterListBody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">Failed to load boarding points: ${error.message}</td></tr>`;
        return;
      }

      masterPointsList = points || [];

      // Populate Assignment Dropdown
      if (selectDropdown) {
        selectDropdown.innerHTML = '<option value="">-- Choose Boarding Point --</option>';
        masterPointsList.forEach(pt => {
          const opt = document.createElement('option');
          opt.value = pt.id;
          opt.dataset.name = pt.name;
          opt.dataset.stop = pt.stop_no != null ? pt.stop_no : '';
          opt.textContent = `${pt.stop_no != null ? 'Stop ' + pt.stop_no + ': ' : ''}${pt.name}`;
          selectDropdown.appendChild(opt);
        });
        const customOpt = document.createElement('option');
        customOpt.value = 'custom';
        customOpt.textContent = '-- Custom / Other --';
        selectDropdown.appendChild(customOpt);
      }

      // Populate Master Table
      if (masterPointsList.length === 0) {
        masterListBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">No boarding points created yet for this bus. Add one above!</td></tr>';
        return;
      }

      masterListBody.replaceChildren(...masterPointsList.map(pt => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${pt.stop_no != null ? pt.stop_no : '—'}</td>
          <td><strong>${pt.name}</strong></td>
          <td><span class="badge bg-success">Active</span></td>
          <td class="text-center">
            <button class="btn btn-xs btn-outline-info py-0 px-2 me-1 btn-edit-master" data-id="${pt.id}" data-name="${pt.name}" data-stop="${pt.stop_no != null ? pt.stop_no : ''}">
              Edit
            </button>
            <button class="btn btn-xs btn-outline-danger py-0 px-2 btn-del-master" data-id="${pt.id}">
              Delete
            </button>
          </td>
        `;

        tr.querySelector('.btn-edit-master').onclick = () => {
          masterIdInput.value = pt.id;
          masterNameInput.value = pt.name;
          masterStopInput.value = pt.stop_no != null ? pt.stop_no : '';
          if (masterBusSelect && pt.bus_id) masterBusSelect.value = pt.bus_id;
          masterSaveBtn.textContent = 'Update Point';
          masterCancelBtn.removeAttribute('hidden');
          masterFormTitle.textContent = '✏️ Edit Master Boarding Point';
          masterNameInput.focus();
        };

        tr.querySelector('.btn-del-master').onclick = async () => {
          if (!confirm(`Are you sure you want to remove boarding point "${pt.name}"?`)) return;
          const { error: delErr } = await supabase.rpc('delete_boarding_point', { p_id: pt.id });
          if (delErr) {
            showToast(`Could not delete boarding point: ${delErr.message || 'Access denied'}`, 'danger');
          } else {
            showToast(`Boarding point "${pt.name}" removed.`, 'success');
            loadMasterBoardingPoints();
            document.getElementById('btn-apply-filters')?.click();
          }
        };

        return tr;
      }));

    } catch (err) {
      console.error('loadMasterBoardingPoints error:', err);
      masterListBody.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Error loading master points.</td></tr>';
    }
  };

  // Reset Master Form
  const resetMasterForm = () => {
    masterIdInput.value = '';
    masterNameInput.value = '';
    masterStopInput.value = '';
    masterSaveBtn.textContent = 'Add Point';
    masterCancelBtn.setAttribute('hidden', '');
    masterFormTitle.textContent = '➕ Add New Master Boarding Point';
    masterMsg.innerHTML = '';
  };

  if (masterCancelBtn) masterCancelBtn.onclick = resetMasterForm;

  // Save Master Boarding Point
  if (masterSaveBtn) {
    masterSaveBtn.onclick = async () => {
      const id = masterIdInput.value || null;
      const name = masterNameInput.value.trim();
      const stopNo = masterStopInput.value ? parseInt(masterStopInput.value, 10) : null;
      const targetBusId = getActiveBusIdFilter();

      if (!name) {
        masterMsg.innerHTML = '<span class="text-danger">Boarding point name is required.</span>';
        return;
      }

      masterSaveBtn.disabled = true;
      masterMsg.innerHTML = '<span class="text-muted">Saving…</span>';

      const { data: newId, error } = await supabase.rpc('upsert_boarding_point', {
        p_id: id,
        p_name: name,
        p_stop_no: stopNo,
        p_bus_id: targetBusId
      });

      masterSaveBtn.disabled = false;

      if (error) {
        masterMsg.innerHTML = `<span class="text-danger">⚠️ ${error.message || 'Could not save boarding point.'}</span>`;
        return;
      }

      masterMsg.innerHTML = '<span class="text-success">✅ Boarding point saved!</span>';
      showToast(`Master boarding point "${name}" saved!`, 'success');
      resetMasterForm();
      loadMasterBoardingPoints();
    };
  }

  // Handle dropdown selection logic for student assignment
  if (selectDropdown) {
    selectDropdown.onchange = () => {
      const selectedVal = selectDropdown.value;
      if (selectedVal === 'custom') {
        customNameCol.removeAttribute('hidden');
        formPoint.value = '';
        formStop.value = '';
      } else if (selectedVal) {
        customNameCol.setAttribute('hidden', '');
        const selectedOpt = selectDropdown.options[selectDropdown.selectedIndex];
        formPoint.value = selectedOpt.dataset.name || '';
        formStop.value = selectedOpt.dataset.stop || '';
      } else {
        customNameCol.setAttribute('hidden', '');
        formPoint.value = '';
        formStop.value = '';
      }
    };
  }

  // ── Load and render boarding history for a student ─────────────────────────
  const loadBoardingDetail = async (studentId, studentFullName, studentEmail) => {
    selectedStudentId   = studentId;
    selectedStudentName = studentFullName;

    detailName.textContent  = studentFullName;
    detailEmail.textContent = studentEmail;

    // Reset form
    if (selectDropdown) selectDropdown.value = '';
    customNameCol.setAttribute('hidden', '');
    formPoint.value   = '';
    formStop.value    = '';
    formFrom.value    = todayStr;
    formComment.value = '';
    formMsg.innerHTML = '';

    historyBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Loading…</td></tr>';
    detailPanel.removeAttribute('hidden');
    detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const { data: history, error } = await supabase.rpc('get_student_boarding', { p_student_id: studentId });
    if (error) {
      historyBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Could not load boarding history: ${error.message}</td></tr>`;
      curPoint.textContent = curStop.textContent = curFrom.textContent = '—';
      return;
    }

    const current = (history || []).find(r => r.is_current);
    if (current) {
      curPoint.textContent = current.boarding_point || '—';
      curStop.textContent  = current.bus_stop_no != null ? `Stop ${current.bus_stop_no}` : '—';
      curFrom.textContent  = fmtDate(current.effective_from);

      // Pre-fill dropdown or custom form with current values
      const curPtName = current.boarding_point || '';
      let matchedOpt = Array.from(selectDropdown.options).find(opt => opt.dataset.name === curPtName);
      if (matchedOpt) {
        selectDropdown.value = matchedOpt.value;
        formPoint.value = curPtName;
        formStop.value  = current.bus_stop_no != null ? current.bus_stop_no : matchedOpt.dataset.stop || '';
      } else if (curPtName) {
        selectDropdown.value = 'custom';
        customNameCol.removeAttribute('hidden');
        formPoint.value = curPtName;
        formStop.value  = current.bus_stop_no != null ? current.bus_stop_no : '';
      }
    } else {
      curPoint.textContent = curStop.textContent = curFrom.textContent = 'No active record';
    }

    if (!history || history.length === 0) {
      historyBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No boarding records yet.</td></tr>';
      return;
    }

    historyBody.replaceChildren(...history.map(rec => {
      const tr = document.createElement('tr');
      const statusBadge = rec.is_current
        ? '<span class="badge bg-success">Active</span>'
        : '<span class="badge bg-secondary">Historical</span>';
      tr.innerHTML = `
        <td>${rec.boarding_point || '—'}</td>
        <td>${rec.bus_stop_no != null ? rec.bus_stop_no : '—'}</td>
        <td>${fmtDate(rec.effective_from)}</td>
        <td>${rec.effective_to ? fmtDate(rec.effective_to) : '<span class="text-success">Present</span>'}</td>
        <td>${rec.comment || '—'}</td>
        <td>${statusBadge}</td>
      `;
      return tr;
    }));
  };

  // ── Search handler ─────────────────────────────────────────────────────────
  const doSearch = async () => {
    const query = searchInput.value.trim();
    if (query.length < 2) {
      searchMsg.innerHTML = '<span class="text-warning">Enter at least 2 characters to search.</span>';
      resultsDiv.setAttribute('hidden', '');
      return;
    }
    searchMsg.innerHTML = '<span class="text-muted">Searching…</span>';
    resultsDiv.setAttribute('hidden', '');
    detailPanel.setAttribute('hidden', '');
    selectedStudentId = null;

    const busIdFilter = getActiveBusIdFilter();
    const { data: students, error } = await supabase.rpc('search_students_for_boarding', { p_query: query, p_bus_id: busIdFilter });
    if (error) {
      searchMsg.innerHTML = `<span class="text-danger">Search failed: ${error.message}</span>`;
      return;
    }
    if (!students || students.length === 0) {
      searchMsg.innerHTML = '<span class="text-warning">No students found. Try a different search term.</span>';
      return;
    }
    searchMsg.innerHTML = `<span class="text-muted">${students.length} result${students.length !== 1 ? 's' : ''} found.</span>`;

    searchBody.replaceChildren(...students.map(s => {
      const tr = document.createElement('tr');
      const boardingCell = s.has_boarding
        ? `<span class="text-success">${s.boarding_point || '—'}</span>`
        : '<span class="text-muted fst-italic">Not assigned</span>';
      const stopCell = s.has_boarding && s.bus_stop_no != null ? s.bus_stop_no : '—';
      tr.innerHTML = `
        <td>${s.full_name || '—'}</td>
        <td>${s.register_number || '—'}</td>
        <td>${s.email}</td>
        <td>${s.bus_number ? 'Bus ' + s.bus_number : '—'}</td>
        <td>${boardingCell}</td>
        <td>${stopCell}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-info py-0 px-2 btn-manage-boarding" data-id="${s.id}" data-name="${s.full_name}" data-email="${s.email}">
            Manage
          </button>
        </td>
      `;
      tr.querySelector('.btn-manage-boarding').onclick = () => loadBoardingDetail(s.id, s.full_name, s.email);
      return tr;
    }));
    resultsDiv.removeAttribute('hidden');
  };

  searchBtn.onclick = doSearch;
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  let searchDebounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    if (searchInput.value.trim().length >= 2) {
      searchDebounce = setTimeout(doSearch, 400);
    }
  });

  // ── Close detail panel ─────────────────────────────────────────────────────
  closeBtn.onclick = () => {
    detailPanel.setAttribute('hidden', '');
    selectedStudentId = null;
  };

  // ── Save student boarding assignment (upsert) ──────────────────────────────
  formSaveBtn.onclick = async () => {
    if (!selectedStudentId) {
      showToast('No student selected.', 'warning');
      return;
    }

    let boardingPoint = formPoint.value.trim();
    if (selectDropdown && selectDropdown.value && selectDropdown.value !== 'custom') {
      const selectedOpt = selectDropdown.options[selectDropdown.selectedIndex];
      if (selectedOpt && selectedOpt.dataset.name) {
        boardingPoint = selectedOpt.dataset.name;
      }
    }

    const stopNo = formStop.value ? parseInt(formStop.value, 10) : null;
    const effectiveFrom = formFrom.value || todayStr;
    const comment = formComment.value.trim() || null;

    if (!boardingPoint) {
      formMsg.innerHTML = '<span class="text-danger">Please select or enter a boarding point.</span>';
      return;
    }
    if (!effectiveFrom) {
      formMsg.innerHTML = '<span class="text-danger">Effective from date is required.</span>';
      return;
    }

    formSaveBtn.disabled = true;
    formMsg.innerHTML = '<span class="text-muted">Saving…</span>';

    const { data: newId, error } = await supabase.rpc('upsert_student_boarding', {
      p_student_id:     selectedStudentId,
      p_boarding_point: boardingPoint,
      p_bus_stop_no:    stopNo,
      p_effective_from: effectiveFrom,
      p_comment:        comment,
    });

    formSaveBtn.disabled = false;

    if (error) {
      formMsg.innerHTML = `<span class="text-danger">⚠️ ${error.message || 'Could not save boarding details.'}</span>`;
      showToast('Could not save boarding details.', 'danger');
      return;
    }

    formMsg.innerHTML = '<span class="text-success">✅ Boarding point saved successfully!</span>';
    showToast(`Boarding point set for ${selectedStudentName}.`, 'success');
    // Refresh history
    await loadBoardingDetail(selectedStudentId, detailName.textContent, detailEmail.textContent);
    // Refresh search results to reflect new boarding point
    if (searchInput.value.trim().length >= 2) doSearch();
  };

  // Initial Load of Master Points
  loadMasterBoardingPoints();
};

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
  const deleteBusSelect = document.getElementById('delete-bus-select');

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
  if (deleteBusSelect) {
    deleteBusSelect.replaceChildren();
    buses.forEach((b) => addOption(deleteBusSelect, b.id, `Bus ${b.bus_number} — ${b.route}`));
  }

  const btnDeleteBusSidebar = document.getElementById('btn-delete-bus-sidebar');
  if (btnDeleteBusSidebar) {
    btnDeleteBusSidebar.onclick = async () => {
      const busId = deleteBusSelect?.value;
      const msg = document.getElementById('delete-bus-msg');
      if (!busId) {
        showToast('Please select a bus to delete.', 'danger');
        return;
      }
      const bus = buses.find((b) => b.id === busId);
      if (!bus) return;

      if (!confirm(`Are you sure you want to delete Bus ${bus.bus_number} (${bus.route || 'No route description'})?\n\nThis action cannot be undone.`)) {
        return;
      }

      btnDeleteBusSidebar.disabled = true;
      btnDeleteBusSidebar.textContent = 'Deleting Bus…';

      const { data, error } = await supabase.functions.invoke('attendance-api', {
        body: { action: 'delete-bus', busId }
      });

      btnDeleteBusSidebar.disabled = false;
      btnDeleteBusSidebar.textContent = 'Delete Bus';

      if (error || !data?.message) {
        let err = data?.message;
        if (!err && error) {
          try {
            if (typeof error.context?.json === 'function') {
              const resBody = await error.context.json();
              err = resBody?.message;
            }
          } catch (_) {}
          if (!err && error.message && !error.message.includes('non-2xx')) err = error.message;
        }
        err = err || 'Could not delete bus.';
        if (msg) msg.innerHTML = `<span class="text-danger">${err}</span>`;
        showToast(err, 'danger');
      } else {
        if (msg) msg.innerHTML = `<span class="text-success">${data.message}</span>`;
        showToast(data.message, 'success');
        if (typeof globalRefreshAdminViews === 'function') {
          await globalRefreshAdminViews();
        }
      }
    };
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

      // ── Duplicate-email guard (uses RPC to avoid RLS recursion on profiles) ──
      const { data: allStudents, error: lookupErr } = await supabase.rpc('authorized_student_records');

      if (lookupErr) {
        const errMsg = lookupErr.message || 'Could not verify email uniqueness.';
        if (msg) msg.innerHTML = `<span class="text-danger">⚠️ ${errMsg}</span>`;
        showToast(errMsg, 'danger');
        return;
      }

      const existing = (allStudents || []).find(s => s.email?.toLowerCase() === email);
      if (existing) {
        const statusLabel = existing.status ? ` (status: ${existing.status})` : '';
        const warnMsg = `⚠️ A student with this email already exists: <strong>${existing.full_name || email}</strong>${statusLabel}. Please use a different email or update the existing record.`;
        if (msg) msg.innerHTML = `<span class="text-warning">${warnMsg}</span>`;
        showToast('Student with this email already exists.', 'danger');
        return;
      }
      // ─────────────────────────────────────────────────────────────────────

      const { data, error } = await supabase.functions.invoke('attendance-api', {
        body: { action: 'add-student', fullName: name, email, registerNumber: regNumber, busId }
      });
      if (error || data?.message !== 'Student added successfully.') {
        let err = data?.message;
        if (!err && error) {
          try {
            if (typeof error.context?.json === 'function') {
              const resBody = await error.context.json();
              err = resBody?.message;
            }
          } catch (_) {}
          if (!err && error.message && !error.message.includes('non-2xx')) err = error.message;
        }
        err = err || 'Could not add student.';
        if (msg) msg.innerHTML = `<span class="text-danger">${err}</span>`;
        showToast(err, 'danger');
      } else {
        if (msg) msg.innerHTML = '<span class="text-success">Student added successfully!</span>';
        showToast('Student added successfully.', 'success');
        document.getElementById('add-student-name').value = '';
        document.getElementById('add-student-email').value = '';
        document.getElementById('add-student-regnumber').value = '';
        await renderStudentRoster();
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
        let err = data?.message;
        if (!err && error) {
          try {
            if (typeof error.context?.json === 'function') {
              const resBody = await error.context.json();
              err = resBody?.message;
            }
          } catch (_) {}
          if (!err && error.message && !error.message.includes('non-2xx')) err = error.message;
        }
        err = err || 'Could not move student.';
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
        let err = data?.message;
        if (!err && error) {
          try {
            if (typeof error.context?.json === 'function') {
              const resBody = await error.context.json();
              err = resBody?.message;
            }
          } catch (_) {}
          if (!err && error.message && !error.message.includes('non-2xx')) err = error.message;
        }
        err = err || 'Could not remove student.';
        if (msg) msg.innerHTML = `<span class="text-danger">${err}</span>`;
        showToast(err, 'danger');
      } else {
        if (msg) msg.innerHTML = '<span class="text-success">Student removed from bus.</span>';
        showToast('Student removed from bus.', 'info');
        document.getElementById('remove-student-email').value = '';
        await renderStudentRoster();
      }
    };
  }

  const handleRemoveCoordinator = async (email) => {
    const msg = document.getElementById('remove-coord-msg');
    const btnRemoveCoord = document.getElementById('btn-remove-coordinator');
    if (btnRemoveCoord) {
      btnRemoveCoord.disabled = true;
      btnRemoveCoord.textContent = 'Removing…';
    }
    const { data, error } = await supabase.functions.invoke('attendance-api', {
      body: { action: 'remove-coordinator', email }
    });
    if (btnRemoveCoord) {
      btnRemoveCoord.disabled = false;
      btnRemoveCoord.textContent = 'Remove Coordinator';
    }
    if (error || !data?.message) {
      let err = data?.message;
      if (!err && error) {
        try {
          if (typeof error.context?.json === 'function') {
            const resBody = await error.context.json();
            err = resBody?.message;
          }
        } catch (_) {}
        if (!err && error.message && !error.message.includes('non-2xx')) err = error.message;
      }
      err = err || 'Could not remove coordinator.';
      if (msg) msg.innerHTML = `<span class="text-danger">${err}</span>`;
      showToast(err, 'danger');
    } else {
      if (msg) msg.innerHTML = `<span class="text-success">${data.message}</span>`;
      showToast(data.message, 'success');
      const input = document.getElementById('remove-coord-email');
      if (input) input.value = '';
      if (typeof globalRefreshAdminViews === 'function') {
        await globalRefreshAdminViews();
      }
    }
  };

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
      btnAddCoord.disabled = true;
      btnAddCoord.textContent = 'Adding…';

      let successMessage = '';
      let rpcError = null;

      try {
        const { data: rpcData, error: err } = await supabase.rpc('assign_coordinator', {
          p_email: email,
          p_full_name: name,
          p_bus_id: busId
        });
        if (err) {
          rpcError = err;
        } else if (rpcData?.message) {
          successMessage = rpcData.message;
        }
      } catch (e) {
        rpcError = e;
      }

      if (rpcError) {
        try {
          const { error: upsertErr } = await supabase.from('pending_coordinator_assignments').upsert({
            email: email,
            full_name: name,
            bus_id: busId,
            status: 'active'
          });
          if (!upsertErr) {
            rpcError = null;
            successMessage = 'Coordinator assigned successfully.';
            await supabase.from('profiles').update({
              role: 'coordinator',
              bus_id: busId,
              full_name: name,
              status: 'active'
            }).eq('email', email);
          }
        } catch (_) {}
      }

      let edgeData = null;
      let edgeError = null;
      try {
        const { data: edData, error: edErr } = await supabase.functions.invoke('attendance-api', {
          body: { action: 'add-coordinator', fullName: name, email, busId }
        });
        edgeData = edData;
        edgeError = edErr;
      } catch (e) {
        edgeError = e;
      }

      btnAddCoord.disabled = false;
      btnAddCoord.textContent = 'Add Coordinator';

      if (rpcError) {
        const err = rpcError?.message || edgeError?.message || 'Could not add coordinator.';
        if (msg) msg.innerHTML = `<span class="text-danger">${err}</span>`;
        showToast(err, 'danger');
      } else {
        const displayMsg = successMessage || edgeData?.message || 'Coordinator assigned successfully.';
        if (msg) msg.innerHTML = `<span class="text-success">${displayMsg}</span>`;
        showToast(displayMsg, 'success');
        document.getElementById('add-coord-name').value = '';
        document.getElementById('add-coord-email').value = '';
        if (typeof globalRefreshAdminViews === 'function') {
          await globalRefreshAdminViews();
        }
      }
    };
  }

  const btnRemoveCoord = document.getElementById('btn-remove-coordinator');
  if (btnRemoveCoord) {
    btnRemoveCoord.onclick = async () => {
      const email = document.getElementById('remove-coord-email')?.value?.trim()?.toLowerCase();
      if (!email) {
        showToast('Coordinator email is required.', 'danger');
        return;
      }
      await handleRemoveCoordinator(email);
    };
  }

  const btnAddBus = document.getElementById('btn-add-bus');
  if (btnAddBus) {
    btnAddBus.onclick = async () => {
      const busNumber = document.getElementById('add-bus-number')?.value;
      const capacity = document.getElementById('add-bus-capacity')?.value || 60;
      const routeName = document.getElementById('add-bus-route')?.value?.trim();
      const msg = document.getElementById('add-bus-msg');
      if (!busNumber || !routeName) {
        showToast('Bus number and route description are required.', 'danger');
        return;
      }
      btnAddBus.disabled = true;
      btnAddBus.textContent = 'Adding Bus…';
      const { data, error } = await supabase.functions.invoke('attendance-api', {
        body: { action: 'add-bus', busNumber, capacity, routeName }
      });
      btnAddBus.disabled = false;
      btnAddBus.textContent = 'Add Bus';
      if (error || !data?.message) {
        let err = data?.message;
        if (!err && error) {
          try {
            if (typeof error.context?.json === 'function') {
              const resBody = await error.context.json();
              err = resBody?.message;
            }
          } catch (_) {}
          if (!err && error.message && !error.message.includes('non-2xx')) err = error.message;
        }
        err = err || 'Could not create bus.';
        if (msg) msg.innerHTML = `<span class="text-danger">${err}</span>`;
        showToast(err, 'danger');
      } else {
        if (msg) msg.innerHTML = `<span class="text-success">${data.message}</span>`;
        showToast(data.message, 'success');
        document.getElementById('add-bus-number').value = '';
        document.getElementById('add-bus-route').value = '';
        if (typeof globalRefreshAdminViews === 'function') {
          await globalRefreshAdminViews();
        }
      }
    };
  }

  const btnSaveEditBus = document.getElementById('btn-save-edit-bus');
  if (btnSaveEditBus) {
    btnSaveEditBus.onclick = async () => {
      const busId = document.getElementById('edit-bus-id')?.value;
      const busNumber = document.getElementById('edit-bus-number')?.value;
      const capacity = document.getElementById('edit-bus-capacity')?.value || 60;
      const routeName = document.getElementById('edit-bus-route')?.value?.trim();
      const msg = document.getElementById('edit-bus-msg');

      if (!busId || !busNumber || !routeName) {
        showToast('Bus number and route description are required.', 'danger');
        return;
      }

      btnSaveEditBus.disabled = true;
      btnSaveEditBus.textContent = 'Saving…';

      const { data, error } = await supabase.functions.invoke('attendance-api', {
        body: { action: 'edit-bus', busId, busNumber, capacity, routeName }
      });

      btnSaveEditBus.disabled = false;
      btnSaveEditBus.textContent = 'Save Changes';

      if (error || !data?.message) {
        let err = data?.message;
        if (!err && error) {
          try {
            if (typeof error.context?.json === 'function') {
              const resBody = await error.context.json();
              err = resBody?.message;
            }
          } catch (_) {}
          if (!err && error.message && !error.message.includes('non-2xx')) err = error.message;
        }
        err = err || 'Could not update bus.';
        if (msg) msg.innerHTML = `<span class="text-danger">${err}</span>`;
        showToast(err, 'danger');
      } else {
        if (msg) msg.innerHTML = `<span class="text-success">${data.message}</span>`;
        showToast(data.message, 'success');
        const modalEl = document.getElementById('modalEditBus');
        if (modalEl) {
          const modal = bootstrap.Modal.getInstance(modalEl);
          modal?.hide();
        }
        if (typeof globalRefreshAdminViews === 'function') {
          await globalRefreshAdminViews();
        }
      }
    };
  }

  const btnSubmitOverride = document.getElementById('btn-submit-override');
  if (btnSubmitOverride) {
    btnSubmitOverride.onclick = async () => {
      const emailSelect = document.getElementById('override-student-select');
      const emailInput = document.getElementById('override-student-email');
      const selectedOpt = emailSelect?.options?.[emailSelect.selectedIndex];

      let registerNumber = selectedOpt?.dataset?.reg || '';
      if (!registerNumber && selectedOpt?.textContent) {
        const textParts = selectedOpt.textContent.split('—');
        if (textParts.length > 1 && textParts[0].trim().toUpperCase().startsWith('URK')) {
          registerNumber = textParts[0].trim().toUpperCase();
        }
      }

      const email = (emailInput?.value || emailSelect?.value)?.trim()?.toLowerCase();
      const sessionType = document.getElementById('override-session-type')?.value;
      const status = document.getElementById('override-status')?.value;
      const remark = document.getElementById('override-remark')?.value?.trim();
      const msg = document.getElementById('override-msg');

      if (!email && !registerNumber) {
        showToast('Please select a student from the dropdown.', 'danger');
        if (msg) msg.innerHTML = '<span class="text-danger">Please select a student.</span>';
        return;
      }
      if (!remark || remark.length < 3) {
        showToast('A reason/comment (at least 3 characters) is mandatory for manual override.', 'warning');
        if (msg) msg.innerHTML = '<span class="text-warning">Reason/comment is mandatory.</span>';
        return;
      }

      const overrideDate = document.getElementById('override-date')?.value || null;

      btnSubmitOverride.disabled = true;
      btnSubmitOverride.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting…';

      // Obtain device GPS location of Admin / BC marking manual attendance
      const getDeviceCoordinates = () => new Promise(resolve => {
        if (!navigator.geolocation) return resolve({ latitude: null, longitude: null });
        navigator.geolocation.getCurrentPosition(
          pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          () => resolve({ latitude: null, longitude: null }),
          { timeout: 4000, enableHighAccuracy: true }
        );
      });

      const { latitude, longitude } = await getDeviceCoordinates();

      let invokeResult = await supabase.functions.invoke('attendance-api', {
        body: {
          action: 'manual-override-attendance',
          studentEmail: email,
          registerNumber,
          sessionType,
          status,
          remark,
          overrideDate,
          latitude,
          longitude
        }
      }).catch(err => ({ data: null, error: err }));

      // Retry once automatically on transient network interruptions
      if (invokeResult.error && (invokeResult.error.name === 'FunctionsFetchError' || String(invokeResult.error.message || '').includes('Failed to send'))) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        invokeResult = await supabase.functions.invoke('attendance-api', {
          body: {
            action: 'manual-override-attendance',
            studentEmail: email,
            registerNumber,
            sessionType,
            status,
            remark,
            overrideDate,
            latitude,
            longitude
          }
        }).catch(err => ({ data: null, error: err }));
      }

      const { data: apiData, error: apiErr } = invokeResult;

      btnSubmitOverride.disabled = false;
      btnSubmitOverride.innerHTML = 'Submit Override';

      if (apiErr || !apiData?.message) {
        console.error('Manual attendance override API error detail:', { apiErr, apiData });
        let err = 'Could not record manual attendance.';

        if (apiErr?.context && typeof apiErr.context.clone === 'function') {
          const body = await apiErr.context.clone().json().catch(() => null);
          if (body?.message) err = body.message;
        } else if (apiErr?.message) {
          err = apiErr.message;
        }

        if (apiData?.message) {
          err = apiData.message;
        }

        if (msg) msg.innerHTML = `<span class="text-danger">${err}</span>`;
        showToast(err, 'danger');
      } else {
        if (msg) msg.innerHTML = `<span class="text-success">${apiData.message}</span>`;
        showToast(apiData.message, 'success');
        document.getElementById('override-remark').value = '';
        await updateActualStatusUI();
        await loadHistory();
      }
    };
  }
  initBackToTopButton();
};

const setupCSVImportHandlers = () => {
  const EMAIL_PATTERN = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i;
  const isValidEmail = (v) => typeof v === 'string' && EMAIL_PATTERN.test(v) && v.length <= 254;
  const isValidRegNo = (v) => typeof v === 'string' && /^[A-Z0-9]+$/i.test(v.trim()) && v.trim().length <= 30;

  const downloadTemplate = () => {
    const csvContent = "student_name,student_id,email\nAshika Braicy,24CS001,ashika@karunya.edu.in\nBenesha Mercy,24CS002,benesha@karunya.edu.in\nAngel Achsah,24CS003,angel@karunya.edu.in\n";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'student_import_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  ['btn-download-csv-template', 'main-btn-download-csv-template'].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.onclick = downloadTemplate;
  });

  const parseCSV = (text) => {
    const lines = text.split(/\r\n|\n|\r/);
    if (!lines.length) return { headers: [], rows: [] };

    const parseRow = (line) => {
      const res = [];
      let cell = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
          res.push(cell.trim());
          cell = '';
        } else {
          cell += c;
        }
      }
      res.push(cell.trim());
      return res;
    };

    const rawHeaders = parseRow(lines[0]);
    const headers = rawHeaders.map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cells = parseRow(line);
      const rowObj = {};
      headers.forEach((h, idx) => {
        rowObj[h] = cells[idx] ?? '';
      });
      rows.push(rowObj);
    }
    return { headers, rows };
  };

  const bindCSVInput = (fileInputId, previewContainerId, previewCountId, badgeId, tbodyId, submitBtnId, msgId) => {
    const fileInput = document.getElementById(fileInputId);
    const previewContainer = document.getElementById(previewContainerId);
    const previewCount = document.getElementById(previewCountId);
    const badge = document.getElementById(badgeId);
    const tbody = document.getElementById(tbodyId);
    const submitBtn = document.getElementById(submitBtnId);
    const msg = document.getElementById(msgId);

    if (!fileInput || !submitBtn) return;

    let parsedRows = [];

    fileInput.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv' && file.type !== 'application/vnd.ms-excel') {
        if (msg) msg.innerHTML = `<div class="alert alert-danger p-2 small">Invalid file type. Please upload a .csv file.</div>`;
        if (submitBtn) submitBtn.disabled = true;
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result;
        if (typeof content !== 'string') return;

        const { headers, rows } = parseCSV(content);

        const hasName = headers.some((h) => ['student_name', 'full_name', 'name'].includes(h));
        const hasId = headers.some((h) => ['student_id', 'register_number', 'reg_no', 'roll_no'].includes(h));
        const hasEmail = headers.some((h) => ['email', 'student_email'].includes(h));

        if (!hasName || !hasId || !hasEmail) {
          if (msg) msg.innerHTML = `<div class="alert alert-danger p-2 small">Missing required CSV columns. Required headers: <code>student_name,student_id,email</code></div>`;
          if (previewContainer) previewContainer.hidden = true;
          if (submitBtn) submitBtn.disabled = true;
          return;
        }

        if (!rows.length) {
          if (msg) msg.innerHTML = `<div class="alert alert-warning p-2 small">No student records found in CSV.</div>`;
          if (previewContainer) previewContainer.hidden = true;
          if (submitBtn) submitBtn.disabled = true;
          return;
        }

        parsedRows = rows;
        let validCount = 0;
        let invalidCount = 0;

        if (tbody) {
          tbody.replaceChildren(...rows.map((row, idx) => {
            const tr = document.createElement('tr');

            const name = row.student_name || row.full_name || row.name || '';
            const regNo = (row.student_id || row.register_number || row.reg_no || row.roll_no || '').toUpperCase();
            const email = (row.email || row.student_email || '').toLowerCase();

            let statusHtml = '';
            let isRowValid = true;

            if (!name) {
              isRowValid = false;
              statusHtml = `<span class="badge bg-danger">Missing Name</span>`;
            } else if (!regNo || !isValidRegNo(regNo)) {
              isRowValid = false;
              statusHtml = `<span class="badge bg-danger">Invalid Student ID</span>`;
            } else if (!email || !isValidEmail(email)) {
              isRowValid = false;
              statusHtml = `<span class="badge bg-danger">Invalid Email</span>`;
            } else {
              statusHtml = `<span class="badge bg-success">Valid</span>`;
            }

            if (isRowValid) validCount++;
            else invalidCount++;

            tr.innerHTML = `
              <td>${idx + 1}</td>
              <td>${name || '—'}</td>
              <td><code>${regNo || '—'}</code></td>
              <td>${email || '—'}</td>
              <td>${statusHtml}</td>
            `;
            return tr;
          }));
        }

        if (previewCount) previewCount.textContent = `CSV Preview (${rows.length} rows found)`;
        if (badge) {
          badge.className = validCount > 0 ? 'badge bg-success' : 'badge bg-danger';
          badge.textContent = `${validCount} valid, ${invalidCount} invalid`;
        }
        if (previewContainer) previewContainer.hidden = false;
        if (msg) msg.innerHTML = '';
        if (submitBtn) submitBtn.disabled = validCount === 0;
      };

      reader.readAsText(file);
    };

    submitBtn.onclick = async () => {
      if (!parsedRows.length) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Importing…';
      if (msg) msg.innerHTML = `<div class="alert alert-info p-2 small">Importing student records into database…</div>`;

      const { data, error } = await supabase.functions.invoke('attendance-api', {
        body: { action: 'import-students-csv', students: parsedRows }
      });

      submitBtn.disabled = false;
      submitBtn.textContent = '🚀 Import Students';

      if (error || !data?.summary) {
        let err = data?.message;
        if (!err && error) {
          try {
            if (typeof error.context?.json === 'function') {
              const resBody = await error.context.json();
              err = resBody?.message;
            }
          } catch (_) {}
          if (!err && error.message && !error.message.includes('non-2xx')) err = error.message;
        }
        err = err || 'Failed to import CSV.';
        if (msg) msg.innerHTML = `<div class="alert alert-danger p-2 small">${err}</div>`;
        showToast(err, 'danger');
      } else {
        const sum = data.summary;
        let alertClass = sum.successfullyAdded > 0 ? 'alert-success' : 'alert-warning';
        let html = `
          <div class="alert ${alertClass} p-3 mb-0">
            <h6 class="fw-bold mb-2">🎉 ${data.message}</h6>
            <div class="d-flex flex-wrap gap-2 mb-2">
              <span class="badge bg-dark">Total Rows: ${sum.totalRows}</span>
              <span class="badge bg-success">Successfully Added: ${sum.successfullyAdded}</span>
              <span class="badge bg-warning text-dark">Already Existing: ${sum.alreadyExisting}</span>
              <span class="badge bg-danger">Invalid / Rejected: ${sum.invalidRows}</span>
            </div>
        `;

        if (sum.rowErrors && sum.rowErrors.length > 0) {
          html += `
            <hr class="border-secondary my-2">
            <div class="small fw-semibold text-danger mb-1">Row Details &amp; Rejections:</div>
            <ul class="small mb-0 text-muted ps-3" style="max-height: 140px; overflow-y: auto;">
              ${sum.rowErrors.map((e) => `<li>Row ${e.row}: ${e.error}</li>`).join('')}
            </ul>
          `;
        }

        html += `</div>`;
        if (msg) msg.innerHTML = html;
        showToast(`Import completed: ${sum.successfullyAdded} added, ${sum.alreadyExisting} existing.`, 'success');

        await renderStudentRoster();
      }
    };
  };

  bindCSVInput('csv-file-input', 'csv-preview-container', 'csv-preview-count', 'csv-validation-badge', 'csv-preview-tbody', 'btn-import-csv-submit', 'csv-import-msg');
  bindCSVInput('main-csv-file-input', 'main-csv-preview-container', 'main-csv-preview-count', 'main-csv-validation-badge', 'main-csv-preview-tbody', 'main-btn-import-csv-submit', 'main-csv-import-msg');
};

const initAdminActivitiesSystem = async () => {
  const badgeEl = document.getElementById('nav-unread-badge');
  const feedList = document.getElementById('activity-feed-list');
  const markAllReadBtn = document.getElementById('btn-mark-all-read');
  const loadMoreBtn = document.getElementById('btn-load-more-activities');
  const filterButtons = document.querySelectorAll('#activity-filter-group button');
  const infoText = document.getElementById('activity-pagination-info');

  let currentPage = 1;
  const pageSize = 15;
  let currentFilter = 'all';
  let loadedActivities = [];
  let totalCount = 0;

  const getActionIcon = (action, entityType) => {
    if (entityType === 'bus' || action.includes('BUS')) return '🚌';
    if (entityType === 'coordinator' || action.includes('COORDINATOR')) return '👤';
    if (entityType === 'student' || action.includes('STUDENT')) return '🎓';
    return '🔔';
  };

  const formatTimestamp = (isoStr) => {
    if (!isoStr) return '';
    const date = new Date(isoStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Today, ${timeStr}`;
    if (isYesterday) return `Yesterday, ${timeStr}`;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  };

  const fetchActivities = async (page = 1, append = false) => {
    const unreadOnly = currentFilter === 'unread';
    let data = null;
    let error = null;

    try {
      const res = await supabase.functions.invoke('attendance-api', {
        body: { action: 'get-admin-activities', page, limit: pageSize, unreadOnly }
      });
      data = res.data;
      error = res.error;
    } catch (e) {
      error = e;
    }

    if (error || !data || !Array.isArray(data.activities)) {
      try {
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        let q = supabase.from('security_audit_events').select('*', { count: 'exact' });
        if (unreadOnly) q = q.eq('is_read', false);

        const { data: auditData, count, error: dbErr } = await q.order('created_at', { ascending: false }).range(from, to);

        if (!dbErr && auditData) {
          const { count: unreadCount } = await supabase.from('security_audit_events').select('*', { count: 'exact', head: true }).eq('is_read', false);
          data = {
            activities: auditData.map(e => ({
              id: e.id,
              action: e.action || 'SYSTEM_ACTIVITY',
              entity_type: e.entity_type || 'system',
              entity_name: e.entity_name || e.action,
              details: e.details || {},
              created_at: e.created_at,
              is_read: e.is_read || false,
              actor_name: e.actor_name || 'System'
            })),
            totalCount: count || auditData.length,
            unreadCount: unreadCount || 0
          };
          error = null;
        }
      } catch (e) {
        console.warn('Direct audit events fetch fallback error:', e);
      }
    }

    if (error || !data || !Array.isArray(data.activities)) {
      if (feedList && !append) {
        feedList.innerHTML = `<div class="glass-panel p-4 text-center text-muted small">No recent system activities recorded yet.</div>`;
      }
      return;
    }

    const { activities, totalCount: total, unreadCount } = data;
    totalCount = total;

    if (badgeEl) {
      if (unreadCount > 0) {
        badgeEl.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        badgeEl.hidden = false;
      } else {
        badgeEl.hidden = true;
      }
    }

    if (append) {
      loadedActivities = [...loadedActivities, ...(activities || [])];
    } else {
      loadedActivities = activities || [];
    }

    if (infoText) {
      infoText.textContent = `Showing ${loadedActivities.length} of ${totalCount} activities`;
    }

    if (loadMoreBtn) {
      loadMoreBtn.hidden = loadedActivities.length >= totalCount;
    }

    renderActivitiesList();
  };

  const renderActivitiesList = () => {
    if (!feedList) return;

    if (!loadedActivities.length) {
      feedList.innerHTML = `<div class="glass-panel p-4 text-center text-muted small">No ${currentFilter === 'unread' ? 'unread ' : ''}activities recorded yet.</div>`;
      return;
    }

    feedList.replaceChildren(...loadedActivities.map((act) => {
      const card = document.createElement('div');
      card.className = `glass-panel p-3 border ${act.is_read ? 'border-secondary border-opacity-25' : 'border-warning border-opacity-50'} position-relative`;

      const icon = getActionIcon(act.action, act.entity_type);
      const timeDisplay = formatTimestamp(act.created_at);

      let detailsHtml = '';
      if (act.details && typeof act.details === 'object' && Object.keys(act.details).length > 0) {
        const d = act.details;
        if (d.capacityOld !== undefined && d.capacityNew !== undefined) {
          detailsHtml = `<div class="small text-muted mt-1">Capacity: <span class="text-light">${d.capacityOld ?? 60}</span> → <span class="text-warning fw-bold">${d.capacityNew}</span></div>`;
        } else if (d.totalRows !== undefined && d.successfullyAdded !== undefined) {
          detailsHtml = `<div class="small text-muted mt-1">Total CSV rows: ${d.totalRows} | Added: <span class="text-success fw-bold">${d.successfullyAdded}</span> | Existing: ${d.alreadyExisting} | Rejected: ${d.invalidRows}</div>`;
        }
      }

      card.innerHTML = `
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div class="d-flex gap-3 align-items-start">
            <span class="fs-4">${icon}</span>
            <div>
              <div class="d-flex align-items-center gap-2 flex-wrap">
                <span class="badge ${act.actor_role === 'admin' ? 'bg-danger' : 'bg-warning text-dark'}">${act.actor_role === 'admin' ? 'Admin' : 'Bus Coordinator'}</span>
                <strong class="text-light small">${act.actor_name}</strong>
                ${!act.is_read ? '<span class="badge bg-warning text-dark" style="font-size: 0.65rem;">NEW</span>' : ''}
              </div>
              <p class="mb-0 text-light mt-1 small">${act.message}</p>
              ${detailsHtml}
              <small class="text-muted" style="font-size: 0.72rem;">${timeDisplay}</small>
            </div>
          </div>
          ${!act.is_read ? `<button class="btn btn-sm btn-outline-secondary btn-mark-single-read" data-id="${act.id}" title="Mark as read">✓ Read</button>` : ''}
        </div>
      `;

      card.querySelector('.btn-mark-single-read')?.addEventListener('click', async () => {
        const { data, error } = await supabase.functions.invoke('attendance-api', {
          body: { action: 'mark-activity-read', activityId: act.id }
        });
        if (!error && data) {
          act.is_read = true;
          fetchActivities(1, false);
        }
      });

      return card;
    }));
  };

  filterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterButtons.forEach((b) => b.classList.remove('active', 'btn-warning'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter || 'all';
      currentPage = 1;
      fetchActivities(1, false);
    });
  });

  if (markAllReadBtn) {
    markAllReadBtn.onclick = async () => {
      markAllReadBtn.disabled = true;
      const { data, error } = await supabase.functions.invoke('attendance-api', {
        body: { action: 'mark-all-activities-read' }
      });
      markAllReadBtn.disabled = false;
      if (!error && data) {
        showToast('All activities marked as read.', 'success');
        currentPage = 1;
        fetchActivities(1, false);
      }
    };
  }

  if (loadMoreBtn) {
    loadMoreBtn.onclick = () => {
      currentPage += 1;
      fetchActivities(currentPage, true);
    };
  }

  await fetchActivities(1, false);
  setInterval(() => fetchActivities(1, false), 30000);
};

const initBackToTopButton = () => {
  let btn = document.getElementById('btn-back-to-top');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'btn-back-to-top';
    btn.setAttribute('aria-label', 'Back to top');
    btn.setAttribute('title', 'Back to top');
    document.body.append(btn);
  }
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:18px;height:18px;max-width:18px;max-height:18px;"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;

  const checkScroll = () => {
    if (window.scrollY > 200 || document.documentElement.scrollTop > 200) {
      btn.classList.add('show');
    } else {
      btn.classList.remove('show');
    }
  };

  window.addEventListener('scroll', checkScroll, { passive: true });
  checkScroll();

  btn.onclick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBackToTopButton);
} else {
  initBackToTopButton();
}
