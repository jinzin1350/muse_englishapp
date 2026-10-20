// Redirect the Cloudflare Pages default subdomain (*.pages.dev) to the
// canonical domain museenglishapp.com (301, path+query preserved).
// Requests on the canonical domain pass through untouched.
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === 'muse-englishapp.pages.dev' || url.hostname.endsWith('.muse-englishapp.pages.dev')) {
    url.hostname = 'museenglishapp.com';
    return Response.redirect(url.toString(), 301);
  }
  return context.next();
}
