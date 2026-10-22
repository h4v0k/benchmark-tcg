// /api/geo?zip=: turns a US ZIP code into coordinates for the Toolbox event finder.
// The finder then opens the official Play! Pokémon event locator already searched for that spot. The locator has no
// public API (its data comes from a private, bot-protected app endpoint), so we link to it rather than scrape it.

const ZIP_API = 'https://api.zippopotam.us/us/';

const json = (body, status = 200, maxAge = 0) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

async function geo(zip) {
  const r = await fetch(ZIP_API + zip, { cf: { cacheTtl: 86400 * 30, cacheEverything: true } });
  if (!r.ok) return null;
  const d = await r.json();
  const p = d.places?.[0];
  return p ? { lat: +p.latitude, lng: +p.longitude, place: `${p['place name']}, ${p['state abbreviation']}` } : null;
}

export async function handleApi(request, ctx, url) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (url.pathname !== '/api/geo') return json({ error: 'Not found' }, 404);
  const zip = url.searchParams.get('zip') || '';
  if (!/^\d{5}$/.test(zip)) return json({ error: 'Enter a 5-digit ZIP code.' }, 400);
  const g = await geo(zip).catch(() => null);
  return g ? json(g, 200, 86400) : json({ error: 'That ZIP code wasn’t found.' }, 404);
}
