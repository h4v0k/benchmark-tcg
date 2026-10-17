// Card search syntax. The text is parsed here into OR-groups of AND-clauses, which the database function
// search_cards_q applies with fixed conditions (no query text is ever run as SQL).
//   iono                      name contains "iono"        "ultra ball"   a phrase
//   t:fire  t:psychic  cat:trainer  stage:stage2  is:ex  tt:supporter
//   o:"draw a card"  atk:burning  ab:"infernal reign"
//   hp>=200  retreat<=1  damage>=180  cost>=3  usd>5      (comparisons: : = != > < >= <=)
//   weak:water  res:fighting  set:sv04.5  num:54  reg:h  r:"ultra rare"  a:"5ban graphics"
//   legal:standard  banned:expanded  is:ace  is:radiant
//   is:ex (modern lowercase "ex" only)  is:old-ex (old EX)  is:v (V, VSTAR and VMAX)  is:gx
//   -t:water  (leading minus negates)    fire or water    (either side)
export type Clause = { f: string; op?: string; v: string; neg?: boolean };
export type CardQuery = { groups: Clause[][]; error?: string; simple: boolean; empty: boolean };

const TYPES: Record<string, string> = { fire: 'fire', r: 'fire', water: 'water', w: 'water', grass: 'grass', g: 'grass', lightning: 'lightning', electric: 'lightning', l: 'lightning', psychic: 'psychic', p: 'psychic', fighting: 'fighting', f: 'fighting', darkness: 'darkness', dark: 'darkness', d: 'darkness', metal: 'metal', steel: 'metal', m: 'metal', dragon: 'dragon', n: 'dragon', fairy: 'fairy', y: 'fairy', colorless: 'colorless', c: 'colorless' };
const CATS: Record<string, string> = { pokemon: 'pokemon', 'pokémon': 'pokemon', trainer: 'trainer', energy: 'energy' };
const STAGES: Record<string, string> = { basic: 'basic', stage1: 'stage1', 'stage-1': 'stage1', '1': 'stage1', stage2: 'stage2', 'stage-2': 'stage2', '2': 'stage2', mega: 'mega', vstar: 'vstar', vmax: 'vmax', baby: 'baby', break: 'break', restored: 'restored', 'v-union': 'v-union', 'level-up': 'level-up' };
const SUFFIXES: Record<string, string> = { ex: 'ex', gx: 'gx', v: 'v', legend: 'legend', prime: 'prime', 'tag-team': 'tag team-gx', tagteam: 'tag team-gx' };
const TRAINERS: Record<string, string> = { item: 'item', supporter: 'supporter', stadium: 'stadium', tool: 'tool', tm: 'technical machine', 'technical-machine': 'technical machine' };
const IS: Record<string, string> = { ace: 'ace', acespec: 'ace', radiant: 'radiant', prism: 'prism', 'basic-energy': 'basic-energy', 'special-energy': 'special-energy', rotating: 'rotating', basic: 'basic', ex: 'ex', 'old-ex': 'old-ex', gx: 'gx', v: 'v' };
const FORMATS: Record<string, string> = { standard: 'standard', std: 'standard', expanded: 'expanded', exp: 'expanded' };
const NUMERIC: Record<string, string> = { hp: 'hp', retreat: 'retreat', ret: 'retreat', damage: 'damage', dmg: 'damage', cost: 'cost', usd: 'usd', price: 'usd', $: 'usd' };
const TEXTY: Record<string, string> = {
  n: 'name', name: 'name', o: 'text', text: 'text', rules: 'text', atk: 'atk', attack: 'atk', ab: 'ab', ability: 'ab',
  weak: 'weak', weakness: 'weak', res: 'res', resistance: 'res', s: 'set', set: 'set', num: 'num', number: 'num',
  reg: 'reg', mark: 'reg', regulation: 'reg', r: 'rarity', rarity: 'rarity', a: 'artist', artist: 'artist', illustrator: 'artist',
};

function tokenize(q: string): string[] {
  const out: string[] = [];
  const re = /(-?[a-z$]+(?:<=|>=|!=|:|=|<|>)"[^"]*"?|-?!?"[^"]*"?|-?[a-z$]+(?:<=|>=|!=|:|=|<|>)\S*|\S+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) out.push(m[0]);
  return out;
}
const unquote = (s: string) => s.replace(/^"/, '').replace(/"$/, '');
const isNum = (v: string) => /^-?\d+(\.\d+)?$/.test(v);

// The database enforces the same limits (search_cards_q).
const MAX_GROUPS = 10, MAX_CLAUSES = 20, MAX_VALUE = 100, MAX_TEXT = 4; // same limits as search_cards_q

type R = { clause: Clause } | { error: string };
const bad = (error: string): R => ({ error });

function term(raw: string): R {
  let neg = false, t = raw;
  if (t.startsWith('-') && t.length > 1) { neg = true; t = t.slice(1); }
  const ok = (c: Clause): R => ({ clause: neg ? { ...c, neg: true } : c });
  if (t.startsWith('!')) { const v = unquote(t.slice(1)).trim(); return v ? ok({ f: 'exact', v }) : bad('Put a card name after !'); }
  const kv = t.match(/^([a-z$]+)(<=|>=|!=|:|=|<|>)(.*)$/i);
  if (!kv) return ok({ f: 'name', v: unquote(t).trim() });
  const key = kv[1].toLowerCase(), op = kv[2], v = unquote(kv[3]).trim(), lv = v.toLowerCase().replace(/\s+/g, '-');
  if (!v) return bad(`Add a value after "${key}${op}".`);
  if (NUMERIC[key]) {
    if (!isNum(v)) return bad(`${key} needs a number, like ${key}>=${key === 'usd' ? 5 : 100}.`);
    return ok({ f: NUMERIC[key], op: op === ':' ? '=' : op, v });
  }
  const textKey = TEXTY[key];
  if (textKey) {
    if (op !== ':' && op !== '=' && !(textKey === 'num' && op !== '!=')) return bad(`"${key}" can only use ":" (not ${op}).`);
    if (textKey === 'num') return ok({ f: 'num', op: op === ':' ? '=' : op, v });
    if (textKey === 'weak' || textKey === 'res') { const ty = TYPES[lv]; return ty ? ok({ f: textKey, v: ty }) : bad(`Unknown energy type "${v}".`); }
    return ok({ f: textKey, v });
  }
  if (op !== ':' && op !== '=') return bad(`"${key}" can only use ":" (not ${op}).`);
  switch (key) {
    case 't': case 'type': case 'energy': {
      if (TYPES[lv]) return ok({ f: 'type', v: TYPES[lv] });
      // Be forgiving: t:supporter, t:stage2, t:pokemon all do what you meant.
      if (TRAINERS[lv]) return ok({ f: 'tt', v: TRAINERS[lv] });
      if (CATS[lv]) return ok({ f: 'cat', v: CATS[lv] });
      if (STAGES[lv] && lv.length > 1) return ok({ f: 'stage', v: STAGES[lv] });
      return bad(`Unknown type "${v}". Try fire, water, grass, lightning, psychic, fighting, darkness, metal, dragon or colorless.`);
    }
    case 'cat': case 'category': case 'c':
      return CATS[lv] ? ok({ f: 'cat', v: CATS[lv] }) : bad(`Category must be pokemon, trainer or energy.`);
    case 'stage': case 'st': {
      if (STAGES[lv]) return ok({ f: 'stage', v: STAGES[lv] });
      if (SUFFIXES[lv]) return ok({ f: 'suffix', v: SUFFIXES[lv] });
      return bad(`Unknown stage "${v}". Try basic, stage1, stage2, mega, ex, v, vstar or vmax.`);
    }
    case 'tt': case 'trainer': case 'subtype':
      return TRAINERS[lv] ? ok({ f: 'tt', v: TRAINERS[lv] }) : bad(`Trainer type must be item, supporter, stadium or tool.`);
    case 'legal': case 'f': case 'format':
      return FORMATS[lv] ? ok({ f: 'legal', v: FORMATS[lv] }) : bad(`Format must be standard or expanded.`);
    case 'banned':
      return FORMATS[lv] ? ok({ f: 'banned', v: FORMATS[lv] }) : bad(`Format must be standard or expanded.`);
    case 'is': case 'has': {
      if (lv === 'vstar' || lv === 'vmax') return ok({ f: 'stage', v: lv });
      if (lv === 'mega') return ok({ f: 'stage', v: 'mega' });
      if (lv === 'pokemon' || lv === 'trainer' || lv === 'energy') return ok({ f: 'cat', v: lv });
      if (TRAINERS[lv]) return ok({ f: 'tt', v: TRAINERS[lv] });
      return IS[lv] ? ok({ f: 'is', v: IS[lv] }) : bad(`Unknown "is:${v}". Try ace, radiant, ex, old-ex, v, basic, basic-energy or special-energy.`);
    }
  }
  return bad(`Unknown search field "${key}:". Open "Syntax help" for the list.`);
}

/** Parses a search box string. `simple` means plain words only (the old name search handles those). */
export function parseCardQuery(q: string): CardQuery {
  const toks = tokenize(q.trim());
  if (!toks.length) return { groups: [], simple: true, empty: true };
  const groups: Clause[][] = [[]];
  let simple = true;
  for (const tk of toks) {
    if (/^or$/i.test(tk)) { groups.push([]); simple = false; continue; }
    if (/^and$/i.test(tk)) continue;
    if (/^-|^!|["<>=:]/.test(tk)) simple = false;
    const r = term(tk);
    if ('error' in r) return { groups: [], error: r.error, simple: false, empty: false };
    if (r.clause.v) groups[groups.length - 1].push(r.clause);
  }
  const live = groups.filter(g => g.length);
  if (live.flat().filter(c => c.f === 'text' || c.f === 'atk' || c.f === 'ab').length > MAX_TEXT)
    return { groups: [], error: `That search is too long: use at most ${MAX_TEXT} text, attack or ability conditions.`, simple: false, empty: false };
  if (live.length > MAX_GROUPS || live.reduce((n, g) => n + g.length, 0) > MAX_CLAUSES || live.some(g => g.some(c => c.v.length > MAX_VALUE)))
    return { groups: [], error: `That search is too long: use at most ${MAX_GROUPS} "or" groups, ${MAX_CLAUSES} conditions in all, and ${MAX_VALUE} characters per value.`, simple: false, empty: false };
  return { groups: live, simple: simple && live.length === 1, empty: !live.length };
}

/* ---------- advanced search form → query string ---------- */
export type CmpField = { op: string; val: string };
export type CardFormValues = {
  name: string; text: string; attack: string; ability: string; category: '' | 'pokemon' | 'trainer' | 'energy';
  types: string[]; stage: string; trainer: string;
  hp: CmpField; retreat: CmpField; damage: CmpField; cost: CmpField; usd: CmpField;
  weak: string; set: string; marks: string[]; rarity: string; artist: string;
  legal: '' | 'standard' | 'expanded'; flags: string[];
};
export const emptyCardForm = (): CardFormValues => ({
  name: '', text: '', attack: '', ability: '', category: '', types: [], stage: '', trainer: '',
  hp: { op: '>=', val: '' }, retreat: { op: '<=', val: '' }, damage: { op: '>=', val: '' }, cost: { op: '>=', val: '' }, usd: { op: '>', val: '' },
  weak: '', set: '', marks: [], rarity: '', artist: '', legal: '', flags: [],
});
/** Quote a value only when it needs it. */
const qv = (v: string) => { v = v.replace(/"/g, '').trim(); return /^[^\s()]+$/.test(v) && !/^(or|and)$/i.test(v) ? v : `"${v}"`; };

export function buildCardQuery(f: CardFormValues): string {
  const out: string[] = [];
  const name = f.name.replace(/"/g, '').trim();
  if (name) out.push(/^[^\s()!:<>=-][^\s()]*$/.test(name) && !/^(or|and)$/i.test(name) ? name : `"${name}"`);
  const one = (k: string, v: string) => { v = v.replace(/"/g, '').trim(); if (v) out.push(`${k}:${qv(v)}`); };
  one('o', f.text); one('atk', f.attack); one('ab', f.ability);
  if (f.category) out.push(`cat:${f.category}`);
  // Several energy types mean "any of these", which the query language writes as OR groups; the form keeps to one type per search.
  if (f.types.length) out.push(`t:${f.types[0]}`);
  if (f.stage) out.push(`stage:${f.stage}`);
  if (f.trainer) out.push(`tt:${f.trainer}`);
  const num = (k: string, c: CmpField) => { const v = c.val.trim(); if (v && isNum(v)) out.push(`${k}${c.op === '≠' ? '!=' : c.op === '≤' ? '<=' : c.op === '≥' ? '>=' : c.op}${v}`); };
  num('hp', f.hp); num('retreat', f.retreat); num('damage', f.damage); num('cost', f.cost); num('usd', f.usd);
  if (f.weak) out.push(`weak:${f.weak}`);
  one('set', f.set); one('r', f.rarity); one('a', f.artist);
  if (f.marks.length === 1) out.push(`reg:${f.marks[0].toLowerCase()}`);
  if (f.legal) out.push(`legal:${f.legal}`);
  for (const fl of f.flags) out.push(`is:${fl}`);
  return out.join(' ');
}

/** Rows for the "Syntax help" table. */
export const SYNTAX_HELP: { field: string; what: string; example: string }[] = [
  { field: 'name  n', what: 'Words in the card name (just type them)', example: 'iono   "ultra ball"   !"Boss’s Orders"' },
  { field: 'o  text', what: 'Rules text, including abilities and attacks', example: 'o:"draw 3 cards"' },
  { field: 'atk  ab', what: 'Attack name, ability name', example: 'atk:burning   ab:"infernal reign"' },
  { field: 't  type', what: 'Energy type of the Pokémon', example: 't:fire   t:psychic   -t:colorless' },
  { field: 'cat', what: 'pokemon, trainer or energy', example: 'cat:trainer' },
  { field: 'stage', what: 'basic, stage1, stage2, mega, vstar, vmax, ex (modern), v, gx', example: 'stage:stage2   stage:ex' },
  { field: 'tt', what: 'Trainer type: item, supporter, stadium, tool', example: 'tt:supporter' },
  { field: 'hp  retreat', what: 'Numbers; compare with > < >= <= = !=', example: 'hp>=200   retreat<=1' },
  { field: 'damage  cost', what: 'Biggest attack damage; most energy in an attack cost', example: 'damage>=180   cost>=3' },
  { field: 'weak  res', what: 'Weakness or resistance type', example: 'weak:water   res:fighting' },
  { field: 's  set', what: 'Set code, set id or part of the set name', example: 'set:sv04.5   s:"paldea evolved"' },
  { field: 'num', what: 'Card number', example: 'num:54   num>=200' },
  { field: 'reg  mark', what: 'Regulation mark', example: 'reg:h   reg:i' },
  { field: 'r  rarity', what: 'Rarity words', example: 'r:"special illustration"' },
  { field: 'a  artist', what: 'Illustrator', example: 'a:"5ban graphics"' },
  { field: 'legal  banned', what: 'Format: standard or expanded', example: 'legal:standard   banned:expanded' },
  { field: 'is', what: 'ace, radiant, ex (modern), old-ex, v (incl. VSTAR, VMAX), gx, basic, basic-energy, special-energy', example: 'is:ace   is:radiant   -is:basic-energy' },
  { field: 'usd', what: 'Price in dollars (when we have one)', example: 'usd>5   usd<=1' },
  { field: '-  or', what: 'Minus leaves matches out; or accepts either side', example: 'fire or water   -t:water   stage:basic -is:ex' },
];
