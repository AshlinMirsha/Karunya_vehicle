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

const buildBrevoPayload = async (recipient: string, busNumber: string, checkinUrl: string, sessionType: string) => {
  const qrDataUrl = await QRCode.toDataURL(checkinUrl, { errorCorrectionLevel: 'M', margin: 2, width: 640 });
  const encodedPng = qrDataUrl.split(',', 2)[1];
  if (!encodedPng) throw new Error('Could not encode attendance QR image');
  
  const dateStr = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', dateStyle: 'long' });
  const subject = `Bus ${busNumber} ${sessionType} Attendance QR - ${dateStr}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f7fa;color:#102a43;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d9e2ec;border-radius:16px"><tr><td style="padding:32px"><p style="margin:0 0 12px;color:#486581;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Karunya bus attendance - ${dateStr}</p><h1 style="margin:0 0 16px;font-size:24px">Bus ${busNumber} ${sessionType} QR</h1><p style="margin:0 0 24px;line-height:1.5">Scan this QR code to open the secure attendance check-in.</p><p style="margin:0 0 24px;text-align:center"><img src="data:image/png;base64,${encodedPng}" alt="Bus ${busNumber} attendance QR code" width="320" height="320" style="display:inline-block;max-width:100%;height:auto;border:0"></p><p style="margin:0 0 12px;line-height:1.5">If the image does not appear, use this secure link:</p><p style="margin:0 0 24px"><a href="${checkinUrl}" style="display:inline-block;padding:12px 18px;background:#1769aa;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold">Open attendance check-in</a></p><p style="margin:0;color:#627d98;font-size:13px">This code expires in five hours.</p></td></tr></table></td></tr></table></body></html>`;
  
  const senderEmail = Deno.env.get('EMAIL_ID') || 'karunya.attendance@gmail.com';
  
  return {
    sender: { name: "Karunya Bus Attendance", email: senderEmail },
    to: [{ email: recipient }],
    subject: subject,
    htmlContent: html,
    attachment: [{
      content: encodedPng,
      name: "bus-attendance-qr.png"
    }]
  };
};

/**
 * Sends email via Brevo transactional email API over HTTPS.
 */
const sendBrevoEmail = async (payload: any): Promise<void> => {
  const apiKey = Deno.env.get('BREVO_API_KEY');

  if (!apiKey) {
    throw new Error('BREVO_API_KEY is not configured');
  }

  const sendResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload),
  });

  if (!sendResponse.ok) {
    const errText = await sendResponse.text().catch(() => '');
    throw new Error(`Brevo send failed: ${sendResponse.status} ${errText}`);
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

        // Build and send email via Brevo REST API
        const checkinUrl = `${APP_URL}/checkin?token=${token}`;
        try {
          const payload = await buildBrevoPayload(faculty.email, bus.bus_number, checkinUrl, sessionType);
          await sendBrevoEmail(payload);
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
