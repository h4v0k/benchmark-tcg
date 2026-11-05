// Deck construction rules plus format legality. Per-card legality comes from the database,
// which recomputes it whenever sets, bans or rotations change.
import type { Format, Rules } from './types';
import { FORMAT_LABEL, fmtDate, isBasicEnergy, linePrice, sum, type Line } from './cards';

export type Check = { level: 'ok' | 'bad' | 'warn' | 'info'; msg: string; detail?: string; cards?: string[]; live?: boolean };
export type CardProblem = { level: 'bad' | 'warn'; label: string; why: string; live?: boolean };

// Sets already playable on Pokémon TCG Live but not yet legal for paper Standard events (paper legality is the
// 2nd Friday after the US release). Deck lines from these sets that aren't in the card database yet are stored by
// their Japanese set code and number ("M6-58"). Delta Reign = Japan's Storm Emeralda (M6): TCG Live Nov 5, paper Nov 20.
// Once a set is in the card database, cardProblem works this out from the set's own dates instead.
const LIVE_PREVIEW_SETS: Record<string, { name: string; paper: string }> = {
  M6: { name: 'Delta Reign', paper: '2026-11-20' },
  MEM: { name: 'Delta Reign', paper: '2026-11-20' },
};
// TCG Live gets a new set about a day before the paper release.
const LIVE_LEAD_DAYS = 1;
const short = (d: string) => fmtDate(d, { month: 'short', day: 'numeric' });
const liveProblem = (setName: string, paper: string): CardProblem =>
  ({ level: 'warn', live: true, label: 'TCG Live legal', why: `${setName} is playable on Pokémon TCG Live now. It isn’t legal at paper Standard events until ${fmtDate(paper)}.` });
const today = () => new Date().toISOString().slice(0, 10);

export function cardProblem(l: Line, format: Format): CardProblem | null {
  const c = l.card;
  if (!c) {
    const pre = LIVE_PREVIEW_SETS[String(l.cid).split('-')[0]];
    if (pre && format === 'standard' && pre.paper > today()) return liveProblem(pre.name, pre.paper);
    if (pre && format === 'standard') return null; // paper-legal now; the real printing just isn't in the database yet
    return { level: 'warn', label: 'Unknown', why: 'This card isn’t in the card database yet.' };
  }
  if (format === 'unlimited') return null;
  if (c.banned_in?.includes(format)) return { level: 'bad', label: 'Banned', why: `Banned in ${FORMAT_LABEL[format]}.` };
  const legal = format === 'standard' ? c.legal_standard : c.legal_expanded;
  if (!legal) {
    // Released (so on TCG Live) but not yet paper legal.
    const rel = c.set?.release_date;
    if (format === 'standard' && c.standard_from && rel && c.standard_from > today()
        && new Date(Date.parse(rel) - LIVE_LEAD_DAYS * 864e5).toISOString().slice(0, 10) <= today()) return liveProblem(c.set?.name || 'This set', c.standard_from);
    if (format === 'standard' && c.standard_from) return { level: 'bad', label: `Legal ${short(c.standard_from)}`, why: `This set becomes Standard legal on ${fmtDate(c.standard_from)}.` };
    if (c.set?.is_classic) return { level: 'bad', label: 'Not legal', why: 'This printing is never tournament legal.' };
    return { level: 'bad', label: 'Not legal', why: format === 'standard' ? `Regulation mark ${c.reg_mark || '(none)'} isn’t in the current Standard format.` : 'Not in the Expanded format (Black & White onward).' };
  }
  if (format === 'standard' && c.rotating) return { level: 'warn', label: 'Rotating', why: c.rotating_on ? `Leaves Standard on ${fmtDate(c.rotating_on)}.` : 'Leaves Standard at the next rotation (date not announced yet).' };
  return null;
}

export function validateDeck(lines: Line[], format: Format, rules?: Rules | null): Check[] {
  const main = lines.filter(l => l.board === 'main');
  const out: Check[] = [];
  const n = sum(main, l => l.qty);
  out.push(n === 60 ? { level: 'ok', msg: '60 cards' } : { level: 'bad', msg: `${n} cards`, detail: n < 60 ? `Add ${60 - n} more. A deck has exactly 60 cards.` : `Remove ${n - 60}. A deck has exactly 60 cards.` });

  // Trainer prints tagged with their character ("Boss's Orders (Giovanni)") are the same card for the 4-copy rule.
  const copyName = (l: Line) => l.card && l.card.category !== 'Pokemon' ? l.name.replace(/\s*\([^)]*\)\s*$/, '') : l.name;
  const byName = new Map<string, number>();
  for (const l of main) if (!isBasicEnergy(l)) byName.set(copyName(l), (byName.get(copyName(l)) || 0) + l.qty);
  const over = [...byName].filter(([, q]) => q > 4);
  out.push(over.length
    ? { level: 'bad', msg: 'More than 4 copies', detail: over.map(([nm, q]) => `${nm} (${q})`).join(', '), cards: over.map(([nm]) => nm) }
    : { level: 'ok', msg: 'Up to 4 copies of each card' });

  const aces = main.filter(l => l.card?.is_ace);
  const aceN = sum(aces, l => l.qty);
  if (aceN > 1) out.push({ level: 'bad', msg: `${aceN} ACE SPEC cards`, detail: 'Only 1 ACE SPEC card is allowed per deck.', cards: aces.map(l => l.name) });
  const rad = main.filter(l => l.card?.is_radiant || /^radiant /i.test(l.name));
  const radN = sum(rad, l => l.qty);
  if (radN > 1) out.push({ level: 'bad', msg: `${radN} Radiant Pokémon`, detail: 'Only 1 Radiant Pokémon is allowed per deck.', cards: rad.map(l => l.name) });
  const prism = [...byName].filter(([nm, q]) => /◇|prism star/i.test(nm) && q > 1);
  if (prism.length) out.push({ level: 'bad', msg: 'Prism Star duplicates', detail: 'Only 1 copy of each Prism Star card.', cards: prism.map(([nm]) => nm) });

  const basics = sum(main.filter(l => l.card?.category === 'Pokemon' && /^basic$/i.test(l.card.stage)), l => l.qty);
  out.push(basics > 0 ? { level: 'ok', msg: `${basics} Basic Pokémon` } : { level: 'bad', msg: 'No Basic Pokémon', detail: 'A deck needs at least one Basic Pokémon.' });

  if (format !== 'unlimited') {
    const probs = main.map(l => ({ l, p: cardProblem(l, format) })).filter(x => x.p);
    const bad = probs.filter(x => x.p!.level === 'bad' && x.p!.label !== 'Unknown');
    const rotating = probs.filter(x => x.p!.label === 'Rotating');
    const unknown = probs.filter(x => x.p!.label === 'Unknown');
    const live = probs.filter(x => x.p!.live);
    if (bad.length) out.push({ level: 'bad', msg: `${bad.length} card${bad.length > 1 ? 's' : ''} not ${FORMAT_LABEL[format]} legal`, detail: bad.map(x => `${x.l.name}: ${x.p!.why}`).join(' '), cards: bad.map(x => x.l.name) });
    else if (live.length) {
      const paper = live.map(x => x.p!.why.match(/until (.+)\.$/)?.[1]).find(Boolean);
      const n = sum(live.map(x => x.l), l => l.qty);
      out.push({ level: 'warn', live: true, msg: `TCG Live legal · paper legal ${paper || 'soon'}`, detail: `${n} card${n > 1 ? 's' : ''} from a new set can be played on Pokémon TCG Live now but not at paper Standard events until ${paper || 'the set is tournament legal'}: ${[...new Set(live.map(x => x.l.name))].join(', ')}.`, cards: live.map(x => x.l.name) });
    }
    else out.push({ level: 'ok', msg: `All cards ${FORMAT_LABEL[format]} legal` });
    if (rotating.length) {
      const when = rules?.next_rotation?.effective_date;
      out.push({ level: 'warn', msg: `${rotating.length} card${rotating.length > 1 ? 's' : ''} rotating ${when ? 'on ' + fmtDate(when) : 'at the next rotation'}`, detail: rotating.map(x => x.l.name).join(', '), cards: rotating.map(x => x.l.name) });
    }
    if (unknown.length) out.push({ level: 'warn', msg: `${unknown.length} card${unknown.length > 1 ? 's' : ''} not found`, detail: unknown.map(x => x.l.name).join(', '), cards: unknown.map(x => x.l.name) });
  }
  const noPrice = main.filter(l => linePrice(l) == null).length;
  if (noPrice) out.push({ level: 'info', msg: `${noPrice} card${noPrice > 1 ? 's' : ''} without a price` });
  return out;
}

export const isLegalDeck = (checks: Check[]) => !checks.some(c => c.level === 'bad');
/** Legal on Pokémon TCG Live but not yet for paper events (no hard problems, some new-set cards). */
export const isLiveOnly = (checks: Check[]) => isLegalDeck(checks) && checks.some(c => c.live);
