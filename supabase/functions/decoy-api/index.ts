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

const sendCanaryAlertEmail = async (ip: string, userAgent: string, path: string) => {
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
  const subject = `ALERT: Restricted Route Accessed /${path}`;
  
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f7fa;color:#102a43;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d9e2ec;border-radius:16px">
            <tr>
              <td style="padding:32px">
                <h1 style="color:#d32f2f;margin:0 0 16px;font-size:24px">Access Attempt on Restricted Resource</h1>
                <p style="margin:0 0 12px;line-height:1.5"><strong>Requested Path:</strong> /${path}</p>
                <p style="margin:0 0 12px;line-height:1.5"><strong>Source IP:</strong> ${ip}</p>
                <p style="margin:0 0 12px;line-height:1.5"><strong>User-Agent:</strong> ${userAgent}</p>
                <p style="margin:0 0 12px;line-height:1.5"><strong>Timestamp:</strong> ${timeStr}</p>
                <p style="margin:0;color:#627d98;font-size:13px">This notification was triggered automatically by the route manager.</p>
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
    `From: "System Security" <${recipient}>`,
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

const getFakeAdminPanelHtml = () => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>System Login - Administration Hub</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    body { background: #0b132b; color: #ffffff; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: rgba(28, 37, 65, 0.8); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37); backdrop-filter: blur(8px); padding: 30px; width: 400px; }
    .btn-primary { background: #3a86c8; border: none; }
    .btn-primary:hover { background: #2a6698; }
    .form-control { background: #1c2541; border: 1px solid rgba(255,255,255,0.1); color: #fff; }
    .form-control:focus { background: #1c2541; border-color: #3a86c8; color: #fff; box-shadow: none; }
  </style>
</head>
<body>
  <!-- DEVELOPMENT NOTE: Temporary login credentials during migration: admin / changemeafterproduction -->
  <div class="card" id="login-container">
    <h3 class="text-center mb-4">Operations Console</h3>
    <form id="login-form">
      <div class="mb-3">
        <label for="username" class="form-label">Username</label>
        <input type="text" id="username" class="form-control" autocomplete="off" required>
      </div>
      <div class="mb-3">
        <label for="password" class="form-label">Password</label>
        <input type="password" id="password" class="form-control" autocomplete="off" required>
      </div>
      <button type="submit" class="btn btn-primary w-100 mt-2">Access Portal</button>
    </form>
  </div>

  <div class="container d-none" id="dashboard-container" style="max-width: 1000px; padding: 40px 20px;">
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h2>System Dashboard Center</h2>
      <button class="btn btn-outline-danger btn-sm" onclick="window.location.reload()">Sign Out</button>
    </div>
    <div class="row g-4">
      <div class="col-md-4">
        <div class="card w-100 p-3">
          <h5>Users Synced</h5>
          <h2 class="text-success mt-2">1,248</h2>
          <p class="text-muted small mb-0">Active LDAP connections</p>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card w-100 p-3">
          <h5>Database Status</h5>
          <h2 class="text-info mt-2">Healthy</h2>
          <p class="text-muted small mb-0">Pool size: 20 active connections</p>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card w-100 p-3">
          <h5>API Integrity</h5>
          <h2 class="text-warning mt-2">99.98%</h2>
          <p class="text-muted small mb-0">Average response: 48ms</p>
        </div>
      </div>
    </div>

    <div class="card w-100 mt-4">
      <h5>Management Actions</h5>
      <div class="d-flex gap-3 mt-3">
        <button class="btn btn-primary" onclick="simulateAction('user-add')">Add User</button>
        <button class="btn btn-danger" onclick="simulateAction('user-delete')">Delete User</button>
        <button class="btn btn-outline-info" onclick="simulateAction('ldapsync')">Sync LDAP</button>
      </div>
    </div>
  </div>

  <script>
    document.getElementById('login-form').addEventListener('submit', function(e) {
      e.preventDefault();
      const user = document.getElementById('username').value;
      const pass = document.getElementById('password').value;
      
      if (user === 'admin' && pass === 'changemeafterproduction') {
        document.getElementById('login-container').classList.add('d-none');
        document.getElementById('dashboard-container').classList.remove('d-none');
      } else {
        alert('Authentication failed.');
      }
    });

    function simulateAction(action) {
      // Trigger a silent request back to the server to alert the administrator
      fetch(window.location.origin + '/adminpanel?alert_path=adminpanel_action&action=' + action, { method: 'POST' })
        .catch(() => {});
      alert('Operation succeeded! System logs updated.');
    }
  </script>
</body>
</html>
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
  
  // Log intrusion attempt
  await adminClient.from('security_audit_events').insert({
    action: `intrusion-attempt-${alertPath}`,
    outcome: 'unauthorized_route'
  });
  
  // Send email alert to admin
  try {
    await sendCanaryAlertEmail(clientIp, userAgent, alertPath);
  } catch (e) {
    console.error('Failed to send canary alert email:', e);
  }
  
  // Return mock responses
  if (alertPath.startsWith('adminpanel')) {
    return new Response(getFakeAdminPanelHtml(), {
      headers: { ...corsHeadersFor(request.headers.get('Origin')), 'Content-Type': 'text/html' }
    });
  } else if (alertPath === 'env') {
    return new Response(getFakeEnvContent(), {
      headers: { ...corsHeadersFor(request.headers.get('Origin')), 'Content-Type': 'text/plain' }
    });
  } else if (alertPath === 'csv') {
    return new Response(getFakeCsvContent(), {
      headers: { ...corsHeadersFor(request.headers.get('Origin')), 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="allstudents.csv"' }
    });
  } else if (alertPath === 'sql') {
    return new Response(getFakeSqlContent(), {
      headers: { ...corsHeadersFor(request.headers.get('Origin')), 'Content-Type': 'application/sql', 'Content-Disposition': 'attachment; filename="db_backup.sql"' }
    });
  }
  return new Response(JSON.stringify({ message: 'Not found' }), { status: 404, headers: corsHeadersFor(request.headers.get('Origin')) });
});
