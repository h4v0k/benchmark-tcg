// Deck list text: parsing (Pokémon TCG Live, PTCGO, Limitless, TCGplayer, plain lists, YouTube
// descriptions) and exporting.
import type { Board } from './types';
import { category, groupOf, isBasicEnergy, numLabel, setCode, sortLines, sum, SUPER, type Line } from './cards';

export type ParsedLine = { i: number; qty: number; name: string; code: string; num: string; board: Board; raw: string };

const ENERGY_SYM: Record<string, string> = { G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal', Y: 'Fairy' };
const HEADER_RE = /^(#+\s*)?(pok[eé]mon|trainers?|energy|energies|supporters?|items?|tools?|stadiums?|total cards|deck ?list|main ?deck)\b\s*[:(\-–]?\s*\d*\s*\)?\s*$/i;
const MAYBE_RE = /^(#+\s*)?(considering|maybe ?board|maybe|side ?board|sideboard|tech options|options)\b\s*[:(\-–]?\s*\d*\s*\)?\s*$/i;
const TIME_RE = /^\d{1,2}:\d{2}/;

/** Normalizes energy spellings and stray symbols in a card name. */
export function cleanName(name: string): string {
  let n = name.trim()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s*[|•·].*$/, '')
    .replace(/^["']|["']$/g, '');
  const sym = n.match(/^(?:Basic )?\{([A-Z])\} Energy$/i);
  if (sym && ENERGY_SYM[sym[1].toUpperCase()]) n = `Basic ${ENERGY_SYM[sym[1].toUpperCase()]} Energy`;
  // PTCGO wrote basic energy as "Basic Fire Energy Energy 2" (name, then the "Energy" set and a number).
  n = n.replace(/^((?:Basic )?\w+ Energy) Energy(?: \d+)?$/i, '$1');
  return n;
}

// Set code and collector number: "PAL 185", "PR-SV 149", "SVP 85", "TG 12"… and old energy numbers like "SUM D".
const SET_NUM = String.raw`([A-Z][A-Z0-9]{1,4}(?:-[A-Z]{1,3})?)\s+([A-Z]{0,4}\d{1,3}[a-z]?|[A-Z])`;
const PATTERNS: RegExp[] = [
  // 4 Iono PAL 185   /  * 4 Iono PAL 185  /  4x Iono PAL 185
  new RegExp(String.raw`^(\d{1,2})\s*x?\s+(.+?)\s+${SET_NUM}$`),
  // 4 Iono (PAL 185)  /  4 Iono [PAL 185]
  new RegExp(String.raw`^(\d{1,2})\s*x?\s+(.+?)\s*[([]${SET_NUM}[)\]]$`),
  // 4 Iono [PAL]  /  4 Iono (PAL)
  /^(\d{1,2})\s*x?\s+(.+?)\s*[([]([A-Z][A-Z0-9]{1,4}(?:-[A-Z]{1,3})?)[)\]]$/,
  // 4 Iono
  /^(\d{1,2})\s*x?\s+(.+)$/,
  // Iono x4
  /^(.+?)\s+x\s*(\d{1,2})$/i,
];

export function parseDeckText(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  let board: Board = 'main';
  for (const raw0 of text.split(/\r?\n/)) {
    const raw = raw0.trim();
    let line = raw.replace(/^[*\-–•·]+\s*/, '').replace(/\s+/g, ' ').trim();
    if (!line || line.length > 120) continue;
    if (MAYBE_RE.test(line)) { board = 'maybe'; continue; }
    if (HEADER_RE.test(line)) { if (/pok|trainer|energ|deck/i.test(line) && !/total/i.test(line)) board = 'main'; continue; }
    if (TIME_RE.test(line) || /https?:\/\//i.test(line) || /^total\b/i.test(line)) continue;
    let qty = 0, name = '', code = '', num = '';
    for (let p = 0; p < PATTERNS.length; p++) {
      const m = line.match(PATTERNS[p]);
      if (!m) continue;
      if (p === 4) { name = m[1]; qty = +m[2]; }
      else { qty = +m[1]; name = m[2]; code = m[3] || ''; num = m[4] || ''; }
      break;
    }
    if (!qty || qty > 60 || !name) continue;
    name = cleanName(name);
    // descriptions are full of "1 thing to know" style lines: require something card-like
    if (name.length < 2 || name.length > 60 || /^(of|the|and|to|for|in|on|at|is|my|you|i)\b/i.test(name) || /[?!]$/.test(name)) continue;
    out.push({ i: out.length, qty, name, code: code.toUpperCase(), num, board, raw });
  }
  return out;
}

/** Text a person probably pasted as a deck (vs. a whole description): share of lines that parsed. */
export function looksLikeList(text: string) {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const parsed = parseDeckText(text);
  return { parsed: parsed.length, total: lines.length, cards: parsed.reduce((s, l) => s + l.qty, 0) };
}

const SECTION: Record<string, string> = { Pokemon: 'Pokémon', Trainer: 'Trainer', Energy: 'Energy' };
const ptcglNum = (l: Line) => (l.card ? numLabel(l.card) : '');

/** Pokémon TCG Live export format (also what Limitless accepts). */
export function exportPTCGL(lines: Line[], board: Board = 'main'): string {
  const cards = lines.filter(l => l.board === board);
  const out: string[] = [];
  for (const cat of ['Pokemon', 'Trainer', 'Energy']) {
    const list = sortLines(cards.filter(l => (category(l) || 'Trainer') === cat));
    if (!list.length) continue;
    out.push(`${SECTION[cat]}: ${sum(list, l => l.qty)}`);
    for (const l of list) out.push(`${l.qty} ${l.name}${l.card ? ` ${setCode(l.card)} ${ptcglNum(l)}` : ''}`);
    out.push('');
  }
  out.push(`Total Cards: ${sum(cards, l => l.qty)}`);
  return out.join('\n');
}
export function exportPlain(lines: Line[], board: Board = 'main'): string {
  const agg = new Map<string, number>();
  lines.filter(l => l.board === board).forEach(l => agg.set(l.name, (agg.get(l.name) || 0) + l.qty));
  return [...agg].map(([n, q]) => `${q} ${n}`).join('\n');
}
/** Grouped text the way the deck page shows it, for sharing in chats. */
export function exportGrouped(lines: Line[], board: Board = 'main'): string {
  const groups = new Map<string, Line[]>();
  for (const l of lines.filter(x => x.board === board)) {
    const g = SUPER(groupOf(l));
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(l);
  }
  const out: string[] = [];
  for (const [g, list] of groups) {
    out.push(`${g} (${sum(list, l => l.qty)})`);
    for (const l of sortLines(list)) out.push(`${l.qty} ${l.name}`);
    out.push('');
  }
  return out.join('\n').trim();
}
export { isBasicEnergy };
