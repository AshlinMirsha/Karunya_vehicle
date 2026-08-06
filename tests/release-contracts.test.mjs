import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('daily QR schedule uses the required 5 AM and 3 PM IST UTC schedules', async () => {
  const migration = await read('supabase/migrations/20260802135404_schedule_daily_qr.sql');
  assert.match(migration, /karunya-morning-qr', '30 23 \* \* \*'/);
  assert.match(migration, /karunya-evening-qr', '30 9 \* \* \*'/);
  assert.match(migration, /x-cron-secret/);
});

test('daily QR function protects the scheduler and delivers a QR email', async () => {
  const source = await read('supabase/functions/daily-qr/index.ts');
  assert.match(source, /x-cron-secret/);
  assert.match(source, /EMAIL_APP_PASSWORD/);
  assert.match(source, /npm:qrcode@/);
  assert.match(source, /QRCode\.toDataURL/);
  assert.match(source, /Content-Type: image\/png/);
  assert.match(source, /Content-ID: <\$\{QR_IMAGE_CID\}>/);
  assert.match(source, /QR_SESSION_DURATION_MS = 5 \* 60 \* 60 \* 1000/);
  assert.match(source, /Failed to send email/);
});

test('attendance API remains JWT-protected', async () => {
  const config = await read('supabase/config.toml');
  const client = await read('supabase/client.js');
  const api = await read('supabase/functions/attendance-api/index.ts');
  assert.match(config, /\[functions\.attendance-api\][\s\S]*verify_jwt = true/);
  assert.match(api, /headers: \{ Authorization: authorization \}/);
  assert.match(api, /auth\.getUser\(\)/);
  assert.match(api, /SESSION_TYPES\.has\(body\.sessionType\)/);
  assert.match(api, /QR_TOKEN_PATTERN/);
  assert.match(api, /withinCoordinateBounds/);
  assert.match(api, /isAllowedOrigin/);
  assert.match(api, /Forbidden origin/);
  assert.match(api, /consume_attendance_rate_limit/);
  assert.match(api, /security_audit_events/);
  assert.match(api, /SESSION_DURATION_MS = 5 \* 60 \* 60 \* 1000/);
  assert.match(api, /manickaraja@karunya\.edu/);
  assert.match(api, /profile\.role !== 'coordinator'/);
  assert.match(api, /profile\.bus_id !== bus\.id/);
  assert.doesNotMatch(api, /\['admin', 'coordinator'\]/);
  assert.match(client, /storage: window\.sessionStorage/);
  assert.match(client, /flowType: 'pkce'/);
});

test('database policies scope coordinators while restoring all-bus admin access', async () => {
  const [migration, coordinatorScope, currentRoles, dashboard, coordinator] = await Promise.all([
    read('supabase/migrations/20260802143000_harden_rls_policies.sql'),
    read('supabase/migrations/20260803131000_scope_coordinator_student_visibility.sql'),
    read('supabase/migrations/20260803143000_remove_admin_role_use_coordinators_only.sql'),
    read('supabase/migrations/20260803150000_restore_admin_and_dashboard_history.sql'),
    read('js/coordinator.js'),
  ]);
  assert.match(migration, /read assigned bus/);
  assert.match(migration, /read authorized attendance/);
  assert.match(migration, /current_user_role\(\) = 'coordinator'/);
  assert.match(coordinatorScope, /coordinators read assigned students/);
  assert.match(coordinatorScope, /role = 'student'/);
  assert.match(coordinatorScope, /bus_id = \(/);
  assert.match(currentRoles, /profiles_role_no_admin_check/);
  assert.match(currentRoles, /role = 'coordinator'/);
  assert.match(currentRoles, /ashlinmirsha@karunya\.edu\.in/);
  assert.match(currentRoles, /bus_number = '1'/);
  assert.match(currentRoles, /manickaraja@karunya\.edu/);
  assert.match(currentRoles, /bus_number = '2'/);
  assert.doesNotMatch(currentRoles, /assigned_role := 'admin'/);
  assert.match(dashboard, /lohita@karunya\.edu\.in/);
  assert.match(dashboard, /profiles_role_with_admin_check/);
  assert.match(dashboard, /authorized_attendance_history/);
  assert.match(dashboard, /Coordinator access is limited to the assigned bus/);
  assert.match(coordinator, /initOperationsDashboard\('coordinator'\)/);
});

test('attendance sheets can read their session and bus relationships', async () => {
  const [policy, student] = await Promise.all([
    read('supabase/migrations/20260803051000_allow_attendance_session_reads.sql'),
    read('js/student.js'),
  ]);
  assert.match(policy, /read authorized attendance sessions/);
  assert.match(policy, /current_user_role\(\) = 'coordinator'/);
  assert.match(policy, /attendance\.student_id = auth\.uid\(\)/);
  assert.match(student, /rpc\('student_attendance_history'\)/);
});

test('Benesha Mercy is assigned as an active student on Bus 2', async () => {
  const migration = await read('supabase/migrations/20260803134000_move_benesha_student_to_bus_two.sql');
  assert.match(migration, /beneshamercy@karunya\.edu\.in/);
  assert.match(migration, /role = 'student'/);
  assert.match(migration, /bus_number = '2'/);
  assert.match(migration, /status = 'active'/);
});

test('check-in scanner requests a camera stream and supports QR decoding fallback', async () => {
  const scanner = await read('js/qr-scanner.js');
  const page = await read('pages/checkin.html');
  assert.match(scanner, /mediaDevices\?\.getUserMedia/);
  assert.match(scanner, /BarcodeDetector/);
  assert.match(scanner, /window\.jsQR/);
  assert.match(scanner, /getTracks\(\).*stop/);
  assert.match(scanner, /let isCameraStarting = false/);
  assert.match(scanner, /let isDecoding = false/);
  assert.match(scanner, /let isSubmitting = false/);
  assert.match(scanner, /generation !== scanGeneration/);
  assert.match(scanner, /showCheckinSuccess/);
  assert.match(scanner, /showCheckinConfirmation/);
  assert.match(scanner, /attendanceErrorMessage/);
  assert.match(scanner, /rememberProtectedRedirect\(\)/);
  assert.match(scanner, /auth\.getSession\(\)/);
  assert.match(scanner, /auth\.getUser\(\)/);
  assert.match(scanner, /const token = extractToken\(input\.value\)/);
  assert.match(scanner, /body: \{ action: 'mark-attendance', token,/);
  assert.match(page, /jsqr@1\.4\.0/);
  assert.match(page, /\.\.\/Logo\.png/);
  assert.match(page, /protected-page/);
  assert.match(page, /qr-scan-line/);
  assert.match(page, /checkin-success-dialog/);
  assert.match(page, /checkin-confirm-dialog/);
});

test('protected pages require authenticated render and preserve safe post-login redirects', async () => {
  const [auth, login, styles, student, coordinator, operationsDashboard, navbar, scanner, index, vercel] = await Promise.all([
    read('js/auth.js'),
    read('js/login-page.js'),
    read('assets/css/style.css'),
    read('pages/student.html'),
    read('pages/coordinator.html'),
    read('js/operations-dashboard.js'),
    read('components/navbar.js'),
    read('js/qr-scanner.js'),
    read('pages/index.html'),
    read('vercel.json'),
  ]);
  assert.match(auth, /SAFE_REDIRECT_PATTERN/);
  assert.match(auth, /postLoginRedirect/);
  assert.match(auth, /admin\|dashboard/);
  assert.match(login, /consumeProtectedRedirect\(\)/);
  assert.match(login, /rpc\('current_app_profile'\)/);
  assert.match(login, /roleHome/);
  assert.match(login, /safeRedirect/);
  assert.match(login, /profile\?\.role === 'admin' \? '\/admin'/);
  assert.match(await read('js/student.js'), /auth\.getSession\(\)/);
  assert.match(await read('js/student.js'), /rpc\('current_app_profile'\)/);
  assert.match(await read('js/student.js'), /roleProfile\.role === 'coordinator'/);
  assert.match(await read('js/student.js'), /location\.replace\('\/coordinator'\)/);
  assert.match(await read('js/admin.js'), /initOperationsDashboard\('admin'\)/);
  assert.match(operationsDashboard, /auth\.getSession\(\)/);
  assert.match(await read('js/coordinator.js'), /initOperationsDashboard\('coordinator'\)/);
  assert.match(vercel, /Cache-Control/);
  assert.match(vercel, /no-store, max-age=0/);
  assert.match(vercel, /"source": "\/admin"[\s\S]*"destination": "\/pages\/admin\.html"/);
  assert.match(vercel, /"source": "\/dashboard"[\s\S]*"destination": "\/pages\/admin\.html"/);
  assert.doesNotMatch(index, /Students use/);
  assert.doesNotMatch(index, /assigned Bus 2 coordinator/i);
  assert.match(styles, /\.protected-page:not\(\.role-authorized\) main/);
  assert.match(student, /protected-page/);
  assert.match(student, /document\.readyState === 'loading'/);
  assert.match(coordinator, /protected-page/);
  assert.match(coordinator, /document\.readyState\s*={2,3}\s*'loading'/);
  assert.match(scanner, /document\.body\.classList\.add\('role-authorized'\)/);
  assert.doesNotMatch(navbar, /\?\.[^;\n]*\)\.[^;\n]*=/);
});
