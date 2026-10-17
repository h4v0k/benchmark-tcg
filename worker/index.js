// Cloudflare Worker in front of the static site.
// Handles /img/*, /sitemap.xml and HTML page requests (see run_worker_first in wrangler.jsonc); built files are served
// straight from the static assets. /img/* re-serves TCGdex card art from our own domain so the deck
// image export can draw it to a canvas and save it as a PNG (cross-origin images would block that).

import { matchRoute, headFor, rewriteHead, sitemapXml } from './seo.js';

const UPSTREAM = 'https://assets.tcgdex.net';
// TCGplayer's photo of a printing that TCGdex has no art for: /img/tcgp/475431_in_1000x1000.jpg
const TCGP_UPSTREAM = 'https://tcgplayer-cdn.tcgplayer.com/product/';
const TCGP_ALLOWED = /^\/img\/tcgp\/(\d{1,9}_(?:in_1000x1000|200w)\.jpg)$/;
// e.g. /img/en/sv/sv10/081/high.webp → https://assets.tcgdex.net/en/sv/sv10/081/high.webp
const ALLOWED = /^\/img\/[a-z]{2}(?:-[a-z]{2})?\/[a-z0-9.-]+\/[a-z0-9.-]+\/[A-Za-z0-9.-]+\/(?:low|high)\.(?:webp|png|jpg)$/;
const WEEK = 60 * 60 * 24 * 7;

async function cardImage(request, ctx, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const tcgp = url.pathname.match(TCGP_ALLOWED);
  if (!tcgp && !ALLOWED.test(url.pathname)) return new Response('Not found', { status: 404 });
  const cache = caches.default;
  const key = new Request(url.origin + url.pathname, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const up = await fetch(tcgp ? TCGP_UPSTREAM + tcgp[1] : UPSTREAM + url.pathname.slice(4), { cf: { cacheTtl: WEEK, cacheEverything: true } });
  if (!up.ok) return new Response('Not found', { status: up.status === 404 ? 404 : 502 });
  const res = new Response(up.body, {
    headers: {
      'Content-Type': up.headers.get('Content-Type') || 'image/webp',
      'Cache-Control': `public, max-age=${WEEK}`,
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function sitemap(request, ctx) {
  const key = new Request(new URL(request.url).origin + '/sitemap.xml', { method: 'GET' });
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const hit = cache && await cache.match(key);
  if (hit) return hit;
  const res = new Response(await sitemapXml(), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  if (cache) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// HTML pages: serve the app shell (index.html) with per-route head tags. Unknown routes get a real 404 status
// but the same shell, so the app shows its NotFound page. Headers (incl. CSP) come from the asset response,
// where public/_headers is applied, and are carried over untouched.
async function page(request, env, url) {
  const shell = await env.ASSETS.fetch(new Request(url.origin + '/', { method: 'GET', headers: request.headers }));
  const ct = shell.headers.get('Content-Type') || '';
  if (!shell.ok || !ct.includes('text/html')) return shell;
  const route = matchRoute(url.pathname);
  if (!route) return new Response(shell.body, { status: 404, headers: shell.headers });
  try {
    return rewriteHead(shell, await headFor(route));
  } catch {
    return env.ASSETS.fetch(new Request(url.origin + '/', { method: 'GET' }));
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/img/')) return cardImage(request, ctx, url);
    if (url.pathname === '/sitemap.xml' && (request.method === 'GET' || request.method === 'HEAD')) {
      try { return await sitemap(request, ctx); } catch { return new Response('Unavailable', { status: 503 }); }
    }
    // Files (anything with an extension) and non-GET requests go straight to the static assets.
    if ((request.method !== 'GET' && request.method !== 'HEAD') || /\.[a-z0-9]{1,8}$/i.test(url.pathname)) return env.ASSETS.fetch(request);
    try { return await page(request, env, url); } catch { return env.ASSETS.fetch(request); }
  },
};
