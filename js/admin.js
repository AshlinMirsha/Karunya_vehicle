import { supabase } from '../supabase/client.js';
import { renderNavbar } from '../components/navbar.js';
import { showToast } from '../components/toast.js';
import { rememberProtectedRedirect } from './auth.js';

const setText = (id, value) => { document.getElementById(id).textContent = String(value); };
const cell = (value) => { const element = document.createElement('td'); if (value instanceof Node) element.append(value); else element.textContent = String(value ?? '—'); return element; };
const makeRow = (values) => { const row = document.createElement('tr'); values.forEach((value) => row.append(cell(value))); return row; };
const todayStart = () => { const date = new Date(); date.setHours(0, 0, 0, 0); return date.toISOString(); };
const formatCoordinate = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(6) : '—';
const mapUrlFor = (latitude, longitude) => Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
  ? `https://www.google.com/maps?q=${encodeURIComponent(`${Number(latitude).toFixed(6)},${Number(longitude).toFixed(6)}`)}`
  : null;
const mapLink = (url) => {
  if (!url) return '—';
  const link = document.createElement('a');
  link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'btn btn-sm btn-outline-primary'; link.textContent = 'Open map';
  return link;
};

const renderRows = (id, rows, columns, emptyMessage) => {
  const body = document.getElementById(id);
  const visibleRows = rows.length ? rows : [makeRow([emptyMessage])];
  body.replaceChildren(...visibleRows);
  if (!rows.length) body.firstElementChild.firstElementChild.colSpan = columns;
};

const addBusFilterOption = (select, bus) => {
  const option = document.createElement('option');
  option.value = bus.id;
  option.textContent = `Bus ${bus.bus_number}`;
  select.append(option);
};

const loadAssignedStudentsForBus = async (busId) => {
  const { data, error } = await supabase.rpc('admin_student_records', { p_bus_id: busId || null });
  if (error) {
    showToast('Assigned student records could not be loaded for this bus.', 'danger');
    return [];
  }
  return data ?? [];
};

const downloadAttendanceSheet = (records) => {
  const header = ['Student', 'Register number', 'Bus number', 'Session', 'Latitude', 'Longitude', 'Google Maps link', 'Checked in', 'Status'];
  const csv = [header, ...records].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `karunya-attendance-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click(); URL.revokeObjectURL(link.href);
};

export async function initAdminDashboard() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { rememberProtectedRedirect(); return location.replace('/'); }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { rememberProtectedRedirect(); return location.replace('/'); }
  const { data: profile, error: profileError } = await supabase.rpc('current_app_profile').single();
  if (profileError || !profile?.role) { showToast('Your profile role could not be verified. Sign out and sign in again.', 'danger'); return; }
  if (profile.role !== 'admin') return location.replace('/student');
  renderNavbar(user, 'Admin');
  document.body.classList.add('role-authorized');

  const [busesResult, attendanceResult, coordinatorsResult] = await Promise.all([
    supabase.rpc('admin_bus_records'),
    supabase.rpc('admin_attendance_sheet'),
    supabase.rpc('admin_coordinator_count'),
  ]);
  const buses = busesResult.data ?? [];
  const attendance = attendanceResult.data ?? [];
  const coordinators = coordinatorsResult.data ?? 0;
  const dashboardError = [busesResult.error, attendanceResult.error, coordinatorsResult.error].find(Boolean);
  if (dashboardError) showToast('Some dashboard records could not be loaded. Refresh and try again.', 'danger');
  const busFilter = document.getElementById('select-admin-student-bus');
  busFilter.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All buses';
  busFilter.append(allOption);
  buses.forEach((bus) => addBusFilterOption(busFilter, bus));
  const renderAssignedStudents = async () => {
    const students = await loadAssignedStudentsForBus(busFilter.value);
    setText('stat-total-students', students.length);
    renderRows('admin-students-list', students.map((student) => makeRow([student.register_number, student.full_name, student.email, student.bus_number ?? 'Unassigned', student.status])), 5, 'No student records found for this bus.');
  };
  const attendanceRows = attendance.map((record) => {
    const mapUrl = mapUrlFor(record.latitude, record.longitude);
    return [record.full_name ?? 'Unknown student', record.register_number ?? '—', record.bus_number ?? '—', record.session_type ?? '—', formatCoordinate(record.latitude), formatCoordinate(record.longitude), mapUrl ?? '—', new Date(record.checked_in_at).toLocaleString('en-IN'), record.status];
  });
  setText('stat-active-buses', buses.length);
  setText('stat-coordinators', coordinators); setText('stat-today-attendance', attendance.filter((record) => record.checked_in_at >= todayStart()).length);
  busFilter.addEventListener('change', renderAssignedStudents);
  await renderAssignedStudents();
  renderRows('admin-buses-list', buses.map((bus) => makeRow([bus.bus_number, bus.route, `${bus.radius_meters} m`])), 3, 'No bus records found.');
  renderRows('admin-attendance-list', attendanceRows.map((row) => makeRow([...row.slice(0, 6), mapLink(row[6]), ...row.slice(7)])), 9, 'No attendance has been recorded yet.');

  document.getElementById('btn-export-csv').addEventListener('click', () => downloadAttendanceSheet(attendanceRows));
  document.getElementById('btn-generate-qr').addEventListener('click', async () => {
    const busNumber = document.getElementById('input-bus-number').value.trim();
    const bus = buses.find((item) => String(item.bus_number) === busNumber);
    if (!bus) return showToast('Enter an active bus number from the Bus service list.', 'danger');
    const { data, error } = await supabase.functions.invoke('attendance-api', { body: { action: 'create-session', busId: bus.id, busNumber: bus.bus_number, sessionType: document.getElementById('select-session').value, emailQr: document.getElementById('input-email-qr').checked } });
    if (error || !data?.token || !data?.expiresAt) return showToast('QR session could not be created.', 'danger');
    const display = document.getElementById('qr-code-display'); display.replaceChildren();
    new window.QRCode(display, { text: `${location.origin}/checkin?token=${encodeURIComponent(data.token)}`, width: 220, height: 220 });
    document.getElementById('qr-url-text').textContent = `Bus ${bus.bus_number} • Expires ${new Date(data.expiresAt).toLocaleTimeString('en-IN')}`;
    showToast(data.emailSent === false ? 'QR created, but Gmail delivery could not be completed.' : 'Secure QR session created and emailed.', data.emailSent === false ? 'warning' : 'success');
  });
}
