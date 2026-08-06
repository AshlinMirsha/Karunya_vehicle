import { createClient } from 'npm:@supabase/supabase-js@2';
import QRCode from 'npm:qrcode@1.5.4';

const ALLOWED_ORIGINS = new Set([
  'https://karunya-bus-attendance.vercel.app',
  'https://karunya-bus-attendance-ashlinmirshas-projects.vercel.app',
  'https://karunya-bus-attendance-ashlinmirsha-ashlinmirshas-projects.vercel.app',
]);
const PRIMARY_APP_ORIGIN = 'https://karunya-bus-attendance.vercel.app';
const EARTH_RADIUS_METERS = 6_371_000;
const SESSION_DURATION_MS = 5 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QR_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;
const SESSION_TYPES = new Set(['Morning', 'Evening', 'Special']);
const QR_IMAGE_CID = 'manual-attendance-qr';
const MAX_REQUEST_BODY_BYTES = 2_048;
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
const distanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const radians = Math.PI / 180;
  const deltaLat = (lat2 - lat1) * radians;
  const deltaLon = (lon2 - lon1) * radians;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(deltaLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
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
    if (!body || typeof body !== 'object' || !['create-session', 'mark-attendance', 'update-coordinator-location'].includes((body as { action?: string }).action ?? '')) return response(request, { message: 'Invalid request.' }, 400);
    
    if (body.action === 'create-session' || body.action === 'mark-attendance') {
      const { data: limit, error: limitError } = await adminClient.rpc('consume_attendance_rate_limit', { p_actor_id: user.id, p_action: body.action }).single();
      if (limitError || !limit?.allowed) {
        await adminClient.from('security_audit_events').insert({ actor_id: user.id, action: body.action, outcome: 'rate_limited' });
        return response(request, { message: `Too many requests. Try again in ${Math.max(1, limit?.retry_after_seconds ?? 600)} seconds.` }, 429);
      }
    }

    if (body.action === 'create-session') {
      if (profile.role !== 'coordinator') return response(request, { message: 'Not authorized.' }, 403);
      if (!UUID_PATTERN.test(body.busId ?? '') || !SESSION_TYPES.has(body.sessionType)) return response(request, { message: 'Invalid session request.' }, 400);
      const { data: bus } = await adminClient.from('buses').select('id,bus_number').eq('id', body.busId).single();
      if (!bus || profile.bus_id !== bus.id) return response(request, { message: 'Bus is not assigned to you.' }, 403);
      const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
      const { data: session, error } = await adminClient.from('attendance_sessions').insert({
        bus_id: bus.id, session_type: body.sessionType, token_hash: await hashToken(token, qrSecret), expires_at: expiresAt, created_by: user.id,
      }).select('id').single();
      if (error || !session) return response(request, { message: 'Could not create QR session.' }, 500);
      const emailSent = body.emailQr === true
        ? await sendManualQrEmail(profile.email, String(bus.bus_number), body.sessionType, token).catch(() => false)
        : true;
      await adminClient.from('security_audit_events').insert({ actor_id: user.id, action: body.action, outcome: 'allowed' });
      return response(request, { token, sessionId: session.id, expiresAt, emailSent });
    }

    if (body.action === 'update-coordinator-location') {
      if (profile.role !== 'coordinator') return response(request, { message: 'Not authorized.' }, 403);
      const { busId, latitude, longitude } = body;
      if (typeof busId !== 'string' || !UUID_PATTERN.test(busId) || !withinCoordinateBounds(latitude, longitude)) {
        return response(request, { message: 'A valid bus ID and GPS location are required.' }, 400);
      }
      if (profile.bus_id !== busId) return response(request, { message: 'Bus is not assigned to you.' }, 403);

      const { error: updateError } = await adminClient
        .from('buses')
        .update({ latitude, longitude })
        .eq('id', busId);

      if (updateError) {
        console.error('Failed to update coordinator location:', updateError);
        return response(request, { message: 'Could not update live position.' }, 500);
      }
      return response(request, { success: true });
    }

    if (body.action === 'mark-attendance') {
      const { token, latitude, longitude } = body;
      if (typeof token !== 'string' || !QR_TOKEN_PATTERN.test(token) || !withinCoordinateBounds(latitude, longitude)) return response(request, { message: 'A valid QR token and GPS location are required.' }, 400);
      if (profile.status !== 'active' || !profile.bus_id) return response(request, { message: 'Your bus assignment is not active.' }, 403);
      const { data: session } = await adminClient.from('attendance_sessions').select('*, buses(*)').eq('token_hash', await hashToken(token, qrSecret)).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (!session) return response(request, { message: 'Invalid or expired QR session.' }, 400);
      if (session.bus_id !== profile.bus_id) return response(request, { message: 'STUDENT BELONG TO THIS BUS INVALID SCAN YOUR BUS CODE' }, 400);
      // Geofencing check disabled: student coordinates are recorded without radius restriction
      // if (distanceMeters(latitude, longitude, session.buses.latitude, session.buses.longitude) > session.buses.radius_meters) return response(request, { message: 'You are outside the permitted bus geofence.' }, 400);

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

      if (existingCheckin && existingCheckin.length > 0) {
        return response(request, { message: 'ALREADY MARKED PRESENT !!!' }, 409);
      }

      const { error } = await adminClient.from('attendance').insert({ session_id: session.id, student_id: user.id, latitude, longitude });
      if (error?.code === '23505') return response(request, { message: 'ALREADY MARKED PRESENT !!!' }, 409);
      if (error) return response(request, { message: 'Attendance could not be recorded.' }, 500);
      await adminClient.from('security_audit_events').insert({ actor_id: user.id, action: body.action, outcome: 'allowed' });
      return response(request, { message: 'Attendance marked successfully!' });
    }
    return response(request, { message: 'Unknown action.' }, 400);
  } catch (error) {
    console.error('attendance-api failed', error instanceof Error ? error.message : 'Unknown error');
    return response(request, { message: 'Attendance request could not be processed.' }, 502);
  }
});
