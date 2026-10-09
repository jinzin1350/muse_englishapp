/* Cloudflare Pages Function: server-side admin gate for /adminpanel.
 *
 * POST /api/admin/verify   Authorization: Bearer <supabase user access token>
 * -> { ok: true, email } | 403 { ok: false }
 *
 * The token is validated by calling the is_admin() RPC through the Supabase
 * REST API *as the user* (anon key + user JWT). The client-side email check
 * is only UI sugar; THIS is the real gate, and every admin RPC / RLS policy
 * re-checks is_admin() on the database side too.
 *
 * Successful verifications are appended to public.admin_audit_log (needs the
 * SUPABASE_SERVICE_ROLE_KEY secret; logging is skipped if it is absent).
 *
 * Env (Pages project -> Settings -> Functions -> Variables):
 *   SUPABASE_URL (fallback: the public project URL below)
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY (optional, for audit logging)
 */

const SB_URL = 'https://hxkxowjbnbfyqiifuydn.supabase.co';
/* Public anon key (same as js/config.js) — fallback if the env var is absent.
   The service-role key is NEVER hardcoded; it only comes from env. */
const SB_ANON_FALLBACK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4a3hvd2pibmJmeXFpaWZ1eWRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3NDM5MzQsImV4cCI6MjEwNjMxOTkzNH0.M0fviKDLncJomoldPABR5BDhQjLIdM8WowfoT-FA8ik';

const RATE_MAX = 60;                    // verifications per window per IP
const RATE_WIN = 10 * 60 * 1000;
const rateMap = new Map();

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  let rec = rateMap.get(ip);
  if (!rec || now > rec.reset) rec = { count: 0, reset: now + RATE_WIN };
  rec.count += 1;
  rateMap.set(ip, rec);
  if (rec.count > RATE_MAX) return json({ ok: false, error: 'rate_limited' }, 429);

  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ ok: false }, 403);

  const url = env.SUPABASE_URL || SB_URL;
  const anon = env.SUPABASE_ANON_KEY || SB_ANON_FALLBACK;

  let isAdmin = false;
  let email = '';
  try {
    const r = await fetch(url + '/rest/v1/rpc/is_admin', {
      method: 'POST',
      headers: {
        'apikey': anon,
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!r.ok) return json({ ok: false }, 403);
    isAdmin = (await r.json()) === true;
    if (isAdmin) {
      try {
        const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        email = (JSON.parse(atob(b64)).email) || '';
      } catch (e) { /* email stays empty */ }
    }
  } catch (e) {
    return json({ ok: false }, 403);
  }
  if (!isAdmin) return json({ ok: false }, 403);

  /* Best-effort audit log (never blocks the gate). */
  const svc = env.SUPABASE_SERVICE_ROLE_KEY;
  if (svc) {
    try {
      await fetch(url + '/rest/v1/admin_audit_log', {
        method: 'POST',
        headers: {
          'apikey': svc,
          'Authorization': 'Bearer ' + svc,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ admin_email: email, action: 'panel_verify', ip: ip }),
      });
    } catch (e) { /* audit failure must not open or close the gate */ }
  }

  return json({ ok: true, email: email });
}
