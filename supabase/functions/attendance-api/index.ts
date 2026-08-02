import { createClient } from 'npm:@supabase/supabase-js@2';
import QRCode from 'npm:qrcode@1.5.4';

const ALLOWED_ORIGIN = 'https://karunya-bus-attendance.vercel.app';
const EARTH_RADIUS_METERS = 6_371_000;
const SESSION_DURATION_MS = 30 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QR_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;
const SESSION_TYPES = new Set(['Morning', 'Evening']);
const QR_IMAGE_CID = 'manual-attendance-qr';
const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  Vary: 'Origin',
};

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
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
  const checkinUrl = `${ALLOWED_ORIGIN}/checkin?token=${token}`;
  const svg = await QRCode.toString(checkinUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 320 });
  const boundary = `manual-qr-${crypto.randomUUID()}`;
  const encodedSvg = btoa(unescape(encodeURIComponent(svg))).replace(/(.{76})/g, '$1\r\n');
  const raw = [`To: ${recipient}`, `From: ${Deno.env.get('GMAIL_FROM_EMAIL') ?? recipient}`, `Subject: Bus ${busNumber} ${sessionType} Attendance QR`, 'MIME-Version: 1.0', `Content-Type: multipart/related; boundary="${boundary}"`, '', `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', '', `<p>Your manual attendance QR for <strong>Bus ${busNumber}</strong> is ready.</p><p><img src="cid:${QR_IMAGE_CID}" alt="Attendance QR code" width="320" height="320"></p><p>This QR expires in 30 minutes.</p>`, `--${boundary}`, 'Content-Type: image/svg+xml; name="attendance-qr.svg"', 'Content-Transfer-Encoding: base64', `Content-ID: <${QR_IMAGE_CID}>`, 'Content-Disposition: inline; filename="attendance-qr.svg"', '', encodedSvg, `--${boundary}--`].join('\r\n');
  const sent = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${credentials.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: base64Url(raw) }) });
  return sent.ok;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ message: 'Method not allowed.' }, 405);
  const authorization = request.headers.get('Authorization');
  const qrSecret = Deno.env.get('QR_SECRET');
  if (!authorization || !qrSecret) return response({ message: 'Unauthorized request.' }, 401);

  try {
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user?.email?.endsWith('@karunya.edu.in')) return response({ message: 'Only official Karunya accounts are authorized.' }, 403);
    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: profile } = await adminClient.from('profiles').select('*').eq('id', user.id).single();
    if (!profile) return response({ message: 'Profile is not ready. Please sign in again.' }, 409);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return response({ message: 'Invalid request.' }, 400);

    if (body.action === 'create-session') {
      if (!['admin', 'coordinator'].includes(profile.role)) return response({ message: 'Not authorized.' }, 403);
      if (!UUID_PATTERN.test(body.busId ?? '') || !SESSION_TYPES.has(body.sessionType)) return response({ message: 'Invalid session request.' }, 400);
      const { data: bus } = await adminClient.from('buses').select('id,bus_number').eq('id', body.busId).single();
      if (!bus || (profile.role === 'coordinator' && profile.bus_id !== bus.id)) return response({ message: 'Bus is not assigned to you.' }, 403);
      const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
      const { data: session, error } = await adminClient.from('attendance_sessions').insert({
        bus_id: bus.id, session_type: body.sessionType, token_hash: await hashToken(token, qrSecret), expires_at: expiresAt, created_by: user.id,
      }).select('id').single();
      if (error || !session) return response({ message: 'Could not create QR session.' }, 500);
      const emailSent = body.emailQr === true && profile.role === 'admin'
        ? await sendManualQrEmail(profile.email, String(bus.bus_number), body.sessionType, token).catch(() => false)
        : body.emailQr !== true;
      return response({ token, sessionId: session.id, expiresAt, emailSent });
    }

    if (body.action === 'mark-attendance') {
      const { token, latitude, longitude } = body;
      if (typeof token !== 'string' || !QR_TOKEN_PATTERN.test(token) || !withinCoordinateBounds(latitude, longitude)) return response({ message: 'A valid QR token and GPS location are required.' }, 400);
      if (profile.status !== 'active' || !profile.bus_id) return response({ message: 'Your bus assignment is not active.' }, 403);
      const { data: session } = await adminClient.from('attendance_sessions').select('*, buses(*)').eq('token_hash', await hashToken(token, qrSecret)).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (!session || session.bus_id !== profile.bus_id) return response({ message: 'Invalid, expired, or incorrect-bus QR session.' }, 400);
      if (distanceMeters(latitude, longitude, session.buses.latitude, session.buses.longitude) > session.buses.radius_meters) return response({ message: 'You are outside the permitted bus geofence.' }, 400);
      const { error } = await adminClient.from('attendance').insert({ session_id: session.id, student_id: user.id, latitude, longitude });
      if (error?.code === '23505') return response({ message: 'Attendance is already registered for this session.' }, 409);
      if (error) return response({ message: 'Attendance could not be recorded.' }, 500);
      return response({ message: 'Attendance marked successfully!' });
    }
    return response({ message: 'Unknown action.' }, 400);
  } catch (error) {
    console.error('attendance-api failed', error instanceof Error ? error.message : 'Unknown error');
    return response({ message: 'Attendance request could not be processed.' }, 502);
  }
});
