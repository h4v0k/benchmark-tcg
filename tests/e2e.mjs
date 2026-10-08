// Playwright smoke test with a fully mocked Supabase backend.
// Run: node build.mjs && node tests/e2e.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = '/tmp/claude-0/-home-claude/4df323f2-1f99-574d-acaf-99e0e324586e/scratchpad';
fs.mkdirSync(OUT, { recursive: true });
const DECK_ID = '11111111-1111-1111-1111-111111111111';
const NOW = '2026-10-05T00:00:00Z';
const ME = '22222222-2222-2222-2222-222222222222';

/* ---------- fixtures ---------- */
const SET = { id: 'sv06', name: 'Twilight Masquerade', code: 'TWM', series: 'Scarlet & Violet', release_date: '2024-05-24', legal_date: '2024-06-07', symbol: '', logo: '', is_promo: false, is_classic: false };
let pid = 543210;
const mk = (n, name, o = {}) => ({
  id: `sv06-${n}`, set_id: 'sv06', local_id: String(n), name, category: 'Pokemon', stage: 'Basic', trainer_type: '', energy_type: '', suffix: '', evolves_from: '',
  types: ['Psychic'], hp: 70, retreat: 1, rarity: 'Common', reg_mark: 'H', illustrator: 'x', effect: '', abilities: [],
  attacks: [{ name: 'Petty Grudge', cost: ['Psychic'], damage: '10', effect: '' }], weaknesses: [], resistances: [], variants: ['normal', 'reverse'],
  image: `https://assets.tcgdex.net/en/sv/sv06/${n}`, is_ace: false, is_radiant: false, is_prism: false, is_basic_energy: false,
  tcgp_product_id: pid, tcgp: { normal: pid }, prices: { normal: 0.12, reverse: 0.3 }, prices_at: NOW,
  legal_standard: true, legal_expanded: true, standard_from: null, rotating: false, rotating_on: null, banned_in: [], detail_at: NOW, set: SET, ...o,
});
const trainer = (n, name, tt, o = {}) => mk(n, name, { category: 'Trainer', stage: '', trainer_type: tt, types: [], hp: null, retreat: null, attacks: [], ...o });
const CARDS = [
  mk(128, 'Dreepy'),
  mk(129, 'Drakloak', { stage: 'Stage 1', evolves_from: 'Dreepy', hp: 90, tcgp_product_id: 543211, tcgp: { normal: 543211 } }),
  mk(130, 'Dragapult ex', { stage: 'Stage 2', evolves_from: 'Drakloak', suffix: 'ex', hp: 320, tcgp_product_id: 543212, tcgp: { normal: 543212 } }),
  trainer(185, 'Iono', 'Supporter', { reg_mark: 'G', legal_standard: false, legal_expanded: true, tcgp_product_id: 543213, tcgp: { normal: 543213 } }),
  trainer(196, 'Ultra Ball', 'Item', { tcgp_product_id: 543214, tcgp: { normal: 543214 } }),
  trainer(144, 'Buddy-Buddy Poffin', 'Item', { tcgp_product_id: 543215, tcgp: { normal: 543215 } }),
  mk(300, 'Basic Psychic Energy', { category: 'Energy', stage: '', energy_type: 'Basic', types: [], hp: null, retreat: null, attacks: [], is_basic_energy: true, reg_mark: '', tcgp_product_id: 543216, tcgp: { normal: 543216 } }),
  trainer(173, 'Night Stretcher', 'Item', { tcgp_product_id: 543217, tcgp: { normal: 543217 } }),
];
const byName = n => CARDS.find(c => c.name.toLowerCase() === String(n).toLowerCase());
const id = n => byName(n).id;
const DECK = {
  id: DECK_ID, owner: '22222222-2222-2222-2222-222222222222', name: 'Dragapult test', format: 'standard', description: 'A test deck',
  primer: '## Plan\nUse [[Iono]].', is_public: true,
  cards: [
    { cid: id('Dreepy'), qty: 4, board: 'main', name: 'Dreepy', cat: 'Pokemon' },
    { cid: id('Drakloak'), qty: 3, board: 'main', name: 'Drakloak', cat: 'Pokemon' },
    { cid: id('Dragapult ex'), qty: 2, board: 'main', name: 'Dragapult ex', cat: 'Pokemon' },
    { cid: id('Iono'), qty: 1, board: 'main', name: 'Iono', cat: 'Trainer' },
    { cid: id('Ultra Ball'), qty: 4, board: 'main', name: 'Ultra Ball', cat: 'Trainer' },
    { cid: id('Buddy-Buddy Poffin'), qty: 4, board: 'main', name: 'Buddy-Buddy Poffin', cat: 'Trainer' },
    { cid: id('Basic Psychic Energy'), qty: 2, board: 'main', name: 'Basic Psychic Energy', cat: 'Energy' },
    { cid: id('Night Stretcher'), qty: 1, board: 'maybe', name: 'Night Stretcher', cat: 'Trainer' },
  ],
  cover: '', price: 12.5, card_count: 20, like_count: 3, view_count: 10, comment_count: 0, featured: false, tags: ['test'], folder_id: null,
  archetype: 'Dragapult', created_at: '2026-10-01T00:00:00Z', updated_at: NOW, owner_profile: { username: 'tester', avatar_card: '' },
};
const DECK_B_ID = '33333333-3333-3333-3333-333333333333';
const DECK_B = { ...DECK, id: DECK_B_ID, name: 'Second deck B', cards: [{ cid: id('Iono'), qty: 4, board: 'main', name: 'Iono', cat: 'Trainer' }] };
const BIG_ID = '44444444-4444-4444-4444-444444444444';
const BIG_N = 170; // 170 unique cards -> ceil(170/80) = 3 chunks
const BIG_CARDS = Array.from({ length: BIG_N }, (_, i) => mk(2000 + i, `Bulk Card ${i + 1}`, { tcgp_product_id: 600000 + i, tcgp: { normal: 600000 + i } }));
const DECK_BIG = { ...DECK, id: BIG_ID, name: 'Bulk deck', cards: BIG_CARDS.map(c => ({ cid: c.id, qty: 1, board: 'main', name: c.name, cat: 'Pokemon' })), card_count: BIG_N };
const muDeck = (deck, name, games, wins, losses, ties, events) => ({ deck, name, icons: [], games, wins, losses, ties, win_pct: Math.round(1000 * (wins + ties / 3) / games) / 10, events });
const MU_DECKS_ONLINE = [
  muDeck('dragapult-ex', 'Dragapult', 412, 210, 190, 12, 31),
  muDeck('n-zoroark', "N's Zoroark", 268, 130, 132, 6, 28),
  muDeck('gardevoir-ex', 'Gardevoir', 231, 118, 108, 5, 25),
  muDeck('basic-box-m', 'Basic Box', 140, 66, 70, 4, 19),
  muDeck('crustle-dri', 'Crustle', 96, 55, 38, 3, 14),
];
const MU_DECKS_OFFICIAL = [
  muDeck('gardevoir-ex', 'Gardevoir', 64, 33, 29, 2, 6),
  muDeck('raging-bolt-ex', 'Raging Bolt', 41, 20, 20, 1, 5),
  muDeck('dragapult-ex', 'Dragapult', 38, 17, 20, 1, 6),
];
const muOpp = (opp, name, games, wins, losses, ties) => ({ opp, name, icons: [], games, wins, losses, ties, win_pct: Math.round(1000 * (wins + ties / 3) / games) / 10 });
const MU_DRAGAPULT = [
  muOpp('n-zoroark', "N's Zoroark", 60, 36, 22, 2),
  muOpp('gardevoir-ex', 'Gardevoir', 55, 15, 38, 2),
  muOpp('raging-bolt-ex', 'Raging Bolt', 50, 30, 19, 1),
  muOpp('charizard-ex', 'Charizard', 45, 14, 30, 1),
  muOpp('basic-box-m', 'Basic Box', 40, 20, 20, 0),
  muOpp('lugia-vstar', 'Lugia', 35, 20, 14, 1),
  muOpp('ceruledge-ex', 'Ceruledge', 30, 18, 12, 0),
  muOpp('toxtricity', 'Toxtricity', 30, 10, 20, 0),
  muOpp('terapagos-ex', 'Terapagos', 25, 8, 17, 0),
  muOpp('v1','Miraidon',28,14,14,0), muOpp('v2','Snorlax',27,13,14,0), muOpp('v3','Palkia',26,13,13,0),
  muOpp('v4','Joltik Box',24,12,12,0), muOpp('v5','Klawf',22,11,11,0), muOpp('v6','Arboliva',21,10,11,0),
  muOpp('crustle-dri', 'Crustle', 9, 7, 2, 0),
  muOpp('froslass', 'Froslass', 5, 1, 4, 0),
];
const DECK_LISTS = [
  { key: 'o101', tier: 'online', event_id: 'ev-9001', event_name: 'Online Series #12', date: '2026-10-03', event_players: 64, player: 'Ana', place: 1, wins: 8, losses: 0, ties: 0, score: 3 },
  { key: 't580-2', tier: 'regional', event_id: '580', event_name: 'Regional Recife', date: '2026-10-03', event_players: 1074, player: 'Bea', place: 2, wins: null, losses: null, ties: null, score: 9.07 },
  { key: 'o102', tier: 'online', event_id: 'ev-9002', event_name: 'Weekly Cup #31', date: '2026-10-01', event_players: 48, player: 'Bo', place: 2, wins: 7, losses: 1, ties: 0, score: 2.29 },
  { key: 'o103', tier: 'online', event_id: 'ev-9003', event_name: 'Weekly Cup #30', date: '2026-09-28', event_players: 40, player: 'Cy', place: 5, wins: 6, losses: 2, ties: 1, score: 1.5 },
  { key: 'o104', tier: 'online', event_id: 'ev-9004', event_name: 'Online Series #11', date: '2026-09-25', event_players: 36, player: 'Di', place: 9, wins: 5, losses: 3, ties: 0, score: 1 },
];
const LIST_TEXT = '4 Dreepy TWM 128\n3 Drakloak TWM 129\n2 Dragapult ex TWM 130\n4 Ultra Ball TWM 196\n1 Mystery Card XYZ 1';
const archRow = (tid, name, date, kind, players, place, player, cc, lid, price) => ({ tournament_id: tid, place, player, country: 'US', archetype: 'Dragapult', list_id: lid, card_count: cc, price, tournaments: { id: tid, name, date, kind, players } });
const ARCH_ROWS = [ // deliberately not in display order
  archRow(580, 'Regional Recife', '2026-10-03', 'regional', 1074, 2, 'Bea', 60, 30002, 41.5),
  archRow(560, 'Regional Lille', '2026-09-10', 'regional', 800, 25, 'Eli', 60, 30025, 38.2),
  archRow(570, 'World Championships', '2026-08-22', 'worlds', 4000, 1, 'Wes', 60, 29001, 45.9),
  archRow(570, 'World Championships', '2026-08-22', 'worlds', 4000, 9, 'Gus', 60, 29009, 43.0),
  archRow(560, 'Regional Lille', '2026-09-10', 'regional', 800, 14, 'Fay', null, 30014, null),
  archRow(580, 'Regional Recife', '2026-10-03', 'regional', 1074, 1, 'Ana', 60, 30001, 44.1),
];
const RULES = {"standard_min_mark":"H","formats":[{"format":"standard","min_mark":"H","min_release":null,"season":"2026-27","notes":"","source":"","checked_at":"2026-10-05T12:00:00Z","updated_at":"2026-10-05T12:00:00Z"},{"format":"expanded","min_mark":null,"min_release":"2011-04-25","season":"","notes":"","source":"","checked_at":"2026-10-05T12:00:00Z","updated_at":"2026-10-05T12:00:00Z"}],"next_rotation":null,"bans":[{"format":"expanded","card_name":"Red Card","printings":[{"set":"XY","num":"124/146"}],"card_ids":["xy1-124"],"effective_date":null,"source":""}],"upcoming_sets":[],"last_checked":"2026-10-05T12:00:00Z","last_catalog_sync":"2026-10-05T12:00:00Z","card_count":20000};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/* ---------- static server ---------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { p = '/'; }
  let f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || !fs.statSync(f).isFile()) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ---------- mock backend ---------- */
const unexpected = [];
const deckDelay = {}; // deck id -> ms to hold the decks response
const cardReqs = []; // { start, end, n } per /rest/v1/cards `in.` request
const passkeyReqs = [];
const json = (route, body, extra = {}) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...(extra.headers || {}) }, body: JSON.stringify(body) });
async function handleSupabase(route) {
  const req = route.request();
  const u = new URL(req.url());
  const p = u.pathname;
  const method = req.method();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  let body = {};
  try { body = req.postDataJSON() || {}; } catch {}
  if (p === '/rest/v1/rpc/current_rules') return json(route, RULES);
  if (p === '/rest/v1/rpc/search_cards') {
    const q = String(body.q || '').toLowerCase();
    const hits = CARDS.filter(c => c.name.toLowerCase().includes(q) || (q.length >= 3 && c.name.toLowerCase().startsWith(q.slice(0, 2)))) /* fuzzy like the real trigram search: 'dre' also finds Drakloak */.slice(0, body.lim || 50).map(c => ({
      name: c.name, card_id: c.id, image: c.image, set_id: c.set_id, set_name: SET.name, category: c.category, sub: c.stage || c.trainer_type || c.energy_type,
      printings: 1, legal: body.fmt === 'standard' ? c.legal_standard : c.legal_expanded }));
    return json(route, hits);
  }
  if (p === '/rest/v1/rpc/resolve_decklist' || p === '/rest/v1/rpc/resolve_decklist_v2') {
    return json(route, (body.lines || []).map(l => { const c = byName(l.name); return { i: l.i, card_id: c ? c.id : null, how: c ? 'name' : 'none' }; }));
  }
  if (p === '/rest/v1/rpc/tourney_meta') return json(route, [{ archetype: 'Dragapult', top32: 41, top8: 10, wins: 1, events: 4, best_tournament: 580, best_place: 2 }, { archetype: "N's Zoroark", top32: 8, top8: 1, wins: 0, events: 3, best_tournament: 580, best_place: 4 }]);
  if (p === '/rest/v1/tournaments') return json(route, [{ id: 580, name: 'Regional Recife', date: '2026-10-03', country: 'BR', players: 1074, kind: 'regional', status: 'lists', tournament_decks: [{ count: 32 }] }]);
  if (p === '/rest/v1/tournament_decks' && (u.searchParams.get('select') || '').includes('tournaments!inner')) return json(route, u.searchParams.get('archetype') === 'eq.Dragapult' ? ARCH_ROWS : []);
  if (p === '/rest/v1/tournament_decks') {
    const mk = (place, arch) => ({ tournament_id: 580, place, player: 'Victor Carreira Rodrigues', country: 'BR', archetype: arch, list_id: 30000 + place, card_count: 60, price: 44.14, cards: DECK.cards, missing: [] });
    if (u.searchParams.get('place')) return json(route, [mk(Number(u.searchParams.get('place').slice(3)), u.searchParams.get('place') === 'eq.1' ? 'Ogerpon Meganium' : 'Dragapult')]);
    return json(route, Array.from({ length: 32 }, (_, i) => { const d = mk(i + 1, i % 2 ? 'Dragapult' : "N's Zoroark Lucario"); delete d.cards; if (i > 29) { d.card_count = null; d.list_id = null; } return d; }));
  }
  if (p === '/rest/v1/rpc/matchup_decks') return json(route, body.p_source === 'official' ? MU_DECKS_OFFICIAL : MU_DECKS_ONLINE);
  if (p === '/rest/v1/rpc/matchups') return json(route, body.p_deck === 'dragapult-ex' && body.p_source !== 'official' ? MU_DRAGAPULT : []);
  if (p === '/rest/v1/rpc/matchup_coverage') return json(route, { events: body.p_source === 'official' ? 6 : 38, pending: 2, from: '2026-09-07', to: '2026-10-05', event_names: ['Regional Recife', 'Online Series #12'] });
  if (p === '/rest/v1/rpc/deck_lists') return json(route, body.p_deck === 'dragapult-ex' ? DECK_LISTS : []);
  if (p === '/rest/v1/rpc/deck_list') return json(route, DECK_LISTS.filter(r => r.key === body.p_key).map(r => r.tier === 'online'
    ? { ...r, deck: 'dragapult-ex', list: LIST_TEXT, cards: null, missing: [], list_id: null }
    : { ...r, deck: 'dragapult-ex', list: null, cards: DECK.cards, missing: [], list_id: 30002 }));
  if (p === '/rest/v1/archetypes') return json(route, u.searchParams.get('slug') === 'eq.dragapult-ex' ? [{ name: 'Dragapult' }] : [], { headers: { 'content-range': '*/0' } });
  if (p === '/rest/v1/rpc/record_view') return route.fulfill({ status: 204, headers: cors });
  if (p === '/rest/v1/cards') {
    const idq = u.searchParams.get('id'); const nameq = u.searchParams.get('name');
    let rows = CARDS;
    if (idq && idq.startsWith('in.') && idq.includes('sv06-2')) {
      const ids = [...idq.matchAll(/"([^"]+)"/g)].map(m => m[1]); const rec = { start: Date.now(), end: 0, n: ids.length }; cardReqs.push(rec);
      await new Promise(r => setTimeout(r, 250)); rec.end = Date.now();
      const got = BIG_CARDS.filter(c => ids.includes(c.id));
      return json(route, got, { headers: { 'content-range': `0-${Math.max(got.length - 1, 0)}/${got.length}` } });
    }
    if (idq && idq.startsWith('in.')) { const ids = [...idq.matchAll(/"([^"]+)"/g)].map(m => m[1]); const bare = ids.length ? ids : idq.slice(4).replace(/[()]/g, '').split(','); rows = CARDS.filter(c => bare.includes(c.id)); }
    else if (idq && idq.startsWith('eq.')) rows = CARDS.filter(c => c.id === idq.slice(3));
    else if (nameq && nameq.startsWith('eq.')) rows = CARDS.filter(c => c.name.toLowerCase() === nameq.slice(3).toLowerCase());
    return json(route, rows, { headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` } });
  }
  if (p === '/rest/v1/decks') {
    const idq = u.searchParams.get('id');
    const want = idq && idq.startsWith('eq.') ? idq.slice(3) : null;
    if (want && deckDelay[want]) await new Promise(r => setTimeout(r, deckDelay[want]));
    const rows = want ? [DECK, DECK_B, DECK_BIG].filter(d => d.id === want) : [DECK];
    return json(route, rows, { headers: { 'content-range': `0-0/1` } });
  }
  if (p === '/rest/v1/profiles' && u.searchParams.get('id') === `eq.${ME}`) return json(route, [{ id: ME, username: 'tester', bio: '', avatar_card: '', is_admin: false, created_at: NOW }], { headers: { 'content-range': '0-0/1' } });
  if (p === '/rest/v1/follows') return json(route, [], { headers: { 'content-range': '*/0' } });
  if (p === '/auth/v1/passkeys/') passkeyReqs.push(Date.now());
  if (p === '/auth/v1/passkeys/') return json(route, [{ id: 'pk1', created_at: NOW }]);
  if (['/rest/v1/rule_changes', '/rest/v1/deck_comments', '/rest/v1/profiles', '/rest/v1/folders', '/rest/v1/printing_prefs'].includes(p)) return json(route, [], { headers: { 'content-range': '*/0' } });
  unexpected.push(`${method} ${p}${u.search}`);
  return json(route, p.startsWith('/auth/') ? {} : []);
}

/* ---------- harness ---------- */
const pageErrors = [];
const results = [];
const browser = await chromium.launch();
async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return route.continue();
    if (u.hostname.endsWith('supabase.co')) return handleSupabase(route);
    if (route.request().resourceType() === 'image' || /\.(png|jpg|webp)$/.test(u.pathname) || u.hostname.includes('tcgdex')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
  });
  page.on('pageerror', e => pageErrors.push(`[${page.url()}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(`[${page.url()}] console.error: ${m.text()}`); });
  return page;
}
async function scenario(name, fn) {
  const before = pageErrors.length;
  try { await fn(); const n = pageErrors.length - before; if (n) throw new Error(`${n} page/console error(s) during scenario`); results.push([name, true]); console.log(`PASS  ${name}`); }
  catch (e) { results.push([name, false]); console.log(`FAIL  ${name}\n      ${String(e.message).split('\n').slice(0, 6).join('\n      ')}`); }
}
const T = { timeout: 8000 };
const see = (page, text) => page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', ...T });

async function deckChecks(page, shot) {
  await page.goto(`${BASE}/decks/${DECK_ID}`);
  await see(page, 'Dragapult test');
  await page.getByRole('heading', { name: /Pokémon/ }).first().waitFor({ state: 'visible', ...T });
  await see(page, 'Iono');
  await see(page, 'Not legal');
  await page.getByText(/not Standard legal|Not legal/).first().waitFor({ state: 'visible', ...T });
  const buy = page.locator('a[href^="https://www.tcgplayer.com/massentry?productline=Pokemon&c="]').first();
  await buy.waitFor({ state: 'attached', ...T });
  const href = await buy.getAttribute('href');
  if (!href.includes('543210')) throw new Error(`Buy href lacks 543210: ${href}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, shot), fullPage: false });
}

try {
  const desk = await newPage({ width: 1366, height: 900 });

  await scenario('1. / loads home', async () => {
    await desk.goto(BASE + '/');
    await see(desk, 'keeps up with the game');
    await desk.waitForTimeout(500);
    await desk.screenshot({ path: path.join(OUT, 'home.png') });
  });
  await scenario('2. /decks lists deck tile', async () => {
    await desk.goto(BASE + '/decks');
    await see(desk, 'Dragapult test');
  });
  await scenario('3. /decks/:id deck page', async () => {
    await deckChecks(desk, 'deck-desktop.png');
    for (const v of ['Visual', 'Stacks', 'Table']) {
      await desk.locator(`button[title="${v}"]`).first().click({ timeout: 5000 });
      await see(desk, 'Drakloak');
      await see(desk, 'Dragapult ex');
    }
    await desk.locator('button[title="Text"]').first().click(T);
    await desk.getByRole('button', { name: /Dreepy/ }).or(desk.getByText('Dreepy', { exact: true })).first().click(T);
    const dlg = desk.getByRole('dialog');
    await dlg.waitFor({ state: 'visible', ...T });
    const link = dlg.getByRole('link', { name: /Buy this printing on TCGplayer/ });
    await link.waitFor({ state: 'visible', ...T });
    const h = await link.getAttribute('href');
    if (!h.includes('/product/543210')) throw new Error(`modal buy href: ${h}`);
    await desk.keyboard.press('Escape');
    await dlg.waitFor({ state: 'hidden', ...T });
    await desk.getByRole('button', { name: 'Export' }).first().click(T);
    const d2 = desk.getByRole('dialog');
    await d2.waitFor({ state: 'visible', ...T });
    const val = await d2.locator('textarea').first().inputValue();
    if (!val.includes('4 Dreepy TWM 128')) throw new Error(`export text: ${JSON.stringify(val.slice(0, 200))}`);
    await desk.keyboard.press('Escape');
    await desk.getByRole('tab', { name: 'Primer' }).or(desk.getByRole('button', { name: 'Primer' })).first().click(T);
    await see(desk, 'Plan');
    await desk.getByRole('tab', { name: 'Comments' }).or(desk.getByRole('button', { name: /^Comments/ })).first().click(T);
    await see(desk, 'No comments yet');
  });
  await scenario('4. /cards?q=dre', async () => {
    await desk.goto(BASE + '/cards?q=dre');
    await see(desk, 'Dreepy');
    await see(desk, 'Drakloak');
  });
  await scenario('5. /rules shows Red Card', async () => {
    await desk.goto(BASE + '/rules');
    await see(desk, 'Red Card');
  });
  await scenario('6. /login email field', async () => {
    await desk.goto(BASE + '/login');
    await desk.locator('input[type="email"], input[name="email"], input[autocomplete="email"]').first().waitFor({ state: 'visible', ...T });
  });
  await scenario('7. legacy hash redirect', async () => {
    await desk.goto(`${BASE}/#/deck/${DECK_ID}`);
    await desk.waitForURL(u => new URL(u).pathname === `/decks/${DECK_ID}`, T);
  });

  const mob = await newPage({ width: 390, height: 844 });
  await scenario('3m. deck page at mobile 390x844', async () => {
    await deckChecks(mob, 'deck-mobile.png');
    const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error(`horizontal overflow of ${overflow}px`);
  });
  await scenario('8m. signed in on mobile: New deck opens full size', async () => {
    const page = await newPage({ width: 390, height: 844 });
    await page.addInitScript(([me]) => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('sb-rnujzhrfiqjfjqskekpt-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_at: exp, user: { id: me, email: 't@example.com' } }));
    }, [ME]);
    await page.goto(BASE + '/');
    await page.locator('.topbar-actions button.btn.primary').first().click();
    const box = await page.locator('.modal').boundingBox();
    if (!box || box.height < 250) throw new Error(`New deck window is only ${box ? Math.round(box.height) : 0}px tall`);
    if (!(await page.locator('.modal select').isVisible()) || !(await page.locator('.modal button.primary').isVisible())) throw new Error('New deck fields not visible');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'new-deck-mobile.png') });
    await page.context().close();
  });
  for (const w of [260, 390]) await scenario(`9m. tournaments pages at ${w}px`, async () => {
    const page = await newPage({ width: w, height: 800 });
    for (const [url, sel] of [['/events', '.meta-list li'], ['/events/580', '.standings li'], ['/events/580/1', '.deck-side .panel']]) {
      await page.goto(BASE + url);
      await page.locator(sel).first().waitFor({ timeout: 8000 });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) throw new Error(`${url}: ${over}px sideways overflow`);
      if (w === 260) await page.screenshot({ path: path.join(OUT, `events${url.replace(/\//g, '_')}-${w}.png`), fullPage: false });
    }
    await page.context().close();
  });
  const overflowOf = p => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const BIG = 'body{font-size:24px}';
  const shotP = (p, f) => p.screenshot({ path: '/home/claude/' + f, fullPage: true });
  const noOverflow = async (p, what) => { const o = await overflowOf(p); if (o > 1) throw new Error(`${what}: horizontal overflow of ${o}px`); };
  const sec = (p, t) => p.locator('section.mu-section', { has: p.getByRole('heading', { name: t }) });
  const deckReady = async p => { await p.getByRole('heading', { name: 'Dragapult', level: 1 }).waitFor({ state: 'visible', ...T }); await sec(p, 'Other matchups').locator('li').first().waitFor({ state: 'visible', ...T }); };
  const mu = await newPage({ width: 390, height: 844 });
  await scenario('10m. matchups list renders + Find a deck filter', async () => {
    await mu.goto(BASE + '/matchups');
    await mu.getByLabel('Find a deck').waitFor({ state: 'visible', ...T });
    const rows = mu.locator('a.mu-link');
    await rows.first().waitFor({ state: 'visible', ...T });
    if (await rows.count() !== 5) throw new Error(`expected 5 deck rows, got ${await rows.count()}`);
    for (const n of ['Dragapult', "N's Zoroark", 'Gardevoir', 'Basic Box', 'Crustle']) await rows.filter({ hasText: n }).first().waitFor({ state: 'visible', ...T });
    const first = (await rows.first().textContent()) || '';
    if (!/412 games/.test(first) || !/%/.test(first)) throw new Error(`row text: ${first}`);
    await noOverflow(mu, 'list 390');
    await shotP(mu, 'mu-list-phone.png');
    await mu.getByLabel('Find a deck').fill('zor');
    await mu.waitForFunction(() => document.querySelectorAll('a.mu-link').length === 1, null, T);
    await rows.filter({ hasText: "N's Zoroark" }).first().waitFor({ state: 'visible', ...T });
    await mu.getByLabel('Find a deck').fill('nope-xyz');
    await mu.waitForFunction(() => document.querySelectorAll('a.mu-link').length === 0, null, T);
    await see(mu, 'No deck matches');
  });
  await scenario('11m. matchups Official switch + period select change URL', async () => {
    await mu.goto(BASE + '/matchups');
    await mu.locator('a.mu-link').first().waitFor({ state: 'visible', ...T });
    const period = mu.getByLabel('Period');
    if (await period.inputValue() !== '30') throw new Error('online default period should be 30');
    const optsOnline = await period.locator('option').allTextContents();
    if (optsOnline.join('|') !== 'Last 14 days|Last 30 days|Last 60 days') throw new Error(`online options: ${optsOnline}`);
    await period.selectOption('60');
    await mu.waitForURL(u => new URL(u).searchParams.get('days') === '60', T);
    await mu.getByRole('radiogroup', { name: 'Results from' }).getByText('Official', { exact: true }).click(T);
    await mu.waitForURL(u => { const s = new URL(u).searchParams; return s.get('src') === 'official' && s.get('days') === null; }, T);
    await mu.locator('a.mu-link', { hasText: 'Raging Bolt' }).first().waitFor({ state: 'visible', ...T });
    if (await mu.locator('a.mu-link', { hasText: 'Crustle' }).count()) throw new Error('Crustle still listed for official');
    if (await mu.locator('a.mu-link').count() !== 3) throw new Error(`expected 3 official decks, got ${await mu.locator('a.mu-link').count()}`);
    if (await period.inputValue() !== '90') throw new Error('official default period should be 90');
    const optsOff = await period.locator('option').allTextContents();
    if (optsOff.join('|') !== 'Last 30 days|Last 60 days|Last 90 days|Last 180 days') throw new Error(`official options: ${optsOff}`);
    await period.selectOption('180');
    await mu.waitForURL(u => new URL(u).searchParams.get('days') === '180', T);
    await period.selectOption('90');
    await mu.waitForURL(u => new URL(u).searchParams.get('days') === null, T);
    await mu.getByRole('radiogroup', { name: 'Results from' }).getByText('Online', { exact: true }).click(T);
    await mu.waitForURL(u => new URL(u).searchParams.get('src') === null, T);
    await mu.locator('a.mu-link', { hasText: 'Crustle' }).first().waitFor({ state: 'visible', ...T });
  });
  // expected sections, derived from the fixture with the same rules as the page (whole-% tone, min 20 games online)
  const wholePct = m => Math.round(m.win_pct);
  const solid = MU_DRAGAPULT.filter(m => m.games >= 20);
  const expBest = solid.filter(m => wholePct(m) >= 55).sort((a, b) => b.win_pct - a.win_pct).slice(0, 3);
  const expWorst = solid.filter(m => wholePct(m) <= 45).sort((a, b) => a.win_pct - b.win_pct).slice(0, 3);
  const expOthers = MU_DRAGAPULT.filter(m => !expBest.includes(m) && !expWorst.includes(m));
  const expOtherShown = expOthers.slice(0, 8);
  const FEW = MU_DRAGAPULT.filter(m => m.games < 20);
  const tabbable = p => p.evaluate(() => [...document.querySelectorAll('[role=radiogroup] button')].map(b => `${b.dataset.v}:${b.tabIndex}`).join(','));
  await scenario('12m. matchups deck page: best/worst, other matchups, search, details, resets, keyboard', async () => {
    if (expOthers.length <= 8 || expBest.length !== 3 || expWorst.length !== 3) throw new Error('fixture must give 3 best, 3 worst and >8 others');
    await mu.goto(BASE + '/matchups/dragapult-ex');
    await deckReady(mu);
    await mu.locator('p.crumbs a', { hasText: 'Matchups' }).waitFor({ state: 'visible', ...T });
    await see(mu, 'overall · 412 games');
    await see(mu, 'updated every 6 hours');
    const best = sec(mu, 'Best matchups'), worst = sec(mu, 'Worst matchups'), other = sec(mu, 'Other matchups');
    const names = async s => (await s.locator('li .mu-name b').allTextContents());
    const nm = a => a.map(m => m.name).join('|');
    if ((await names(best)).join('|') !== nm(expBest)) throw new Error(`best: ${await names(best)}`);
    if ((await names(worst)).join('|') !== nm(expWorst)) throw new Error(`worst: ${await names(worst)}`);
    for (const s of [best, worst]) for (const f of FEW) if ((await names(s)).includes(f.name)) throw new Error(`few-games ${f.name} in best/worst`);
    if (await mu.getByRole('heading', { name: 'All matchups' }).count()) throw new Error('"All matchups" shown although best/worst exist');
    // other matchups: no duplicates of best/worst, first 8 only, no bars anywhere in the lists
    const oNames = await names(other);
    if (oNames.join('|') !== nm(expOtherShown)) throw new Error(`other (first 8): ${oNames}`);
    for (const n of [...expBest, ...expWorst].map(m => m.name)) if (oNames.includes(n)) throw new Error(`${n} shown twice`);
    if (await mu.locator('.mu-bar').count()) throw new Error('bars shown on list rows');
    const more = other.getByRole('button', { name: `Show all ${expOthers.length}` });
    await more.waitFor({ state: 'visible', ...T });
    await noOverflow(mu, 'deck 390');
    await shotP(mu, 'mu-deck-phone.png');
    await more.click(T);
    await other.getByRole('button', { name: 'Show fewer' }).waitFor({ state: 'visible', ...T });
    if (await other.locator('li').count() !== expOthers.length) throw new Error('expected all others after Show all');
    for (const f of FEW) {
      const row = other.locator('li.few', { hasText: f.name });
      await row.waitFor({ state: 'visible', ...T });
      if (!/few games/.test(await row.textContent())) throw new Error(`${f.name} row lacks "few games"`);
    }
    await other.getByRole('button', { name: 'Show fewer' }).click(T);
    await other.getByRole('button', { name: `Show all ${expOthers.length}` }).waitFor({ state: 'visible', ...T });
    if (await other.locator('li').count() !== 8) throw new Error('expected 8 rows after Show fewer');
    // search: hides sections, verdict + bar on result, live region
    await mu.getByLabel('Who are you facing?').fill('gard');
    await mu.getByRole('heading', { name: 'Best matchups' }).waitFor({ state: 'detached', ...T });
    for (const h of ['Worst matchups', 'Other matchups']) if (await mu.getByRole('heading', { name: h }).count()) throw new Error(`${h} still shown while searching`);
    const rowsFound = mu.locator('li.mu-item');
    if (await rowsFound.count() !== 1) throw new Error(`expected 1 search row, got ${await rowsFound.count()}`);
    await rowsFound.first().getByText('Gardevoir').waitFor({ state: 'visible', ...T });
    await rowsFound.first().locator('.mu-verdict', { hasText: /^Unfavored$/ }).waitFor({ state: 'visible', ...T });
    if (await rowsFound.first().locator('.mu-bar').count() !== 1) throw new Error('search result has no bar');
    const live = mu.locator('p.sr-only[aria-live=polite]');
    if ((await live.textContent()).trim() !== '1 result') throw new Error(`live region: ${await live.textContent()}`);
    await mu.getByLabel('Who are you facing?').fill('a');
    const nA = MU_DRAGAPULT.filter(m => m.name.toLowerCase().includes('a')).length;
    await mu.waitForFunction(n => document.querySelector('p.sr-only[aria-live=polite]').textContent.trim() === `${n} results`, nA, T);
    await mu.getByLabel('Who are you facing?').fill('zzz');
    await mu.waitForFunction(() => document.querySelector('p.sr-only[aria-live=polite]').textContent.trim() === '0 results', null, T);
    await mu.getByLabel('Who are you facing?').fill('gard');
    await rowsFound.first().waitFor({ state: 'visible', ...T });
    await noOverflow(mu, 'deck search 390');
    await shotP(mu, 'mu-deck-search.png');
    // search text is kept when the period changes; "Show all" resets
    await mu.getByLabel('Period').selectOption('60');
    await mu.waitForURL(u => new URL(u).searchParams.get('days') === '60', T);
    await mu.waitForTimeout(300);
    if (await mu.getByLabel('Who are you facing?').inputValue() !== 'gard') throw new Error('search text lost on period change');
    await mu.getByLabel('Who are you facing?').fill('');
    await mu.getByRole('heading', { name: 'Best matchups' }).waitFor({ state: 'visible', ...T });
    await more.click(T);
    await other.getByRole('button', { name: 'Show fewer' }).waitFor({ state: 'visible', ...T });
    await mu.getByLabel('Period').selectOption('14');
    await mu.waitForURL(u => new URL(u).searchParams.get('days') === '14', T);
    await other.getByRole('button', { name: `Show all ${expOthers.length}` }).waitFor({ state: 'visible', ...T });
    await more.click(T);
    await other.getByRole('button', { name: 'Show fewer' }).waitFor({ state: 'visible', ...T });
    await mu.getByRole('radiogroup', { name: 'Results from' }).getByText('Official', { exact: true }).click(T);
    await mu.waitForURL(u => new URL(u).searchParams.get('src') === 'official', T);
    await mu.getByRole('radiogroup', { name: 'Results from' }).getByText('Online', { exact: true }).click(T);
    await mu.waitForURL(u => new URL(u).searchParams.get('src') === null, T);
    await other.getByRole('button', { name: `Show all ${expOthers.length}` }).waitFor({ state: 'visible', ...T });
    // search text cleared when navigating to a different deck and back (key={deck})
    await mu.getByLabel('Who are you facing?').fill('gard');
    await mu.evaluate(() => { history.pushState(null, '', '/matchups/gardevoir-ex'); dispatchEvent(new PopStateEvent('popstate')); });
    await mu.getByRole('heading', { name: 'Gardevoir', level: 1 }).waitFor({ state: 'visible', ...T });
    await mu.evaluate(() => { history.pushState(null, '', '/matchups/dragapult-ex'); dispatchEvent(new PopStateEvent('popstate')); });
    await deckReady(mu);
    if (await mu.getByLabel('Who are you facing?').inputValue() !== '') throw new Error('search text kept across decks');
    // details
    const det = mu.locator('footer.mu-about details');
    if (await det.evaluate(d => d.open)) throw new Error('details open by default');
    await det.locator('summary').click(T);
    if (!(await det.evaluate(d => d.open))) throw new Error('details did not open on click');
    await det.getByText('Mirror matches are left out').waitFor({ state: 'visible', ...T });
    await noOverflow(mu, 'deck 390 details open');
  });
  await scenario('12m. Online/Official control: one tab stop, arrow keys move selection and focus', async () => {
    await mu.goto(BASE + '/matchups');
    await mu.locator('a.mu-link').first().waitFor({ state: 'visible', ...T });
    if (await tabbable(mu) !== 'online:0,official:-1') throw new Error(`tab stops: ${await tabbable(mu)}`);
    const grp = mu.getByRole('radiogroup', { name: 'Results from' });
    await grp.getByRole('radio', { name: 'Online' }).focus();
    await mu.keyboard.press('ArrowRight');
    await mu.waitForURL(u => new URL(u).searchParams.get('src') === 'official', T);
    await mu.waitForFunction(() => document.activeElement && document.activeElement.dataset.v === 'official', null, T);
    if (await tabbable(mu) !== 'online:-1,official:0') throw new Error(`tab stops after: ${await tabbable(mu)}`);
    await mu.keyboard.press('ArrowLeft');
    await mu.waitForURL(u => new URL(u).searchParams.get('src') === null, T);
    await mu.waitForFunction(() => document.activeElement && document.activeElement.dataset.v === 'online', null, T);
  });
  const sizes = [[320, 640], [390, 844]];
  for (const [w, h] of sizes) for (const big of [false, true]) await scenario(`13m. matchups at ${w}x${h}${big ? ' with large text (24px)' : ''}`, async () => {
    const page = await newPage({ width: w, height: h });
    await page.goto(BASE + '/matchups/dragapult-ex');
    await deckReady(page);
    if (big) await page.addStyleTag({ content: BIG });
    await page.waitForTimeout(300);
    await noOverflow(page, 'deck');
    await sec(page, 'Other matchups').getByRole('button', { name: /Show all/ }).click(T);
    await page.getByLabel('Who are you facing?').waitFor({ state: 'visible', ...T });
    await noOverflow(page, 'deck expanded');
    await page.locator('footer.mu-about summary').click(T);
    await noOverflow(page, 'deck details open');
    if (w === 390 && big) await shotP(page, 'mu-deck-phone-bigtext.png');
    if (w === 320 && !big) await shotP(page, 'mu-deck-320.png');
    await page.getByLabel('Who are you facing?').fill('gard');
    await page.locator('li.mu-item').first().waitFor({ state: 'visible', ...T });
    await noOverflow(page, 'deck search');
    await page.goto(BASE + '/matchups');
    await page.locator('a.mu-link').first().waitFor({ state: 'visible', ...T });
    if (big) await page.addStyleTag({ content: BIG });
    await noOverflow(page, 'list');
    await page.goto(BASE + '/matchups?src=official&days=180');
    await page.locator('a.mu-link').first().waitFor({ state: 'visible', ...T });
    if (big) await page.addStyleTag({ content: BIG });
    await noOverflow(page, 'list official');
    await page.context().close();
  });
  await scenario('13m. matchups at 1280x800 desktop', async () => {
    const page = await newPage({ width: 1280, height: 800 });
    await page.goto(BASE + '/matchups');
    await page.locator('a.mu-link').first().waitFor({ state: 'visible', ...T });
    await noOverflow(page, 'list desktop');
    await shotP(page, 'mu-list-desktop.png');
    await page.goto(BASE + '/matchups/dragapult-ex');
    await deckReady(page);
    await noOverflow(page, 'deck desktop');
    await shotP(page, 'mu-deck-desktop.png');
    await page.context().close();
  });
  await scenario('13m. matchups light theme at 390', async () => {
    const page = await newPage({ width: 390, height: 844 });
    await page.addInitScript(() => { try { localStorage.setItem('bm:theme', 'light'); } catch {} });
    await page.goto(BASE + '/matchups/dragapult-ex');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await deckReady(page);
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== 'light') throw new Error('theme not light');
    await noOverflow(page, 'deck light');
    await shotP(page, 'mu-deck-light.png');
    await page.context().close();
  });
  const lsec = p => p.locator('section[aria-label="Selected list"]');
  const otherLists = p => p.locator('section.mu-section', { has: p.getByRole('heading', { name: /^(Other lists|Lists)/ }) });
  const listsReady = async p => { await p.getByRole('heading', { name: 'Dragapult lists', level: 1 }).waitFor({ state: 'visible', ...T }); await lsec(p).getByText('Dreepy').first().waitFor({ state: 'visible', ...T }); };
  const rec = r => `${r.wins}-${r.losses}-${r.ties}`;
  await scenario('15. winning lists: CTA, best list, other lists, selection, period', async () => {
    const page = await newPage({ width: 390, height: 844 });
    await page.goto(BASE + '/matchups/dragapult-ex');
    await deckReady(page);
    await page.getByRole('link', { name: /Winning Dragapult lists/ }).click(T);
    await page.waitForURL(u => new URL(u).pathname === '/matchups/dragapult-ex/lists', T);
    await listsReady(page);
    const best = DECK_LISTS[0], sel = lsec(page);
    await sel.getByText('Winningest list').waitFor({ state: 'visible', ...T });
    await sel.getByText(rec(best), { exact: true }).waitFor({ state: 'visible', ...T });
    await sel.getByText(/1st of 64/).waitFor({ state: 'visible', ...T });
    for (const n of ['Dreepy', 'Drakloak', 'Dragapult ex', 'Ultra Ball']) await sel.getByText(n).first().waitFor({ state: 'visible', ...T });
    await see(page, 'Not matched to a card yet: Mystery Card');
    for (const b of ['Copy to my decks', 'Export']) await sel.getByRole('button', { name: b }).waitFor({ state: 'visible', ...T });
    const ev = await sel.getByRole('link', { name: 'Event' }).getAttribute('href');
    if (ev !== `https://play.limitlesstcg.com/tournament/${best.event_id}/standings`) throw new Error(`Event href: ${ev}`);
    // other lists: the other 3 rows
    const oth = otherLists(page);
    await oth.locator('li button.mu-pick').first().waitFor({ state: 'visible', ...T });
    if (await oth.locator('li button.mu-pick').count() !== DECK_LISTS.length - 1) throw new Error('expected other lists = rows - 1');
    if (await oth.locator('li button.mu-pick', { hasText: rec(best) }).count()) throw new Error('best list also in Other lists');
    await noOverflow(page, 'lists 390');
    await shotP(page, 'lists-phone.png');
    // select another
    const pick = DECK_LISTS[2];
    await oth.locator('li button.mu-pick').nth(1).click(T);
    await page.waitForURL(u => new URL(u).searchParams.get('list') === pick.key, T);
    await sel.getByText('Selected list', { exact: true }).waitFor({ state: 'visible', ...T });
    await sel.getByText(rec(pick), { exact: true }).waitFor({ state: 'visible', ...T });
    if (await sel.getByText('Winningest list').count()) throw new Error('still says Winningest');
    await oth.locator('li button.mu-pick', { hasText: rec(best) }).waitFor({ state: 'visible', ...T });
    if (await oth.locator('li button.mu-pick').count() !== DECK_LISTS.length - 1) throw new Error('other lists count changed');
    // period
    const period = page.getByLabel('Period');
    if (await period.inputValue() !== '60') throw new Error('default period should be 60');
    if ((await period.locator('option').allTextContents()).join('|') !== 'Last 30 days|Last 60 days|Last 90 days') throw new Error('period options');
    await period.selectOption('90');
    await page.waitForURL(u => { const s = new URL(u).searchParams; return s.get('days') === '90' && s.get('list') === null; }, T);
    await sel.getByText('Winningest list').waitFor({ state: 'visible', ...T });
    await period.selectOption('60');
    await page.waitForURL(u => new URL(u).searchParams.get('days') === null, T);
    await page.context().close();
  });
  await scenario('16. winning lists: opponent link, empty state', async () => {
    const page = await newPage({ width: 390, height: 844 });
    await page.goto(BASE + '/matchups/dragapult-ex');
    await deckReady(page);
    const link = page.locator('a.mu-deck-link', { hasText: "N's Zoroark" }).first();
    await link.waitFor({ state: 'visible', ...T });
    if (await link.getAttribute('href') !== '/matchups/n-zoroark/lists') throw new Error(`opp href: ${await link.getAttribute('href')}`);
    await link.click(T);
    await page.waitForURL(u => new URL(u).pathname === '/matchups/n-zoroark/lists', T);
    await see(page, 'No lists yet');
    await page.getByRole('heading', { name: /lists$/, level: 1 }).waitFor({ state: 'visible', ...T });
    const back = page.getByRole('link', { name: 'Back to matchups' });
    await back.waitFor({ state: 'visible', ...T });
    await noOverflow(page, 'empty lists');
    await shotP(page, 'lists-empty.png');
    await back.click(T);
    await page.waitForURL(u => new URL(u).pathname === '/matchups/n-zoroark', T);
    await page.context().close();
  });
  await scenario('17. winning lists: Copy to my decks signed out -> /signup, signed in -> POST /decks', async () => {
    const out = await newPage({ width: 390, height: 844 });
    await out.goto(BASE + '/matchups/dragapult-ex/lists');
    await listsReady(out);
    await lsec(out).getByRole('button', { name: 'Copy to my decks' }).click(T);
    await out.waitForURL(u => new URL(u).pathname === '/signup', T);
    await out.context().close();
    const page = await newPage({ width: 390, height: 844 });
    await page.addInitScript(([me]) => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('sb-rnujzhrfiqjfjqskekpt-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_at: exp, user: { id: me, email: 't@example.com' } }));
    }, [ME]);
    const posts = [];
    page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/rest/v1/decks') { try { posts.push(r.postDataJSON()); } catch { posts.push(null); } } });
    await page.goto(BASE + '/matchups/dragapult-ex/lists');
    await listsReady(page);
    await lsec(page).getByRole('button', { name: 'Copy to my decks' }).click(T);
    await page.waitForURL(u => new URL(u).pathname === `/decks/${DECK_ID}`, T);
    if (posts.length !== 1) throw new Error(`expected 1 POST /decks, got ${posts.length}`);
    const b = Array.isArray(posts[0]) ? posts[0][0] : posts[0];
    if (!b || b.format !== 'standard' || b.is_public !== false) throw new Error(`POST body: ${JSON.stringify(b).slice(0, 300)}`);
    if (!Array.isArray(b.cards) || b.cards.length !== 4) throw new Error(`expected 4 cards, got ${b.cards && b.cards.length}`);
    const qty = Object.fromEntries(b.cards.map(c => [c.name, c.qty]));
    if (JSON.stringify(qty) !== JSON.stringify({ Dreepy: 4, Drakloak: 3, 'Dragapult ex': 2, 'Ultra Ball': 4 })) throw new Error(`cards: ${JSON.stringify(qty)}`);
    if (b.cards.some(c => /Mystery/.test(c.name))) throw new Error('unmatched card was included');
    if (!/8-0-0/.test(b.name) || !/Dragapult/.test(b.name)) throw new Error(`deck name: ${b.name}`);
    await page.context().close();
  });
  for (const [w, h] of sizes) for (const big of [false, true]) await scenario(`18. winning lists at ${w}x${h}${big ? ' with large text (24px)' : ''}`, async () => {
    const page = await newPage({ width: w, height: h });
    await page.goto(BASE + '/matchups/dragapult-ex');
    await deckReady(page);
    if (big) await page.addStyleTag({ content: BIG });
    await noOverflow(page, 'deck page with CTA');
    if (w === 390 && !big) await shotP(page, 'mu-deck-phone.png');
    await page.goto(BASE + '/matchups/dragapult-ex/lists');
    await listsReady(page);
    if (big) await page.addStyleTag({ content: BIG });
    await page.waitForTimeout(300);
    await noOverflow(page, 'lists');
    await page.goto(BASE + '/matchups/dragapult-ex/lists?list=' + DECK_LISTS[1].key);
    await listsReady(page);
    if (big) await page.addStyleTag({ content: BIG });
    await noOverflow(page, 'lists (selected)');
    await lsec(page).getByRole('button', { name: 'Export' }).click(T);
    await page.getByRole('dialog').waitFor({ state: 'visible', ...T });
    await noOverflow(page, 'export dialog');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden', ...T });
    if (w === 390 && big) await shotP(page, 'lists-bigtext.png');
    await page.context().close();
  });
  await scenario('18. winning lists light theme at 390', async () => {
    const page = await newPage({ width: 390, height: 844 });
    await page.addInitScript(() => { try { localStorage.setItem('bm:theme', 'light'); } catch {} });
    await page.goto(BASE + '/matchups/dragapult-ex/lists');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await listsReady(page);
    await noOverflow(page, 'lists light');
    await shotP(page, 'lists-light.png');
    await page.context().close();
  });
  const ordn = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const archSorted = [...ARCH_ROWS].sort((a, b) => a.place - b.place || b.tournaments.date.localeCompare(a.tournaments.date));
  const archSummary = (() => { const w = ARCH_ROWS.filter(r => r.place === 1).length, t8 = ARCH_ROWS.filter(r => r.place <= 8).length, ev = new Set(ARCH_ROWS.map(r => r.tournament_id)).size;
    return `${ARCH_ROWS.length} top 32 finishes · ${t8} top 8 · ${w} wins · ${ev} events`; })();
  const archReady = async p => { await p.getByRole('heading', { name: 'Dragapult', level: 1 }).waitFor({ state: 'visible', ...T }); await p.locator('.mu-list li').first().waitFor({ state: 'visible', ...T }); };
  await scenario('25. winning lists: official major list shows placing + tier, renders stored cards, links to our event page', async () => {
    const page = await newPage({ width: 390, height: 844 });
    const asked = [];
    page.on('request', r => { if (new URL(r.url()).pathname === '/rest/v1/rpc/deck_lists') { try { asked.push(r.postDataJSON()); } catch {} } });
    await page.goto(BASE + '/matchups/dragapult-ex/lists');
    await listsReady(page);
    if (!asked.length || asked[0].p_days !== 60) throw new Error(`deck_lists days: ${JSON.stringify(asked[0])}`);
    const oth = otherLists(page);
    const row = oth.locator('li button.mu-pick', { hasText: 'Regional Recife' });
    await row.waitFor({ state: 'visible', ...T });
    const txt = (await row.innerText()).replace(/\s+/g, ' ');
    if (!/2nd/.test(txt) || !/Regional/.test(txt) || !/of 1,074/.test(txt)) throw new Error(`official row: ${txt}`);
    if (/null/.test(txt)) throw new Error(`official row shows null: ${txt}`);
    await row.click(T);
    await page.waitForURL(u => new URL(u).searchParams.get('list') === 't580-2', T);
    const sel = lsec(page);
    await sel.getByText('Selected list', { exact: true }).waitFor({ state: 'visible', ...T });
    await sel.getByText(DECK.cards[0].name).first().waitFor({ state: 'visible', ...T });
    const ev = await sel.getByRole('link', { name: 'Event' }).getAttribute('href');
    if (ev !== '/events/580') throw new Error(`official Event href: ${ev}`);
    if (await sel.getByText(/null|undefined/).count()) throw new Error('null/undefined shown');
    await noOverflow(page, 'official list');
    await page.context().close();
  });
  await scenario('19. archetype page: link from What\'s winning, summary, order, row links, period', async () => {
    const page = await newPage({ width: 390, height: 844 });
    const dates = [];
    page.on('request', r => { const u = new URL(r.url()); if (u.pathname === '/rest/v1/tournament_decks' && (u.searchParams.get('select') || '').includes('tournaments!inner')) dates.push(u.searchParams.get('tournaments.date')); });
    await page.goto(BASE + '/events');
    const link = page.locator('a.mu-deck-link', { hasText: /^Dragapult$/ }).first();
    await link.waitFor({ state: 'visible', ...T });
    if (await link.getAttribute('href') !== '/archetype/Dragapult') throw new Error(`href: ${await link.getAttribute('href')}`);
    await link.click(T);
    await page.waitForURL(u => new URL(u).pathname === '/archetype/Dragapult', T);
    await archReady(page);
    await page.getByText(archSummary, { exact: true }).waitFor({ state: 'visible', ...T });
    const items = page.locator('.mu-list li');
    if (await items.count() !== archSorted.length) throw new Error(`expected ${archSorted.length} rows, got ${await items.count()}`);
    const placeTxt = await items.locator('.mu-place').allTextContents();
    if (placeTxt.join('|') !== archSorted.map(r => ordn(r.place)).join('|')) throw new Error(`order: ${placeTxt}`);
    const evNames = await items.locator('.mu-name b').allTextContents();
    if (evNames.join('|') !== archSorted.map(r => r.tournaments.name).join('|')) throw new Error(`event order (newer first within a place): ${evNames}`);
    for (let i = 0; i < archSorted.length; i++) {
      const r = archSorted[i], li = items.nth(i);
      if (r.card_count != null) {
        const href = await li.locator('a.mu-link').getAttribute('href');
        if (href !== `/events/${r.tournament_id}/${r.place}`) throw new Error(`row ${i} href: ${href}`);
      } else {
        if (await li.locator('a').count()) throw new Error(`row ${i} (no card_count) is a link`);
        await li.getByText('Loading list').waitFor({ state: 'visible', ...T });
      }
    }
    // period
    const period = page.getByLabel('Period');
    if (await period.inputValue() !== '60') throw new Error('default period should be 60');
    if ((await period.locator('option').allTextContents()).join('|') !== 'Last 30 days|Last 60 days|Last 120 days') throw new Error('period options');
    const since = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
    if (dates[dates.length - 1] !== `gte.${since(60)}`) throw new Error(`default date filter: ${dates[dates.length - 1]}`);
    await period.selectOption('120');
    await page.waitForURL(u => new URL(u).searchParams.get('days') === '120', T);
    await page.waitForFunction(() => true);
    await page.waitForTimeout(300);
    if (dates[dates.length - 1] !== `gte.${since(120)}`) throw new Error(`120-day date filter: ${dates[dates.length - 1]}`);
    await period.selectOption('60');
    await page.waitForURL(u => new URL(u).searchParams.get('days') === null, T);
    // /events link carries ?days when not 60
    await page.context().close();
  });
  await scenario('20. archetype page: empty state, and "More lists" link from an event list page', async () => {
    const page = await newPage({ width: 390, height: 844 });
    await page.goto(BASE + '/archetype/Nothing%20Here');
    await page.getByRole('heading', { name: 'Nothing Here', level: 1 }).waitFor({ state: 'visible', ...T });
    await see(page, 'No top 32 finishes in this period');
    await page.getByRole('link', { name: 'All tournaments' }).waitFor({ state: 'visible', ...T });
    await page.goto(BASE + '/events/580/2');
    const more = page.getByRole('link', { name: /More Dragapult lists/ });
    await more.waitFor({ state: 'visible', ...T });
    await more.click(T);
    await page.waitForURL(u => new URL(u).pathname === '/archetype/Dragapult', T);
    await archReady(page);
    await page.context().close();
  });
  for (const [w, h] of sizes) for (const big of [false, true]) await scenario(`21. archetype page at ${w}x${h}${big ? ' with large text (24px)' : ''}`, async () => {
    const page = await newPage({ width: w, height: h });
    await page.goto(BASE + '/archetype/Dragapult');
    await archReady(page);
    if (big) await page.addStyleTag({ content: BIG });
    await page.waitForTimeout(300);
    await noOverflow(page, 'archetype');
    if (w === 390) await shotP(page, big ? 'archetype-bigtext.png' : 'archetype-phone.png');
    await page.goto(BASE + '/archetype/Nothing%20Here');
    await see(page, 'No top 32 finishes');
    if (big) await page.addStyleTag({ content: BIG });
    await noOverflow(page, 'archetype empty');
    await page.context().close();
  });
  await scenario('21. archetype page light theme at 390', async () => {
    const page = await newPage({ width: 390, height: 844 });
    await page.addInitScript(() => { try { localStorage.setItem('bm:theme', 'light'); } catch {} });
    await page.goto(BASE + '/archetype/Dragapult');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await archReady(page);
    await noOverflow(page, 'archetype light');
    await page.context().close();
  });
  await scenario('22. deck navigation race: slow deck A never replaces deck B', async () => {
    const page = await newPage({ width: 1366, height: 900 });
    deckDelay[DECK_ID] = 1500;
    await page.goto(BASE + '/');
    await page.evaluate(([a, b]) => { history.pushState({}, '', '/decks/' + a); dispatchEvent(new PopStateEvent('popstate')); setTimeout(() => { history.pushState({}, '', '/decks/' + b); dispatchEvent(new PopStateEvent('popstate')); }, 200); }, [DECK_ID, DECK_B_ID]);
    await see(page, 'Second deck B');
    await page.waitForTimeout(2000); // let the slow A response land
    delete deckDelay[DECK_ID];
    if (await page.getByText('Dragapult test').count()) throw new Error('stale deck A replaced deck B');
    await see(page, 'Second deck B');
    await page.context().close();
  });
  await scenario('23. deck with >80 unique cards: chunked card requests run concurrently', async () => {
    const page = await newPage({ width: 1366, height: 900 });
    cardReqs.length = 0;
    await page.goto(`${BASE}/decks/${BIG_ID}`);
    await see(page, 'Bulk deck');
    await see(page, 'Bulk Card 170');
    const want = Math.ceil(BIG_N / 80);
    if (cardReqs.length !== want) throw new Error(`expected ${want} card requests, got ${cardReqs.length}`);
    if (cardReqs.reduce((s, r) => s + r.n, 0) !== BIG_N) throw new Error('chunks did not cover all ids once');
    if (Math.max(...cardReqs.map(r => r.start)) >= Math.min(...cardReqs.map(r => r.end))) throw new Error('card chunks were sequential, not concurrent');
    await page.context().close();
  });
  await scenario('24. signed-in /feed (follows mocked) and /settings fetches passkeys exactly once', async () => {
    const page = await newPage({ width: 1366, height: 900 });
    await page.addInitScript(([me]) => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('sb-rnujzhrfiqjfjqskekpt-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_at: exp, user: { id: me, email: 't@example.com' } }));
    }, [ME]);
    await page.goto(BASE + '/feed');
    await page.waitForTimeout(800);
    passkeyReqs.length = 0;
    await page.goto(BASE + '/settings');
    await see(page, 'Passkeys');
    await page.waitForTimeout(1000);
    if (passkeyReqs.length !== 1) throw new Error(`expected 1 passkeys request, got ${passkeyReqs.length}`);
    await page.context().close();
  });
  await scenario('14. nav has Matchups link', async () => {
    await desk.goto(BASE + '/');
    await desk.locator('a[href="/matchups"]').first().waitFor({ state: 'attached', ...T });
    const t = await desk.locator('a[href="/matchups"]').first().textContent();
    if (!/Matchups/.test(t)) throw new Error(`nav link text: ${t}`);
  });
  await scenario('38. a hung request ends in a friendly error, not an endless spinner', async () => {
    const page = await newPage({ width: 1000, height: 800 });
    await page.addInitScript(() => { globalThis.__BM_TIMEOUT_MS = 1500; });
    await page.route('**/rest/v1/decks*', () => {}); // never answers
    const t0 = Date.now();
    await page.goto(BASE + `/decks/${DECK_ID}`);
    await see(page, 'took too long');
    if (Date.now() - t0 > 15000) throw new Error('error took too long to appear');
    await page.context().close();
  });
  await scenario('41. browsers without AbortSignal.timeout (Safari 15) still load data and still time out', async () => {
    const page = await newPage({ width: 1000, height: 800 });
    await page.addInitScript(() => { delete AbortSignal.timeout; globalThis.__BM_TIMEOUT_MS = 1500; });
    await page.goto(BASE + '/matchups/dragapult-ex/lists');
    await lsec(page).getByText('Dreepy').first().waitFor({ state: 'visible', ...T });
    await page.route('**/rest/v1/decks*', () => {}); // never answers
    await page.goto(BASE + `/decks/${DECK_ID}`);
    await see(page, 'took too long');
    await page.context().close();
  });
  const SKEY = 'sb-rnujzhrfiqjfjqskekpt-auth-token';
  await scenario('44. slow edge function outlasts the normal request deadline; old numeric ?list= links still open that list', async () => {
    const page = await newPage({ width: 1000, height: 800 });
    await page.addInitScript(([me, key]) => {
      globalThis.__BM_TIMEOUT_MS = 1500;
      localStorage.setItem(key, JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: me, email: 't@example.com' } }));
    }, [ME, SKEY]);
    await page.route('**/functions/v1/deck-import', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      await new Promise(r => setTimeout(r, 2500));
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ kind: 'limitless', title: 'Slow list', author: 'Ana', text: '4 Dreepy TWM 128\n3 Drakloak TWM 129\n2 Dragapult ex TWM 130\n4 Ultra Ball TWM 196' }) });
    });
    await page.goto(BASE + `/decks/${DECK_ID}?import=1`);
    const dlg = page.getByRole('dialog');
    await dlg.waitFor({ state: 'visible', ...T });
    await dlg.getByRole('radio', { name: /Limitless link/ }).click(T);
    await dlg.getByLabel('Link').fill('https://limitlesstcg.com/decks/list/777');
    await dlg.getByRole('button', { name: 'Get list' }).click(T);
    await dlg.getByText('Drakloak').first().waitFor({ state: 'visible', timeout: 12000 });
    if (await dlg.getByText('took too long').count()) throw new Error('import timed out at the normal deadline');
    await page.goto(BASE + '/matchups/dragapult-ex/lists?list=102');
    const sel = lsec(page);
    await sel.getByText('Selected list', { exact: true }).waitFor({ state: 'visible', ...T });
    await sel.getByText('7-1-0', { exact: true }).waitFor({ state: 'visible', ...T });
    await page.context().close();
  });
  await scenario('42. password sign-in succeeds: session stored, user sent on', async () => {
    const page = await newPage({ width: 1000, height: 800 });
    let asked = null;
    await page.route('**/auth/v1/token*', async route => {
      asked = route.request().url();
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ access_token: 'pw-at', refresh_token: 'pw-rt', expires_in: 3600, user: { id: ME, email: 't@example.com' } }) });
    });
    await page.goto(BASE + '/login');
    const pwToggle = page.getByRole('button', { name: 'Use a password instead' });
    if (await pwToggle.count()) await pwToggle.click(T);
    await page.getByLabel('Email').fill('t@example.com');
    await page.getByLabel('Password').fill('hunter22');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(T);
    await page.waitForURL(u => new URL(u).pathname !== '/login', T);
    if (!asked || !/grant_type=password/.test(asked)) throw new Error(`token request: ${asked}`);
    const stored = await page.evaluate(k => localStorage.getItem(k), SKEY);
    if (!stored || !stored.includes('pw-at')) throw new Error('session not stored: ' + stored);
    await page.context().close();
  });
  await scenario('43. importing a Limitless link calls the deck-import function and shows the cards', async () => {
    const page = await newPage({ width: 1000, height: 800 });
    await page.addInitScript(([me, key]) => {
      localStorage.setItem(key, JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: me, email: 't@example.com' } }));
    }, [ME, SKEY]);
    let body = null;
    await page.route('**/functions/v1/deck-import', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      body = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ kind: 'limitless', title: 'Test list', author: 'Ana', text: '4 Dreepy TWM 128\n3 Drakloak TWM 129\n2 Dragapult ex TWM 130\n4 Ultra Ball TWM 196' }) });
    });
    await page.goto(BASE + `/decks/${DECK_ID}?import=1`);
    const dlg = page.getByRole('dialog');
    await dlg.waitFor({ state: 'visible', ...T });
    await dlg.getByRole('radio', { name: /Limitless link/ }).click(T);
    await dlg.getByLabel('Link').fill('https://limitlesstcg.com/decks/list/12345');
    await dlg.getByRole('button', { name: 'Get list' }).click(T);
    await dlg.getByText('Drakloak').first().waitFor({ state: 'visible', ...T });
    if (!body || body.url !== 'https://limitlesstcg.com/decks/list/12345') throw new Error(`deck-import body: ${JSON.stringify(body)}`);
    await page.context().close();
  });
  await scenario('39. failing profile lookup does not ask a signed-in user to pick a username', async () => {
    const page = await newPage({ width: 1000, height: 800 });
    const before = pageErrors.length;
    await page.addInitScript(([me, key]) => {
      localStorage.setItem(key, JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: me, email: 't@example.com' } }));
    }, [ME, SKEY]);
    await page.route('**/rest/v1/profiles*', route => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
    await page.goto(BASE + '/');
    await page.locator('.topbar-actions button.btn.primary').first().waitFor({ state: 'visible', ...T });
    await page.waitForTimeout(3500); // past the quiet retry
    if (await page.getByText('Pick a username').count()) throw new Error('username prompt shown after a failed profile lookup');
    pageErrors.length = before; // the failed loads are expected
    await page.context().close();
  });
  await scenario('40. a 400 on token refresh keeps the user signed in when another tab stored a newer token', async () => {
    const page = await newPage({ width: 1000, height: 800 });
    const before = pageErrors.length;
    await page.addInitScript(([me, key]) => {
      localStorage.setItem(key, JSON.stringify({ access_token: 'old', refresh_token: 'old-rt', expires_at: Math.floor(Date.now() / 1000) - 100, user: { id: me, email: 't@example.com' } }));
    }, [ME, SKEY]);
    await page.route('**/auth/v1/token*', async route => {
      // "another tab" rotates the token just before our refresh is rejected
      await page.evaluate(([me, key]) => localStorage.setItem(key, JSON.stringify({ access_token: 'new', refresh_token: 'new-rt', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: me, email: 't@example.com' } })), [ME, SKEY]);
      await route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"invalid_grant"}' });
    });
    const rejected = page.waitForResponse(r => new URL(r.url()).pathname === '/auth/v1/token', T);
    await page.goto(BASE + '/');
    await rejected;
    await page.locator('.topbar-actions button.btn.primary').first().waitFor({ state: 'visible', ...T });
    const stored = await page.evaluate(k => localStorage.getItem(k), SKEY);
    if (!stored || !stored.includes('new-rt')) throw new Error('session was dropped or not adopted: ' + stored);
    await page.waitForTimeout(500); // let the browser's own "Failed to load resource" log for the expected 400 arrive
    pageErrors.length = before; // that 400 is the point of this test
    await page.context().close();
  });
} finally {
  await browser.close();
  server.close();
}
console.log('\nPage errors (' + pageErrors.length + '):'); pageErrors.forEach(e => console.log('  ' + e));
console.log('\nUnexpected Supabase calls (' + unexpected.length + '):'); [...new Set(unexpected)].forEach(e => console.log('  ' + e));
process.exit(results.some(r => !r[1]) ? 1 : 0);
