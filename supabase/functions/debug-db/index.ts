Deno.serve(async () => {
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';

  if (!cronSecret) {
    return new Response(JSON.stringify({ error: 'CRON_SECRET not set' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  const result = await fetch(
    'https://kkbzofddkfusblyplnca.supabase.co/functions/v1/daily-qr',
    {
      method: 'POST',
      headers: {
        'x-cron-secret': cronSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionTypes: ['Morning'] }),
    }
  );

  const body = await result.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = body; }

  return new Response(JSON.stringify({ httpStatus: result.status, ok: result.ok, response: parsed }, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
});
