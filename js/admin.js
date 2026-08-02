import { supabase } from '../supabase/client.js';
import { renderNavbar } from '../components/navbar.js';

const setText = (id, value) => { document.getElementById(id).textContent = String(value); };
const cell = (value) => { const element = document.createElement('td'); element.textContent = value ?? ''; return element; };

const renderStudents = (students) => {
  const body = document.getElementById('admin-students-list');
  body.replaceChildren(...students.map((student) => {
    const row = document.createElement('tr');
    [student.register_number, student.full_name, student.email, student.bus_id ?? 'Pending', student.status, 'Supabase'].forEach((value) => row.append(cell(value)));
    return row;
  }));
};

const renderBuses = (buses) => {
  const body = document.getElementById('admin-buses-list');
  body.replaceChildren(...buses.map((bus) => {
    const row = document.createElement('tr');
    [bus.bus_number, bus.route, '—', `${bus.latitude}, ${bus.longitude}`, `${bus.radius_meters}m`, 'Supabase'].forEach((value) => row.append(cell(value)));
    return row;
  }));
};

export async function initAdminDashboard() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return location.replace('/');
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') return location.replace('/student');
  renderNavbar(user, 'Admin');
  const [{ data: students }, { data: buses }, { data: attendance }, { data: coordinators }] = await Promise.all([
    supabase.from('profiles').select('*').eq('role', 'student'), supabase.from('buses').select('*'),
    supabase.from('attendance').select('id'), supabase.from('profiles').select('id').in('role', ['admin', 'coordinator']),
  ]);
  setText('stat-total-students', students?.length ?? 0); setText('stat-active-buses', buses?.length ?? 0);
  setText('stat-coordinators', coordinators?.length ?? 0); setText('stat-today-attendance', attendance?.length ?? 0);
  renderStudents(students ?? []); renderBuses(buses ?? []);
}
