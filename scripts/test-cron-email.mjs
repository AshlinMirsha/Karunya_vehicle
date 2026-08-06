#!/usr/bin/env node
/**
 * Isolated test script for the daily-qr cron email function.
 *
 * Usage:
 *   node scripts/test-cron-email.mjs --secret <CRON_SECRET_VALUE> [--time morning|evening]
 *
 * The CRON_SECRET can be found in your Supabase Dashboard:
 *   Settings → Edge Functions → Secrets → CRON_SECRET (view plaintext value)
 *
 * Or pass via environment variable:
 *   CRON_SECRET=your_secret node scripts/test-cron-email.mjs
 */

const FUNCTION_URL = 'https://kkbzofddkfusblyplnca.supabase.co/functions/v1/daily-qr';

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
};

const cronSecret = getArg('--secret') || process.env.CRON_SECRET;
const timeArg = (getArg('--time') || 'morning').toLowerCase();

if (!cronSecret) {
  console.error('❌ Error: CRON_SECRET is required.');
  console.error('   Run with: node scripts/test-cron-email.mjs --secret YOUR_CRON_SECRET');
  console.error('   Or set environment variable: CRON_SECRET=your_secret node scripts/test-cron-email.mjs');
  process.exit(1);
}

const sessionTypes = timeArg === 'evening' ? ['Evening'] : timeArg === 'both' ? ['Morning', 'Evening'] : ['Morning'];

console.log('─'.repeat(60));
console.log(`🚌 Karunya Bus Attendance — Cron Email Test`);
console.log('─'.repeat(60));
console.log(`  Function URL : ${FUNCTION_URL}`);
console.log(`  Session type : ${sessionTypes.join(', ')}`);
console.log(`  Secret       : ${cronSecret.slice(0, 6)}${'*'.repeat(8)}...`);
console.log('─'.repeat(60));
console.log('Sending request...\n');

const startTime = Date.now();
let response, text, data;

try {
  response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'x-cron-secret': cronSecret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sessionTypes }),
  });

  text = await response.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
} catch (err) {
  console.error('❌ Network error:', err.message);
  process.exit(1);
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`HTTP Status : ${response.status} ${response.statusText}`);
console.log(`Time taken  : ${elapsed}s`);
console.log(`Response    :`);
console.log(JSON.stringify(data, null, 2));
console.log('─'.repeat(60));

if (response.status === 401) {
  console.error('\n❌ UNAUTHORIZED — The CRON_SECRET does not match.');
  console.error('   Check your Supabase Dashboard → Edge Functions → Secrets → CRON_SECRET');
  process.exit(1);
}

if (!response.ok) {
  console.error(`\n❌ Request failed with status ${response.status}`);
  process.exit(1);
}

// Analyse per-bus results
if (Array.isArray(data?.results)) {
  const sent = data.results.filter(r => r.emailStatus === 'sent');
  const failed = data.results.filter(r => r.emailStatus === 'failed');
  const skipped = data.results.filter(r => r.emailStatus?.startsWith('skipped'));

  console.log(`\n📊 Results summary:`);
  console.log(`   ✅ Sent    : ${sent.length}`);
  console.log(`   ❌ Failed  : ${failed.length}`);
  console.log(`   ⏭️  Skipped : ${skipped.length}`);

  if (sent.length > 0) {
    console.log(`\n✅ Emails sent successfully to:`);
    sent.forEach(r => console.log(`   Bus ${r.bus} (${r.sessionType})`));
  }

  if (failed.length > 0) {
    console.error(`\n❌ Failed to send emails:`);
    failed.forEach(r => console.error(`   Bus ${r.bus} (${r.sessionType}): ${r.error}`));
    process.exit(1);
  }

  if (sent.length > 0) {
    console.log('\n🎉 All emails sent successfully!');
  }
} else {
  console.log('\n⚠️  No per-bus results in response. Check function logs in Supabase Dashboard.');
}
