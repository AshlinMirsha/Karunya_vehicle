import { createClient } from 'npm:@supabase/supabase-js@2';
import QRCode from 'npm:qrcode@1.5.4';

const APP_URL = 'https://karunya-bus-attendance.vercel.app';
const QR_SESSION_DURATION_MS = 5 * 60 * 60 * 1000; // 5 hours validity
const QR_IMAGE_CID = 'bus-attendance-qr';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const base64Url = (value: string) => btoa(unescape(encodeURIComponent(value)))
  .replaceAll('+', '-')
  .replaceAll('/', '_')
  .replaceAll('=', '');

const sessionHash = async (token: string) => {
  const secret = Deno.env.get('QR_SECRET');
  if (!secret) throw new Error('QR secret is not configured');
  const bytes = new TextEncoder().encode(`${secret}:${token}`);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const getSessionType = () => {
  const now = new Date();
  const istTime = new Date(now.getTime() + (5 * 60 + 30) * 60000);
  return istTime.getUTCHours() < 12 ? 'Morning' : 'Evening';
};

const requestedSessionTypes = async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Invalid request body');
  }
  const requested = (body as { sessionTypes?: unknown }).sessionTypes;
  if (requested === undefined) return [getSessionType()];
  if (!Array.isArray(requested) || requested.length === 0
    || requested.some((value) => value !== 'Morning' && value !== 'Evening')) {
    throw new Error('sessionTypes must contain Morning and/or Evening');
  }
  return [...new Set(requested)];
};

// Rewrite: Gmail API OAuth2 integration (HTTP POST) instead of SMTP to resolve TCP-bound blocking
const sendGmailApiEmail = async (recipient: string, busNumber: string, sessionType: string, token: string) => {
  const [clientId, clientSecret, refreshToken] = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'].map((name) => Deno.env.get(name) ?? '');
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Gmail OAuth environment variables are missing');
  
  const refresh = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  
  const credentials = await refresh.json().catch(() => null);
  if (!refresh.ok || !credentials?.access_token) throw new Error('Could not refresh Gmail API access token');
  
  const checkinUrl = `${APP_URL}/checkin?token=${token}`;
  const qrDataUrl = await QRCode.toDataURL(checkinUrl, { errorCorrectionLevel: 'M', margin: 2, width: 640 });
  const encodedPng = qrDataUrl.split(',', 2)[1];
  if (!encodedPng) throw new Error('Could not encode attendance QR image');
  const wrappedPng = encodedPng.replace(/(.{76})/g, '$1\r\n');
  const dateStr = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', dateStyle: 'long' });
  const subject = `Bus ${busNumber} ${sessionType} Attendance QR - ${dateStr}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f7fa;color:#102a43;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d9e2ec;border-radius:16px"><tr><td style="padding:32px"><p style="margin:0 0 12px;color:#486581;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Karunya bus attendance - ${dateStr}</p><h1 style="margin:0 0 16px;font-size:24px">Bus ${busNumber} ${sessionType} QR</h1><p style="margin:0 0 24px;line-height:1.5">Scan this QR code to open the secure attendance check-in.</p><p style="margin:0 0 24px;text-align:center"><img src="cid:${QR_IMAGE_CID}" alt="Bus ${busNumber} attendance QR code" width="320" height="320" style="display:inline-block;max-width:100%;height:auto;border:0"></p><p style="margin:0 0 12px;line-height:1.5">If the image does not appear, use this secure link:</p><p style="margin:0 0 24px"><a href="${checkinUrl}" style="display:inline-block;padding:12px 18px;background:#1769aa;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold">Open attendance check-in</a></p><p style="margin:0;color:#627d98;font-size:13px">This code expires in five hours.</p></td></tr></table></td></tr></table></body></html>`;
  const boundary = `bus-attendance-${crypto.randomUUID()}`;
  const messageId = `<${crypto.randomUUID()}@supabase.co>`;
  const fromEmail = Deno.env.get('GMAIL_FROM_EMAIL') ?? 'karunya.attendance@gmail.com';
  
  const rawMimeMessage = [
    `To: ${recipient}`,
    `From: "Karunya Bus Attendance" <${fromEmail}>`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
    `--${boundary}`,
    'Content-Type: image/png; name="bus-attendance-qr.png"',
    'Content-Transfer-Encoding: base64',
    `Content-ID: <${QR_IMAGE_CID}>`,
    'Content-Disposition: inline; filename="bus-attendance-qr.png"',
    '',
    wrappedPng,
    `--${boundary}--`
  ].join('\r\n');
  
  const sent = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: base64Url(rawMimeMessage) })
  });
  
  if (!sent.ok) {
    const errorText = await sent.text().catch(() => 'Unknown error');
    throw new Error(`Gmail API failed: ${errorText}`);
  }
};

Deno.serve(async (request) => {
  if (request.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return json({ message: 'Unauthorized' }, 401);
  
  try {
    const database = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const [{ data: buses, error: busesError }, { data: coordinators, error: coordsError }] = await Promise.all([
      database.from('buses').select('id,bus_number'),
      database.from('profiles').select('id,email,bus_id').eq('role', 'coordinator'),
    ]);
    if (busesError) throw new Error(`Bus lookup failed: ${busesError.message}`);
    if (coordsError) throw new Error(`Coordinator lookup failed: ${coordsError.message}`);
    if (!buses?.length) return json({ message: 'Buses are missing' }, 409);

    const sessionTypes = await requestedSessionTypes(request);
    for (const sessionType of sessionTypes) {
      for (const bus of buses) {
        const faculty = coordinators?.find(c => c.bus_id === bus.id);
        if (!faculty) {
          console.warn(`No coordinator found for bus ${bus.bus_number}`);
          continue;
        }

        // Generate signed token to enforce server-side tamper-free check
        const randomPart = crypto.randomUUID().replaceAll('-', '');
        const signaturePart = (await sessionHash(`${randomPart}:${bus.id}:${sessionType}`)).slice(0, 32);
        const token = randomPart + signaturePart;
        
        const expiresAt = new Date(Date.now() + QR_SESSION_DURATION_MS).toISOString();
        const { data: session, error: sessionError } = await database.from('attendance_sessions').insert({
          bus_id: bus.id, session_type: sessionType, token_hash: await sessionHash(token), expires_at: expiresAt, created_by: faculty.id, email_status: 'pending',
        }).select('id').single();
        
        if (sessionError || !session) {
          console.error(`Could not create Bus ${bus.bus_number} attendance session`, sessionError);
          continue;
        }

        try {
          await sendGmailApiEmail(faculty.email, bus.bus_number, sessionType, token);
          await database.from('attendance_sessions').update({ email_status: 'sent' }).eq('id', session.id);
        } catch (emailError) {
          const errMsg = emailError instanceof Error ? emailError.message : String(emailError);
          console.error(`Failed to send email to coordinator ${faculty.email} for bus ${bus.bus_number}:`, errMsg);
          await database.from('attendance_sessions').update({ email_status: 'failed', email_error: errMsg }).eq('id', session.id);
        }
      }
    }
    return json({ message: 'QR sessions created and faculty email sent', sessionTypes, busCount: buses.length });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    console.error('daily-qr failed', reason);
    return json({ message: 'Could not create and deliver the scheduled QR', reason }, 502);
  }
});
