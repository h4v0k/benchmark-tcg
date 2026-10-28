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
  [/^\/tools$/, 'tools'],
  [/^\/tools\/damage$/, 'toolDamage'],
  [/^\/tools\/tracker$/, 'toolTracker'],
  [/^\/tools\/cp$/, 'toolCp'],
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
  [/^\/copyright$/, 'copyright'],
  [/^\/accessibility$/, 'accessibility'],
  [/^\/credits$/, 'credits'],
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
  tools: { title: 'Pokémon TCG Toolbox · Benchmark', description: 'Damage and prize-trade calculator, game tracker, Championship Points tracker and an event finder for Pokémon TCG players.' },
  toolDamage: { title: 'Pokémon TCG Damage & Prize Trade Calculator · Benchmark', description: 'Exact damage with Weakness, Resistance and modifiers in rulebook order, plus the fewest Knock Outs to take your Prize cards.' },
  toolTracker: { title: 'Pokémon TCG Game Tracker · Benchmark', description: 'Track damage counters, Special Conditions, Prize cards and once-per-turn actions at the table.' },
  toolCp: { title: 'Championship Points Tracker · Benchmark', description: 'Log your Play! Pokémon finishes and see your season CP with best-finish limits applied.' },
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
  copyright: { title: 'Copyright Policy · Benchmark', description: 'How to report copyright infringement on Benchmark.' },
  accessibility: { title: 'Accessibility · Benchmark', description: 'How Benchmark supports keyboard, screen reader, large text and reduced motion users, and how to report a problem.' },
  credits: { title: 'Data Credits · Benchmark', description: 'Where Benchmark gets its card, price and tournament data.' },
};

const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const MIN_GAMES = 20; // same floor as the app's online matchups (src/pages/Matchups.tsx)
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const link = (href, text) => `<a href="${esc(href)}">${esc(clean(text))}</a>`;

// Crawlable page body: plain HTML put inside #root, so crawlers (and visitors before the app loads) get the
// page's real content and links. React replaces it on its first render.
function page(trail, h1, inner) {
  const nav = trail ? `<p class="crumbs">${[['Benchmark', '/'], ...trail].map(([t, h]) => link(h, t)).join(' › ')}</p>` : '';
  return `<div class="wrap page ssr">${nav}<h1>${esc(h1)}</h1>${inner.replace(/\n\s+/g, '')}</div>`;
}
function crumbs(trail) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [['Benchmark', '/'], ...trail].map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + (p === '/' ? '/' : p) })) };
}
// Share images are served from our own domain through the /img/* proxy (worker/index.js), not straight from
// TCGdex/TCGplayer: link-preview crawlers (X, Discord, Slack) fetch og:image themselves and third-party CDNs can
// refuse or stall them, which shows up as a blank preview card.
const TCGDEX = 'https://assets.tcgdex.net/';
const TCGP = 'https://tcgplayer-cdn.tcgplayer.com/product/';
export const coverUrl = base => {
  if (!base) return '';
  if (base.startsWith(TCGP) && /^\d{1,9}$/.test(base.slice(TCGP.length))) return `${SITE}/img/tcgp/${base.slice(TCGP.length)}_in_1000x1000.jpg`;
  if (base.startsWith(TCGDEX) && /^[a-z]{2}(?:-[a-z]{2})?\/[a-z0-9.-]+\/[a-z0-9.-]+\/[A-Za-z0-9.-]+$/.test(base.slice(TCGDEX.length))) return `${SITE}/img/${base.slice(TCGDEX.length)}/high.webp`;
  return '';
};

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
    // case-insensitive, same as the app (src/lib/api.ts), with wildcard characters removed
    const [p] = await q(`profiles?username=ilike.${encodeURIComponent(r.args[0].replace(/[%_*,()]/g, ''))}&select=username,bio&limit=1`);
    if (!p) return NOT_FOUND;
    return { title: `${p.username} · Decks`, description: trunc(clean(p.bio) || `Pokémon TCG decks by ${p.username} on Benchmark.`, 200) };
  },
  async event(r, q) {
    const id = encodeURIComponent(r.args[0]);
    if (r.args[1]) {
      const [[t], [d]] = await Promise.all([
        q(`tournaments?id=eq.${id}&select=name,date,players&limit=1`),
        q(`tournament_decks?tournament_id=eq.${id}&place=eq.${encodeURIComponent(r.args[1])}&select=place,player,country,archetype,cards&limit=1`),
      ]);
      if (!t) return NOT_FOUND;
      if (!d) return { title: `${clean(t.name)} · Place ${r.args[1]} · Results` };
      const who = `${clean(d.player)}${d.country ? ` (${clean(d.country)})` : ''}`;
      const title = `${clean(d.archetype)} deck list · ${ord(d.place)} at ${clean(t.name)}`;
      const main = (Array.isArray(d.cards) ? d.cards : []).filter(c => c && c.board !== 'side');
      const sections = ['Pokemon', 'Trainer', 'Energy'].map(cat => [cat, main.filter(c => c.cat === cat)]).filter(([, l]) => l.length);
      // Share image: art of the Pokémon the list plays most copies of (link previews show it)
      const star = main.filter(c => c.cat === 'Pokemon' && c.cid).sort((a, b) => (+b.qty || 0) - (+a.qty || 0))[0];
      const [art] = star ? await q(`cards?id=eq.${encodeURIComponent(star.cid)}&select=image&limit=1`).catch(() => []) : [];
      const list = sections.map(([cat, l]) => `<h2>${esc(cat === 'Pokemon' ? 'Pokémon' : cat)} (${l.reduce((n, c) => n + (+c.qty || 0), 0)})</h2><ul>${l.map(c => `<li>${+c.qty || 0} ${c.cid ? link(`/cards/${encodeURIComponent(c.cid)}`, c.name) : esc(c.name)}</li>`).join('')}</ul>`).join('');
      return {
        title,
        image: coverUrl(art?.image) || undefined,
        description: trunc(`${who} finished ${ord(d.place)} at ${clean(t.name)}${t.date ? ` (${t.date})` : ''} with ${clean(d.archetype)}. Full 60-card list, prices and one-click TCGplayer buy on Benchmark.`, 200),
        body: page([['Tournaments', '/events'], [clean(t.name), `/events/${r.args[0]}`]], title,
          `<p>${esc(who)} placed ${ord(d.place)}${t.players ? ` of ${t.players} players` : ''} at ${esc(clean(t.name))}${t.date ? ` on ${esc(t.date)}` : ''}.</p>${list}
          <p>${link(`/archetype/${encodeURIComponent(d.archetype)}`, `More ${clean(d.archetype)} finishes`)} · ${link('/matchups', 'Matchup win rates')}</p>`),
        jsonld: crumbs([['Tournaments', '/events'], [clean(t.name), `/events/${r.args[0]}`], [title, r.path]]),
      };
    }
    const [[t], decks] = await Promise.all([
      q(`tournaments?id=eq.${id}&select=name,date,country,players,format&limit=1`),
      q(`tournament_decks?tournament_id=eq.${id}&select=place,player,archetype,card_count&order=place.asc&limit=64`).catch(() => []),
    ]);
    if (!t) return NOT_FOUND;
    const win = decks.find(d => d.place === 1);
    const name = clean(t.name);
    return {
      title: `${name} · Results & Deck Lists`,
      description: trunc(`${name}${t.date ? `, ${t.date}` : ''}${t.players ? `, ${t.players} players` : ''}.${win ? ` Won by ${clean(win.player)} with ${clean(win.archetype)}.` : ''} Top finishing decklists on Benchmark.`, 200),
      body: page([['Tournaments', '/events']], `${name} results`,
        `<p>${[t.date, t.country, t.players ? `${t.players} players` : ''].filter(Boolean).map(esc).join(' · ')}</p>
        <ol>${decks.map(d => `<li>${ord(d.place)}: ${d.card_count != null ? link(`/events/${r.args[0]}/${d.place}`, `${clean(d.archetype)} by ${clean(d.player)}`) : esc(`${clean(d.archetype)} by ${clean(d.player)}`)}</li>`).join('')}</ol>`),
      jsonld: crumbs([['Tournaments', '/events'], [name, r.path]]),
    };
  },
  async archetype(r, q) {
    const n = clean(r.args[0]);
    const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    const [rows, mu] = await Promise.all([
      q(`tournament_decks?archetype=eq.${encodeURIComponent(r.args[0])}&select=tournament_id,place,player,card_count,tournaments!inner(name,date)&tournaments.date=gte.${since}&order=place.asc&limit=40`),
      q('rpc/matchup_decks?p_source=online&p_days=60').catch(() => []),
    ]);
    const wins = rows.filter(x => x.place === 1).length, top8 = rows.filter(x => x.place <= 8).length;
    const deck = mu.find(d => d.name === n);
    const stats = rows.length ? `${rows.length} top 32 finish${rows.length === 1 ? '' : 'es'}, ${top8} top 8${wins ? `, ${wins} win${wins === 1 ? '' : 's'}` : ''} in the last 60 days` : '';
    return {
      title: `${n} Deck · Tournament Lists & Results`,
      description: trunc(`${n} in the Pokémon TCG: ${stats ? stats + '. ' : ''}${deck?.win_pct != null ? `${deck.win_pct}% win rate over ${deck.games.toLocaleString('en-US')} games. ` : ''}Winning decklists, prices and matchups.`, 200),
      body: page([['Tournaments', '/events']], `${n} deck lists`,
        `<p>${esc(stats || `Recent tournament finishes for ${n}`)}.${deck ? ` ${link(`/matchups/${encodeURIComponent(deck.deck)}`, `${n} matchups`)}${deck.win_pct != null ? `: ${deck.win_pct}% win rate` : ''}.` : ''}</p>
        <ul>${rows.filter(x => x.card_count != null).map(x => `<li>${link(`/events/${x.tournament_id}/${x.place}`, `${ord(x.place)} at ${clean(x.tournaments?.name)}`)} by ${esc(clean(x.player))}${x.tournaments?.date ? ` (${esc(x.tournaments.date)})` : ''}</li>`).join('')}</ul>`),
      jsonld: crumbs([['Tournaments', '/events'], [n, r.path]]),
    };
  },
  async matchup(r, q) {
    const slug = r.args[0];
    const [decks, rows] = await Promise.all([
      q('rpc/matchup_decks?p_source=online&p_days=60'),
      q(`rpc/matchups?p_deck=${encodeURIComponent(slug)}&p_source=online&p_days=60`),
    ]);
    const me = decks.find(d => d.deck === slug);
    if (!me) return null; // could be an older deck the app still shows with a longer period
    const n = clean(me.name);
    const ok = rows.filter(m => m.games >= MIN_GAMES && m.win_pct != null).sort((a, b) => b.games - a.games);
    const best = [...ok].sort((a, b) => b.win_pct - a.win_pct).slice(0, 3), worst = [...ok].sort((a, b) => a.win_pct - b.win_pct).slice(0, 3);
    const list = ms => ms.map(m => `${clean(m.name)} (${m.win_pct}%)`).join(', ');
    return {
      title: `${n} Matchups & Win Rate`,
      description: trunc(`${n}: ${me.win_pct}% win rate over ${me.games.toLocaleString('en-US')} tournament games.${best.length ? ` Best vs ${list(best)}.` : ''}${worst.length ? ` Worst vs ${list(worst)}.` : ''}`, 200),
      body: page([['Matchups', '/matchups']], `${n} matchups`,
        `<p>${esc(n)} has a ${me.win_pct}% win rate over ${me.games.toLocaleString('en-US')} games in the last 60 days of online tournaments. ${link(`/matchups/${encodeURIComponent(slug)}/lists`, `Winning ${n} lists`)} · ${link(`/archetype/${encodeURIComponent(me.name)}`, `${n} major finishes`)}</p>
        <table><thead><tr><th>Opponent</th><th>Win rate</th><th>Record</th><th>Games</th></tr></thead><tbody>${ok.map(m => `<tr><td>${link(`/matchups/${encodeURIComponent(m.opp)}`, m.name)}</td><td>${m.win_pct}%</td><td>${m.wins}-${m.losses}-${m.ties}</td><td>${m.games}</td></tr>`).join('')}</tbody></table>`),
      jsonld: crumbs([['Matchups', '/matchups'], [n, r.path]]),
    };
  },
  async matchupLists(r, q) {
    const decks = await q('rpc/matchup_decks?p_source=online&p_days=60');
    const me = decks.find(d => d.deck === r.args[0]);
    if (!me) return null;
    const n = clean(me.name);
    return {
      title: `Best ${n} Deck Lists`,
      description: trunc(`Top-finishing ${n} decklists from recent Pokémon TCG tournaments, with records, prices and one-click TCGplayer buy.`, 200),
      jsonld: crumbs([['Matchups', '/matchups'], [n, `/matchups/${r.args[0]}`], ['Lists', r.path]]),
    };
  },
  async matchups(r, q) {
    const decks = (await q('rpc/matchup_decks?p_source=online&p_days=60')).filter(d => d.games >= 100).sort((a, b) => b.games - a.games);
    if (!decks.length) return null;
    return {
      description: trunc(`Real Pokémon TCG matchup win rates from ${decks.reduce((n, d) => n + d.games, 0).toLocaleString('en-US')} tournament games. Most played: ${decks.slice(0, 4).map(d => clean(d.name)).join(', ')}.`, 200),
      body: page([], 'Pokémon TCG matchup win rates',
        `<p>Win rates from online tournaments over the last 60 days, updated every 6 hours.</p>
        <table><thead><tr><th>Deck</th><th>Win rate</th><th>Games</th></tr></thead><tbody>${decks.map(d => `<tr><td>${link(`/matchups/${encodeURIComponent(d.deck)}`, d.name)}</td><td>${d.win_pct ?? ''}%</td><td>${d.games}</td></tr>`).join('')}</tbody></table>`),
    };
  },
  async events(r, q) {
    const meta = await q('rpc/tourney_meta?days=60');
    if (!meta.length) return null;
    return {
      body: page([], 'Pokémon TCG tournament results',
        `<p>The most successful decks at Regionals, Internationals and Worlds in the last 60 days.</p>
        <ul>${meta.slice(0, 30).map(m => `<li>${link(`/archetype/${encodeURIComponent(m.archetype)}`, m.archetype)}: ${m.top32} top 32, ${m.top8} top 8${m.wins ? `, ${m.wins} win${m.wins === 1 ? '' : 's'}` : ''}</li>`).join('')}</ul>`),
    };
  },
  async home(r, q) {
    const [meta, decks] = await Promise.all([
      q('rpc/tourney_meta?days=60').catch(() => []),
      q('rpc/matchup_decks?p_source=online&p_days=60').catch(() => []),
    ]);
    const top = decks.filter(d => d.games >= 100).sort((a, b) => b.games - a.games).slice(0, 12);
    return {
      body: page(null, 'The Pokémon TCG deck builder that keeps up with the game',
        `<p>Paste a list or a YouTube link and get a priced, legality-checked deck in seconds. Track the meta, real matchup win rates and what's winning in Japan.</p>
        ${meta.length ? `<h2>Top decks at majors</h2><ul>${meta.slice(0, 12).map(m => `<li>${link(`/archetype/${encodeURIComponent(m.archetype)}`, m.archetype)}</li>`).join('')}</ul>` : ''}
        ${top.length ? `<h2>Matchups</h2><ul>${top.map(d => `<li>${link(`/matchups/${encodeURIComponent(d.deck)}`, `${clean(d.name)} matchups`)}</li>`).join('')}</ul>` : ''}
        <p>${link('/decks', 'Browse decks')} · ${link('/cards', 'Card search')} · ${link('/events', 'Tournaments')} · ${link('/events/japan', 'Japan')} · ${link('/rules', 'Formats and bans')}</p>`),
      jsonld: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Benchmark', alternateName: 'BenchmarkTCG', url: SITE + '/' },
    };
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
    info = { ...DEFAULT, ...base, ...got };
  }
  info = info || { ...DEFAULT };
  const title = /(^Benchmark\b|· Benchmark$)/.test(info.title) ? info.title : `${info.title} · Benchmark`;
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
  // index.html's size/alt tags describe og-image.png (1200×630). A card-art share image is portrait, so those
  // tags would lie about it: drop the sizes and describe the page instead.
  if (h.image !== DEFAULT.image) {
    // X's summary_large_image card centre-crops a portrait card into a 2:1 strip (the text box, not the art).
    // The small "summary" card shows a square thumbnail beside the text, which lands on the art instead.
    rw.on('meta[name="twitter:card"]', { element: e => e.setAttribute('content', 'summary') })
      .on('meta[property="og:image:width"]', { element: e => e.remove() })
      .on('meta[property="og:image:height"]', { element: e => e.remove() })
      .on('meta[property="og:image:alt"]', { element: e => e.setAttribute('content', h.title) });
  }
  if (h.body) rw.on('div#root', { element: e => e.setInnerContent(h.body, { html: true }) });
  // JSON-LD is data, not script: CSP doesn't apply. Escape "<" so a name can't close the tag.
  if (h.jsonld) rw.on('head', { element: e => e.append(`<script type="application/ld+json">${JSON.stringify(h.jsonld).replace(/</g, '\\u003c')}</script>`, { html: true }) });
  if (h.noindex) rw.on('head', { element: e => e.append('<meta name="robots" content="noindex">', { html: true }) });
  return rw.transform(res);
}

// ---- sitemaps ----
// /sitemap.xml is an index of the two below, so the card list (thousands of URLs) can grow on its own.
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SITEMAP_STATIC = ['/', '/decks', '/cards', '/events', '/events/japan', '/matchups', '/rules', '/users', '/tools', '/tools/damage', '/tools/tracker', '/tools/cp'];
export const SITEMAPS = ['/sitemap-pages.xml', '/sitemap-cards.xml'];

const urlset = urls => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
  urls.map(([p, lm]) => `  <url><loc>${xmlEsc(SITE + (p === '/' ? '/' : p))}</loc>${lm ? `<lastmod>${xmlEsc(String(lm).slice(0, 10))}</lastmod>` : ''}</url>`).join('\n')
}\n</urlset>\n`;

export function sitemapIndex() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    SITEMAPS.map(p => `  <sitemap><loc>${SITE}${p}</loc></sitemap>`).join('\n')
  }\n</sitemapindex>\n`;
}

export async function sitemapPages() {
  const settle = p => p.catch(() => []);
  const pages = [0, 1, 2, 3, 4].map(i => settle(sbFetch(`decks?is_public=eq.true&select=id,updated_at&order=updated_at.desc&limit=1000&offset=${i * 1000}`, { ttl: 3600 })));
  const [decks, arch, tours, lists, mu, jp] = await Promise.all([
    Promise.all(pages).then(a => a.flat().slice(0, 5000)),
    settle(sbFetch('tournament_decks?select=archetype&order=fetched_at.desc&limit=1000', { ttl: 3600 })),
    settle(sbFetch('tournaments?select=id,date&order=date.desc&limit=300', { ttl: 3600 })),
    settle(sbFetch('tournament_decks?select=tournament_id,place&card_count=not.is.null&order=tournament_id.desc,place.asc&limit=5000', { ttl: 3600 })),
    settle(sbFetch('rpc/matchup_decks?p_source=online&p_days=60', { ttl: 3600 })),
    settle(sbFetch('jp_tournaments?select=id,date&order=date.desc&limit=300', { ttl: 3600 })),
  ]);
  const urls = SITEMAP_STATIC.map(p => [p, '']);
  const dates = new Map();
  for (const t of tours) if (t?.id != null) { dates.set(t.id, t.date || ''); urls.push([`/events/${t.id}`, t.date || '']); }
  for (const l of lists) if (l?.tournament_id != null && dates.has(l.tournament_id)) urls.push([`/events/${l.tournament_id}/${l.place}`, dates.get(l.tournament_id)]);
  const seen = new Set();
  for (const a of arch) if (a?.archetype && !seen.has(a.archetype)) { seen.add(a.archetype); urls.push([`/archetype/${encodeURIComponent(a.archetype)}`, '']); }
  for (const d of mu) if (d?.deck && d.games >= MIN_GAMES) urls.push([`/matchups/${encodeURIComponent(d.deck)}`, ''], [`/matchups/${encodeURIComponent(d.deck)}/lists`, '']);
  for (const t of jp) if (t?.id && isJpId(String(t.id))) urls.push([`/events/japan/${t.id}`, t.date || '']);
  for (const d of decks) if (d?.id) urls.push([`/decks/${d.id}`, d.updated_at || '']);
  return urlset(urls);
}

// Every Standard-legal card plus Expanded cards with a price (the ones people search for); 10k cap.
export async function sitemapCards() {
  const get = (f, i) => sbFetch(`cards?${f}&select=id,updated_at&order=id.asc&limit=1000&offset=${i * 1000}`, { ttl: 86400, ms: 4000 }).catch(() => []);
  const std = await Promise.all([0, 1, 2, 3, 4].map(i => get('legal_standard=is.true', i)));
  const exp = await Promise.all([0, 1, 2, 3, 4].map(i => get('legal_standard=is.false&legal_expanded=is.true&tcgp_product_id=not.is.null', i)));
  const seen = new Set();
  const urls = [];
  for (const c of [...std.flat(), ...exp.flat()]) if (c?.id && !seen.has(c.id) && urls.length < 10000) { seen.add(c.id); urls.push([`/cards/${encodeURIComponent(c.id)}`, c.updated_at || '']); }
  return urlset(urls);
}
