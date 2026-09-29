// Benchmark — Pokémon TCG deck builder
// Card data: TCGdex (api.tcgdex.net). Accounts + storage: Supabase, or browser-only demo mode.

/* ---------------- utilities ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (n == null || isNaN(n)) ? '—' : '$' + Number(n).toFixed(2);
const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
function lsGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  const u = [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']];
  for (const [n, l] of u) if (s >= n) return Math.floor(s / n) + l + ' ago';
  return '';
}
function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 2800);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src;
    s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = null; } }
  });
  await Promise.all(workers); return out;
}

/* ---------------- modal ---------------- */
let MODAL = null;
function openModal(html, { wide = false, onClose } = {}) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) closeModal(); });
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
  MODAL = { wrap, onClose, prevFocus: document.activeElement };
  document.body.style.overflow = 'hidden';
  const f = wrap.querySelector('[autofocus]') || wrap.querySelector('input,textarea,select,button');
  if (f) setTimeout(() => f.focus(), 30);
  return wrap.querySelector('.modal');
}
function closeModal() {
  if (!MODAL) return;
  const m = MODAL; MODAL = null;
  m.wrap.remove(); document.body.style.overflow = '';
  if (m.onClose) m.onClose();
  if (m.prevFocus && m.prevFocus.focus) try { m.prevFocus.focus(); } catch {}
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && MODAL) closeModal(); });
const modalHead = title => `<div class="modal-head"><h2>${esc(title)}</h2><button class="x" data-close aria-label="Close">×</button></div>`;

/* ---------------- TCGdex card data ---------------- */
const API = 'https://api.tcgdex.net/v2/en';
const mem = new Map();
async function getJSON(path, { ttl = 0 } = {}) {
  const key = 'bm:api:' + path;
  if (mem.has(key)) return mem.get(key);
  if (ttl) {
    const c = lsGet(key);
    if (c && Date.now() - c.t < ttl) { mem.set(key, Promise.resolve(c.v)); return c.v; }
  }
  const p = fetch(API + path).then(r => {
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('The card database returned an error (' + r.status + '). Try again in a moment.');
    return r.json();
  });
  mem.set(key, p);
  try {
    const v = await p;
    if (ttl && v != null && !lsSet(key, { t: Date.now(), v })) pruneCache();
    return v;
  } catch (e) { mem.delete(key); throw e; }
}
function pruneCache() {
  try { Object.keys(localStorage).filter(k => k.startsWith('bm:api:/cards/')).forEach(k => localStorage.removeItem(k)); } catch {}
}
const setIdOf = cardId => cardId.slice(0, cardId.lastIndexOf('-'));
const img = (base, q = 'low') => base ? `${base}/${q}.webp` : '';

let SETS = null;
async function getSets() {
  if (SETS) return SETS;
  const list = (await getJSON('/sets', { ttl: 864e5 })) || [];
  const byId = {};
  list.forEach((s, i) => byId[s.id] = { ...s, order: i });
  SETS = { list, byId };
  return SETS;
}
async function getSetInfo(id) {
  const key = 'bm:setinfo:' + id;
  const c = lsGet(key);
  if (c && Date.now() - c.t < 7 * 864e5) return c.v;
  const s = await getJSON('/sets/' + encodeURIComponent(id));
  if (!s) return null;
  const v = { id: s.id, name: s.name, tcgOnline: s.tcgOnline || '', releaseDate: s.releaseDate || '', official: s.cardCount?.official || null };
  lsSet(key, { t: Date.now(), v });
  return v;
}
const getCard = id => getJSON('/cards/' + encodeURIComponent(id), { ttl: 3 * 864e5 });
const namesEq = name => `/cards?name=eq:${encodeURIComponent(name)}`;

async function searchCards(q, cat) {
  q = q.trim();
  if (q.length < 2) return [];
  let briefs;
  const base = `/cards?name=like:${encodeURIComponent(q)}&pagination:itemsPerPage=250`;
  try { briefs = (await getJSON(base + (cat ? `&category=eq:${cat}` : ''))) || []; }
  catch (e) { if (!cat) throw e; briefs = (await getJSON(base)) || []; }
  const sets = await getSets().catch(() => ({ byId: {} }));
  const order = b => sets.byId[setIdOf(b.id)]?.order ?? -1;
  const byName = new Map();
  for (const b of briefs) {
    const cur = byName.get(b.name);
    if (!cur) byName.set(b.name, { name: b.name, best: b, count: 1 });
    else { cur.count++; if (order(b) > order(cur.best) || (!cur.best.image && b.image)) cur.best = b; }
  }
  const ql = q.toLowerCase();
  const rank = n => { const l = n.toLowerCase(); return l === ql ? 0 : l.startsWith(ql) ? 1 : l.split(/\s+/).some(w => w.startsWith(ql)) ? 2 : 3; };
  return [...byName.values()].sort((a, b) => rank(a.name) - rank(b.name) || a.name.length - b.name.length || a.name.localeCompare(b.name)).slice(0, 40);
}

// Printings of a card name, newest set first.
async function getPrintings(name) {
  const briefs = (await getJSON(namesEq(name))) || [];
  const sets = await getSets().catch(() => ({ byId: {} }));
  return briefs.map(b => ({ ...b, setId: setIdOf(b.id), setName: sets.byId[setIdOf(b.id)]?.name || setIdOf(b.id).toUpperCase(), order: sets.byId[setIdOf(b.id)]?.order ?? -1 }))
    .sort((a, b) => b.order - a.order || localNum(a.localId) - localNum(b.localId));
}
const localNum = l => { const n = parseInt(String(l).replace(/\D/g, ''), 10); return isNaN(n) ? 9999 : n; };

// Default printing when adding by name: newest set, lowest collector number (skips secret/special arts).
function pickDefault(printings) {
  const withImg = printings.filter(p => p.image);
  const pool_ = withImg.length ? withImg : printings;
  if (!pool_.length) return null;
  const top = pool_[0].order;
  return pool_.filter(p => p.order === top).sort((a, b) => localNum(a.localId) - localNum(b.localId))[0];
}

/* ---------------- deck entries ---------------- */
const VARIANT_LABEL = { normal: 'Normal', holo: 'Holo', reverse: 'Reverse Holo', firstEdition: '1st Edition', firstEditionHolo: '1st Ed. Holo', unlimitedHolo: 'Unlimited Holo' };
function normVariant(k) {
  const l = k.toLowerCase();
  if (l === 'normal') return 'normal';
  if (l.includes('reverse')) return 'reverse';
  if (l.includes('1st') || l.includes('first')) return l.includes('holo') ? 'firstEditionHolo' : 'firstEdition';
  if (l.includes('unlimited') && l.includes('holo')) return 'unlimitedHolo';
  if (l.includes('holo')) return 'holo';
  return k;
}
function pricesOf(card) {
  const tp = card.pricing?.tcgplayer || {};
  const out = {};
  for (const [k, v] of Object.entries(tp)) {
    if (!v || typeof v !== 'object') continue;
    const p = v.marketPrice ?? v.midPrice ?? v.lowPrice ?? null;
    out[normVariant(k)] = p == null ? null : Number(p);
  }
  const f = card.variants || {};
  if (f.normal && !('normal' in out)) out.normal = null;
  if (f.holo && !('holo' in out)) out.holo = null;
  if (f.reverse && !('reverse' in out)) out.reverse = null;
  if (f.firstEdition && !('firstEdition' in out)) out.firstEdition = null;
  if (!Object.keys(out).length) out.normal = null;
  return out;
}
function defaultVariant(prices, want) {
  const keys = Object.keys(prices);
  if (want && keys.includes(want)) return want;
  for (const k of ['normal', 'holo', 'reverse']) if (keys.includes(k) && prices[k] != null) return k;
  for (const k of ['normal', 'holo', 'reverse']) if (keys.includes(k)) return k;
  return keys[0] || 'normal';
}
function toEntry(card, setInfo, extra = {}) {
  const prices = pricesOf(card);
  return {
    cid: card.id, name: card.name, cat: card.category || '',
    sub: card.trainerType || card.energyType || card.stage || '',
    stage: card.stage || '', types: card.types || [], hp: card.hp || null,
    rarity: card.rarity || '', img: card.image || '',
    setId: card.set?.id || setIdOf(card.id), setName: card.set?.name || setInfo?.name || '',
    setCode: setInfo?.tcgOnline || '', num: String(card.localId ?? ''),
    official: card.set?.cardCount?.official || setInfo?.official || null,
    reg: card.regulationMark || '',
    legal: { standard: !!card.legal?.standard, expanded: !!card.legal?.expanded },
    attacks: (card.attacks || []).map(a => a.name),
    prices, updated: Date.now(),
    qty: 1, board: 'main', variant: defaultVariant(prices), ...extra,
  };
}
async function entryFromId(id, extra = {}) {
  const card = await getCard(id);
  if (!card) throw new Error('That card could not be found in the card database.');
  const setInfo = await getSetInfo(card.set?.id || setIdOf(id)).catch(() => null);
  const e = toEntry(card, setInfo, extra);
  if (extra.variant) e.variant = defaultVariant(e.prices, extra.variant);
  return e;
}
const entryPrice = e => { const p = e.prices || {}; let v = p[e.variant]; if (v == null) v = Object.values(p).find(x => x != null) ?? null; return v; };
const isBasicEnergy = e => e.cat === 'Energy' && /basic/i.test(e.sub);
const isAce = e => /ace spec/i.test(e.rarity) || /ace spec/i.test(e.sub);
const isRadiant = e => /^radiant /i.test(e.name);
const isPrism = e => /◇|prism star/i.test(e.name);
const isBasicPokemon = e => e.cat === 'Pokemon' && /^basic$/i.test(e.stage || e.sub);
const setLabel = e => `${e.setCode || e.setId.toUpperCase()} ${e.num}`;

const GROUPS = ['Pokémon', 'Supporter', 'Item', 'Pokémon Tool', 'Stadium', 'Trainer', 'Special Energy', 'Basic Energy', 'Other'];
function groupOf(e) {
  if (e.cat === 'Pokemon') return 'Pokémon';
  if (e.cat === 'Energy') return isBasicEnergy(e) ? 'Basic Energy' : 'Special Energy';
  if (e.cat === 'Trainer') {
    const t = (e.sub || '').toLowerCase();
    if (t.includes('supporter')) return 'Supporter';
    if (t.includes('stadium')) return 'Stadium';
    if (t.includes('tool')) return 'Pokémon Tool';
    if (t.includes('item')) return 'Item';
    return 'Trainer';
  }
  return 'Other';
}
const STAGE_ORDER = { basic: 0, stage1: 1, stage2: 2, 'vmax': 2, 'vstar': 2, mega: 2, 'break': 2, restored: 0 };
function sortEntries(list) {
  return list.slice().sort((a, b) => {
    if (a.cat === 'Pokemon' && b.cat === 'Pokemon') {
      const sa = STAGE_ORDER[(a.stage || '').toLowerCase().replace(/\s/g, '')] ?? 1, sb = STAGE_ORDER[(b.stage || '').toLowerCase().replace(/\s/g, '')] ?? 1;
      if (b.qty !== a.qty && sa === sb) return b.qty - a.qty;
      if (sa !== sb) return sa - sb;
    } else if (b.qty !== a.qty) return b.qty - a.qty;
    return a.name.localeCompare(b.name);
  });
}
const tcgplayerUrl = e => e.tcgp
  ? `https://www.tcgplayer.com/product/${e.tcgp}`
  : `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(`${e.name} ${e.num}`.trim())}&view=grid`;
// TCGplayer Mass Entry prefilled with exact products: c=4-497557||1-590025
function massEntry(cards) {
  const byId = new Map(), missing = new Map();
  cards.filter(c => c.board === 'main').forEach(c => {
    if (c.tcgp) byId.set(c.tcgp, (byId.get(c.tcgp) || 0) + c.qty);
    else missing.set(c.name, (missing.get(c.name) || 0) + c.qty);
  });
  const lines = [...byId].map(([id, q]) => `${q}-${id}`);
  const url = lines.length
    ? `https://www.tcgplayer.com/massentry?productline=Pokemon&c=${lines.join('||')}`
    : `https://www.tcgplayer.com/massentry?productline=Pokemon&c=${encodeURIComponent([...missing].map(([n, q]) => `${q} ${n}`).join('||'))}`;
  return { url, missing: [...missing.keys()], matched: byId.size };
}
const massEntryUrl = cards => massEntry(cards).url;

// Exact TCGplayer product IDs come from the "tcgplayer" Supabase Edge Function.
const TCGP_RETRY = 7 * 864e5;
const needsTcgp = e => e.tcgp === undefined || (!e.tcgp && Date.now() - (e.tcgpAt || 0) > TCGP_RETRY);
async function resolveTcgp(entries) {
  if (!B || B.kind !== 'supabase') return false;
  const todo = entries.filter(needsTcgp);
  if (!todo.length) return false;
  const uniq = [...new Map(todo.map(e => [e.cid, e])).values()];
  let changed = false;
  for (let i = 0; i < uniq.length; i += 60) {
    const chunk = uniq.slice(i, i + 60);
    try {
      const { data, error } = await B.sb.functions.invoke('tcgplayer', { body: { cards: chunk.map(e => ({ cid: e.cid, name: e.name, setName: e.setName, setCode: e.setCode, num: e.num })) } });
      if (error || !data?.results) { console.warn('TCGplayer lookup failed', error || data); continue; }
      for (const e of todo) {
        if (!(e.cid in data.results)) continue;
        const r = data.results[e.cid];
        e.tcgp = r?.productId || 0; e.tcgpAbbr = r?.abbr || ''; e.tcgpAt = Date.now(); changed = true;
      }
    } catch (err) { console.warn('TCGplayer lookup failed', err); }
  }
  return changed;
}

/* ---------------- rules & stats ---------------- */
const FORMATS = { standard: 'Standard', expanded: 'Expanded', unlimited: 'Unlimited' };
// Current Standard rules (2026–27 format, in effect since April 10, 2026):
// regulation mark H or later; Basic Energy always; Classic Collection reprints never.
const STANDARD_FIRST_MARK = 'H';
const STANDARD_NOTE = 'Regulation marks H, I, J and later (2026–27 format)';
const isClassicCollection = e => /^CC\d/i.test(String(e.num || ''));
const markLegal = mark => /^[A-Z]$/i.test(mark || '') && mark.toUpperCase() >= STANDARD_FIRST_MARK;
function legalIn(e, format) {
  if (format === 'unlimited') return true;
  if (isClassicCollection(e)) return false;
  if (isBasicEnergy(e)) return true;
  const std = markLegal(e.reg) || !!e.reprintLegal;
  if (format === 'standard') return std;
  return std || !!e.legal?.expanded;
}
function validate(deck) {
  const main = deck.cards.filter(c => c.board === 'main');
  const out = [];
  const n = sum(main, c => c.qty);
  out.push(n === 60 ? { level: 'ok', msg: 'Exactly 60 cards' } : { level: 'bad', msg: `${n} cards. A deck needs exactly 60.` });
  const byName = new Map();
  main.filter(c => !isBasicEnergy(c)).forEach(c => byName.set(c.name, (byName.get(c.name) || 0) + c.qty));
  const over = [...byName].filter(([, q]) => q > 4);
  out.push(over.length ? { level: 'bad', msg: 'More than 4 copies: ' + over.map(([nm, q]) => `${nm} (${q})`).join(', ') } : { level: 'ok', msg: 'No more than 4 of any card' });
  const aces = sum(main.filter(isAce), c => c.qty);
  if (aces > 1) out.push({ level: 'bad', msg: `${aces} ACE SPEC cards. Only 1 is allowed.` });
  const rad = sum(main.filter(isRadiant), c => c.qty);
  if (rad > 1) out.push({ level: 'bad', msg: `${rad} Radiant Pokémon. Only 1 is allowed.` });
  const prism = [...byName].filter(([nm, q]) => /◇|prism star/i.test(nm) && q > 1);
  if (prism.length) out.push({ level: 'bad', msg: 'Prism Star cards are limited to 1 each.' });
  const basics = sum(main.filter(isBasicPokemon), c => c.qty);
  out.push(basics > 0 ? { level: 'ok', msg: `${basics} Basic Pokémon` } : { level: 'bad', msg: 'No Basic Pokémon. A deck needs at least one.' });
  if (deck.format !== 'unlimited') {
    const bad = [...new Set(main.filter(c => !legalIn(c, deck.format)).map(c => c.name))];
    out.push(bad.length
      ? { level: 'bad', msg: `Not ${FORMATS[deck.format]} legal: ${bad.join(', ')}`, hint: deck.format === 'standard' ? STANDARD_NOTE + '. Classic Collection reprints are never legal.' : '' }
      : { level: 'ok', msg: `All cards ${FORMATS[deck.format]} legal`, hint: deck.format === 'standard' ? STANDARD_NOTE : '' });
  }
  const noPrice = main.filter(c => entryPrice(c) == null).length;
  if (noPrice) out.push({ level: 'warn', msg: `${noPrice} card${noPrice > 1 ? 's have' : ' has'} no price data` });
  return out;
}
function choose(n, k) { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }
// Chance of at least one Basic Pokémon in the opening 7.
function openOdds(main) {
  const N = sum(main, c => c.qty); const B = sum(main.filter(isBasicPokemon), c => c.qty);
  if (N < 7 || B === 0) return null;
  return 1 - choose(N - B, 7) / choose(N, 7);
}
const TYPE_COLOR = { Grass: '#3f9b3f', Fire: '#e0532b', Water: '#2f7fd1', Lightning: '#f0c419', Psychic: '#9a4fc1', Fighting: '#b5652d', Darkness: '#2f4b55', Metal: '#8a96a1', Dragon: '#b08f1c', Fairy: '#e070a8', Colorless: '#c9c3b6' };
const energyType = e => { const m = e.name.match(/(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy)/i); return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : 'Other'; };

/* ---------------- PTCGL import / export ---------------- */
const SECTION_NAME = { Pokemon: 'Pokémon', Trainer: 'Trainer', Energy: 'Energy' };
function exportPTCGL(deck, board = 'main') {
  const cards = deck.cards.filter(c => c.board === board);
  const lines = [];
  for (const cat of ['Pokemon', 'Trainer', 'Energy']) {
    const list = sortEntries(cards.filter(c => (c.cat || 'Trainer') === cat));
    if (!list.length) continue;
    lines.push(`${SECTION_NAME[cat]}: ${sum(list, c => c.qty)}`);
    list.forEach(c => lines.push(`${c.qty} ${c.name} ${c.setCode || c.setId.toUpperCase()} ${/^\d+$/.test(c.num) ? String(parseInt(c.num, 10)) : c.num}`));
    lines.push('');
  }
  lines.push(`Total Cards: ${sum(cards, c => c.qty)}`);
  return lines.join('\n');
}
function exportPlain(deck, board = 'main') {
  const agg = new Map();
  deck.cards.filter(c => c.board === board).forEach(c => agg.set(c.name, (agg.get(c.name) || 0) + c.qty));
  return [...agg].map(([n, q]) => `${q} ${n}`).join('\n');
}
const ENERGY_SYM = { G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal', Y: 'Fairy' };
function parseDeckText(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^\*\s*/, '');
    if (!line || /^(pok[eé]mon|trainer|energy|total cards)\s*[:(]/i.test(line) || /^#/.test(line)) continue;
    let m = line.match(/^(\d+)x?\s+(.+?)\s+([A-Za-z0-9-]{2,8}(?:\.\d)?)\s+([A-Za-z]{0,4}\d+[A-Za-z]?)$/);
    if (m) { out.push({ qty: +m[1], name: m[2], code: m[3], num: m[4], line: raw }); continue; }
    m = line.match(/^(\d+)x?\s+(.+)$/);
    if (m) out.push({ qty: +m[1], name: m[2].trim(), code: '', num: '', line: raw });
  }
  return out;
}
function nameVariants(name) {
  const v = [name];
  const sym = name.match(/^Basic \{(\w)\} Energy$/i);
  if (sym && ENERGY_SYM[sym[1].toUpperCase()]) v.push(`Basic ${ENERGY_SYM[sym[1].toUpperCase()]} Energy`, `${ENERGY_SYM[sym[1].toUpperCase()]} Energy`);
  if (/^Basic \w+ Energy$/i.test(name)) v.push(name.replace(/^Basic /i, ''));
  else if (/^(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/i.test(name)) v.push('Basic ' + name);
  v.push(name.replace(/’/g, "'"), name.replace(/ Pokemon/g, ' Pokémon'));
  return [...new Set(v)];
}
async function resolveLine(l) {
  const nums = l.num ? [...new Set([l.num, String(parseInt(l.num, 10)), l.num.padStart(3, '0')].filter(x => x && x !== 'NaN'))] : [];
  for (const n of nameVariants(l.name)) {
    if (nums.length) {
      const briefs = (await getJSON(`${namesEq(n)}&localId=eq:${nums.map(encodeURIComponent).join('|')}`)) || [];
      if (briefs.length === 1) return briefs[0].id;
      if (briefs.length > 1) {
        if (l.code) for (const b of briefs) {
          const s = await getSetInfo(setIdOf(b.id)).catch(() => null);
          if (s?.tcgOnline && s.tcgOnline.toUpperCase() === l.code.toUpperCase()) return b.id;
        }
        const p = await getPrintings(n); const hit = p.find(x => briefs.some(b => b.id === x.id));
        if (hit) return hit.id;
      }
    }
    const prints = await getPrintings(n);
    if (prints.length) {
      if (l.code) {
        for (const p of prints.slice(0, 12)) {
          const s = await getSetInfo(p.setId).catch(() => null);
          if (s?.tcgOnline && s.tcgOnline.toUpperCase() === l.code.toUpperCase()) return p.id;
        }
      }
      return pickDefault(prints)?.id;
    }
  }
  return null;
}

/* ---------------- backends ---------------- */
class LocalBackend {
  constructor() { this.kind = 'local'; this.user = { id: 'local-user' }; this.profile = { id: 'local-user', username: 'you' }; this.listeners = []; }
  async init() {}
  onChange(f) { this.listeners.push(f); }
  _all() { return lsGet('bm.local.decks') || []; }
  _save(a) { if (!lsSet('bm.local.decks', a)) throw new Error('Your browser storage is full. Delete a deck and try again.'); }
  _out(d) { return d ? { ...d, ownerName: 'you' } : null; }
  async listMine() { return this._all().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(d => this._out(d)); }
  async listPublic({ q = '', format = '', sort = 'likes' } = {}) {
    let a = this._all().filter(d => d.isPublic);
    if (q) a = a.filter(d => d.name.toLowerCase().includes(q.toLowerCase()));
    if (format) a = a.filter(d => d.format === format);
    a.sort((x, y) => sort === 'new' ? y.updatedAt.localeCompare(x.updatedAt) : (y.likeCount - x.likeCount) || y.updatedAt.localeCompare(x.updatedAt));
    return a.map(d => this._out(d));
  }
  async getProfile(username) { return username === 'you' ? this.profile : null; }
  async listByUser(profile) { return profile ? this.listMine() : []; }
  async getDeck(id) { return this._out(this._all().find(d => d.id === id)); }
  async createDeck(d) {
    const now = new Date().toISOString();
    const deck = { id: newId(), owner: this.user.id, name: 'Untitled deck', format: 'standard', description: '', isPublic: false, cards: [], cover: '', price: 0, cardCount: 0, likeCount: 0, createdAt: now, updatedAt: now, ...d };
    const a = this._all(); a.push(deck); this._save(a); return this._out(deck);
  }
  async updateDeck(id, patch) {
    const a = this._all(); const i = a.findIndex(d => d.id === id);
    if (i < 0) throw new Error('Deck not found.');
    a[i] = { ...a[i], ...patch, updatedAt: new Date().toISOString() }; this._save(a); return this._out(a[i]);
  }
  async deleteDeck(id) { this._save(this._all().filter(d => d.id !== id)); }
  async likedSet(ids) { const l = new Set(lsGet('bm.local.likes') || []); return new Set(ids.filter(i => l.has(i))); }
  async like(id, on) {
    const l = new Set(lsGet('bm.local.likes') || []); on ? l.add(id) : l.delete(id); lsSet('bm.local.likes', [...l]);
    const a = this._all(); const d = a.find(x => x.id === id); if (d) { d.likeCount = Math.max(0, (d.likeCount || 0) + (on ? 1 : -1)); this._save(a); }
  }
}

const LIST_COLS = 'id,owner,name,format,description,is_public,cover,price,card_count,like_count,created_at,updated_at,owner_profile:profiles!decks_owner_fkey(username)';
class SupaBackend {
  constructor(url, key) {
    this.kind = 'supabase';
    this.sb = window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    this.user = null; this.profile = null; this.listeners = [];
  }
  async init() {
    const { data } = await this.sb.auth.getSession();
    await this._apply(data.session);
    this.sb.auth.onAuthStateChange((_ev, session) => {
      // Defer: calling Supabase inside this callback can deadlock the auth client.
      setTimeout(async () => {
        const before = this.user?.id;
        await this._apply(session);
        if (before !== this.user?.id) this.listeners.forEach(f => f());
      }, 0);
    });
  }
  onChange(f) { this.listeners.push(f); }
  async _apply(session) {
    const u = session?.user || null;
    if (u && this.user?.id === u.id && this.profile) { this.user = u; return; }
    this.user = u; this.profile = null;
    if (u) {
      const { data } = await this.sb.from('profiles').select('id,username').eq('id', u.id).maybeSingle();
      this.profile = data || null;
    }
  }
  _err(error, fallback) {
    if (!error) return;
    throw new Error(error.message || fallback || 'Something went wrong. Try again.');
  }
  async signUp(email, password) {
    const { data, error } = await this.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
    this._err(error); return { needsConfirm: !data.session };
  }
  async signIn(email, password) { const { error } = await this.sb.auth.signInWithPassword({ email, password }); this._err(error); await this._apply((await this.sb.auth.getSession()).data.session); }
  async signOut() { await this.sb.auth.signOut(); this.user = null; this.profile = null; }
  async resetPassword(email) { const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); this._err(error); }
  async createProfile(username) {
    const { data, error } = await this.sb.from('profiles').insert({ id: this.user.id, username }).select('id,username').single();
    if (error) throw new Error(error.code === '23505' ? 'That username is taken.' : error.message);
    this.profile = data; return data;
  }
  _map(r) {
    return { id: r.id, owner: r.owner, ownerName: r.owner_profile?.username || '', name: r.name, format: r.format, description: r.description || '', isPublic: r.is_public, cards: r.cards || [], cover: r.cover || '', price: Number(r.price) || 0, cardCount: r.card_count || 0, likeCount: r.like_count || 0, createdAt: r.created_at, updatedAt: r.updated_at };
  }
  async listMine() {
    const { data, error } = await this.sb.from('decks').select(LIST_COLS).eq('owner', this.user.id).order('updated_at', { ascending: false });
    this._err(error); return data.map(r => this._map(r));
  }
  async listPublic({ q = '', format = '', sort = 'likes' } = {}) {
    let qb = this.sb.from('decks').select(LIST_COLS).eq('is_public', true);
    if (q) qb = qb.ilike('name', `%${q.replace(/[%_]/g, '')}%`);
    if (format) qb = qb.eq('format', format);
    qb = sort === 'new' ? qb.order('updated_at', { ascending: false }) : qb.order('like_count', { ascending: false }).order('updated_at', { ascending: false });
    const { data, error } = await qb.limit(60);
    this._err(error); return data.map(r => this._map(r));
  }
  async getProfile(username) {
    const { data, error } = await this.sb.from('profiles').select('id,username').ilike('username', username.replace(/[%_]/g, '')).maybeSingle();
    this._err(error); return data;
  }
  async listByUser(profile) {
    const { data, error } = await this.sb.from('decks').select(LIST_COLS).eq('owner', profile.id).order('updated_at', { ascending: false });
    this._err(error); return data.map(r => this._map(r));
  }
  async getDeck(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { data, error } = await this.sb.from('decks').select('*,owner_profile:profiles!decks_owner_fkey(username)').eq('id', id).maybeSingle();
    this._err(error); return data ? this._map(data) : null;
  }
  _row(p) {
    const r = {};
    if ('name' in p) r.name = p.name; if ('format' in p) r.format = p.format; if ('description' in p) r.description = p.description;
    if ('isPublic' in p) r.is_public = p.isPublic; if ('cards' in p) r.cards = p.cards; if ('cover' in p) r.cover = p.cover;
    if ('price' in p) r.price = Math.round(p.price * 100) / 100; if ('cardCount' in p) r.card_count = p.cardCount;
    return r;
  }
  async createDeck(d) {
    const row = { owner: this.user.id, name: 'Untitled deck', format: 'standard', ...this._row(d) };
    const { data, error } = await this.sb.from('decks').insert(row).select('*,owner_profile:profiles!decks_owner_fkey(username)').single();
    this._err(error); return this._map(data);
  }
  async updateDeck(id, patch) {
    const { error } = await this.sb.from('decks').update({ ...this._row(patch), updated_at: new Date().toISOString() }).eq('id', id);
    this._err(error);
  }
  async deleteDeck(id) { const { error } = await this.sb.from('decks').delete().eq('id', id); this._err(error); }
  async likedSet(ids) {
    if (!this.user || !ids.length) return new Set();
    const { data, error } = await this.sb.from('deck_likes').select('deck_id').eq('user_id', this.user.id).in('deck_id', ids);
    if (error) return new Set(); return new Set(data.map(r => r.deck_id));
  }
  async like(id, on) {
    const { error } = on
      ? await this.sb.from('deck_likes').insert({ deck_id: id, user_id: this.user.id })
      : await this.sb.from('deck_likes').delete().eq('deck_id', id).eq('user_id', this.user.id);
    if (error && error.code !== '23505') this._err(error);
  }
}

let B;
const signedIn = () => !!(B.user && B.profile);

/* ---------------- shell ---------------- */
const main = $('#main');
function renderShell() {
  const h = location.hash || '#/';
  const cur = h.startsWith('#/decks') ? 'decks' : h === '#/' || h === '#' ? 'browse' : '';
  $('#nav').innerHTML = `
    <a href="#/" ${cur === 'browse' ? 'aria-current="page"' : ''}>Browse</a>
    <a href="#/decks" ${cur === 'decks' ? 'aria-current="page"' : ''}>My decks</a>`;
  const acc = $('#account');
  if (B.kind === 'local') acc.innerHTML = `<button class="btn primary sm" data-act="new-deck">New deck</button>`;
  else if (B.user && B.profile) acc.innerHTML = `
    <button class="btn primary sm" data-act="new-deck">New deck</button>
    <div class="menu"><button class="btn sm" data-act="menu" aria-haspopup="true" aria-expanded="false">@${esc(B.profile.username)}</button>
      <div class="menu-list" hidden><a href="#/u/${encodeURIComponent(B.profile.username)}">My profile</a><a href="#/decks">My decks</a><button data-act="sign-out">Sign out</button></div></div>`;
  else acc.innerHTML = `<a class="btn sm" href="#/login">Sign in</a><a class="btn primary sm" href="#/login?new">Create account</a>`;
  $('#banner').innerHTML = B.kind === 'local' ? `<div class="banner"><div class="wrap"><b>Demo mode.</b><span>Decks save in this browser only. Add your Supabase keys to config.js to turn on accounts and public decks.</span></div></div>` : '';
}
document.addEventListener('click', async e => {
  const a = e.target.closest('[data-act]');
  if (!a) {
    $$('.menu-list').forEach(m => m.hidden = true);
    return;
  }
  const act = a.dataset.act;
  if (act === 'menu') { const l = a.nextElementSibling; l.hidden = !l.hidden; a.setAttribute('aria-expanded', String(!l.hidden)); e.stopPropagation(); return; }
  if (act === 'sign-out') { await B.signOut(); renderShell(); location.hash = '#/'; toast('Signed out'); return; }
  if (act === 'new-deck') { newDeckModal(); return; }
});

function needAuth() {
  if (B.kind === 'local' || signedIn()) return false;
  if (B.user && !B.profile) { usernameModal(); return true; }
  location.hash = '#/login'; return true;
}

/* ---------------- router ---------------- */
const routes = [
  [/^#?\/?$/, viewBrowse],
  [/^#\/decks$/, viewMyDecks],
  [/^#\/deck\/([^/?]+)$/, viewDeck],
  [/^#\/u\/([^/?]+)$/, viewUser],
  [/^#\/login(\?new)?$/, viewLogin],
];
let routeToken = 0;
async function route() {
  closeModal(); hidePreview();
  const token = ++routeToken;
  renderShell();
  const h = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      try { await fn(token, ...m.slice(1).map(x => x && decodeURIComponent(x))); }
      catch (err) { if (token === routeToken) main.innerHTML = errorBlock(err); console.error(err); }
      if (token === routeToken && B.user && !B.profile && B.kind === 'supabase') usernameModal();
      return;
    }
  }
  main.innerHTML = `<div class="wrap page"><div class="empty"><h2>Page not found</h2><p>That link doesn't go anywhere.</p><div class="row-gap"><a class="btn primary" href="#/">Browse decks</a></div></div></div>`;
}
const errorBlock = err => `<div class="wrap page"><div class="empty"><h2>Couldn't load this</h2><p>${esc(err.message || err)}</p><div class="row-gap"><button class="btn" onclick="location.reload()">Reload</button></div></div></div>`;
const loadingBlock = (t = 'Loading…') => `<div class="wrap loading">${esc(t)}</div>`;

/* ---------------- deck tiles ---------------- */
function tileHTML(d) {
  const art = d.cover ? `style="background-image:url('${esc(img(d.cover, 'high'))}')"` : '';
  return `<a class="tile" href="#/deck/${esc(d.id)}">
    <div class="tile-art" ${art}><span class="badge fmt">${esc(FORMATS[d.format] || d.format)}</span></div>
    <div class="tile-body">
      <div class="tile-name">${esc(d.name)}</div>
      <div class="tile-meta"><span>@${esc(d.ownerName || 'unknown')}</span>${d.isPublic ? '' : '<span>Private</span>'}<span>${esc(ago(d.updatedAt))}</span></div>
      <div class="tile-meta"><span><span class="mono">${d.cardCount || 0}</span> cards</span><span class="mono">${money(d.price)}</span><span>♥ <span class="mono">${d.likeCount || 0}</span></span></div>
    </div></a>`;
}

/* ---------------- views: browse / mine / user ---------------- */
async function viewBrowse(token) {
  const st = lsGet('bm.browse') || { q: '', format: '', sort: 'likes' };
  main.innerHTML = `<div class="wrap page">
    <div class="page-head"><div><h1>Browse decks</h1><p>Public decks from everyone${B.kind === 'local' ? ' (in demo mode, only your own public decks show here)' : ''}.</p></div></div>
    <div class="filters">
      <input class="input" id="bq" type="search" placeholder="Search deck names" value="${esc(st.q)}" aria-label="Search deck names">
      <select class="input" id="bf" aria-label="Format"><option value="">All formats</option>${Object.entries(FORMATS).map(([k, v]) => `<option value="${k}" ${st.format === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select class="input" id="bs" aria-label="Sort"><option value="likes" ${st.sort === 'likes' ? 'selected' : ''}>Most liked</option><option value="new" ${st.sort === 'new' ? 'selected' : ''}>Recently updated</option></select>
    </div>
    <div id="blist">${loadingBlock()}</div></div>`;
  const load = async () => {
    const s = { q: $('#bq').value.trim(), format: $('#bf').value, sort: $('#bs').value }; lsSet('bm.browse', s);
    const list = await B.listPublic(s);
    if (token !== routeToken) return;
    $('#blist').innerHTML = list.length ? `<div class="tiles">${list.map(tileHTML).join('')}</div>`
      : `<div class="empty"><h2>No public decks yet</h2><p>${s.q || s.format ? 'Nothing matches those filters.' : 'Build a deck and make it public in its settings to list it here.'}</p><div class="row-gap"><button class="btn primary" data-act="new-deck">New deck</button></div></div>`;
  };
  $('#bq').addEventListener('input', debounce(() => load().catch(e => $('#blist').innerHTML = errorBlock(e)), 300));
  $('#bf').addEventListener('change', () => load());
  $('#bs').addEventListener('change', () => load());
  await load();
}

async function viewMyDecks(token) {
  if (needAuth()) return;
  main.innerHTML = loadingBlock();
  const list = await B.listMine();
  if (token !== routeToken) return;
  main.innerHTML = `<div class="wrap page">
    <div class="page-head"><div><h1>My decks</h1><p>${list.length} deck${list.length === 1 ? '' : 's'}</p></div>
      <div class="row-gap"><button class="btn" data-act="import-new">Import deck</button><button class="btn primary" data-act="new-deck">New deck</button></div></div>
    ${list.length ? `<div class="tiles">${list.map(tileHTML).join('')}</div>` : `<div class="empty"><h2>No decks yet</h2><p>Start from scratch, or paste a list exported from Pokémon TCG Live.</p><div class="row-gap"><button class="btn" data-act="import-new">Import deck</button><button class="btn primary" data-act="new-deck">New deck</button></div></div>`}
  </div>`;
  $$('[data-act="import-new"]', main).forEach(b => b.addEventListener('click', () => importModal(null)));
}

async function viewUser(token, username) {
  main.innerHTML = loadingBlock();
  const p = await B.getProfile(username);
  if (token !== routeToken) return;
  if (!p) { main.innerHTML = `<div class="wrap page"><div class="empty"><h2>No such user</h2><p>@${esc(username)} doesn't exist.</p></div></div>`; return; }
  const list = await B.listByUser(p);
  if (token !== routeToken) return;
  const mine = B.user && p.id === B.user.id;
  main.innerHTML = `<div class="wrap page"><div class="page-head"><div><h1>@${esc(p.username)}</h1><p>${list.length} ${mine ? '' : 'public '}deck${list.length === 1 ? '' : 's'}</p></div></div>
    ${list.length ? `<div class="tiles">${list.map(tileHTML).join('')}</div>` : `<div class="empty"><h2>No decks to show</h2><p>${mine ? 'Your decks will show here.' : 'This player hasn\'t shared any decks yet.'}</p></div>`}</div>`;
}

/* ---------------- auth views ---------------- */
async function viewLogin(token, isNew) {
  if (B.kind === 'local') { main.innerHTML = `<div class="wrap page auth"><div class="panel"><h1>Demo mode</h1><p>Accounts are off because no Supabase project is connected. Your decks save in this browser.</p><a class="btn primary" href="#/decks">Go to my decks</a></div></div>`; return; }
  if (signedIn()) { location.hash = '#/decks'; return; }
  let mode = isNew ? 'up' : 'in';
  const render = () => {
    main.innerHTML = `<div class="wrap page auth"><form class="panel" id="authf" novalidate>
      <h1>${mode === 'in' ? 'Sign in' : 'Create account'}</h1>
      <div class="field"><label for="ae">Email</label><input class="input" id="ae" type="email" autocomplete="email" required></div>
      <div class="field"><label for="ap">Password</label><input class="input" id="ap" type="password" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}" minlength="8" required></div>
      <div class="form-error" id="aerr" hidden></div>
      <button class="btn primary" type="submit">${mode === 'in' ? 'Sign in' : 'Create account'}</button>
      <div class="row-gap" style="justify-content:space-between">
        <button class="btn ghost sm" type="button" id="aswap">${mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}</button>
        ${mode === 'in' ? '<button class="btn ghost sm" type="button" id="areset">Forgot password</button>' : ''}
      </div></form></div>`;
    $('#aswap').onclick = () => { mode = mode === 'in' ? 'up' : 'in'; render(); };
    const err = m => { const el = $('#aerr'); el.textContent = m; el.hidden = !m; };
    if ($('#areset')) $('#areset').onclick = async () => {
      const email = $('#ae').value.trim(); if (!email) return err('Enter your email first, then tap Forgot password.');
      try { await B.resetPassword(email); err(''); toast('Password reset email sent'); } catch (e) { err(e.message); }
    };
    $('#authf').onsubmit = async ev => {
      ev.preventDefault();
      const email = $('#ae').value.trim(), pw = $('#ap').value;
      if (!email || !pw) return err('Enter your email and password.');
      if (mode === 'up' && pw.length < 8) return err('Use a password with at least 8 characters.');
      const btn = $('#authf button[type=submit]'); btn.disabled = true;
      try {
        if (mode === 'in') { await B.signIn(email, pw); renderShell(); if (!B.profile) usernameModal(() => location.hash = '#/decks'); else location.hash = '#/decks'; }
        else {
          const r = await B.signUp(email, pw);
          if (r.needsConfirm) main.innerHTML = `<div class="wrap page auth"><div class="panel"><h1>Check your email</h1><p>We sent a confirmation link to <b>${esc(email)}</b>. Open it on this device to finish creating your account.</p></div></div>`;
          else { renderShell(); usernameModal(() => location.hash = '#/decks'); }
        }
      } catch (e) { err(e.message); btn.disabled = false; }
    };
  };
  render();
}
function usernameModal(after) {
  if (MODAL?.wrap.querySelector('#unf')) return;
  const m = openModal(`${modalHead('Pick a username')}<form id="unf"><div class="modal-body">
      <p class="muted" style="margin:0">This shows on your public decks and profile page.</p>
      <div class="field"><label for="un">Username</label><input class="input" id="un" autocomplete="username" maxlength="20" placeholder="e.g. ashketchum" autofocus></div>
      <div class="muted" style="font-size:13px">3–20 letters, numbers, or underscores.</div>
      <div class="form-error" id="unerr" hidden></div></div>
      <div class="modal-foot"><button class="btn primary" type="submit">Save username</button></div></form>`);
  m.querySelector('.x').remove();
  $('#unf').onsubmit = async ev => {
    ev.preventDefault();
    const u = $('#un').value.trim(); const e = $('#unerr');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) { e.textContent = 'Use 3–20 letters, numbers, or underscores.'; e.hidden = false; return; }
    try { await B.createProfile(u); closeModal(); renderShell(); toast('Welcome, @' + u); if (after) after(); else route(); }
    catch (er) { e.textContent = er.message; e.hidden = false; }
  };
}

/* ---------------- new deck / import ---------------- */
function newDeckModal() {
  if (needAuth()) return;
  openModal(`${modalHead('New deck')}<form id="ndf"><div class="modal-body">
    <div class="field"><label for="ndn">Deck name</label><input class="input" id="ndn" maxlength="80" placeholder="e.g. Charizard ex / Pidgeot" autofocus></div>
    <div class="field"><label for="ndfm">Format</label><select class="input" id="ndfm">${Object.entries(FORMATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    </div><div class="modal-foot"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Create deck</button></div></form>`);
  $('#ndf').onsubmit = async ev => {
    ev.preventDefault();
    try {
      const d = await B.createDeck({ name: $('#ndn').value.trim() || 'Untitled deck', format: $('#ndfm').value });
      closeModal(); sessionStorage.setItem('bm.edit.' + d.id, '1'); location.hash = '#/deck/' + d.id;
    } catch (e) { toast(e.message, 'bad'); }
  };
}
function importModal(deckCtx) {
  if (needAuth()) return;
  const into = !!deckCtx;
  openModal(`${modalHead(into ? 'Import cards' : 'Import deck')}<form id="imf"><div class="modal-body">
    ${into ? '' : `<div class="field"><label for="imn">Deck name</label><input class="input" id="imn" maxlength="80" placeholder="Imported deck"></div>
    <div class="field"><label for="imfm">Format</label><select class="input" id="imfm">${Object.entries(FORMATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>`}
    <div class="field"><label for="imt">Deck list</label><textarea class="input" id="imt" rows="12" autofocus placeholder="Pokémon: 12\n4 Dreepy TWM 128\n...\nTrainer: 36\n4 Iono PAL 185\n...\nEnergy: 12\n8 Basic {P} Energy SVE 5"></textarea></div>
    <div class="muted" style="font-size:13px">Paste an export from Pokémon TCG Live, or one card per line like <span class="mono">4 Iono PAL 185</span> or <span class="mono">4 Iono</span>.</div>
    ${into ? `<div class="field"><label for="imb">Add to</label><select class="input" id="imb"><option value="main">Mainboard</option><option value="maybe">Maybeboard</option></select></div><label class="check"><input type="checkbox" id="imr"> Replace the cards already on that board</label>` : ''}
    <div id="improg" class="muted" hidden></div>
    </div><div class="modal-foot"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" id="imgo">Import</button></div></form>`, { wide: false });
  $('#imf').onsubmit = async ev => {
    ev.preventDefault();
    const lines = parseDeckText($('#imt').value);
    if (!lines.length) { toast('Paste a deck list first', 'bad'); return; }
    const prog = $('#improg'); prog.hidden = false; $('#imgo').disabled = true;
    const board = into ? $('#imb').value : 'main';
    let done = 0;
    const results = await pool(lines, 4, async l => {
      const id = await resolveLine(l);
      const e = id ? await entryFromId(id, { qty: l.qty, board }) : null;
      prog.textContent = `Finding cards… ${++done} of ${lines.length}`;
      return e;
    });
    const found = results.filter(Boolean);
    const missing = lines.filter((_, i) => !results[i]);
    try {
      if (into) {
        const d = DP.deck;
        if ($('#imr').checked) d.cards = d.cards.filter(c => c.board !== board);
        found.forEach(e => addEntry(d, e));
        closeModal(); afterCardsChange(); renderDeck(); matchTcgp(found); runReprintCheck(found);
      } else {
        prog.textContent = 'Matching cards to TCGplayer…';
        await resolveTcgp(found);
        const cards = []; found.forEach(e => addEntry({ cards }, e));
        const draft = { cards }; const t = totals(draft);
        const d = await B.createDeck({ name: $('#imn').value.trim() || 'Imported deck', format: $('#imfm').value, cards, price: t.price, cardCount: t.count, cover: autoCover(cards) });
        closeModal(); location.hash = '#/deck/' + d.id;
      }
      if (missing.length) setTimeout(() => openModal(`${modalHead('Some cards weren\'t found')}<div class="modal-body"><p style="margin:0">Imported ${found.length} of ${lines.length} lines. These couldn't be matched to a card:</p><pre class="input mono" style="white-space:pre-wrap;margin:0">${esc(missing.map(m => m.line).join('\n'))}</pre><p class="muted" style="margin:0">Search for them by name with the Add card box.</p></div><div class="modal-foot"><button class="btn primary" data-close>OK</button></div>`), 60);
      else toast(`Imported ${found.length} lines`);
    } catch (e) { toast(e.message, 'bad'); $('#imgo').disabled = false; }
  };
}
function addEntry(deck, e) {
  const ex = deck.cards.find(c => c.cid === e.cid && c.board === e.board && c.variant === e.variant);
  if (ex) ex.qty += e.qty; else deck.cards.push(e);
}
function autoCover(cards) {
  const p = sortEntries(cards.filter(c => c.board === 'main' && c.cat === 'Pokemon' && c.img)).sort((a, b) => b.qty - a.qty || (b.hp || 0) - (a.hp || 0));
  return p[0]?.img || cards.find(c => c.img)?.img || '';
}
function totals(deck) {
  const main_ = deck.cards.filter(c => c.board === 'main');
  return { count: sum(main_, c => c.qty), price: sum(main_, c => c.qty * (entryPrice(c) || 0)) };
}

/* ---------------- deck page ---------------- */
let DP = null;
async function viewDeck(token, id) {
  main.innerHTML = loadingBlock('Loading deck…');
  const deck = await B.getDeck(id);
  if (token !== routeToken) return;
  if (!deck) { main.innerHTML = `<div class="wrap page"><div class="empty"><h2>Deck not found</h2><p>This deck doesn't exist, or its owner made it private.</p><div class="row-gap"><a class="btn primary" href="#/">Browse decks</a></div></div></div>`; return; }
  const mine = !!(B.user && deck.owner === B.user.id);
  const liked = (await B.likedSet([deck.id]).catch(() => new Set())).has(deck.id);
  if (token !== routeToken) return;
  const editFlag = sessionStorage.getItem('bm.edit.' + deck.id);
  DP = { deck, mine, liked, editing: mine && (editFlag === '1' || deck.cards.length === 0), board: 'main', view: lsGet('bm.view') || 'text', saving: '', token };
  renderDeck();
  if (mine) refreshStalePrices(token);
  matchTcgp(deck.cards, token);
  runReprintCheck(deck.cards);
}
function coverOf(d) { return d.cover || autoCover(d.cards); }
function renderDeck() {
  const { deck, mine, editing, liked } = DP;
  const t = totals(deck);
  const cover = coverOf(deck);
  document.title = `${deck.name} · Benchmark`;
  const mainCount = t.count, maybeCount = sum(deck.cards.filter(c => c.board === 'maybe'), c => c.qty);
  main.innerHTML = `
  <section class="deck-hero" style="--cover:${cover ? `url('${esc(img(cover, 'high'))}')` : 'none'}">
    <div class="wrap hero-inner"><div>
      <div class="hero-kicker"><a href="#/u/${encodeURIComponent(deck.ownerName)}">@${esc(deck.ownerName)}</a><span class="badge">${esc(FORMATS[deck.format] || deck.format)}</span><span>${deck.isPublic ? 'Public' : 'Private'}</span><span>Updated ${esc(ago(deck.updatedAt))}</span></div>
      <h1>${esc(deck.name)}</h1>
      ${deck.description ? `<p class="deck-desc">${esc(deck.description)}</p>` : ''}
      <div class="hero-stats"><span><b>${mainCount}</b> cards</span><span><b>${money(t.price)}</b> est. price</span><span>♥ <b>${deck.likeCount}</b></span></div>
    </div>${cover ? `<img class="hero-cover" src="${esc(img(cover, 'low'))}" alt="">` : ''}</div>
    <div class="wrap hero-actions">
      ${mine ? `<button class="btn ${editing ? 'primary' : ''}" data-d="toggle-edit">${editing ? 'Done editing' : 'Edit deck'}</button>` : ''}
      ${!mine ? `<button class="btn ${liked ? 'on' : ''}" data-d="like" aria-pressed="${liked}">${liked ? '♥ Liked' : '♡ Like'}</button>` : ''}
      <button class="btn" data-d="export">Export</button>
      <a class="btn js-mass" href="${esc(massEntryUrl(deck.cards))}" target="_blank" rel="noopener">Buy on TCGplayer</a>
      <button class="btn" data-d="share">Share</button>
      <button class="btn" data-d="clone">Copy deck</button>
      ${mine ? `<button class="btn" data-d="settings">Settings</button><button class="btn" data-d="delete">Delete</button>` : ''}
    </div>
  </section>
  <div class="wrap deck-layout">
    <div>
      <div class="toolbar">
        <div class="tabs" role="tablist">
          <button role="tab" aria-selected="${DP.board === 'main'}" data-d="board" data-v="main">Mainboard<span class="n">${mainCount}</span></button>
          <button role="tab" aria-selected="${DP.board === 'maybe'}" data-d="board" data-v="maybe">Maybeboard<span class="n">${maybeCount}</span></button>
        </div>
        <div class="row-gap">
          <span class="save-state" id="savestate">${esc(DP.saving)}</span>
          <div class="seg" aria-label="View">${['text', 'visual', 'table'].map(v => `<button data-d="view" data-v="${v}" aria-pressed="${DP.view === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
        </div>
      </div>
      ${editing ? `<div class="adder">
        <input class="input" id="addq" type="search" placeholder="Add a card to the ${DP.board === 'main' ? 'Mainboard' : 'Maybeboard'}…" autocomplete="off" aria-label="Search cards to add" role="combobox" aria-expanded="false" aria-controls="addres">
        <select class="input" id="addcat" aria-label="Card type"><option value="">All types</option><option value="Pokemon">Pokémon</option><option value="Trainer">Trainer</option><option value="Energy">Energy</option></select>
        <button class="btn" data-d="import">Import</button>
        <div class="results" id="addres" role="listbox" hidden></div>
      </div>` : ''}
      <div id="cardlist">${renderCards()}</div>
    </div>
    <aside class="side">${renderStats()}</aside>
  </div>`;
  bindDeck();
}
function boardCards() { return DP.deck.cards.map((c, i) => ({ c, i })).filter(x => x.c.board === DP.board); }
function grouped() {
  const g = new Map();
  for (const x of boardCards()) { const k = groupOf(x.c); if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
  return GROUPS.filter(k => g.has(k)).map(k => {
    const arr = g.get(k); const sorted = sortEntries(arr.map(x => x.c)); return [k, sorted.map(c => arr.find(x => x.c === c))];
  });
}
const tagsHTML = c => `${isAce(c) ? '<span class="tag ace">Ace</span>' : ''}${c.variant && c.variant !== 'normal' && Object.keys(c.prices || {}).length > 1 ? `<span class="tag fin">${esc(VARIANT_LABEL[c.variant] || c.variant)}</span>` : ''}${DP.deck.format !== 'unlimited' && c.board === 'main' && !legalIn(c, DP.deck.format) ? '<span class="tag bad">Not legal</span>' : ''}`;
function renderCards() {
  const groups = grouped();
  if (!groups.length) {
    return `<div class="empty"><h2>${DP.board === 'main' ? 'No cards yet' : 'Maybeboard is empty'}</h2><p>${DP.editing ? 'Search for a card above, or import a list from Pokémon TCG Live.' : DP.mine ? 'Tap Edit deck to start adding cards.' : 'Nothing here yet.'}</p></div>`;
  }
  const { editing } = DP;
  if (DP.view === 'visual') {
    return `<div class="vgroups">${groups.map(([g, xs]) => `<section class="vgroup"><h3>${esc(g)} <span class="mono muted">${sum(xs, x => x.c.qty)}</span></h3><div class="vgrid">${xs.map(({ c, i }) =>
      `<button class="vcard" data-d="open" data-i="${i}" aria-label="${esc(c.qty + ' ' + c.name)}">${c.img ? `<img loading="lazy" src="${esc(img(c.img))}" alt="">` : `<span class="noimg">${esc(c.name)}</span>`}<span class="vq">×${c.qty}</span></button>`).join('')}</div></section>`).join('')}</div>`;
  }
  if (DP.view === 'table') {
    const rows = groups.flatMap(([g, xs]) => xs.map(x => ({ ...x, g })));
    return `<div class="table-wrap"><table class="cards"><thead><tr><th class="num">Qty</th><th>Name</th><th>Type</th><th>Set</th><th>#</th><th>Reg</th><th>Finish</th><th class="num">Each</th><th class="num">Total</th></tr></thead><tbody>
      ${rows.map(({ c, i, g }) => `<tr><td class="num">${editing ? `<span class="qtyctl"><button class="icon-btn" data-d="dec" data-i="${i}" aria-label="Remove one">−</button><span class="qty">${c.qty}</span><button class="icon-btn" data-d="inc" data-i="${i}" aria-label="Add one">+</button></span>` : c.qty}</td>
        <td><button class="cname" data-d="open" data-i="${i}" data-hover="${esc(c.img)}">${esc(c.name)}</button>${tagsHTML(c)}</td><td>${esc(g)}</td><td>${esc(c.setName)}</td><td class="mono">${esc(c.num)}</td><td>${esc(c.reg || '—')}</td><td>${esc(VARIANT_LABEL[c.variant] || c.variant)}</td><td class="num">${money(entryPrice(c))}</td><td class="num">${money((entryPrice(c) || 0) * c.qty)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  return `<div class="groups">${groups.map(([g, xs]) => `<section class="group"><h3><span>${esc(g)}</span><span class="mono">${sum(xs, x => x.c.qty)}</span></h3><ul class="rows">${xs.map(({ c, i }) => `
    <li class="row">${editing ? `<span class="qtyctl"><button class="icon-btn" data-d="dec" data-i="${i}" aria-label="Remove one ${esc(c.name)}">−</button><span class="qty">${c.qty}</span><button class="icon-btn" data-d="inc" data-i="${i}" aria-label="Add one ${esc(c.name)}">+</button></span>` : `<span class="qty">${c.qty}</span>`}
      <span class="nameCell"><button class="cname" data-d="open" data-i="${i}" data-hover="${esc(c.img)}">${esc(c.name)}</button>${tagsHTML(c)}</span>
      <span class="setc">${esc(setLabel(c))}</span><span class="price">${money(entryPrice(c) == null ? null : entryPrice(c) * c.qty)}</span></li>`).join('')}</ul></section>`).join('')}</div>`;
}
function renderStats() {
  const deck = DP.deck;
  const main_ = deck.cards.filter(c => c.board === 'main');
  const n = sum(main_, c => c.qty);
  const pk = sum(main_.filter(c => c.cat === 'Pokemon'), c => c.qty), tr = sum(main_.filter(c => c.cat === 'Trainer'), c => c.qty), en = sum(main_.filter(c => c.cat === 'Energy'), c => c.qty);
  const other = n - pk - tr - en;
  const denom = Math.max(n, 60);
  const checks = validate(deck);
  const odds = openOdds(main_);
  const types = new Map(); main_.filter(c => c.cat === 'Pokemon').forEach(c => { const t = c.types?.[0] || 'Colorless'; types.set(t, (types.get(t) || 0) + c.qty); });
  const energies = new Map(); main_.filter(isBasicEnergy).forEach(c => { const t = energyType(c); energies.set(t, (energies.get(t) || 0) + c.qty); });
  const special = sum(main_.filter(c => c.cat === 'Energy' && !isBasicEnergy(c)), c => c.qty);
  const t = totals(deck);
  const me = massEntry(deck.cards);
  const chip = (t, q) => `<span class="echip"><span class="dot" style="background:${TYPE_COLOR[t] || '#999'}"></span>${esc(t)} <b>${q}</b></span>`;
  const ic = { ok: '✓', warn: '!', bad: '✕' };
  return `
  <section class="panel"><h2>Deck</h2>
    <div class="bigcount"><b>${n}</b><span class="muted">/ 60</span></div>
    <div class="split" role="img" aria-label="${pk} Pokémon, ${tr} Trainer, ${en} Energy">
      <span style="width:${pk / denom * 100}%;background:#e0532b"></span><span style="width:${tr / denom * 100}%;background:#2f7fd1"></span><span style="width:${en / denom * 100}%;background:#f0c419"></span>${other ? `<span style="width:${other / denom * 100}%;background:#8a96a1"></span>` : ''}
    </div>
    <div class="legend"><div><span><i style="background:#e0532b"></i>Pokémon</span><span class="mono">${pk}</span></div><div><span><i style="background:#2f7fd1"></i>Trainer</span><span class="mono">${tr}</span></div><div><span><i style="background:#f0c419"></i>Energy</span><span class="mono">${en}</span></div></div>
  </section>
  <section class="panel"><h2>${esc(FORMATS[deck.format] || 'Deck')} checks</h2>
    <ul class="checks">${checks.map(c => `<li class="${c.level}"><span class="ic">${ic[c.level]}</span><span>${esc(c.msg)}${c.hint ? `<br><span class="muted">${esc(c.hint)}</span>` : ''}</span></li>`).join('')}</ul>
  </section>
  <section class="panel"><h2>Opening hand</h2>
    ${odds == null ? '<p class="muted" style="margin:0">Add Basic Pokémon to see your odds.</p>' : `<div class="odds"><span>Opens with a Basic</span><b>${(odds * 100).toFixed(1)}%</b><span>Mulligan chance</span><b>${((1 - odds) * 100).toFixed(1)}%</b></div>`}
  </section>
  ${types.size ? `<section class="panel"><h2>Pokémon types</h2><div class="chips">${[...types].sort((a, b) => b[1] - a[1]).map(([t, q]) => chip(t, q)).join('')}</div></section>` : ''}
  ${energies.size || special ? `<section class="panel"><h2>Energy</h2><div class="chips">${[...energies].sort((a, b) => b[1] - a[1]).map(([t, q]) => chip(t, q)).join('')}${special ? `<span class="echip"><span class="dot" style="background:conic-gradient(#e0532b,#2f7fd1,#f0c419,#3f9b3f,#9a4fc1,#e0532b)"></span>Special <b>${special}</b></span>` : ''}</div></section>` : ''}
  <section class="panel"><h2>Price</h2><div class="pricebig">${money(t.price)}</div><p class="muted" style="margin:0 0 12px;font-size:13px">TCGplayer market price for the printings and finishes you picked.</p><a class="btn sm js-mass" href="${esc(me.url)}" target="_blank" rel="noopener">Buy the whole deck on TCGplayer</a>${massNote(me)}</section>`;
}
function massNote(me) {
  if (B.kind !== 'supabase') return '<p class="muted" style="margin:10px 0 0;font-size:12.5px">Exact TCGplayer printings need an account server. In demo mode, TCGplayer picks the printing.</p>';
  if (DP.tcgpPending) return '<p class="muted" style="margin:10px 0 0;font-size:12.5px">Matching cards to TCGplayer…</p>';
  if (!me.missing.length) return me.matched ? '<p class="muted" style="margin:10px 0 0;font-size:12.5px">Opens TCGplayer Mass Entry with your exact printings. Tap Add all to cart.</p>' : '';
  return `<p style="margin:10px 0 0;font-size:12.5px;color:var(--warn)">Not found on TCGplayer, so not in the cart link: ${esc(me.missing.join(', '))}</p>`;
}
function bindDeck() {
  const root = main;
  root.querySelectorAll('[data-d]').forEach(el => el.addEventListener('click', onDeckAction));
  if (DP.editing) bindAdder();
}
async function onDeckAction(e) {
  const el = e.currentTarget; const act = el.dataset.d; const i = el.dataset.i != null ? +el.dataset.i : null;
  const deck = DP.deck;
  switch (act) {
    case 'toggle-edit': DP.editing = !DP.editing; sessionStorage.setItem('bm.edit.' + deck.id, DP.editing ? '1' : '0'); renderDeck(); if (DP.editing) setTimeout(() => $('#addq')?.focus(), 30); break;
    case 'board': DP.board = el.dataset.v; renderDeck(); break;
    case 'view': DP.view = el.dataset.v; lsSet('bm.view', DP.view); $('#cardlist').innerHTML = renderCards(); $$('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === DP.view))); $$('#cardlist [data-d]').forEach(x => x.addEventListener('click', onDeckAction)); break;
    case 'inc': deck.cards[i].qty++; afterCardsChange(); refreshList(); break;
    case 'dec': deck.cards[i].qty--; if (deck.cards[i].qty <= 0) deck.cards.splice(i, 1); afterCardsChange(); refreshList(); break;
    case 'open': openCardModal(i); break;
    case 'import': importModal(deck); break;
    case 'export': exportModal(); break;
    case 'share': shareDeck(); break;
    case 'clone': cloneDeck(); break;
    case 'settings': settingsModal(); break;
    case 'delete': deleteModal(); break;
    case 'like': toggleLike(); break;
  }
}
function refreshList() {
  $('#cardlist').innerHTML = renderCards();
  $$('#cardlist [data-d]').forEach(x => x.addEventListener('click', onDeckAction));
  $('.side').innerHTML = renderStats();
  const t = totals(DP.deck);
  const hs = $$('.hero-stats b'); if (hs[0]) hs[0].textContent = t.count; if (hs[1]) hs[1].textContent = money(t.price);
  const mu = massEntryUrl(DP.deck.cards); $$('.js-mass').forEach(a => a.href = mu);
  const tabs = $$('.tabs .n'); if (tabs[0]) tabs[0].textContent = t.count; if (tabs[1]) tabs[1].textContent = sum(DP.deck.cards.filter(c => c.board === 'maybe'), c => c.qty);
}
const setSaving = s => { DP.saving = s; const el = $('#savestate'); if (el) el.textContent = s; };
const pendingSave = new Map();
const flushSaves = debounce(async () => {
  const decks = [...pendingSave.values()]; pendingSave.clear();
  for (const d of decks) {
    const t = totals(d);
    try {
      await B.updateDeck(d.id, { cards: d.cards, price: t.price, cardCount: t.count, cover: d.cover });
      d.updatedAt = new Date().toISOString();
      if (DP?.deck === d) setSaving('Saved');
    } catch (e) { if (DP?.deck === d) setSaving('Not saved'); toast('Couldn\'t save: ' + e.message, 'bad'); }
  }
}, 700);
async function runReprintCheck(entries) {
  const dp = DP; if (!dp) return;
  const changed = await checkReprints(entries).catch(() => false);
  if (!changed || DP !== dp) return;
  if (dp.mine) { pendingSave.set(dp.deck.id, dp.deck); flushSaves(); }
  refreshList(); if (CM) drawCardModal();
}
async function matchTcgp(entries, token) {
  if (!DP || B.kind !== 'supabase' || !entries.some(needsTcgp)) return;
  const dp = DP; dp.tcgpPending = true;
  const side = $('.side'); if (side) side.innerHTML = renderStats();
  const changed = await resolveTcgp(entries);
  dp.tcgpPending = false;
  if (DP !== dp) return;
  if (changed && dp.mine) { pendingSave.set(dp.deck.id, dp.deck); flushSaves(); }
  refreshList();
  if (CM) drawCardModal();
}
function afterCardsChange() { setSaving('Saving…'); pendingSave.set(DP.deck.id, DP.deck); flushSaves(); }
window.addEventListener('beforeunload', e => { if (pendingSave.size) { e.preventDefault(); e.returnValue = ''; } });

// Add-card search box
function bindAdder() {
  const q = $('#addq'), res = $('#addres'), cat = $('#addcat');
  let items = [], active = 0, seq = 0;
  const close = () => { res.hidden = true; q.setAttribute('aria-expanded', 'false'); };
  const draw = () => {
    res.innerHTML = items.length ? items.map((r, k) => `<button type="button" role="option" class="result ${k === active ? 'active' : ''}" data-k="${k}" aria-selected="${k === active}">
      ${r.best.image ? `<img loading="lazy" src="${esc(img(r.best.image))}" alt="">` : '<span class="noimg"></span>'}
      <span style="min-width:0"><span class="rn">${esc(r.name)}</span><br><span class="rs">${r.count} printing${r.count === 1 ? '' : 's'}</span></span><span class="add">Add</span></button>`).join('')
      : `<div class="note">No cards match “${esc(q.value.trim())}”.</div>`;
    res.hidden = false; q.setAttribute('aria-expanded', 'true');
    res.querySelectorAll('.result').forEach(b => b.addEventListener('mousedown', ev => { ev.preventDefault(); pick(+b.dataset.k); }));
  };
  const run = debounce(async () => {
    const s = ++seq; const text = q.value.trim();
    if (text.length < 2) { close(); return; }
    res.innerHTML = '<div class="note">Searching…</div>'; res.hidden = false;
    try { const r = await searchCards(text, cat.value); if (s !== seq) return; items = r; active = 0; draw(); }
    catch (e) { if (s === seq) { res.innerHTML = `<div class="note">${esc(e.message)}</div>`; } }
  }, 250);
  const pick = async k => {
    const r = items[k]; if (!r) return;
    close(); q.value = '';
    setSaving('Adding ' + r.name + '…');
    try {
      const prints = await getPrintings(r.name);
      const def = pickDefault(prints) || r.best;
      const e = await entryFromId(def.id, { board: DP.board });
      addEntry(DP.deck, e);
      if (!DP.deck.cover) DP.deck.cover = autoCover(DP.deck.cards);
      afterCardsChange(); refreshList(); toast(`Added ${e.name}`);
      matchTcgp([e]); runReprintCheck([e]);
    } catch (err) { setSaving(''); toast(err.message, 'bad'); }
    q.focus();
  };
  q.addEventListener('input', run);
  cat.addEventListener('change', run);
  q.addEventListener('keydown', ev => {
    if (res.hidden || !items.length) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); active = Math.min(items.length - 1, active + 1); draw(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = Math.max(0, active - 1); draw(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); pick(active); }
    else if (ev.key === 'Escape') close();
  });
  q.addEventListener('blur', () => setTimeout(close, 150));
}

// A card is also Standard legal if the same card (same name and attacks) was reprinted with a legal mark.
async function checkReprints(entries) {
  const todo = entries.filter(e => e.cat !== 'Energy' && !markLegal(e.reg) && !isClassicCollection(e) && e.reprintLegal === undefined);
  if (!todo.length) return false;
  let changed = false;
  const byName = new Map(); todo.forEach(e => { if (!byName.has(e.name)) byName.set(e.name, []); byName.get(e.name).push(e); });
  await pool([...byName], 3, async ([name, list]) => {
    const prints = (await getPrintings(name)).filter(p => !/^CC\d/i.test(p.localId)).slice(0, 10);
    const cards = (await pool(prints, 4, p => getCard(p.id))).filter(Boolean).filter(c => markLegal(c.regulationMark));
    for (const e of list) {
      const same = cards.some(c => e.cat !== 'Pokemon' || (c.attacks || []).map(a => a.name).join('|') === (e.attacks || []).join('|'));
      e.reprintLegal = same; changed = true;
    }
  });
  return changed;
}
async function refreshStalePrices(token) {
  const stale = DP.deck.cards.filter(c => Date.now() - (c.updated || 0) > 2 * 864e5);
  if (!stale.length) return;
  let changed = false;
  await pool(stale, 4, async c => {
    const card = await getCard(c.cid); if (!card) return;
    c.prices = pricesOf(card); c.legal = { standard: !!card.legal?.standard, expanded: !!card.legal?.expanded }; c.updated = Date.now(); changed = true;
  });
  if (changed && DP && DP.token === token) { refreshList(); pendingSave.set(DP.deck.id, DP.deck); flushSaves(); }
}

/* ---------------- card modal ---------------- */
let CM = null;
function openCardModal(i) {
  const e = DP.deck.cards[i]; if (!e) return;
  CM = { i, view: e, printings: null };
  openModal(`<div class="modal-head"><h2>Card</h2><button class="x" data-close aria-label="Close">×</button></div><div class="modal-body" id="cmb"></div>`, { wide: true, onClose: () => { CM = null; } });
  drawCardModal();
  loadPrintings();
}
function drawCardModal() {
  if (!CM) return;
  const e = DP.deck.cards[CM.i]; const v = CM.view; const isCur = v.cid === e.cid;
  const editable = DP.editing && DP.mine;
  const fmtLegal = f => `<span class="pill ${legalIn(v, f) ? 'ok' : 'bad'}">${FORMATS[f]} ${legalIn(v, f) ? '✓' : '✕'}</span>`;
  const finishes = Object.entries(v.prices);
  $('#cmb').innerHTML = `<div class="cm">
    <div class="cm-img">${v.img ? `<img src="${esc(img(v.img, 'high'))}" alt="${esc(v.name)}">` : `<span class="noimg">${esc(v.name)}</span>`}</div>
    <div class="cm-info">
      <div><h2>${esc(v.name)}</h2><div class="meta-line">${esc(v.setName)} · #${esc(v.num)}${v.official ? '/' + v.official : ''}${v.rarity ? ' · ' + esc(v.rarity) : ''}${v.reg ? ' · Regulation ' + esc(v.reg) : ''}${v.setCode ? ' · <span class="mono">' + esc(v.setCode) + '</span>' : ''}</div></div>
      <div class="legal">${fmtLegal('standard')}${fmtLegal('expanded')}${isAce(v) ? '<span class="pill neutral">ACE SPEC</span>' : ''}</div>
      <div><div class="label" style="margin-bottom:6px">Finish</div><div class="finishes">${finishes.map(([k, p]) => `<button class="finish" data-fin="${esc(k)}" aria-pressed="${isCur ? e.variant === k : false}" ${editable ? '' : 'disabled'}><b>${esc(VARIANT_LABEL[k] || k)}</b><span>${money(p)}</span></button>`).join('')}</div></div>
      ${!isCur ? `<p class="muted" style="margin:0">Previewing a different printing.</p>` : ''}
      ${editable ? `<div class="cm-controls">
          ${isCur ? `<span class="qtyctl"><button class="icon-btn" data-cm="dec" aria-label="Remove one">−</button><span class="qty mono">${e.qty}</span><button class="icon-btn" data-cm="inc" aria-label="Add one">+</button></span>
          <button class="btn sm" data-cm="move">Move to ${e.board === 'main' ? 'Maybeboard' : 'Mainboard'}</button>
          <button class="btn sm ${DP.deck.cover === e.img ? 'on' : ''}" data-cm="cover">${DP.deck.cover === e.img ? 'Deck cover' : 'Set as cover'}</button>
          <button class="btn sm danger" data-cm="remove">Remove</button>` : `<button class="btn primary sm" data-cm="use">Use this printing</button>`}
        </div>` : ''}
      ${v.tcgp ? `<a class="btn primary buy" href="${esc(tcgplayerUrl(v))}" target="_blank" rel="noopener">Buy this printing on TCGplayer</a>`
        : B.kind === 'supabase' && needsTcgp(v) ? `<span class="btn primary buy" aria-disabled="true" style="opacity:.6">Finding it on TCGplayer…</span>`
        : `<a class="btn buy" href="${esc(tcgplayerUrl(v))}" target="_blank" rel="noopener">Search TCGplayer for this card</a>`}
    </div></div>
    <div class="printings-head"><h3>Printings</h3><span class="muted" id="prcount"></span></div>
    <div class="printings" id="prgrid"><div class="muted">Loading printings…</div></div>`;
  $$('#cmb [data-cm]').forEach(b => b.addEventListener('click', onCardModalAction));
  $$('#cmb [data-fin]').forEach(b => b.addEventListener('click', () => { if (!editable) return; if (!isCur) return; e.variant = b.dataset.fin; afterCardsChange(); drawCardModal(); drawPrintings(); refreshList(); }));
  if (CM.printings) drawPrintings();
}
async function onCardModalAction(ev) {
  const act = ev.currentTarget.dataset.cm; const d = DP.deck; const e = d.cards[CM.i];
  if (act === 'inc') e.qty++;
  else if (act === 'dec') { e.qty--; if (e.qty <= 0) { d.cards.splice(CM.i, 1); closeModal(); afterCardsChange(); refreshList(); return; } }
  else if (act === 'move') {
    const to = e.board === 'main' ? 'maybe' : 'main';
    const ex = d.cards.find(c => c !== e && c.cid === e.cid && c.variant === e.variant && c.board === to);
    if (ex) { ex.qty += e.qty; d.cards.splice(CM.i, 1); } else e.board = to;
    closeModal(); afterCardsChange(); refreshList(); toast(`Moved to ${to === 'main' ? 'Mainboard' : 'Maybeboard'}`); return;
  }
  else if (act === 'cover') { d.cover = e.img; renderDeckKeepModal(); }
  else if (act === 'remove') { d.cards.splice(CM.i, 1); closeModal(); afterCardsChange(); refreshList(); return; }
  else if (act === 'use') { await swapPrinting(CM.view.cid); return; }
  afterCardsChange(); drawCardModal(); refreshList();
}
function renderDeckKeepModal() {
  const heroCover = $('.deck-hero'); if (heroCover) heroCover.style.setProperty('--cover', `url('${img(coverOf(DP.deck), 'high')}')`);
  const hc = $('.hero-cover'); if (hc) hc.src = img(coverOf(DP.deck), 'low');
}
async function swapPrinting(cid) {
  const d = DP.deck; const e = d.cards[CM.i];
  try {
    const n = await entryFromId(cid, { qty: e.qty, board: e.board, variant: e.variant });
    const wasCover = d.cover && d.cover === e.img;
    d.cards[CM.i] = n; if (wasCover) d.cover = n.img;
    CM.view = n; afterCardsChange(); drawCardModal(); refreshList(); renderDeckKeepModal(); toast('Printing updated');
    matchTcgp([n]); runReprintCheck([n]);
  } catch (err) { toast(err.message, 'bad'); }
}
async function loadPrintings() {
  const cm = CM;
  try {
    const list = await getPrintings(cm.view.name);
    if (CM !== cm) return;
    cm.printings = list.map(p => ({ ...p, price: undefined, diff: false }));
    drawPrintings();
    const base = DP.deck.cards[cm.i];
    await pool(cm.printings.slice(0, 36), 6, async p => {
      const card = await getCard(p.id); if (!card || CM !== cm) return;
      const pr = pricesOf(card); const k = defaultVariant(pr); p.price = pr[k];
      if (base.cat === 'Pokemon' && base.attacks?.length) {
        const a = (card.attacks || []).map(x => x.name).join('|'); p.diff = a !== base.attacks.join('|');
      }
      drawPrintings();
    });
  } catch (err) { if (CM === cm) $('#prgrid').innerHTML = `<div class="muted">${esc(err.message)}</div>`; }
}
const drawPrintings = debounce(() => {
  if (!CM?.printings) return;
  const e = DP.deck.cards[CM.i]; const g = $('#prgrid'); if (!g) return;
  const list = CM.printings;
  $('#prcount').textContent = `${list.length} printing${list.length === 1 ? '' : 's'}`;
  g.innerHTML = list.map(p => `<button class="pr ${p.diff ? 'diff' : ''}" data-pid="${esc(p.id)}" aria-current="${p.id === e.cid}" title="${esc(p.setName + ' #' + p.localId)}">
    ${p.image ? `<img loading="lazy" src="${esc(img(p.image))}" alt="">` : `<span class="noimg">No image</span>`}
    <span class="ps">${esc(p.setName)}</span><span class="pp">#${esc(p.localId)} · ${p.price === undefined ? '…' : money(p.price)}</span>${p.diff ? '<span class="dtag">Different card</span>' : ''}</button>`).join('');
  g.querySelectorAll('.pr').forEach(b => b.addEventListener('click', async () => {
    const pid = b.dataset.pid;
    if (DP.editing && DP.mine) { if (pid !== e.cid) await swapPrinting(pid); return; }
    try {
      CM.view = pid === e.cid ? e : await entryFromId(pid); drawCardModal();
      if (needsTcgp(CM.view)) { const v = CM.view; await resolveTcgp([v]); if (CM && CM.view === v) drawCardModal(); }
    } catch (err) { toast(err.message, 'bad'); }
  }));
}, 60);

/* ---------------- deck actions ---------------- */
function exportModal() {
  const d = DP.deck;
  let fmt = 'ptcgl', board = DP.board;
  const text = () => fmt === 'ptcgl' ? exportPTCGL(d, board) : exportPlain(d, board);
  openModal(`${modalHead('Export')}<div class="modal-body">
    <div class="row-gap"><div class="seg" id="exf"><button aria-pressed="true" data-v="ptcgl">Pokémon TCG Live</button><button aria-pressed="false" data-v="plain">Names only</button></div>
    <select class="input" id="exb" style="width:auto"><option value="main" ${board === 'main' ? 'selected' : ''}>Mainboard</option><option value="maybe" ${board === 'maybe' ? 'selected' : ''}>Maybeboard</option></select></div>
    <textarea class="input" id="ext" rows="16" readonly></textarea>
    <div class="muted" style="font-size:13px">In Pokémon TCG Live, open Decks, tap Import, and paste this list.</div>
  </div><div class="modal-foot"><button class="btn" data-close>Close</button><button class="btn primary" id="excopy">Copy list</button></div>`);
  const upd = () => { $('#ext').value = text(); };
  upd();
  $$('#exf button').forEach(b => b.addEventListener('click', () => { fmt = b.dataset.v; $$('#exf button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); upd(); }));
  $('#exb').addEventListener('change', ev => { board = ev.target.value; upd(); });
  $('#excopy').onclick = async () => { if (await copyText($('#ext').value)) toast('Deck list copied'); else { $('#ext').select(); toast('Press Ctrl+C or ⌘C to copy'); } };
}
async function shareDeck() {
  const d = DP.deck;
  const url = location.origin + location.pathname + '#/deck/' + d.id;
  if (!d.isPublic) {
    openModal(`${modalHead('Share')}<div class="modal-body"><p style="margin:0">This deck is private, so only you can open the link. Make it public to share it.</p><input class="input mono" readonly value="${esc(url)}"></div><div class="modal-foot"><button class="btn" data-close>Close</button>${DP.mine ? '<button class="btn primary" id="mkpub">Make public and copy link</button>' : ''}</div>`);
    const b = $('#mkpub'); if (b) b.onclick = async () => { try { await B.updateDeck(d.id, { isPublic: true }); d.isPublic = true; closeModal(); renderDeck(); if (await copyText(url)) toast('Deck is public. Link copied.'); else toast('Deck is public'); } catch (e) { toast(e.message, 'bad'); } };
    return;
  }
  if (await copyText(url)) toast('Link copied');
  else openModal(`${modalHead('Share')}<div class="modal-body"><input class="input mono" readonly value="${esc(url)}" onfocus="this.select()" autofocus></div><div class="modal-foot"><button class="btn primary" data-close>Done</button></div>`);
}
async function cloneDeck() {
  if (needAuth()) return;
  const d = DP.deck;
  try {
    const t = totals(d);
    const n = await B.createDeck({ name: `${d.name} (copy)`.slice(0, 80), format: d.format, description: d.description, cards: JSON.parse(JSON.stringify(d.cards)), cover: d.cover, price: t.price, cardCount: t.count });
    toast('Copied to your decks'); location.hash = '#/deck/' + n.id;
  } catch (e) { toast(e.message, 'bad'); }
}
function settingsModal() {
  const d = DP.deck;
  openModal(`${modalHead('Deck settings')}<form id="stf"><div class="modal-body">
    <div class="field"><label for="stn">Name</label><input class="input" id="stn" maxlength="80" value="${esc(d.name)}"></div>
    <div class="field"><label for="stfm">Format</label><select class="input" id="stfm">${Object.entries(FORMATS).map(([k, v]) => `<option value="${k}" ${d.format === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label for="std">Description</label><textarea class="input" id="std" rows="5" maxlength="4000" style="font-family:var(--body);font-size:14px">${esc(d.description)}</textarea></div>
    <label class="check"><input type="checkbox" id="stp" ${d.isPublic ? 'checked' : ''} ${B.kind === 'local' ? '' : ''}> Public: anyone with the link can view it, and it shows in Browse</label>
  </div><div class="modal-foot"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
  $('#stf').onsubmit = async ev => {
    ev.preventDefault();
    const patch = { name: $('#stn').value.trim() || 'Untitled deck', format: $('#stfm').value, description: $('#std').value.trim(), isPublic: $('#stp').checked };
    try { await B.updateDeck(d.id, patch); Object.assign(d, patch); closeModal(); renderDeck(); toast('Settings saved'); }
    catch (e) { toast(e.message, 'bad'); }
  };
}
function deleteModal() {
  const d = DP.deck;
  openModal(`${modalHead('Delete deck')}<div class="modal-body"><p style="margin:0">Delete <b>${esc(d.name)}</b>? This can't be undone.</p></div><div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="delgo">Delete deck</button></div>`);
  $('#delgo').onclick = async () => { try { await B.deleteDeck(d.id); closeModal(); toast('Deck deleted'); location.hash = '#/decks'; } catch (e) { toast(e.message, 'bad'); } };
}
async function toggleLike() {
  if (needAuth()) return;
  const d = DP.deck;
  if (!d.isPublic) { toast('Only public decks can be liked', 'bad'); return; }
  const on = !DP.liked;
  try { await B.like(d.id, on); DP.liked = on; d.likeCount = Math.max(0, d.likeCount + (on ? 1 : -1)); renderDeck(); }
  catch (e) { toast(e.message, 'bad'); }
}

/* ---------------- hover preview ---------------- */
const hp = $('#hover-preview');
const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
function hidePreview() { hp.style.display = 'none'; }
if (canHover) {
  document.addEventListener('mouseover', e => {
    const t = e.target.closest('[data-hover]');
    if (!t || !t.dataset.hover || MODAL) { hidePreview(); return; }
    hp.innerHTML = `<img src="${esc(img(t.dataset.hover))}" alt="">`; hp.style.display = 'block';
  });
  document.addEventListener('mousemove', e => {
    if (hp.style.display !== 'block') return;
    const w = 230, h = 318; let x = e.clientX + 18, y = e.clientY - h / 2;
    if (x + w > innerWidth - 8) x = e.clientX - w - 18;
    y = Math.max(8, Math.min(innerHeight - h - 8, y));
    hp.style.left = x + 'px'; hp.style.top = y + 'px';
  });
}

/* ---------------- boot ---------------- */
async function boot() {
  const cfg = window.BENCHMARK_CONFIG || {};
  if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js');
      B = new SupaBackend(cfg.supabaseUrl, cfg.supabaseAnonKey);
      await B.init();
    } catch (e) {
      console.error(e);
      main.innerHTML = errorBlock(new Error('Couldn\'t connect to your account server. Check the Supabase URL and key in config.js, then reload.'));
      return;
    }
  } else { B = new LocalBackend(); await B.init(); }
  B.onChange(() => route());
  window.addEventListener('hashchange', route);
  getSets().catch(() => {});
  route();
}
boot();
