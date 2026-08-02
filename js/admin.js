import { supabase } from '../supabase/client.js';
import { renderNavbar } from '../components/navbar.js';
import { showToast } from '../components/toast.js';

const setText = (id, value) => { document.getElementById(id).textContent = String(value); };
const cell = (value) => { const element = document.createElement('td'); element.textContent = String(value ?? '—'); return element; };
const makeRow = (values) => { const row = document.createElement('tr'); values.forEach((value) => row.append(cell(value))); return row; };
const todayStart = () => { const date = new Date(); date.setHours(0, 0, 0, 0); return date.toISOString(); };

const renderRows = (id, rows, columns, emptyMessage) => {
  const body = document.getElementById(id);
  body.replaceChildren(...(rows.length ? rows : [makeRow([emptyMessage])])));
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return location.replace('/');
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') return location.replace('/student');
  renderNavbar(user, 'Admin');

  const [{ data: students = [] }, { data: buses = [] }, { data: attendance = [] }, { data: coordinators = [] }] = await Promise.all([
    supabase.from('profiles').select('id,full_name,register_number,email,status,buses(bus_number)').eq('role', 'student'),
    supabase.from('buses').select('id,bus_number,route,radius_meters').order('bus_number'),
    supabase.from('attendance').select('student_id,status,checked_in_at,attendance_sessions(session_type,buses(bus_number))').order('checked_in_at', { ascending: false }).limit(200),
    supabase.from('profiles').select('id').in('role', ['admin', 'coordinator']),
  ]);
  const studentById = new Map(students.map((student) => [student.id, student]));
  const attendanceRows = attendance.map((record) => {
    const student = studentById.get(record.student_id);
    return [student?.full_name ?? 'Unknown student', student?.register_number ?? '—', record.attendance_sessions?.buses?.bus_number ?? '—', record.attendance_sessions?.session_type ?? '—', new Date(record.checked_in_at).toLocaleString('en-IN'), record.status];
  });
  setText('stat-total-students', students.length); setText('stat-active-buses', buses.length);
  setText('stat-coordinators', coordinators.length); setText('stat-today-attendance', attendance.filter((record) => record.checked_in_at >= todayStart()).length);
  renderRows('admin-students-list', students.map((student) => makeRow([student.register_number, student.full_name, student.email, student.buses?.bus_number ?? 'Unassigned', student.status])), 5, 'No student records found.');
  renderRows('admin-buses-list', buses.map((bus) => makeRow([bus.bus_number, bus.route, `${bus.radius_meters} m`])), 3, 'No bus records found.');
  renderRows('admin-attendance-list', attendanceRows.map(makeRow), 6, 'No attendance has been recorded yet.');

  const select = document.getElementById('select-bus');
  buses.forEach((bus) => { const option = document.createElement('option'); option.value = bus.id; option.textContent = `Bus ${bus.bus_number} — ${bus.route}`; select.append(option); });
  document.getElementById('btn-export-csv').addEventListener('click', () => downloadAttendanceSheet(attendanceRows));
  document.getElementById('btn-generate-qr').addEventListener('click', async () => {
    const { data, error } = await supabase.functions.invoke('attendance-api', { body: { action: 'create-session', busId: select.value, sessionType: document.getElementById('select-session').value } });
    if (error || !data?.token || !data?.expiresAt) return showToast('QR session could not be created.', 'danger');
    const display = document.getElementById('qr-code-display'); display.replaceChildren();
    new window.QRCode(display, { text: `${location.origin}/checkin?token=${encodeURIComponent(data.token)}`, width: 220, height: 220 });
    document.getElementById('qr-url-text').textContent = `Expires ${new Date(data.expiresAt).toLocaleTimeString('en-IN')}`;
    showToast('Secure QR session created.', 'success');
  });
}
