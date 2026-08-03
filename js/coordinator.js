import { supabase } from '../supabase/client.js';
import { renderNavbar } from '../components/navbar.js';
import { showToast } from '../components/toast.js';
import { rememberProtectedRedirect } from './auth.js';

const addBusOption = (select, bus) => {
  const option = document.createElement('option');
  option.value = bus.id;
  option.textContent = `Bus ${bus.bus_number} - ${bus.route}`;
  select.append(option);
};

const studentRow = (student, busNumber) => {
  const row = document.createElement('tr');
  for (const value of [student.full_name || 'Unnamed student', student.register_number || '—', student.status === 'active' ? 'Ready to check in' : student.status, busNumber, 'Assigned bus']) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
  }
  return row;
};

export async function initCoordinatorDashboard() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { rememberProtectedRedirect(); return location.replace('/'); }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { rememberProtectedRedirect(); return location.replace('/'); }
  const { data: profile, error: profileError } = await supabase.rpc('current_app_profile').single();
  if (profileError || !profile?.role) { showToast('Your profile role could not be verified. Sign out and sign in again.', 'danger'); return; }
  if (!['admin', 'coordinator'].includes(profile.role)) return location.replace('/student');
  renderNavbar(user, 'Coordinator');
  document.body.classList.add('role-authorized');

  const { data: buses, error } = await supabase.from('buses').select('id,bus_number,route');
  const select = document.getElementById('select-bus');
  select.replaceChildren();
  if (error || !buses?.length) {
    showToast('No buses are available for QR generation.', 'danger');
    return;
  }
  buses.forEach((bus) => addBusOption(select, bus));

  const { data: students, error: studentsError } = await supabase
    .from('profiles')
    .select('full_name,register_number,status')
    .eq('role', 'student')
    .eq('bus_id', profile.bus_id)
    .order('register_number');
  const list = document.getElementById('coordinator-student-list');
  list.replaceChildren();
  if (studentsError) {
    showToast('Assigned students could not be loaded.', 'danger');
    return;
  }
  if (!students?.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'text-center text-muted py-4';
    cell.textContent = 'No students are assigned to your bus.';
    row.append(cell);
    list.append(row);
  } else {
    const busNumber = profile.bus_number ? `Bus ${profile.bus_number}` : 'Assigned bus';
    list.append(...students.map((student) => studentRow(student, busNumber)));
  }
  document.getElementById('present-count').textContent = String(students?.length ?? 0);

  document.getElementById('btn-generate-qr').onclick = async () => {
    const sessionType = document.getElementById('select-session').value;
    const { data, error: invokeError } = await supabase.functions.invoke('attendance-api', {
      body: { action: 'create-session', busId: select.value, sessionType },
    });
    if (invokeError || !data?.token || !data?.expiresAt) return showToast('QR session could not be created.', 'danger');
    const checkinUrl = `${location.origin}/checkin?token=${encodeURIComponent(data.token)}`;
    const display = document.getElementById('qr-code-display');
    display.replaceChildren();
    new window.QRCode(display, { text: checkinUrl, width: 220, height: 220 });
    document.getElementById('qr-url-text').textContent = `Expires ${new Date(data.expiresAt).toLocaleTimeString('en-IN')}`;
    showToast('QR session created.', 'success');
  };
}
