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
  const { data: roleProfile, error: roleError } = await supabase.rpc('current_app_profile').single();
  if (roleError || !roleProfile?.role) { showToast('Your profile role could not be verified. Sign out and sign in again.', 'danger'); return; }
  if (roleProfile.role === 'admin') return location.replace('/admin');
  if (roleProfile.role === 'coordinator') return location.replace('/coordinator');
  renderNavbar(user, 'Student');
  document.body.classList.add('role-authorized');
  const { data: profile } = await supabase.from('profiles').select('full_name, register_number, status, bus_id').eq('id', user.id).maybeSingle();
  const displayName = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Karunya Student';
  const regNumber = profile?.register_number || user.user_metadata?.register_number || 'Pending';
  const busNum = roleProfile?.bus_number ? `Bus ${roleProfile.bus_number}` : 'Pending Assignment';
  const statusStr = profile?.status || roleProfile?.status || 'active';

  const profileEl = document.getElementById('student-profile');
  if (profileEl) {
    profileEl.innerHTML = `<div class="student-profile-card"><div class="student-avatar" aria-label="${escapeHtml(displayName)} profile photo">${escapeHtml(initialFromName(displayName))}</div><div class="student-profile-details"><p class="student-eyebrow">Student profile</p><h1>${escapeHtml(displayName)}</h1><p class="student-email">${escapeHtml(user.email)}</p><div class="student-meta"><span class="student-pill">Reg no. ${escapeHtml(regNumber)}</span><span class="student-pill bus">${escapeHtml(busNum)}</span><span class="student-pill active">${escapeHtml(statusStr)}</span></div></div></div>`;
  }

  const history = document.getElementById('attendance-history');
  try {
    const { data: records, error: attendanceError } = await supabase.rpc('student_attendance_history');
    if (attendanceError || !history) {
      if (history) history.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No attendance has been recorded yet.</td></tr>';
    } else {
      history.innerHTML = records?.length ? records.map((record) => `<tr><td class="font-monospace">${escapeHtml(new Date(record.checked_in_at).toLocaleString('en-IN'))}</td><td>${escapeHtml(record.session_type)}</td><td class="fw-semibold text-info">Bus ${escapeHtml(record.bus_number)}</td><td><small class="text-white-50">Verified</small></td><td><span class="badge-status badge-present">${escapeHtml(record.status)}</span></td></tr>`).join('') : '<tr><td colspan="5" class="text-center text-muted py-3">No attendance has been recorded yet.</td></tr>';
    }
  } catch (err) {
    if (history) history.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No attendance has been recorded yet.</td></tr>';
  }

  let btn = document.getElementById('btn-back-to-top');
  if (btn) {
    const checkScroll = () => {
      if (window.scrollY > 200 || document.documentElement.scrollTop > 200) {
        btn.classList.add('show');
      } else {
        btn.classList.remove('show');
      }
    };
    window.addEventListener('scroll', checkScroll, { passive: true });
    checkScroll();
    btn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
