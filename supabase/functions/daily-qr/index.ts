import { createClient } from 'npm:@supabase/supabase-js@2';
import QRCode from 'npm:qrcode@1.5.4';

const APP_URL = 'https://karunya-bus-attendance.vercel.app';
const QR_SESSION_DURATION_MS = 5 * 60 * 60 * 1000;
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

const getSessionType = () => Number(new Date().toLocaleString('en-US', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false,
})) < 12 ? 'Morning' : 'Evening';

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

const buildEmail = async (recipient: string, busNumber: string, checkinUrl: string, sessionType: string) => {
  const boundary = `bus-attendance-${crypto.randomUUID()}`;
  // Gmail mobile clients render CID PNG reliably; inline SVG QR images are often suppressed.
  const qrDataUrl = await QRCode.toDataURL(checkinUrl, { errorCorrectionLevel: 'M', margin: 2, width: 640 });
  const encodedPng = qrDataUrl.split(',', 2)[1];
  if (!encodedPng) throw new Error('Could not encode attendance QR image');
  const wrappedPng = encodedPng.replace(/(.{76})/g, '$1\r\n');
  const subject = `Bus ${busNumber} ${sessionType} Attendance QR`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f7fa;color:#102a43;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d9e2ec;border-radius:16px"><tr><td style="padding:32px"><p style="margin:0 0 12px;color:#486581;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Karunya bus attendance</p><h1 style="margin:0 0 16px;font-size:24px">Bus ${busNumber} ${sessionType} QR</h1><p style="margin:0 0 24px;line-height:1.5">Scan this QR code to open the secure attendance check-in.</p><p style="margin:0 0 24px;text-align:center"><img src="cid:${QR_IMAGE_CID}" alt="Bus ${busNumber} attendance QR code" width="320" height="320" style="display:inline-block;max-width:100%;height:auto;border:0"></p><p style="margin:0 0 12px;line-height:1.5">If the image does not appear, use this secure link:</p><p style="margin:0 0 24px"><a href="${checkinUrl}" style="display:inline-block;padding:12px 18px;background:#1769aa;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold">Open attendance check-in</a></p><p style="margin:0;color:#627d98;font-size:13px">This code expires in five hours.</p></td></tr></table></td></tr></table></body></html>`;
  return [
    `To: ${recipient}`,
    `From: karunya.attendance@gmail.com`,
    `Subject: ${subject}`,
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
    `--${boundary}--`,
  ].join('\r\n');
};

const sendSmtpEmail = async (user: string, password: string, to: string, rawMimeMessage: string) => {
  const conn = await Deno.connectTls({ hostname: "smtp.gmail.com", port: 465 });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = conn.readable.getReader();
  const writer = conn.writable.getWriter();

  async function readResponse(): Promise<string> {
    const { value } = await reader.read();
    return value ? decoder.decode(value) : '';
  }

  async function sendCmd(cmd: string): Promise<string> {
    await writer.write(encoder.encode(cmd + "\r\n"));
    return await readResponse();
  }

  try {
    await readResponse(); // Welcome 220
    await sendCmd("EHLO localhost");
    await sendCmd("AUTH LOGIN");
    await sendCmd(btoa(user));
    const authPassRes = await sendCmd(btoa(password));
    
    if (!authPassRes.includes("235")) {
      throw new Error(`Authentication failed: ${authPassRes.trim()}`);
    }

    await sendCmd(`MAIL FROM:<${user}>`);
    await sendCmd(`RCPT TO:<${to}>`);
    await sendCmd("DATA");
    await sendCmd(rawMimeMessage + "\r\n.");
    await sendCmd("QUIT");
  } finally {
    conn.close();
  }
};

Deno.serve(async (request) => {
  if (request.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return json({ message: 'Unauthorized' }, 401);
  
  try {
    const emailUser = Deno.env.get('EMAIL_ID') || 'karunya.attendance@gmail.com';
    const emailPassword = Deno.env.get('EMAIL_APP_PASSWORD');
    
    if (!emailPassword) {
      return json({ message: 'EMAIL_APP_PASSWORD environment variable is missing.' }, 500);
    }

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

        const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
        const expiresAt = new Date(Date.now() + QR_SESSION_DURATION_MS).toISOString();
        const { data: session, error: sessionError } = await database.from('attendance_sessions').insert({
          bus_id: bus.id, session_type: sessionType, token_hash: await sessionHash(token), expires_at: expiresAt, created_by: faculty.id,
        }).select('id').single();
        if (sessionError || !session) throw new Error(`Could not create Bus ${bus.bus_number} attendance session`);

        const checkinUrl = `${APP_URL}/checkin?token=${token}`;
        const rawMime = await buildEmail(faculty.email, bus.bus_number, checkinUrl, sessionType);
        
        await sendSmtpEmail(emailUser, emailPassword.replace(/\s+/g, ''), faculty.email, rawMime);
      }
    }
    return json({ message: 'QR sessions created and faculty email sent', sessionTypes, busCount: buses.length });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    console.error('daily-qr failed', reason);
    return json({ message: 'Could not create and deliver the scheduled QR', reason }, 502);
  }
});
