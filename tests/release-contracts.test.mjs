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
});
