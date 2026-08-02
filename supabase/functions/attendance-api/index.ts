// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': 'https://karunya-bus-attendance.vercel.app', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' };
const QR_SECRET = Deno.env.get('QR_SECRET');
const earthRadiusMeters = 6371000;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
const distanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => { const radians = Math.PI / 180; const deltaLat = (lat2-lat1)*radians; const deltaLon = (lon2-lon1)*radians; const a = Math.sin(deltaLat/2)**2 + Math.cos(lat1*radians)*Math.cos(lat2*radians)*Math.sin(deltaLon/2)**2; return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); };
const hashToken = async (token: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${QR_SECRET}:${token}`)))).map((item) => item.toString(16).padStart(2, '0')).join('');

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const authorization = request.headers.get('Authorization');
  if (!authorization || !QR_SECRET) return json({ message: 'Unauthorized request.' }, 401);
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user?.email?.endsWith('@karunya.edu.in')) return json({ message: 'Only official Karunya accounts are authorized.' }, 403);
  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: profile } = await adminClient.from('profiles').select('*').eq('id', user.id).single();
  if (!profile) return json({ message: 'Profile is not ready. Please sign in again.' }, 409);
  const body = await request.json().catch(() => ({}));
  if (body.action === 'create-session') {
    if (!['admin','coordinator'].includes(profile.role)) return json({ message: 'Not authorized.' }, 403);
    const { data: bus } = await adminClient.from('buses').select('id').eq('id', body.busId).single();
    if (!bus || (profile.role === 'coordinator' && profile.bus_id !== bus.id)) return json({ message: 'Bus is not assigned to you.' }, 403);
    const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { data: session, error } = await adminClient.from('attendance_sessions').insert({ bus_id: bus.id, session_type: body.sessionType, token_hash: await hashToken(token), expires_at: expiresAt, created_by: user.id }).select('id').single();
    if (error) return json({ message: 'Could not create QR session.' }, 500);
    return json({ token, sessionId: session.id, expiresAt });
  }
  if (body.action === 'mark-attendance') {
    const { token, latitude, longitude } = body;
    if (!token || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return json({ message: 'A QR token and valid GPS location are required.' }, 400);
    if (profile.status !== 'active' || !profile.bus_id) return json({ message: 'Your bus assignment is not active.' }, 403);
    const { data: session } = await adminClient.from('attendance_sessions').select('*, buses(*)').eq('token_hash', await hashToken(token)).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!session || session.bus_id !== profile.bus_id) return json({ message: 'Invalid, expired, or incorrect-bus QR session.' }, 400);
    if (distanceMeters(latitude, longitude, session.buses.latitude, session.buses.longitude) > session.buses.radius_meters) return json({ message: 'You are outside the permitted bus geofence.' }, 400);
    const { error } = await adminClient.from('attendance').insert({ session_id: session.id, student_id: user.id, latitude, longitude });
    if (error?.code === '23505') return json({ message: 'Attendance is already registered for this session.' }, 409);
    if (error) return json({ message: 'Attendance could not be recorded.' }, 500);
    return json({ message: 'Attendance marked successfully!' });
  }
  return json({ message: 'Unknown action.' }, 400);
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/attendance-api' \
    --header 'apiKey: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' \
    --header 'Authorization: Bearer <UserToken>'
*/
