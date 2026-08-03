import { supabase } from '../supabase/client.js';
import { renderNavbar } from '../components/navbar.js';
import { showToast } from '../components/toast.js';
import { rememberProtectedRedirect } from './auth.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character]));
const initialFromName = (value) => String(value || 'K').trim().charAt(0).toUpperCase() || 'K';

export async function initStudentDashboard() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { rememberProtectedRedirect(); window.location.replace('/'); return; }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { rememberProtectedRedirect(); window.location.replace('/'); return; }
  const { data: roleProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (roleProfile?.role === 'admin') return location.replace('/dashboard');
  if (roleProfile?.role === 'coordinator') return location.replace('/coordinator');
  renderNavbar(user, 'Student');
  document.body.classList.add('role-authorized');
  const { data: profile, error: profileError } = await supabase.from('profiles').select('full_name, register_number, status, buses(bus_number)').eq('id', user.id).single();
  if (profileError) { showToast('Your student profile is still being created. Refresh in a moment.', 'warning'); return; }
  const studentName = profile.full_name || user.user_metadata?.full_name || 'Karunya Student';
  document.getElementById('student-profile').innerHTML = `<div class="student-profile-card"><div class="student-avatar" aria-label="${escapeHtml(studentName)} profile photo">${escapeHtml(initialFromName(studentName))}</div><div class="student-profile-details"><p class="student-eyebrow">Student profile</p><h1>${escapeHtml(studentName)}</h1><p class="student-email">${escapeHtml(user.email)}</p><div class="student-meta"><span class="student-pill">Reg no. ${escapeHtml(profile.register_number)}</span><span class="student-pill bus">Bus ${escapeHtml(profile.buses?.bus_number || 'Pending')}</span><span class="student-pill active">${escapeHtml(profile.status)}</span></div></div></div>`;
  const { data: records, error: attendanceError } = await supabase.rpc('student_attendance_history');
  const history = document.getElementById('attendance-history');
  if (attendanceError) { history.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-3">Attendance history could not be loaded.</td></tr>'; return; }
  history.innerHTML = records?.length ? records.map((record) => `<tr><td class="font-monospace">${escapeHtml(new Date(record.checked_in_at).toLocaleString('en-IN'))}</td><td>${escapeHtml(record.session_type)}</td><td class="fw-semibold text-info">${escapeHtml(record.bus_number)}</td><td><small class="text-white-50">Verified</small></td><td><span class="badge-status badge-present">${escapeHtml(record.status)}</span></td></tr>`).join('') : '<tr><td colspan="5" class="text-center text-white-50 py-3">No attendance has been recorded yet.</td></tr>';
}
