import { createClient } from 'npm:@supabase/supabase-js@2';
import QRCode from 'npm:qrcode@1.5.4';

const ALLOWED_ORIGINS = new Set([
  'https://karunya-bus-attendance.vercel.app',
  'https://karunya-bus-attendance-ashlinmirshas-projects.vercel.app',
  'https://karunya-bus-attendance-ashlinmirsha-ashlinmirshas-projects.vercel.app',
]);
const PRIMARY_APP_ORIGIN = 'https://karunya-bus-attendance.vercel.app';
const SESSION_DURATION_MS = 5 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QR_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;
const SESSION_TYPES = new Set(['Morning', 'Evening', 'Special']);
const QR_IMAGE_CID = 'manual-attendance-qr';
const MAX_REQUEST_BODY_BYTES = 4_096;
const EMAIL_PATTERN = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i;
const ADMIN_ONLY_ACTIONS = new Set(['move-student', 'add-coordinator', 'remove-coordinator', 'add-bus']);
const STAFF_ACTIONS = new Set(['add-student', 'remove-student', ...ADMIN_ONLY_ACTIONS]);
const isValidEmail = (v: unknown): v is string => typeof v === 'string' && EMAIL_PATTERN.test(v) && v.length <= 254;
const isValidName  = (v: unknown): v is string => typeof v === 'string' && v.trim().length >= 1 && v.length <= 100;
const isValidRegNo = (v: unknown): v is string => typeof v === 'string' && /^[A-Z0-9]+$/i.test(v.trim()) && v.trim().length <= 30;
const corsHeadersFor = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && (ALLOWED_ORIGINS.has(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:') || origin.endsWith('.vercel.app')) ? origin : ALLOWED_ORIGINS.values().next().value,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  Vary: 'Origin',
});

const response = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeadersFor(request.headers.get('Origin')) });
const isAllowedOrigin = (request: Request) => {
  const origin = request.headers.get('Origin') ?? '';
  return ALLOWED_ORIGINS.has(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:') || origin.endsWith('.vercel.app');
};
const hasValidJsonBody = (request: Request) => {
  const length = Number(request.headers.get('content-length') ?? '0');
  return request.headers.get('content-type')?.includes('application/json') === true && (!Number.isFinite(length) || length <= MAX_REQUEST_BODY_BYTES);
};
const withinCoordinateBounds = (latitude: unknown, longitude: unknown) => Number.isFinite(latitude) && Number.isFinite(longitude)
  && Math.abs(latitude as number) <= 90 && Math.abs(longitude as number) <= 180;
const hashToken = async (token: string, secret: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}:${token}`))))
  .map((item) => item.toString(16).padStart(2, '0')).join('');
const base64Url = (value: string) => btoa(unescape(encodeURIComponent(value))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

const sendManualQrEmail = async (recipient: string, busNumber: string, sessionType: string, token: string) => {
  const [clientId, clientSecret, refreshToken] = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'].map((name) => Deno.env.get(name) ?? '');
  if (!clientId || !clientSecret || !refreshToken) return false;
  const refresh = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }) });
  const credentials = await refresh.json().catch(() => null);
  if (!refresh.ok || !credentials?.access_token) return false;
  const checkinUrl = `${PRIMARY_APP_ORIGIN}/checkin?token=${token}`;
  const qrDataUrl = await QRCode.toDataURL(checkinUrl, { errorCorrectionLevel: 'M', margin: 2, width: 640 });
  const encodedPng = qrDataUrl.split(',', 2)[1];
  if (!encodedPng) return false;
  const boundary = `manual-qr-${crypto.randomUUID()}`;
  const wrappedPng = encodedPng.replace(/(.{76})/g, '$1\r\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f7fa;color:#102a43;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d9e2ec;border-radius:16px"><tr><td style="padding:32px"><p style="margin:0 0 12px;color:#486581;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Karunya bus attendance</p><h1 style="margin:0 0 16px;font-size:24px">Bus ${busNumber} ${sessionType} QR</h1><p style="margin:0 0 24px;line-height:1.5">Scan this QR code to open the secure attendance check-in.</p><p style="margin:0 0 24px;text-align:center"><img src="cid:${QR_IMAGE_CID}" alt="Attendance QR code" width="320" height="320" style="display:inline-block;max-width:100%;height:auto;border:0"></p><p style="margin:0 0 12px;line-height:1.5">If the image does not appear, use this secure link:</p><p style="margin:0 0 24px"><a href="${checkinUrl}" style="display:inline-block;padding:12px 18px;background:#1769aa;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold">Open attendance check-in</a></p><p style="margin:0;color:#627d98;font-size:13px">This code expires in five hours.</p></td></tr></table></td></tr></table></body></html>`;
  const raw = [`To: ${recipient}`, `From: ${Deno.env.get('GMAIL_FROM_EMAIL') ?? recipient}`, `Subject: Bus ${busNumber} ${sessionType} Attendance QR`, 'MIME-Version: 1.0', `Content-Type: multipart/related; boundary="${boundary}"`, '', `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', '', html, `--${boundary}`, 'Content-Type: image/png; name="attendance-qr.png"', 'Content-Transfer-Encoding: base64', `Content-ID: <${QR_IMAGE_CID}>`, 'Content-Disposition: inline; filename="attendance-qr.png"', '', wrappedPng, `--${boundary}--`].join('\r\n');
  const sent = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${credentials.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: base64Url(raw) }) });
  return sent.ok;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return isAllowedOrigin(request) ? new Response('ok', { headers: corsHeadersFor(request.headers.get('Origin')) }) : response(request, { message: 'Forbidden origin.' }, 403);
  if (request.method !== 'POST') return response(request, { message: 'Method not allowed.' }, 405);
  if (!isAllowedOrigin(request)) return response(request, { message: 'Forbidden origin.' }, 403);
  if (!hasValidJsonBody(request)) return response(request, { message: 'Invalid request format.' }, 415);
  const authorization = request.headers.get('Authorization');
  const qrSecret = Deno.env.get('QR_SECRET');
  if (!authorization || !qrSecret) return response(request, { message: 'Unauthorized request.' }, 401);

  try {
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await userClient.auth.getUser();
    const normalizedEmail = user?.email?.toLowerCase() ?? '';
    const allowedFacultyCoordinators = new Set(['manickraja@karunya.edu', 'manickaraja@karunya.edu', 'karthikr@karunya.edu', 'titusi@karunya.edu']);
    if (!normalizedEmail.endsWith('@karunya.edu.in') && !allowedFacultyCoordinators.has(normalizedEmail)) {
      return response(request, { message: 'Only official Karunya accounts are authorized.' }, 403);
    }
    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: profile } = await adminClient.from('profiles').select('*').eq('id', user.id).single();
    if (!profile) return response(request, { message: 'Profile is not ready. Please sign in again.' }, 409);
    if (normalizedEmail.endsWith('@karunya.edu') && profile.role !== 'coordinator') {
      return response(request, { message: 'Only assigned coordinators may use @karunya.edu accounts.' }, 403);
    }
    const body = await request.json().catch(() => null);
    const action = (body as { action?: string })?.action ?? '';
    if (!body || typeof body !== 'object' || !['create-session', 'mark-attendance', 'update-coordinator-location', 'manual-override-attendance', ...STAFF_ACTIONS].includes(action)) return response(request, { message: 'Invalid request.' }, 400);

    // ── Admin-only actions ────────────────────────────────────────────────────
    if (ADMIN_ONLY_ACTIONS.has(action) && profile.role !== 'admin') {
      await adminClient.from('security_audit_events').insert({ actor_id: user.id, action, outcome: 'denied' });
      return response(request, { message: 'Admin access required.' }, 403);
    }

    if (action === 'add-student') {
      if (profile.role !== 'admin' && profile.role !== 'coordinator') {
        await adminClient.from('security_audit_events').insert({ actor_id: user.id, action, outcome: 'denied' });
        return response(request, { message: 'Admin or Coordinator access required.' }, 403);
      }
      const { email, fullName, registerNumber, busId } = body as Record<string, unknown>;
      if (!isValidEmail(email) || !email.toLowerCase().endsWith('@karunya.edu.in')) return response(request, { message: 'A valid @karunya.edu.in email is required.' }, 400);
      if (!isValidName(fullName)) return response(request, { message: 'Full name must be 1–100 characters.' }, 400);
      if (!isValidRegNo(registerNumber)) return response(request, { message: 'Register number must be alphanumeric, max 30 chars.' }, 400);
      if (!UUID_PATTERN.test(String(busId ?? ''))) return response(request, { message: 'A valid bus ID is required.' }, 400);

      if (profile.role === 'coordinator' && profile.bus_id !== busId) {
        return response(request, { message: 'Coordinators can only add students to their assigned bus.' }, 403);
      }

      const { data: busCheck } = await adminClient.from('buses').select('id').eq('id', busId).maybeSingle();
      if (!busCheck) return response(request, { message: 'Bus not found.' }, 404);
      const { error: upsertErr } = await adminClient.from('pending_student_assignments').upsert(
        { email: email.toLowerCase(), full_name: (fullName as string).trim(), register_number: (registerNumber as string).trim().toUpperCase(), bus_id: busId, status: 'active' },
        { onConflict: 'email' }
      );
      if (upsertErr) return response(request, { message: 'Could not add student.' }, 500);
      // Also update existing profile if already signed in
      await adminClient.from('profiles').update({ bus_id: busId, full_name: (fullName as string).trim(), register_number: (registerNumber as string).trim().toUpperCase(), status: 'active' }).eq('email', email.toLowerCase());
      await adminClient.from('security_audit_events').insert({ actor_id: user.id, action, outcome: 'allowed' });
      return response(request, { message: 'Student added successfully.' });
    }

    if (action === 'move-student') {
      const { studentEmail, newBusId } = body as Record<string, unknown>;
      if (!isValidEmail(studentEmail)) return response(request, { message: 'A valid student email is required.' }, 400);
      if (!UUID_PATTERN.test(String(newBusId ?? ''))) return response(request, { message: 'A valid target bus ID is required.' }, 400);
      const { data: busCheck } = await adminClient.from('buses').select('id').eq('id', newBusId).maybeSingle();
      if (!busCheck) return response(request, { message: 'Target bus not found.' }, 404);
      const emailLower = (studentEmail as string).toLowerCase();
      const { count } = await adminClient.from('profiles').select('id', { count: 'exact', head: true }).eq('email', emailLower).eq('role', 'student');
      const { count: pendingCount } = await adminClient.from('pending_student_assignments').select('email', { count: 'exact', head: true }).eq('email', emailLower);
      if (!count && !pendingCount) return response(request, { message: 'Student not found.' }, 404);
      await adminClient.from('profiles').update({ bus_id: newBusId, status: 'active' }).eq('email', emailLower).eq('role', 'student');
      await adminClient.from('pending_student_assignments').update({ bus_id: newBusId }).eq('email', emailLower);
      await adminClient.from('security_audit_events').insert({ actor_id: user.id, action, outcome: 'allowed' });
      return response(request, { message: 'Student moved to new bus successfully.' });
    }

    if (action === 'remove-student') {
      if (profile.role !== 'admin' && profile.role !== 'coordinator') {
        await adminClient.from('security_audit_events').insert({ actor_id: user.id, action, outcome: 'denied' });
        return response(request, { message: 'Admin or Coordinator access required.' }, 403);
      }
      const { studentEmail } = body as Record<string, unknown>;
      if (!isValidEmail(studentEmail)) return response(request, { message: 'A valid student email is required.' }, 400);
      const emailLower = (studentEmail as string).toLowerCase();

      if (profile.role === 'coordinator') {
        const { data: studentProfile } = await adminClient.from('profiles').select('bus_id').eq('email', emailLower).maybeSingle();
        const { data: pendingAssignment } = await adminClient.from('pending_student_assignments').select('bus_id').eq('email', emailLower).maybeSingle();
        const studentBusId = studentProfile?.bus_id || pendingAssignment?.bus_id;
        if (studentBusId && studentBusId !== profile.bus_id) {
          return response(request, { message: 'Coordinators can only remove students from their assigned bus.' }, 403);
        }
      }

      await adminClient.from('profiles').update({ status: 'inactive', bus_id: null }).eq('email', emailLower).eq('role', 'student');
      await adminClient.from('pending_student_assignments').delete().eq('email', emailLower);
      await adminClient.from('security_audit_events').insert({ actor_id: user.id, action, outcome: 'allowed' });
      return response(request, { message: 'Student removed from bus.' });
    }

    if (action === 'add-coordinator') {
      const { email, fullName, busId } = body as Record<string, unknown>;
      if (!isValidEmail(email)) return response(request, { message: 'A valid email is required.' }, 400);
      if (!isValidName(fullName)) return response(request, { message: 'Full name must be 1–100 characters.' }, 400);
      if (!UUID_PATTERN.test(String(busId ?? ''))) return response(request, { message: 'A valid bus ID is required.' }, 400);
      const { data: busCheck } = await adminClient.from('buses').select('id').eq('id', busId).maybeSingle();
      if (!busCheck) return response(request, { message: 'Bus not found.' }, 404);
      // Update existing profile to coordinator, or will be applied on first sign-in via trigger
      const { error: updateErr } = await adminClient.from('profiles')
        .update({ role: 'coordinator', bus_id: busId, full_name: (fullName as string).trim(), status: 'active' })
        .eq('email', (email as string).toLowerCase());
      await adminClient.from('security_audit_events').insert({ actor_id: user.id, action, outcome: 'allowed' });
      return response(request, { message: 'Coordinator updated. If not yet signed in, they will be assigned automatically on first login.' });
    }

    if (action === 'remove-coordinator') {
      const { email } = body as Record<string, unknown>;
      if (!isValidEmail(email)) return response(request, { message: 'A valid email is required.' }, 400);
      const { error: updateErr } = await adminClient.from('profiles')
        .update({ role: 'student', bus_id: null })
        .eq('email', (email as string).toLowerCase())
        .eq('role', 'coordinator');
      await adminClient.from('security_audit_events').insert({ actor_id: user.id, action, outcome: 'allowed' });
      return response(request, { message: 'Coordinator removed and unassigned.' });
    }

    if (action === 'add-bus') {
      const { busNumber, routeName, capacity } = body as Record<string, unknown>;
      const num = parseInt(String(busNumber), 10);
      if (isNaN(num) || num < 1 || num > 999) return response(request, { message: 'Bus number must be between 1 and 999.' }, 400);
      const route = String(routeName || '').trim();
      if (!route) return response(request, { message: 'Route description is required.' }, 400);
      const cap = parseInt(String(capacity || 60), 10);

      const { data: existing } = await adminClient.from('buses').select('id').eq('bus_number', num).maybeSingle();
      if (existing) return response(request, { message: `Bus ${num} already exists.` }, 400);

      const { data: newBus, error: insertErr } = await adminClient.from('buses').insert({
        bus_number: num,
        route: route,
        capacity: cap
      }).select().single();

      if (insertErr) return response(request, { message: insertErr.message || 'Could not create bus.' }, 400);
      await adminClient.from('security_audit_events').insert({ actor_id: user.id, action, outcome: 'allowed' });
      return response(request, { message: `Bus ${num} added successfully!` });
    }
    
    if (action === 'create-session' || action === 'mark-attendance') {
      const { data: limit, error: limitError } = await adminClient.rpc('consume_attendance_rate_limit', { p_actor_id: user.id, p_action: action }).single();
      if (limitError || !limit?.allowed) {
        await adminClient.from('security_audit_events').insert({ actor_id: user.id, action, outcome: 'rate_limited' });
        return response(request, { message: `Too many requests. Try again in ${Math.max(1, limit?.retry_after_seconds ?? 600)} seconds.` }, 429);
      }
    }

    if (action === 'create-session') {
      if (profile.role !== 'coordinator') return response(request, { message: 'Not authorized.' }, 403);
      const b = body as Record<string, unknown>;
      if (!UUID_PATTERN.test(String(b.busId ?? '')) || !SESSION_TYPES.has(String(b.sessionType ?? ''))) return response(request, { message: 'Invalid session request.' }, 400);
      const { data: bus } = await adminClient.from('buses').select('id,bus_number').eq('id', b.busId).single();
      if (!bus || profile.bus_id !== bus.id) return response(request, { message: 'Bus is not assigned to you.' }, 403);
      const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
      const { data: session, error } = await adminClient.from('attendance_sessions').insert({
        bus_id: bus.id, session_type: b.sessionType, token_hash: await hashToken(token, qrSecret), expires_at: expiresAt, created_by: user.id,
      }).select('id').single();
      if (error || !session) return response(request, { message: 'Could not create QR session.' }, 500);
      const emailSent = b.emailQr === true
        ? await sendManualQrEmail(profile.email, String(bus.bus_number), String(b.sessionType), token).catch(() => false)
        : true;
      await adminClient.from('security_audit_events').insert({ actor_id: user.id, action, outcome: 'allowed' });
      return response(request, { token, sessionId: session.id, expiresAt, emailSent });
    }

    if (action === 'update-coordinator-location') {
      if (profile.role !== 'coordinator') return response(request, { message: 'Not authorized.' }, 403);
      const { busId, latitude, longitude } = body as Record<string, unknown>;
      if (typeof busId !== 'string' || !UUID_PATTERN.test(busId) || !withinCoordinateBounds(latitude, longitude)) {
        return response(request, { message: 'A valid bus ID and GPS location are required.' }, 400);
      }
      if (profile.bus_id !== busId) return response(request, { message: 'Bus is not assigned to you.' }, 403);
      const { error: updateError } = await adminClient.from('buses').update({ latitude, longitude }).eq('id', busId);
      if (updateError) {
        console.error('Failed to update coordinator location:', updateError);
        return response(request, { message: 'Could not update live position.' }, 500);
      }
      return response(request, { success: true });
    }

    if (action === 'manual-override-attendance') {
      if (profile.role !== 'coordinator' && profile.role !== 'admin') {
        return response(request, { message: 'Coordinator or Admin authorization required.' }, 403);
      }
      const b = body as Record<string, unknown>;
      const studentEmail = (b.studentEmail as string)?.toLowerCase()?.trim() ?? '';
      const regNo = ((b.registerNumber || b.register_number || '') as string).trim().toUpperCase();
      const status = String(b.status ?? '').toUpperCase();
      let sessionType = String(b.sessionType ?? 'Morning').trim();
      if (sessionType) sessionType = sessionType.charAt(0).toUpperCase() + sessionType.slice(1).toLowerCase();
      const remark = String(b.remark ?? '').trim();

      if (!studentEmail && !regNo) return response(request, { message: 'Student email or register number is required.' }, 400);
      if (status !== 'PRESENT' && status !== 'ABSENT') return response(request, { message: 'Status must be PRESENT or ABSENT.' }, 400);
      if (remark.length < 3 || remark.length > 250) {
        return response(request, { message: 'A reason/comment (3–250 characters) is required for manual override.' }, 400);
      }
      if (!['Morning', 'Evening', 'Special'].includes(sessionType)) {
        return response(request, { message: 'Session type must be Morning, Evening, or Special.' }, 400);
      }

      let targetStudent: any = null;
      if (regNo) {
        const { data } = await adminClient.from('profiles').select('id, bus_id, role, full_name, email, register_number').ilike('register_number', regNo).maybeSingle();
        targetStudent = data;
      }
      if (!targetStudent && studentEmail && !studentEmail.includes('@')) {
        const { data } = await adminClient.from('profiles').select('id, bus_id, role, full_name, email, register_number').ilike('register_number', studentEmail.toUpperCase()).maybeSingle();
        targetStudent = data;
      }
      if (!targetStudent && studentEmail && studentEmail.includes('@')) {
        const { data } = await adminClient.from('profiles').select('id, bus_id, role, full_name, email, register_number').ilike('email', studentEmail).maybeSingle();
        targetStudent = data;
      }

      // Check if student exists in pending assignments if not yet in profiles
      if (!targetStudent) {
        const { data: pendingStudent } = await adminClient.from('pending_student_assignments')
          .select('email, full_name, register_number, bus_id')
          .or(`register_number.ilike.${regNo || 'NONE'},email.ilike.${studentEmail || 'NONE'}`)
          .maybeSingle();

        if (pendingStudent) {
          return response(request, { message: `Student (${pendingStudent.full_name || pendingStudent.email}) has been assigned to Bus, but has not logged into the portal with Google yet. Attendance will record automatically after their first login.` }, 422);
        }
        return response(request, { message: 'Student profile not found.' }, 404);
      }

      // Sync bus_id from pending assignments if profile bus_id is null
      if (!targetStudent.bus_id) {
        const { data: pending } = await adminClient.from('pending_student_assignments').select('bus_id').ilike('email', targetStudent.email).maybeSingle();
        if (pending?.bus_id) {
          await adminClient.from('profiles').update({ bus_id: pending.bus_id, status: 'active' }).eq('id', targetStudent.id);
          targetStudent.bus_id = pending.bus_id;
        }
      }

      if (!targetStudent.bus_id) {
        return response(request, { message: 'Student is not assigned to any bus.' }, 400);
      }
      if (profile.role === 'coordinator' && targetStudent.bus_id !== profile.bus_id) {
        return response(request, { message: 'Student is not assigned to your bus.' }, 403);
      }

      let startOfDay: Date;
      let endOfDay: Date;
      const targetDateStr = String(b.overrideDate || b.sessionDate || '').trim();

      if (/^\d{4}-\d{2}-\d{2}$/.test(targetDateStr)) {
        startOfDay = new Date(`${targetDateStr}T00:00:00+05:30`);
        endOfDay = new Date(`${targetDateStr}T23:59:59.999+05:30`);
      } else {
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istTime = new Date(now.getTime() + istOffset);
        istTime.setUTCHours(0, 0, 0, 0);
        startOfDay = new Date(istTime.getTime() - istOffset);
        endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);
      }

      let { data: session } = await adminClient
        .from('attendance_sessions')
        .select('id')
        .eq('bus_id', targetStudent.bus_id)
        .eq('session_type', sessionType)
        .gte('created_at', startOfDay.toISOString())
        .lte('created_at', endOfDay.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!session && /^\d{4}-\d{2}-\d{2}$/.test(targetDateStr)) {
        const { data: allBusSessions } = await adminClient
          .from('attendance_sessions')
          .select('id, created_at')
          .eq('bus_id', targetStudent.bus_id)
          .eq('session_type', sessionType);

        if (allBusSessions?.length) {
          const matched = allBusSessions.find(s => {
            const d = new Date(s.created_at);
            const istDate = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
            return istDate.toISOString().slice(0, 10) === targetDateStr;
          });
          if (matched) session = { id: matched.id };
        }
      }

      if (!session) {
        const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
        // Manual attendance override sessions have no time limit
        const expiresAt = new Date('2099-12-31T23:59:59Z').toISOString();
        const sessionCreatedAt = /^\d{4}-\d{2}-\d{2}$/.test(targetDateStr)
          ? new Date(`${targetDateStr}T12:00:00+05:30`).toISOString()
          : new Date().toISOString();
        const creatorId = profile?.id || user.id;

        const { data: newSession, error: createErr } = await adminClient.from('attendance_sessions').insert({
          bus_id: targetStudent.bus_id,
          session_type: sessionType,
          token_hash: await hashToken(token, qrSecret),
          expires_at: expiresAt,
          created_by: creatorId,
          created_at: sessionCreatedAt,
          email_status: 'sent',
        }).select('id').single();

        if (createErr || !newSession) {
          console.error('Session initialization error:', createErr);
          const { data: fallbackSession } = await adminClient
            .from('attendance_sessions')
            .select('id')
            .eq('bus_id', targetStudent.bus_id)
            .eq('session_type', sessionType)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (fallbackSession) {
            session = fallbackSession;
          } else {
            return response(request, { message: `Could not initialize attendance session: ${createErr?.message || 'Unknown database error'}` }, 500);
          }
        } else {
          session = newSession;
        }
      }

      const latVal = typeof b.latitude === 'number' ? b.latitude : parseFloat(String(b.latitude ?? ''));
      const lngVal = typeof b.longitude === 'number' ? b.longitude : parseFloat(String(b.longitude ?? ''));
      const latitude = withinCoordinateBounds(latVal, lngVal) ? latVal : 0.0;
      const longitude = withinCoordinateBounds(latVal, lngVal) ? lngVal : 0.0;

      if (status === 'PRESENT') {
        const { error: upsertErr } = await adminClient.from('attendance').upsert({
          session_id: session.id,
          student_id: targetStudent.id,
          latitude,
          longitude,
          status: 'PRESENT',
          remark: remark,
          submission: 'Manual',
        }, { onConflict: 'session_id,student_id' });
        if (upsertErr) return response(request, { message: 'Could not record manual attendance.' }, 500);
      } else {
        await adminClient.from('attendance')
          .delete()
          .eq('session_id', session.id)
          .eq('student_id', targetStudent.id);
      }

      await adminClient.from('security_audit_events').insert({
        actor_id: user.id,
        action: 'manual-override-attendance',
        outcome: 'allowed',
      });

      return response(request, { message: `Attendance for ${targetStudent.full_name || studentEmail} marked as ${status} (${sessionType}) with comment: "${remark}".` });
    }

    if (action === 'mark-attendance') {
      const b = body as Record<string, unknown>;
      const { token, latitude, longitude } = b;
      if (typeof token !== 'string' || !QR_TOKEN_PATTERN.test(token) || !withinCoordinateBounds(latitude, longitude)) return response(request, { message: 'A valid QR token and GPS location are required.' }, 400);
      if (profile.status !== 'active' || !profile.bus_id) return response(request, { message: 'Your bus assignment is not active.' }, 403);
      const { data: session } = await adminClient.from('attendance_sessions').select('*, buses(*)').eq('token_hash', await hashToken(token as string, qrSecret)).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (!session) return response(request, { message: 'Invalid or expired QR session.' }, 400);
      if (session.bus_id !== profile.bus_id) return response(request, { message: 'STUDENT BELONG TO THIS BUS INVALID SCAN YOUR BUS CODE' }, 400);

      const now = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000;
      const istTime = new Date(now.getTime() + istOffset);
      istTime.setUTCHours(0, 0, 0, 0);
      const startOfDay = new Date(istTime.getTime() - istOffset);
      const { data: existingCheckin } = await adminClient
        .from('attendance')
        .select('id, attendance_sessions!inner(session_type)')
        .eq('student_id', user.id)
        .eq('attendance_sessions.session_type', session.session_type)
        .gte('checked_in_at', startOfDay.toISOString())
        .limit(1);
      if (existingCheckin && existingCheckin.length > 0) return response(request, { message: 'ALREADY MARKED PRESENT !!!' }, 409);
      const { error } = await adminClient.from('attendance').insert({ session_id: session.id, student_id: user.id, latitude, longitude, submission: 'Self' });
      if (error?.code === '23505') return response(request, { message: 'ALREADY MARKED PRESENT !!!' }, 409);
      if (error) return response(request, { message: 'Attendance could not be recorded.' }, 500);
      await adminClient.from('security_audit_events').insert({ actor_id: user.id, action, outcome: 'allowed' });
      return response(request, { message: 'Attendance marked successfully!' });
    }
    return response(request, { message: 'Unknown action.' }, 400);
  } catch (error) {
    console.error('attendance-api failed', error instanceof Error ? error.message : 'Unknown error');
    return response(request, { message: 'Attendance request could not be processed.' }, 502);
  }
});
