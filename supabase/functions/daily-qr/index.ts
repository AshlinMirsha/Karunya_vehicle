import { createClient } from 'npm:@supabase/supabase-js@2';
import QRCode from 'npm:qrcode@1.5.4';

const APP_URL = 'https://karunya-bus-attendance.vercel.app';
const QR_SESSION_DURATION_MS = 5 * 60 * 60 * 1000;
const QR_IMAGE_CID = 'bus-attendance-qr';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const base64Url = (value: string) =>
  btoa(unescape(encodeURIComponent(value))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

const sessionHash = async (token: string) => {
  const secret = Deno.env.get('QR_SECRET');
  if (!secret) throw new Error('QR secret is not configured');
  const bytes = new TextEncoder().encode(`${secret}:${token}`);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const getSessionType = () =>
  Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false })) < 12
    ? 'Morning'
    : 'Evening';

const requestedSessionTypes = async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Invalid request body');
  }
  const requested = (body as { sessionTypes?: unknown }).sessionTypes;
  if (requested === undefined) return [getSessionType()];
  if (!Array.isArray(requested) || requested.length === 0 || requested.some((v) => v !== 'Morning' && v !== 'Evening')) {
    throw new Error('sessionTypes must contain Morning and/or Evening');
  }
  return [...new Set(requested)] as string[];
};

const buildMimeEmail = async (recipient: string, busNumber: string, checkinUrl: string, sessionType: string) => {
  const boundary = `bus-attendance-${crypto.randomUUID()}`;
  const qrDataUrl = await QRCode.toDataURL(checkinUrl, { errorCorrectionLevel: 'M', margin: 2, width: 640 });
  const encodedPng = qrDataUrl.split(',', 2)[1];
  if (!encodedPng) throw new Error('Could not encode attendance QR image');
  const wrappedPng = encodedPng.replace(/(.{76})/g, '$1\r\n');
  const dateStr = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', dateStyle: 'long' });
  const subject = `Bus ${busNumber} ${sessionType} Attendance QR - ${dateStr}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f7fa;color:#102a43;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d9e2ec;border-radius:16px"><tr><td style="padding:32px"><p style="margin:0 0 12px;color:#486581;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Karunya bus attendance - ${dateStr}</p><h1 style="margin:0 0 16px;font-size:24px">Bus ${busNumber} ${sessionType} QR</h1><p style="margin:0 0 24px;line-height:1.5">Scan this QR code to open the secure attendance check-in.</p><p style="margin:0 0 24px;text-align:center"><img src="cid:${QR_IMAGE_CID}" alt="Bus ${busNumber} attendance QR code" width="320" height="320" style="display:inline-block;max-width:100%;height:auto;border:0"></p><p style="margin:0 0 12px;line-height:1.5">If the image does not appear, use this secure link:</p><p style="margin:0 0 24px"><a href="${checkinUrl}" style="display:inline-block;padding:12px 18px;background:#1769aa;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold">Open attendance check-in</a></p><p style="margin:0;color:#627d98;font-size:13px">This code expires in five hours.</p></td></tr></table></td></tr></table></body></html>`;
  const fromEmail = Deno.env.get('GMAIL_FROM_EMAIL') || 'karunya.attendance@gmail.com';
  const messageId = `<${crypto.randomUUID()}@supabase.co>`;
  return [
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
    `--${boundary}--`,
  ].join('\r\n');
};

/**
 * Sends email via Gmail REST API over HTTPS (port 443).
 * Raw SMTP (Deno.connectTls / port 465/587) is blocked in Supabase Edge Functions
 * because they only allow outbound HTTPS. This uses OAuth2 client credentials to
 * obtain a fresh access token, then calls the Gmail messages.send REST endpoint.
 */
const sendGmailEmail = async (to: string, rawMime: string): Promise<void> => {
  const clientId = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
  const refreshToken = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail OAuth2 credentials are not configured (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)');
  }

  // Step 1: Exchange refresh token for a new access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const credentials = await tokenResponse.json().catch(() => null);
  if (!tokenResponse.ok || !credentials?.access_token) {
    const reason = credentials?.error_description ?? credentials?.error ?? 'token refresh failed';
    throw new Error(`Gmail OAuth2 token refresh failed: ${reason}`);
  }

  // Step 2: Send the raw MIME message via Gmail REST API
  const sendResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: base64Url(rawMime) }),
  });

  if (!sendResponse.ok) {
    const errBody = await sendResponse.json().catch(() => ({}));
    const reason = (errBody as { error?: { message?: string } })?.error?.message ?? `HTTP ${sendResponse.status}`;
    throw new Error(`Gmail send failed: ${reason}`);
  }
};

Deno.serve(async (request: Request) => {
  if (request.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return json({ message: 'Unauthorized' }, 401);
  }

  try {
    const database = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const [{ data: buses, error: busesError }, { data: coordinators, error: coordsError }] = await Promise.all([
      database.from('buses').select('id,bus_number'),
      database.from('profiles').select('id,email,bus_id').eq('role', 'coordinator'),
    ]);

    if (busesError) throw new Error(`Bus lookup failed: ${busesError.message}`);
    if (coordsError) throw new Error(`Coordinator lookup failed: ${coordsError.message}`);
    if (!buses?.length) return json({ message: 'No buses found in database' }, 409);

    const sessionTypes = await requestedSessionTypes(request);
    const results: { bus: string; sessionType: string; emailStatus: string; error?: string }[] = [];

    for (const sessionType of sessionTypes) {
      for (const bus of buses) {
        const faculty = coordinators?.find((c) => c.bus_id === bus.id);
        if (!faculty) {
          console.warn(`No coordinator found for bus ${bus.bus_number}`);
          results.push({ bus: bus.bus_number, sessionType, emailStatus: 'skipped_no_coordinator' });
          continue;
        }

        // Create QR session in DB
        const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
        const expiresAt = new Date(Date.now() + QR_SESSION_DURATION_MS).toISOString();
        const { data: session, error: sessionError } = await database
          .from('attendance_sessions')
          .insert({
            bus_id: bus.id,
            session_type: sessionType,
            token_hash: await sessionHash(token),
            expires_at: expiresAt,
            created_by: faculty.id,
            email_status: 'pending',
          })
          .select('id')
          .single();

        if (sessionError || !session) {
          const errMsg = sessionError?.message ?? 'unknown DB error';
          console.error(`Could not create Bus ${bus.bus_number} attendance session:`, errMsg);
          results.push({ bus: bus.bus_number, sessionType, emailStatus: 'failed_session', error: errMsg });
          continue;
        }

        // Build and send email via Gmail REST API
        const checkinUrl = `${APP_URL}/checkin?token=${token}`;
        try {
          const rawMime = await buildMimeEmail(faculty.email, bus.bus_number, checkinUrl, sessionType);
          await sendGmailEmail(faculty.email, rawMime);
          await database.from('attendance_sessions').update({ email_status: 'sent' }).eq('id', session.id);
          console.log(`Email sent to ${faculty.email} for Bus ${bus.bus_number} (${sessionType})`);
          results.push({ bus: bus.bus_number, sessionType, emailStatus: 'sent' });
        } catch (emailError) {
          const errMsg = emailError instanceof Error ? emailError.message : String(emailError);
          console.error(`Failed to send email to ${faculty.email} for Bus ${bus.bus_number}:`, errMsg);
          await database
            .from('attendance_sessions')
            .update({ email_status: 'failed', email_error: errMsg })
            .eq('id', session.id);
          results.push({ bus: bus.bus_number, sessionType, emailStatus: 'failed', error: errMsg });
        }
      }
    }

    return json({ message: 'QR sessions processed', sessionTypes, results });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    console.error('daily-qr failed:', reason);
    return json({ message: 'Could not create and deliver the scheduled QR', reason }, 502);
  }
});
