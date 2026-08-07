import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set([
  'https://karunya-bus-attendance.vercel.app',
  'https://karunya-bus-attendance-ashlinmirshas-projects.vercel.app',
  'https://karunya-bus-attendance-ashlinmirsha-ashlinmirshas-projects.vercel.app',
]);

const corsHeadersFor = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : ALLOWED_ORIGINS.values().next().value,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json',
});

const base64Url = (value: string) => btoa(unescape(encodeURIComponent(value))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

const sendCanaryAlertEmail = async (ip: string, userAgent: string, path: string, eventType: string, userInfoStr: string, locationData: any, extraData: any, timeline: any[]) => {
  const [clientId, clientSecret, refreshToken] = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'].map((name) => Deno.env.get(name) ?? '');
  if (!clientId || !clientSecret || !refreshToken) return false;
  
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
  if (!refresh.ok || !credentials?.access_token) return false;
  
  const timeStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const subject = `INCIDENT REPORT: Restricted Gateway Access Detected [IP: ${ip}]`;
  
  let locationHtml = '<p style="margin:0 0 8px;line-height:1.5"><strong>Audited Location:</strong> Not Provided / Refused</p>';
  if (locationData && locationData.latitude && locationData.longitude) {
    const mapsLink = `https://www.google.com/maps?q=${locationData.latitude},${locationData.longitude}`;
    locationHtml = `<p style="margin:0 0 8px;line-height:1.5"><strong>Audited Location:</strong> <a href="${mapsLink}" target="_blank" style="color:#2563eb;font-weight:bold;text-decoration:none">Lat: ${locationData.latitude.toFixed(6)}, Lon: ${locationData.longitude.toFixed(6)} (Acc: ${locationData.accuracy?.toFixed(1) ?? 'N/A'}m)</a></p>`;
  } else if (extraData && extraData.message) {
    locationHtml = `<p style="margin:0 0 8px;line-height:1.5;color:#d32f2f"><strong>Audited Location:</strong> Denied (Code ${extraData.code}: ${extraData.message})</p>';`;
  }

  let extraHtml = '';
  if (extraData && extraData.action) {
    extraHtml = `<p style="margin:0 0 8px;line-height:1.5"><strong>Action Details:</strong> ${extraData.action}</p>`;
  } else if (extraData && extraData.user) {
    extraHtml = `<p style="margin:0 0 8px;line-height:1.5;color:#d32f2f"><strong>Login Form Entry:</strong> user="${extraData.user}" / pass="${extraData.pass}"</p>`;
  }
  
  let timelineHtml = '';
  if (timeline && timeline.length > 0) {
    timelineHtml = `<h3 style="color:#102a43;margin:24px 0 12px;font-size:16px;border-bottom:1px solid #d9e2ec;padding-bottom:8px">Activity Timeline (Last 1 Hour)</h3>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="4" style="font-size:13px;line-height:1.4">
      ${timeline.map(e => {
        const t = new Date(e.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'medium' });
        return `<tr><td width="90" style="color:#627d98;vertical-align:top"><strong>${t}</strong></td><td style="color:#102a43">${e.action} (${e.outcome})</td></tr>`;
      }).join('')}
    </table>`;
  }

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f7fa;color:#102a43;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d9e2ec;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.05)">
            <tr>
              <td style="padding:32px">
                <h1 style="color:#d32f2f;margin:0 0 8px;font-size:22px;font-weight:bold">Gateway Access Incident</h1>
                <p style="margin:0 0 20px;color:#627d98;font-size:14px">A restricted gateway interface boundary has been breached.</p>
                
                <h3 style="color:#102a43;margin:0 0 12px;font-size:16px;border-bottom:1px solid #d9e2ec;padding-bottom:8px">Target Boundary</h3>
                <p style="margin:0 0 8px;line-height:1.5"><strong>Requested Path:</strong> /${path}</p>
                <p style="margin:0 0 8px;line-height:1.5"><strong>Access Event Type:</strong> ${eventType}</p>
                ${extraHtml}

                <h3 style="color:#102a43;margin:20px 0 12px;font-size:16px;border-bottom:1px solid #d9e2ec;padding-bottom:8px">Origin Identity Profile</h3>
                <p style="margin:0 0 8px;line-height:1.5"><strong>Source IP:</strong> ${ip}</p>
                <p style="margin:0 0 8px;line-height:1.5"><strong>User-Agent:</strong> ${userAgent}</p>
                <p style="margin:0 0 8px;line-height:1.5"><strong>Identity Resolved:</strong> ${userInfoStr}</p>
                ${locationHtml}
                
                ${timelineHtml}
                
                <p style="margin:32px 0 0;color:#627d98;font-size:12px;text-align:center;border-top:1px solid #e1e7ec;padding-top:16px">This notification was generated automatically by system security audits.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body></html>`;
  
  const boundary = `canary-alert-${crypto.randomUUID()}`;
  const recipient = Deno.env.get('GMAIL_FROM_EMAIL') ?? 'karunya.attendance@gmail.com';
  const raw = [
    `To: ${recipient}`,
    `From: "System Security Audit" <${recipient}>`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
    `--${boundary}--`
  ].join('\r\n');
  
  const sent = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: base64Url(raw) })
  });
  return sent.ok;
};

const getFakeEnvContent = () => `
# Development Environment Configurations
SUPABASE_URL=https://kkbzofddkfusblyplnca.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
DATABASE_URL=postgresql://postgres.kkbzofddkfusblyplnca:K8s_db_prod_pass_198!@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
PORT=3000
GMAIL_FROM_EMAIL=karunya.attendance@gmail.com
LDAP_SECRET=Kd987#s9sD2!@#s
`;

const getFakeCsvContent = () => `Register Number,Full Name,Email,Bus Assigned,Status
UR23CS001,Siddharth R,siddharthr@karunya.edu.in,Bus 1,Active
UR23CS002,Benesha Mercy,beneshamercy@karunya.edu.in,Bus 2,Active
UR23CS003,Lohita A,lohitaa@karunya.edu.in,Bus 1,Active
UR23CS004,Ashlin Mirsha,ashlinmirsha@karunya.edu.in,Bus 1,Active
UR23CS005,Aarush Kumar,aarushkumar@karunya.edu.in,Bus 2,Pending
`;

const getFakeSqlContent = () => `
-- Karunya Bus Attendance System database backup dump
-- Dumped at 2026-08-01 04:00:00

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text DEFAULT ''::text NOT NULL,
    role public.user_role DEFAULT 'student'::public.user_role NOT NULL,
    register_number text,
    bus_id uuid,
    status text DEFAULT 'pending_assignment'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

INSERT INTO public.profiles (id, email, full_name, role, register_number, bus_id, status) VALUES
('d1a3c75d-cb8f-4d92-a9b8-067f91cc44a1', 'ashlinmirsha@karunya.edu.in', 'Ashlin Mirsha', 'coordinator', 'ASHLINMIRSHA', 'b1a2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', 'active'),
('e2a4c85d-cb8f-4d92-a9b8-067f91cc44a2', 'manickraja@karunya.edu', 'Manickraja', 'coordinator', 'MANICKRAJA', 'c2a3c4d5-e6f7-8a9b-0c1d-2e3f4a5b6c7d', 'active');
`;

Deno.serve(async (request) => {
  const clientIp = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? '';

  // Block automated scanners, probes, curl, nmap, etc.
  const BLOCKED_USER_AGENTS = /curl|wget|nmap|sqlmap|nikto|dirbuster|gobuster|w3af|acunetix|masscan|python-requests|scan|hydra|john/i;
  if (BLOCKED_USER_AGENTS.test(userAgent)) {
    return new Response('Access Denied', { status: 403 });
  }

  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(request.headers.get('Origin')) });
  }

  const url = new URL(request.url);
  const alertPath = url.searchParams.get('alert_path') ?? 'unknown';

  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // POST Request: handle silent audit logging and email incident report dispatch
  if (request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (body && typeof body === 'object') {
      const type = body.type ?? 'unknown';
      const session = body.session;
      const location = body.location;
      const extra = body.extra ?? {};
      
      let userInfoStr = 'Anonymous Attacker (Not Logged In)';
      let studentId = null;

      if (session && session.id) {
        studentId = session.id;
        const { data: profile } = await adminClient.from('profiles').select('register_number, full_name').eq('id', session.id).maybeSingle();
        if (profile) {
          userInfoStr = `${profile.full_name} [Register No: ${profile.register_number}] (${session.email})`;
        } else {
          userInfoStr = `User with Email: ${session.email} (ID: ${session.id})`;
        }
      }

      let actionDesc = '';
      if (type === 'view') {
        actionDesc = 'gateway-page-view';
      } else if (type === 'action') {
        actionDesc = `gateway-action-${extra.action}`;
      } else if (type === 'login_success') {
        actionDesc = 'gateway-login-success';
      } else if (type === 'login_fail') {
        actionDesc = `gateway-login-failed(user:${extra.user},pass:${extra.pass})`;
      } else {
        actionDesc = `gateway-${type}`;
      }

      let latVal = location?.latitude ? String(location.latitude) : null;
      let lonVal = location?.longitude ? String(location.longitude) : null;
      let locDesc = (latVal && lonVal) ? `Coordinates: ${latVal}, ${lonVal}` : null;

      // Log threat entry to DB
      await adminClient.from('security_audit_events').insert({
        actor_id: studentId,
        action: `intrusion-${alertPath}-${actionDesc}` + (locDesc ? ` [${locDesc}]` : ''),
        outcome: 'unauthorized_route',
        ip_address: clientIp
      });

      // Query complete timeline for this IP to send in the consolidated incident report
      const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      const { data: timeline } = await adminClient
        .from('security_audit_events')
        .select('action, outcome, created_at')
        .eq('ip_address', clientIp)
        .gte('created_at', oneHourAgo)
        .order('created_at', { ascending: true });

      // Send threat incident report email
      try {
        await sendCanaryAlertEmail(clientIp, userAgent, alertPath, actionDesc, userInfoStr, location, extra, timeline || []);
      } catch (e) {
        console.error('Failed to send canary alert email:', e);
      }

      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { ...corsHeadersFor(request.headers.get('Origin')), 'Content-Type': 'application/json' }
      });
    }
  }

  // GET Request: Serve requested files
  if (request.method === 'GET') {
    // Log immediate basic boundary probe to database
    await adminClient.from('security_audit_events').insert({
      action: `intrusion-attempt-${alertPath}-get`,
      outcome: 'unauthorized_route',
      ip_address: clientIp
    });

    // Send immediate email notification for basic boundary probe
    try {
      await sendCanaryAlertEmail(clientIp, userAgent, alertPath, 'get-boundary-probe', 'Anonymous (Direct Link Click)', null, null, []);
    } catch (e) {
      console.error('Failed to send canary alert email:', e);
    }

    if (alertPath === 'env') {
      return new Response(getFakeEnvContent(), {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Content-Type': 'text/plain; charset=utf-8'
        }
      });
    } else if (alertPath === 'csv') {
      return new Response(getFakeCsvContent(), {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="allstudents.csv"'
        }
      });
    } else if (alertPath === 'sql') {
      return new Response(getFakeSqlContent(), {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Content-Type': 'application/sql; charset=utf-8',
          'Content-Disposition': 'attachment; filename="db_backup.sql"'
        }
      });
    }
  }

  return new Response(JSON.stringify({ message: 'Not found' }), { status: 404, headers: corsHeadersFor(request.headers.get('Origin')) });
});
