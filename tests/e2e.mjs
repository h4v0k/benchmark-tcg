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
  muOpp('gardevoir-ex', 'Gardevoir', 55, 22, 31, 2),
  muOpp('basic-box-m', 'Basic Box', 40, 20, 20, 0),
  muOpp('crustle-dri', 'Crustle', 9, 7, 2, 0),
];
const RULES = {"standard_min_mark":"H","formats":[{"format":"standard","min_mark":"H","min_release":null,"season":"2026-27","notes":"","source":"","checked_at":"2026-10-05T12:00:00Z","updated_at":"2026-10-05T12:00:00Z"},{"format":"expanded","min_mark":null,"min_release":"2011-04-25","season":"","notes":"","source":"","checked_at":"2026-10-05T12:00:00Z","updated_at":"2026-10-05T12:00:00Z"}],"next_rotation":null,"bans":[{"format":"expanded","card_name":"Red Card","printings":[{"set":"XY","num":"124/146"}],"card_ids":["xy1-124"],"effective_date":null,"source":""}],"upcoming_sets":[],"last_checked":"2026-10-05T12:00:00Z","last_catalog_sync":"2026-10-05T12:00:00Z","card_count":20000};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/* ---------- static server ---------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || !fs.statSync(f).isFile()) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ---------- mock backend ---------- */
const unexpected = [];
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
  if (p === '/rest/v1/tournament_decks') {
    const mk = (place, arch) => ({ tournament_id: 580, place, player: 'Victor Carreira Rodrigues', country: 'BR', archetype: arch, list_id: 30000 + place, card_count: 60, price: 44.14, cards: DECK.cards, missing: [] });
    if (u.searchParams.get('place')) return json(route, [mk(1, 'Ogerpon Meganium')]);
    return json(route, Array.from({ length: 32 }, (_, i) => { const d = mk(i + 1, i % 2 ? 'Dragapult' : "N's Zoroark Lucario"); delete d.cards; if (i > 29) { d.card_count = null; d.list_id = null; } return d; }));
  }
  if (p === '/rest/v1/rpc/matchup_decks') return json(route, body.p_source === 'official' ? MU_DECKS_OFFICIAL : MU_DECKS_ONLINE);
  if (p === '/rest/v1/rpc/matchups') return json(route, body.p_deck === 'dragapult-ex' && body.p_source !== 'official' ? MU_DRAGAPULT : []);
  if (p === '/rest/v1/rpc/matchup_coverage') return json(route, { events: body.p_source === 'official' ? 6 : 38, pending: 2, from: '2026-09-07', to: '2026-10-05', event_names: ['Regional Recife', 'Online Series #12'] });
  if (p === '/rest/v1/rpc/record_view') return route.fulfill({ status: 204, headers: cors });
  if (p === '/rest/v1/cards') {
    const idq = u.searchParams.get('id'); const nameq = u.searchParams.get('name');
    let rows = CARDS;
    if (idq && idq.startsWith('in.')) { const ids = [...idq.matchAll(/"([^"]+)"/g)].map(m => m[1]); const bare = ids.length ? ids : idq.slice(4).replace(/[()]/g, '').split(','); rows = CARDS.filter(c => bare.includes(c.id)); }
    else if (idq && idq.startsWith('eq.')) rows = CARDS.filter(c => c.id === idq.slice(3));
    else if (nameq && nameq.startsWith('eq.')) rows = CARDS.filter(c => c.name.toLowerCase() === nameq.slice(3).toLowerCase());
    return json(route, rows, { headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` } });
  }
  if (p === '/rest/v1/decks') {
    const idq = u.searchParams.get('id');
    const rows = idq && idq.startsWith('eq.') ? (idq.slice(3) === DECK_ID ? [DECK] : []) : [DECK];
    return json(route, rows, { headers: { 'content-range': `0-0/1` } });
  }
  if (p === '/rest/v1/profiles' && u.searchParams.get('id') === `eq.${ME}`) return json(route, [{ id: ME, username: 'tester', bio: '', avatar_card: '', is_admin: false, created_at: NOW }], { headers: { 'content-range': '0-0/1' } });
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
  const mu = await newPage({ width: 390, height: 844 });
  const overflowOf = p => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await scenario('10m. matchups deck list + Find a deck filter', async () => {
    await mu.goto(BASE + '/matchups');
    await see(mu, 'Dragapult');
    for (const n of ['Dragapult', "N's Zoroark", 'Gardevoir', 'Basic Box', 'Crustle']) await mu.locator('.mu-decks').getByText(n, { exact: true }).waitFor({ state: 'visible', ...T });
    await mu.screenshot({ path: '/home/claude/mu-list-phone.png', fullPage: true });
    await mu.getByLabel('Find a deck').fill('zor');
    await mu.locator('.mu-decks li').first().waitFor({ state: 'visible', ...T });
    const n = await mu.locator('.mu-decks li').count();
    if (n !== 1) throw new Error(`expected 1 deck after filtering, got ${n}`);
    await mu.locator('.mu-decks').getByText("N's Zoroark", { exact: true }).waitFor({ state: 'visible', ...T });
  });
  await scenario('11m. matchups Official events toggle', async () => {
    await mu.goto(BASE + '/matchups');
    await see(mu, 'Crustle');
    await mu.getByRole('button', { name: 'Official events' }).or(mu.getByRole('radio', { name: 'Official events' })).or(mu.getByText('Official events', { exact: true })).first().click(T);
    await mu.waitForURL(u => new URL(u).searchParams.get('src') === 'official', T);
    await see(mu, 'Raging Bolt');
    if (await mu.locator('.mu-decks').getByText('Crustle', { exact: true }).count()) throw new Error('Crustle still listed for official');
    const n = await mu.locator('.mu-decks li').count();
    if (n !== 3) throw new Error(`expected 3 official decks, got ${n}`);
    await mu.getByText('30 days', { exact: true }).or(mu.getByText('90 days', { exact: true })).first().click(T);
    await mu.waitForURL(u => new URL(u).searchParams.get('days') !== null, T);
  });
  await scenario('12m. matchups deck page sections + opponent filter', async () => {
    await mu.goto(BASE + '/matchups/dragapult-ex');
    await see(mu, 'Strong against');
    const sec = t => mu.locator('section.panel', { has: mu.getByRole('heading', { name: t }) });
    const strong = sec('Strong against'), weak = sec('Weak against'), every = sec('Every matchup');
    await strong.getByText("N's Zoroark").first().waitFor({ state: 'visible', ...T });
    await weak.getByText('Gardevoir').first().waitFor({ state: 'visible', ...T });
    if (await strong.getByText('Crustle').count() || await weak.getByText('Crustle').count()) throw new Error('small-sample opponent listed in strong/weak');
    await every.getByText('Crustle').first().waitFor({ state: 'visible', ...T });
    await every.getByText('small sample').first().waitFor({ state: 'visible', ...T });
    if (await every.locator('li').count() !== 4) throw new Error('expected 4 rows in Every matchup');
    await every.getByLabel('Find an opponent').fill('gard');
    await every.locator('li').first().waitFor({ state: 'visible', ...T });
    const n = await every.locator('li').count();
    if (n !== 1) throw new Error(`expected 1 row after opponent filter, got ${n}`);
    await mu.screenshot({ path: '/home/claude/mu-deck-phone.png', fullPage: true });
    const o = await overflowOf(mu);
    if (o > 1) throw new Error(`horizontal overflow of ${o}px`);
  });
  await scenario('13m. matchups deck page with large text (150%)', async () => {
    const page = await newPage({ width: 390, height: 844 });
    await page.goto(BASE + '/matchups/dragapult-ex');
    await see(page, 'Strong against');
    await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; });
    await page.addStyleTag({ content: 'body{font-size:150%}' });
    await page.waitForTimeout(300);
    const o = await overflowOf(page);
    await page.screenshot({ path: '/home/claude/mu-deck-phone-bigtext.png', fullPage: true });
    if (o > 1) throw new Error(`horizontal overflow of ${o}px at 150% text`);
    await page.goto(BASE + '/matchups');
    await see(page, 'Crustle');
    await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; });
    const o2 = await overflowOf(page);
    if (o2 > 1) throw new Error(`list page: horizontal overflow of ${o2}px at 150% text`);
    await page.context().close();
  });
  await scenario('14. nav has Matchups link', async () => {
    await desk.goto(BASE + '/');
    await desk.locator('a[href="/matchups"]').first().waitFor({ state: 'attached', ...T });
    const t = await desk.locator('a[href="/matchups"]').first().textContent();
    if (!/Matchups/.test(t)) throw new Error(`nav link text: ${t}`);
  });
} finally {
  await browser.close();
  server.close();
}
console.log('\nPage errors (' + pageErrors.length + '):'); pageErrors.forEach(e => console.log('  ' + e));
console.log('\nUnexpected Supabase calls (' + unexpected.length + '):'); [...new Set(unexpected)].forEach(e => console.log('  ' + e));
process.exit(results.some(r => !r[1]) ? 1 : 0);
