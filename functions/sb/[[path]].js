// Same-origin proxy to Supabase (2026-11-18, Alireza's order).
//
// Why: learners in Iran cannot reach *.supabase.co without a VPN, so the
// app could not sign in or load data there. The app now points its
// SUPABASE_URL at https://museenglishapp.com/sb (js/config.js) and this
// function forwards every auth / REST / storage request to the real
// Supabase project from Cloudflare's edge. Same-origin, so no CORS.
//
// The app uses no Supabase Realtime channels (verified in src), so plain
// HTTP proxying covers everything it calls.

const UPSTREAM = 'https://hxkxowjbnbfyqiifuydn.supabase.co';

export async function onRequest(context) {
  const { request, params } = context;
  const path = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');
  const url = new URL(request.url);
  const target = UPSTREAM + '/' + path + url.search;

  const headers = new Headers(request.headers);
  headers.delete('host');

  const init = { method: request.method, headers: headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  const resp = await fetch(target, init);

  const outHeaders = new Headers(resp.headers);
  outHeaders.delete('content-encoding');
  outHeaders.delete('content-length');
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: outHeaders
  });
}
