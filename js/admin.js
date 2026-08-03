import { supabase } from '../supabase/client.js';
import { renderNavbar } from '../components/navbar.js';
import { showToast } from '../components/toast.js';
import { rememberProtectedRedirect } from './auth.js';
import { loadAttendanceDetails } from './attendance-details.js';

const setText = (id, value) => { document.getElementById(id).textContent = String(value); };
const cell = (value) => { const element = document.createElement('td'); element.textContent = String(value ?? '—'); return element; };
const makeRow = (values) => { const row = document.createElement('tr'); values.forEach((value) => row.append(cell(value))); return row; };
const todayStart = () => { const date = new Date(); date.setHours(0, 0, 0, 0); return date.toISOString(); };

const renderRows = (id, rows, columns, emptyMessage) => {
  const body = document.getElementById(id);
  const visibleRows = rows.length ? rows : [makeRow([emptyMessage])];
  body.replaceChildren(...visibleRows);
  if (!rows.length) body.firstElementChild.firstElementChild.colSpan = columns;
};

const downloadAttendanceSheet = (records) => {
  const header = ['Student', 'Register number', 'Bus number', 'Session', 'Checked in', 'Status'];
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
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') return location.replace('/student');
  renderNavbar(user, 'Admin');
  document.body.classList.add('role-authorized');

  const [studentsResult, busesResult, attendanceResult, coordinatorsResult] = await Promise.all([
    supabase.from('profiles').select('id,full_name,register_number,email,status,buses(bus_number)').eq('role', 'student'),
    supabase.from('buses').select('id,bus_number,route,radius_meters').order('bus_number'),
    supabase.from('attendance').select('student_id,session_id,status,checked_in_at').order('checked_in_at', { ascending: false }).limit(200),
    supabase.from('profiles').select('id').in('role', ['admin', 'coordinator']),
  ]);
  const students = studentsResult.data ?? [];
  const buses = busesResult.data ?? [];
  const attendance = attendanceResult.data ?? [];
  const coordinators = coordinatorsResult.data ?? [];
  const dashboardError = [studentsResult.error, busesResult.error, attendanceResult.error, coordinatorsResult.error].find(Boolean);
  if (dashboardError) showToast('Some dashboard records could not be loaded. Refresh and try again.', 'danger');
  const { records: attendanceWithDetails, error: detailsError } = await loadAttendanceDetails(attendance);
  if (detailsError) showToast('Attendance session details could not be loaded. Refresh and try again.', 'danger');
  const studentById = new Map(students.map((student) => [student.id, student]));
  const attendanceRows = attendanceWithDetails.map((record) => {
    const student = studentById.get(record.student_id);
    return [student?.full_name ?? 'Unknown student', student?.register_number ?? '—', record.bus?.bus_number ?? '—', record.session?.session_type ?? '—', new Date(record.checked_in_at).toLocaleString('en-IN'), record.status];
  });
  setText('stat-total-students', students.length); setText('stat-active-buses', buses.length);
  setText('stat-coordinators', coordinators.length); setText('stat-today-attendance', attendanceWithDetails.filter((record) => record.checked_in_at >= todayStart()).length);
  renderRows('admin-students-list', students.map((student) => makeRow([student.register_number, student.full_name, student.email, student.buses?.bus_number ?? 'Unassigned', student.status])), 5, 'No student records found.');
  renderRows('admin-buses-list', buses.map((bus) => makeRow([bus.bus_number, bus.route, `${bus.radius_meters} m`])), 3, 'No bus records found.');
  renderRows('admin-attendance-list', attendanceRows.map(makeRow), 6, 'No attendance has been recorded yet.');

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
