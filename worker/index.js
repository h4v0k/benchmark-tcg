// Cloudflare Worker in front of the static site.
// Only /img/* reaches this code (see run_worker_first in wrangler.jsonc); everything else is served
// straight from the static assets. /img/* re-serves TCGdex card art from our own domain so the deck
// image export can draw it to a canvas and save it as a PNG (cross-origin images would block that).

const UPSTREAM = 'https://assets.tcgdex.net';
// e.g. /img/en/sv/sv10/081/high.webp → https://assets.tcgdex.net/en/sv/sv10/081/high.webp
const ALLOWED = /^\/img\/[a-z]{2}(?:-[a-z]{2})?\/[a-z0-9.-]+\/[a-z0-9.-]+\/[A-Za-z0-9.-]+\/(?:low|high)\.(?:webp|png|jpg)$/;
const WEEK = 60 * 60 * 24 * 7;

async function cardImage(request, ctx, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  if (!ALLOWED.test(url.pathname)) return new Response('Not found', { status: 404 });
  const cache = caches.default;
  const key = new Request(url.origin + url.pathname, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const up = await fetch(UPSTREAM + url.pathname.slice(4), { cf: { cacheTtl: WEEK, cacheEverything: true } });
  if (!up.ok) return new Response('Not found', { status: up.status === 404 ? 404 : 502 });
  const res = new Response(up.body, {
    headers: {
      'Content-Type': up.headers.get('Content-Type') || 'image/webp',
      'Cache-Control': `public, max-age=${WEEK}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/img/')) return cardImage(request, ctx, url);
    return env.ASSETS.fetch(request);
  },
};
