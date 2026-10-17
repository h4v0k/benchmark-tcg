// Per-page SEO: route table (mirrors ROUTES in src/App.tsx), head rewriting and the sitemap.
// Everything here must fail soft: any error or timeout means the page is served unmodified.
import { SITE, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const isId = v => /^[1-9]\d{0,14}$/.test(v);
const isJpId = v => /^[cm][1-9]\d{0,9}$/.test(v);

// KEEP IN SYNC with ROUTES in src/App.tsx. First match wins. `kind` picks the head builder in HEAD below;
// `ok` is the same param check the app does (a failed check shows the app's NotFound page, so it is a 404 here).
export const ROUTE_LIST = [
  [/^\/$/, 'home'],
  [/^\/decks$/, 'decks'],
  [/^\/decks\/([^/]+)$/, 'deck'],
  [/^\/users$/, 'users'],
  [/^\/users\/([^/]+)$/, 'profile'],
  [/^\/my\/decks$/, 'private'],
  [/^\/collection$/, 'private'],
  [/^\/feed$/, 'feed'],
  [/^\/cards$/, 'cards'],
  [/^\/cards\/([^/]+)$/, 'card'],
  [/^\/rules$/, 'rules'],
  [/^\/events$/, 'events'],
  [/^\/events\/japan$/, 'japan'],
  [/^\/events\/japan\/card\/([^/]+)$/, 'japanCard'],
  [/^\/events\/japan\/([^/]+)$/, 'japanEvent', m => isJpId(m[1])],
  [/^\/events\/japan\/([^/]+)\/([^/]+)$/, 'japanEvent', m => isJpId(m[1]) && isId(m[2])],
  [/^\/events\/live\/([^/]+)$/, 'liveEvent', m => /^\d{1,6}$/.test(m[1])],
  [/^\/events\/([^/]+)$/, 'event', m => isId(m[1])],
  [/^\/events\/([^/]+)\/([^/]+)$/, 'event', m => isId(m[1]) && isId(m[2])],
  [/^\/matchups$/, 'matchups'],
  [/^\/matchups\/([^/]+)$/, 'matchup'],
  [/^\/matchups\/([^/]+)\/lists$/, 'matchupLists'],
  [/^\/archetype\/([^/]+)$/, 'archetype'],
  [/^\/login$/, 'private'],
  [/^\/signup$/, 'private'],
  [/^\/settings$/, 'private'],
  [/^\/admin$/, 'private'],
  [/^\/privacy$/, 'privacy'],
  [/^\/terms$/, 'terms'],
];

export function matchRoute(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  for (const [re, kind, ok] of ROUTE_LIST) {
    const m = path.match(re);
    if (m && (!ok || ok(m))) return { kind, path, args: m.slice(1).map(safeDecode) };
  }
  return null;
}
function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }

const DEFAULT = {
  title: 'Benchmark · Pokémon TCG Decks, Meta & Matchups',
  description: "Build decks, scout the meta and see real matchup win rates. Track what's winning in Japan, buy exact printings and print your registration sheet.",
  image: `${SITE}/og-image.png`,
};
const STATIC = {
  home: {},
  decks: { title: 'Browse Pokémon TCG Decks · Benchmark', description: 'Browse public Pokémon TCG decks. Filter by format, archetype and price.' },
  users: { title: 'Players · Benchmark', description: 'Find deck builders on Benchmark and see their public decks.' },
  feed: { title: 'Feed · Benchmark', description: 'New decks from the players you follow.' },
  cards: { title: 'Pokémon TCG Card Search · Benchmark', description: 'Search every Pokémon TCG card with legality, prices and exact printings.' },
  rules: { title: 'Pokémon TCG Rules · Benchmark', description: 'Deck building and format rules for Standard, Expanded and Unlimited.' },
  events: { title: 'Tournaments · Benchmark', description: 'Recent Pokémon TCG tournaments with top finishing decklists.' },
  japan: { title: 'Japan Tournaments · Benchmark', description: "See what's winning in Japanese Pokémon TCG tournaments." },
  japanCard: { title: 'Japan Card Usage · Benchmark', description: 'How a card is being played in Japanese tournament decks.' },
  japanEvent: { title: 'Japan Tournament · Benchmark', description: 'Top finishing decklists from a Japanese Pokémon TCG tournament.' },
  liveEvent: { title: 'Live Tournament · Benchmark', description: 'Live standings and decks from a Pokémon TCG tournament.' },
  matchups: { title: 'Matchup Win Rates · Benchmark', description: 'Real Pokémon TCG matchup win rates from tournament results.' },
  matchup: { title: 'Deck Matchups · Benchmark', description: 'Matchup win rates for this deck against the rest of the meta.' },
  matchupLists: { title: 'Deck Lists · Benchmark', description: 'Tournament decklists for this matchup.' },
  private: { title: 'Benchmark', noindex: true },
  privacy: { title: 'Privacy Policy · Benchmark', description: 'What Benchmark collects, why, and how to download or delete your data.' },
  terms: { title: 'Terms of Use · Benchmark', description: 'The rules for using Benchmark.' },
};

const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
export const coverUrl = base => !base ? '' : base.startsWith('https://tcgplayer-cdn.tcgplayer.com/product/') ? `${base}_in_1000x1000.jpg` : base.startsWith('https://') ? `${base}/high.webp` : '';

// Head builders: return { title, description, image }, null (generic tags; e.g. lookup failed or a deck that may be
// private), or NOT_FOUND (the lookup worked and there's no such thing: the page gets a 404 status). One REST call each.
export const NOT_FOUND = { notFound: true };
const HEAD = {
  async deck(r, q) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.args[0])) return NOT_FOUND;
    const [d] = await q(`decks?id=eq.${encodeURIComponent(r.args[0])}&is_public=eq.true&select=name,format,archetype,card_count,cover,owner_profile:profiles!decks_owner_fkey(username)&limit=1`);
    if (!d) return null; // missing and private decks look the same to us: generic tags, 200
    const owner = d.owner_profile?.username;
    const parts = [cap(clean(d.format)), clean(d.archetype)].filter(Boolean).join(' ');
    return {
      title: `${clean(d.name)} · ${cap(clean(d.format)) || 'Pokémon TCG'} deck`,
      description: trunc(`${parts ? parts + ' deck' : 'Pokémon TCG deck'}, ${d.card_count ?? 60} cards${owner ? ` by ${owner}` : ''}. View the list, price and matchups on Benchmark.`, 200),
      image: coverUrl(d.cover) || undefined,
    };
  },
  async card(r, q) {
    const [c] = await q(`cards?id=eq.${encodeURIComponent(r.args[0])}&select=name,set_id,local_id,category,hp,rarity,image&limit=1`);
    if (!c) return NOT_FOUND;
    const bits = [c.category, c.hp ? `${c.hp} HP` : '', c.rarity].filter(Boolean).join(' · ');
    return {
      title: `${clean(c.name)} (${String(c.set_id || '').toUpperCase()} ${c.local_id ?? ''}) · Card`.replace(' ) ', ') '),
      description: trunc(`${clean(c.name)}${bits ? ': ' + bits : ''}. Legality, prices and every printing on Benchmark.`, 200),
      image: coverUrl(c.image) || undefined,
    };
  },
  async profile(r, q) {
    const [p] = await q(`profiles?username=eq.${encodeURIComponent(r.args[0])}&select=username,bio&limit=1`);
    if (!p) return NOT_FOUND;
    return { title: `${p.username} · Decks`, description: trunc(clean(p.bio) || `Pokémon TCG decks by ${p.username} on Benchmark.`, 200) };
  },
  async event(r, q) {
    const [t] = await q(`tournaments?id=eq.${encodeURIComponent(r.args[0])}&select=name,date,country,players,format&limit=1`);
    if (!t) return NOT_FOUND;
    const place = r.args[1] ? ` · Place ${r.args[1]}` : '';
    return {
      title: `${clean(t.name)}${place} · Results`,
      description: trunc(`${clean(t.name)}${t.date ? `, ${t.date}` : ''}${t.players ? `, ${t.players} players` : ''}. Top finishing decklists on Benchmark.`, 200),
    };
  },
  async archetype(r) {
    const n = clean(r.args[0]);
    return { title: `${n} · Archetype`, description: trunc(`Tournament finishes, decklists and prices for ${n} in Pokémon TCG.`, 200) };
  },
};

// ---- Supabase (public anon key, cheap, edge-cached, short timeout) ----
function sbFetch(path, { ttl = 300, ms = 1500 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Accept: 'application/json' },
    signal: ctl.signal,
    cf: { cacheTtl: ttl, cacheEverything: true },
  }).then(res => { if (!res.ok) throw new Error('supabase ' + res.status); return res.json(); }).finally(() => clearTimeout(t));
}

export async function headFor(route) {
  const base = STATIC[route.kind];
  let info = base ? { ...DEFAULT, ...base } : null;
  if (HEAD[route.kind]) {
    let got = null;
    try { got = await HEAD[route.kind](route, p => sbFetch(p)); } catch { got = null; }
    if (got === NOT_FOUND) return { ...DEFAULT, title: DEFAULT.title, notFound: true, noindex: true, url: SITE + route.path };
    // empty fields (e.g. a deck with no cover) keep the defaults instead of blanking the tag
    if (got) for (const k of Object.keys(got)) if (got[k] == null || got[k] === '') delete got[k];
    info = got ? { ...DEFAULT, ...got } : { ...DEFAULT };
  }
  info = info || { ...DEFAULT };
  const title = /Benchmark/.test(info.title) ? info.title : `${info.title} · Benchmark`;
  return { ...info, title, url: route.path === '/' ? SITE + '/' : SITE + route.path };
}

export function rewriteHead(res, h) {
  const rw = new HTMLRewriter()
    .on('title', { element: e => e.setInnerContent(h.title) })
    .on('meta[name="description"]', { element: e => e.setAttribute('content', h.description) })
    .on('meta[property="og:title"]', { element: e => e.setAttribute('content', h.title) })
    .on('meta[name="twitter:title"]', { element: e => e.setAttribute('content', h.title) })
    .on('meta[property="og:description"]', { element: e => e.setAttribute('content', h.description) })
    .on('meta[name="twitter:description"]', { element: e => e.setAttribute('content', h.description) })
    .on('meta[property="og:url"]', { element: e => e.setAttribute('content', h.url) })
    .on('link[rel="canonical"]', { element: e => e.setAttribute('href', h.url) })
    .on('meta[property="og:image"]', { element: e => e.setAttribute('content', h.image) })
    .on('meta[name="twitter:image"]', { element: e => e.setAttribute('content', h.image) });
  if (h.noindex) rw.on('head', { element: e => e.append('<meta name="robots" content="noindex">', { html: true }) });
  return rw.transform(res);
}

// ---- sitemap ----
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SITEMAP_STATIC = ['/', '/decks', '/cards', '/events', '/events/japan', '/matchups', '/rules', '/users'];

export async function sitemapXml() {
  const settle = p => p.catch(() => []);
  const pages = [0, 1, 2, 3, 4].map(i => settle(sbFetch(`decks?is_public=eq.true&select=id,updated_at&order=updated_at.desc&limit=1000&offset=${i * 1000}`, { ttl: 3600 })));
  const [decks, arch, tours] = await Promise.all([
    Promise.all(pages).then(a => a.flat().slice(0, 5000)),
    settle(sbFetch('tournament_decks?select=archetype&order=fetched_at.desc&limit=1000', { ttl: 3600 })),
    settle(sbFetch('tournaments?select=id,date&order=date.desc&limit=300', { ttl: 3600 })),
  ]);
  const urls = SITEMAP_STATIC.map(p => [p, '']);
  for (const t of tours) if (t?.id != null) urls.push([`/events/${t.id}`, t.date || '']);
  const seen = new Set();
  for (const a of arch) if (a?.archetype && !seen.has(a.archetype)) { seen.add(a.archetype); urls.push([`/archetype/${encodeURIComponent(a.archetype)}`, '']); }
  for (const d of decks) if (d?.id) urls.push([`/decks/${d.id}`, d.updated_at || '']);
  const body = urls.map(([p, lm]) => `  <url><loc>${xmlEsc(SITE + (p === '/' ? '/' : p))}</loc>${lm ? `<lastmod>${xmlEsc(String(lm).slice(0, 10))}</lastmod>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
