import { supabase } from '../supabase/client.js';
import { renderNavbar } from '../components/navbar.js';
import { showToast } from '../components/toast.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character]));
const initialFromName = (value) => String(value || 'K').trim().charAt(0).toUpperCase() || 'K';

export async function initStudentDashboard() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { window.location.replace('/'); return; }
  renderNavbar(user, 'Student');
  const { data: profile, error: profileError } = await supabase.from('profiles').select('full_name, register_number, status, buses(bus_number)').eq('id', user.id).single();
  if (profileError) { showToast('Your student profile is still being created. Refresh in a moment.', 'warning'); return; }
  const studentName = profile.full_name || user.user_metadata?.full_name || 'Karunya Student';
  document.getElementById('student-profile').innerHTML = `<div class="student-profile-card"><div class="student-avatar" aria-label="${escapeHtml(studentName)} profile photo">${escapeHtml(initialFromName(studentName))}</div><div class="student-profile-details"><p class="student-eyebrow">Student profile</p><h1>${escapeHtml(studentName)}</h1><p class="student-email">${escapeHtml(user.email)}</p><div class="student-meta"><span class="student-pill">Reg no. ${escapeHtml(profile.register_number)}</span><span class="student-pill bus">Bus ${escapeHtml(profile.buses?.bus_number || 'Pending')}</span><span class="student-pill active">${escapeHtml(profile.status)}</span></div></div></div>`;
  const { data: records, error: attendanceError } = await supabase.from('attendance').select('status, checked_in_at, attendance_sessions(session_type, buses(bus_number))').eq('student_id', user.id).order('checked_in_at', { ascending: false }).limit(25);
  const history = document.getElementById('attendance-history');
  if (attendanceError) { history.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-3">Attendance history could not be loaded.</td></tr>'; return; }
  history.innerHTML = records?.length ? records.map((record) => `<tr><td class="font-monospace">${escapeHtml(new Date(record.checked_in_at).toLocaleString('en-IN'))}</td><td>${escapeHtml(record.attendance_sessions?.session_type)}</td><td class="fw-semibold text-info">${escapeHtml(record.attendance_sessions?.buses?.bus_number)}</td><td><small class="text-white-50">Verified</small></td><td><span class="badge-status badge-present">${escapeHtml(record.status)}</span></td></tr>`).join('') : '<tr><td colspan="5" class="text-center text-white-50 py-3">No attendance has been recorded yet.</td></tr>';
}
