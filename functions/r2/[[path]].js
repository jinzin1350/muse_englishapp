// Same-origin proxy to the public R2 media bucket (2026-11-18).
//
// Why: pre-2026-10-10 lesson media lives only in the muse-mp3 R2 bucket,
// whose public *.r2.dev address is unreachable from Iran without a VPN.
// R2_MEDIA_BASE in the app now points at https://museenglishapp.com/r2/
// and this function streams the file from the bucket's public URL.
// Range headers pass through, so audio seeking keeps working.

const UPSTREAM = 'https://pub-b26d6db3b0dd4beeb7e10e9ab20e4012.r2.dev/';

export async function onRequest(context) {
  const { request, params } = context;
  const path = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');
  const url = new URL(request.url);

  const resp = await fetch(UPSTREAM + path + url.search, {
    method: request.method,
    headers: request.headers
  });

  const outHeaders = new Headers(resp.headers);
  outHeaders.set('Cache-Control', 'public, max-age=86400');
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: outHeaders
  });
}
