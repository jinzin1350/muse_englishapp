// Same-origin serving for lesson media (2026-11-20).
//
// Lesson media (media/<level>/<YYYY-MM-DD>/...) lives in the muse-mp3 R2
// bucket, NOT in the Pages deployment — the repo crossed Cloudflare Pages'
// 20,000-file limit on 2026-11-20. This function streams lesson media from
// the bucket's public URL at the SAME museenglishapp.com/media/... address
// the app has always used, so nothing changes for learners (and the
// same-domain route keeps it reachable from Iran, where *.r2.dev is
// blocked). Range headers pass through, so audio seeking keeps working.
// Anything else under /media/ (vocab, teachers, landing, ...) is still a
// static Pages asset and is served via env.ASSETS. If R2 ever 404s a
// lesson file, we fall back to the static asset before giving up.

const UPSTREAM = 'https://pub-b26d6db3b0dd4beeb7e10e9ab20e4012.r2.dev/';
const LESSON_RE = /^(a1|a2|b1|b2|c1|c2)\/\d{4}-\d{2}-\d{2}\//;

export async function onRequest(context) {
  const { request, params, env } = context;
  const path = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');

  if (!LESSON_RE.test(path)) {
    const asset = await env.ASSETS.fetch(request);
    const h = new Headers(asset.headers);
    h.set('X-Media-Origin', 'assets');
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers: h });
  }

  const url = new URL(request.url);
  const resp = await fetch(UPSTREAM + 'media/' + path + url.search, {
    method: request.method,
    headers: request.headers
  });

  if (resp.status === 404) {
    const asset = await env.ASSETS.fetch(request);
    const h = new Headers(asset.headers);
    h.set('X-Media-Origin', 'assets-fallback');
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers: h });
  }

  const outHeaders = new Headers(resp.headers);
  outHeaders.set('Cache-Control', 'public, max-age=86400');
  outHeaders.set('X-Media-Origin', 'r2');
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: outHeaders
  });
}
