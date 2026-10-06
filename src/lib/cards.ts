import type { Card, DeckEntry, Finish, Format } from './types';

export type Line = DeckEntry & { card?: Card };

export const FINISH_LABEL: Record<string, string> = {
  normal: 'Normal', holo: 'Holo', reverse: 'Reverse Holo', firstEdition: '1st Edition',
  firstEditionHolo: '1st Edition Holo', unlimitedHolo: 'Unlimited Holo',
};
export const FORMAT_LABEL: Record<Format, string> = { standard: 'Standard', expanded: 'Expanded', unlimited: 'Unlimited' };

export const img = (base: string | undefined, q: 'low' | 'high' = 'low') => (base ? `${base}/${q}.webp` : '');

export const TYPE_COLOR: Record<string, string> = {
  Grass: '#4caf50', Fire: '#ef5b3a', Water: '#3d8ee6', Lightning: '#f5c518', Psychic: '#a35ad6',
  Fighting: '#c0703a', Darkness: '#3b5560', Metal: '#8c99a6', Dragon: '#c29b2a', Fairy: '#ea7bb5', Colorless: '#bdb7a9',
};
export const ENERGY_TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy'];

const BASIC_ENERGY_RE = /^(basic )?(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy) energy$/i;
export const isBasicEnergy = (l: { card?: Card; name: string; cat?: string }) =>
  l.card ? l.card.is_basic_energy || (l.card.category === 'Energy' && BASIC_ENERGY_RE.test(l.card.name)) : BASIC_ENERGY_RE.test(l.name);
export const category = (l: Line) => l.card?.category || (l.cat as string) || '';
export const energyTypeOf = (name: string) => {
  const m = name.match(/(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy)/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : 'Colorless';
};

export const GROUPS = ['Pokémon', 'Supporter', 'Item', 'Pokémon Tool', 'Stadium', 'Trainer', 'Special Energy', 'Basic Energy', 'Other'] as const;
export function groupOf(l: Line): string {
  const cat = category(l);
  if (cat === 'Pokemon') return 'Pokémon';
  if (cat === 'Energy') return isBasicEnergy(l) ? 'Basic Energy' : 'Special Energy';
  if (cat === 'Trainer') {
    const t = (l.card?.trainer_type || '').toLowerCase();
    if (t.includes('supporter')) return 'Supporter';
    if (t.includes('stadium')) return 'Stadium';
    if (t.includes('tool')) return 'Pokémon Tool';
    if (t.includes('item')) return 'Item';
    return 'Trainer';
  }
  return 'Other';
}
export const SUPER = (g: string) => (g === 'Pokémon' ? 'Pokémon' : g.includes('Energy') ? 'Energy' : g === 'Other' ? 'Other' : 'Trainer');

const STAGE_ORDER: Record<string, number> = { basic: 0, stage1: 1, stage2: 2, vmax: 2, vstar: 2, mega: 2, break: 2, restored: 0 };
const stageRank = (l: Line) => STAGE_ORDER[(l.card?.stage || '').toLowerCase().replace(/\s/g, '')] ?? 1;

export type SortKey = 'default' | 'name' | 'price' | 'qty' | 'set';
export function sortLines(list: Line[], key: SortKey = 'default'): Line[] {
  const s = list.slice();
  if (key === 'name') return s.sort((a, b) => a.name.localeCompare(b.name));
  if (key === 'price') return s.sort((a, b) => (linePrice(b) ?? -1) - (linePrice(a) ?? -1) || a.name.localeCompare(b.name));
  if (key === 'qty') return s.sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  if (key === 'set') return s.sort((a, b) => (b.card?.set?.release_date || '').localeCompare(a.card?.set?.release_date || '') || a.name.localeCompare(b.name));
  // Pokémon: evolution lines together (basics before evolutions), then by count; others by count then name.
  return s.sort((a, b) => {
    if (category(a) === 'Pokemon' && category(b) === 'Pokemon') {
      const la = lineKey(a, list), lb = lineKey(b, list);
      if (la !== lb) return la.localeCompare(lb);
      const sa = stageRank(a), sb = stageRank(b);
      if (sa !== sb) return sa - sb;
      return b.qty - a.qty || a.name.localeCompare(b.name);
    }
    return b.qty - a.qty || a.name.localeCompare(b.name);
  });
}
// Root of a Pokémon's evolution line within the deck, so Charmander → Charmeleon → Charizard sit together.
function lineKey(l: Line, all: Line[]): string {
  let cur = l, guard = 0;
  while (cur.card?.evolves_from && guard++ < 4) {
    const prev = all.find(x => x.card && x.name === cur.card!.evolves_from);
    if (!prev) return cur.card.evolves_from;
    cur = prev;
  }
  return cur.name;
}

export function finishOf(l: Line): Finish {
  const v = (l.variant as Finish) || 'normal';
  const prices = l.card?.prices || {};
  if (l.card && !(v in prices) && !(l.card.variants || []).includes(v)) {
    return (['normal', 'holo', 'reverse'] as Finish[]).find(k => k in prices || l.card!.variants.includes(k)) || v;
  }
  return v;
}
export function linePrice(l: Line): number | null {
  const p = l.card?.prices || {};
  const f = finishOf(l);
  const v = p[f] ?? p.normal ?? p.holo ?? p.reverse ?? Object.values(p).find(x => x != null);
  return v == null ? null : Number(v);
}
export const money = (n: number | null | undefined) => (n == null || isNaN(n as number) ? '—' : '$' + Number(n).toFixed(2));
export const sum = <T,>(a: T[], f: (x: T) => number | null | undefined) => a.reduce((s, x) => s + (f(x) || 0), 0);

export const setCode = (c?: Card) => (c?.set?.code || c?.set_id?.toUpperCase() || '');
export const numLabel = (c?: Card) => {
  if (!c) return '';
  const n = /^\d+$/.test(c.local_id) ? String(parseInt(c.local_id, 10)) : c.local_id;
  return n;
};
export const printLabel = (c?: Card) => (c ? `${setCode(c)} ${numLabel(c)}` : '');

export function legalIn(c: Card | undefined, f: Format): boolean {
  if (f === 'unlimited' || !c) return true;
  return f === 'standard' ? c.legal_standard : c.legal_expanded;
}

export const fmtDate = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) =>
  iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString(undefined, opts) : '';
export function ago(iso: string | null | undefined) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso);
}

export const choose = (n: number, k: number) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
/** Chance of at least `need` copies among `hits` in a `draw`-card hand from `deck` cards. */
export function atLeast(deck: number, hits: number, draw: number, need = 1) {
  if (deck < draw || hits <= 0) return 0;
  let p = 0;
  for (let k = need; k <= Math.min(hits, draw); k++) p += choose(hits, k) * choose(deck - hits, draw - k) / choose(deck, draw);
  return p;
}
