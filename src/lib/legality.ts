// Deck construction rules plus format legality. Per-card legality comes from the database,
// which recomputes it whenever sets, bans or rotations change.
import type { Format, Rules } from './types';
import { FORMAT_LABEL, fmtDate, isBasicEnergy, linePrice, sum, type Line } from './cards';

export type Check = { level: 'ok' | 'bad' | 'warn' | 'info'; msg: string; detail?: string; cards?: string[] };

export function cardProblem(l: Line, format: Format): { level: 'bad' | 'warn'; label: string; why: string } | null {
  const c = l.card;
  if (!c) return { level: 'warn', label: 'Unknown', why: 'This card isn’t in the card database yet.' };
  if (format === 'unlimited') return null;
  if (c.banned_in?.includes(format)) return { level: 'bad', label: 'Banned', why: `Banned in ${FORMAT_LABEL[format]}.` };
  const legal = format === 'standard' ? c.legal_standard : c.legal_expanded;
  if (!legal) {
    if (format === 'standard' && c.standard_from) return { level: 'bad', label: `Legal ${fmtDate(c.standard_from, { month: 'short', day: 'numeric' })}`, why: `This set becomes Standard legal on ${fmtDate(c.standard_from)}.` };
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

  const byName = new Map<string, number>();
  for (const l of main) if (!isBasicEnergy(l)) byName.set(l.name, (byName.get(l.name) || 0) + l.qty);
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
    if (bad.length) out.push({ level: 'bad', msg: `${bad.length} card${bad.length > 1 ? 's' : ''} not ${FORMAT_LABEL[format]} legal`, detail: bad.map(x => `${x.l.name}: ${x.p!.why}`).join(' '), cards: bad.map(x => x.l.name) });
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
