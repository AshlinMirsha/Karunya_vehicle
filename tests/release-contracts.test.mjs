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
  assert.match(source, /GMAIL_REFRESH_TOKEN/);
  assert.match(source, /npm:qrcode@/);
  assert.match(source, /Content-ID: <\$\{QR_IMAGE_CID\}>/);
  assert.match(source, /Gmail did not accept/);
});

test('attendance API remains JWT-protected', async () => {
  const config = await read('supabase/config.toml');
  const api = await read('supabase/functions/attendance-api/index.ts');
  assert.match(config, /\[functions\.attendance-api\][\s\S]*verify_jwt = true/);
  assert.match(api, /headers: \{ Authorization: authorization \}/);
  assert.match(api, /auth\.getUser\(\)/);
  assert.match(api, /SESSION_TYPES\.has\(body\.sessionType\)/);
  assert.match(api, /QR_TOKEN_PATTERN/);
  assert.match(api, /withinCoordinateBounds/);
});

test('database policies scope buses and coordinator attendance to the assigned bus', async () => {
  const migration = await read('supabase/migrations/20260802143000_harden_rls_policies.sql');
  assert.match(migration, /read assigned bus/);
  assert.match(migration, /read authorized attendance/);
  assert.match(migration, /current_user_role\(\) = 'coordinator'/);
});

test('attendance sheets can read their session and bus relationships', async () => {
  const [policy, dashboard] = await Promise.all([
    read('supabase/migrations/20260803051000_allow_attendance_session_reads.sql'),
    read('js/admin.js'),
  ]);
  assert.match(policy, /read authorized attendance sessions/);
  assert.match(policy, /current_user_role\(\) = 'admin'/);
  assert.match(policy, /attendance\.student_id = auth\.uid\(\)/);
  assert.match(dashboard, /attendance_sessions!inner\(session_type,buses!inner\(bus_number\)\)/);
});

test('Benesha Mercy is seeded as an active student on Bus 1', async () => {
  const migration = await read('supabase/migrations/20260803050000_assign_benesha_bus_one.sql');
  assert.match(migration, /beneshamercy@karunya\.edu\.in/);
  assert.match(migration, /R A BENESHA MERCY RAMESH/);
  assert.match(migration, /URK25CS1176/);
  assert.match(migration, /bus_number = '1'/);
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
});

test('protected pages require authenticated render and preserve safe post-login redirects', async () => {
  const [auth, login, styles, student, coordinator, navbar, admin, scanner] = await Promise.all([
    read('js/auth.js'),
    read('js/login-page.js'),
    read('assets/css/style.css'),
    read('pages/student.html'),
    read('pages/coordinator.html'),
    read('components/navbar.js'),
    read('js/admin.js'),
    read('js/qr-scanner.js'),
  ]);
  assert.match(auth, /SAFE_REDIRECT_PATTERN/);
  assert.match(auth, /postLoginRedirect/);
  assert.match(login, /consumeProtectedRedirect\(\)/);
  assert.match(await read('js/student.js'), /auth\.getSession\(\)/);
  assert.match(await read('js/admin.js'), /auth\.getSession\(\)/);
  assert.match(await read('js/coordinator.js'), /auth\.getSession\(\)/);
  assert.match(styles, /\.protected-page:not\(\.role-authorized\) main/);
  assert.match(student, /protected-page/);
  assert.match(student, /document\.readyState === 'loading'/);
  assert.match(coordinator, /protected-page/);
  assert.match(coordinator, /document\.readyState === 'loading'/);
  assert.match(admin, /const visibleRows = rows\.length \? rows : \[makeRow\(\[emptyMessage\]\)\];/);
  assert.match(admin, /document\.body\.classList\.add\('role-authorized'\)/);
  assert.match(scanner, /document\.body\.classList\.add\('role-authorized'\)/);
  assert.doesNotMatch(navbar, /\?\.[^;\n]*\)\.[^;\n]*=/);
});
