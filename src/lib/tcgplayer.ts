// Links to buy cards on TCGplayer: an exact product page per printing, and Mass Entry for a whole deck.
import type { Card, Finish } from './types';
import { finishOf, numLabel, type Line } from './cards';

const PRINTING_PARAM: Partial<Record<Finish, string>> = { normal: 'Normal', holo: 'Holofoil', reverse: 'Reverse Holofoil', firstEdition: '1st Edition', firstEditionHolo: '1st Edition Holofoil', unlimitedHolo: 'Unlimited Holofoil' };

export function productId(c: Card | undefined, finish?: Finish): number | null {
  if (!c) return null;
  return (finish && c.tcgp?.[finish]) || c.tcgp_product_id || null;
}

/** The exact printing's product page, with the finish preselected when TCGplayer supports it. */
export function buyUrl(c: Card | undefined, finish?: Finish, name?: string): string {
  const id = productId(c, finish);
  if (id) {
    const p = finish && PRINTING_PARAM[finish];
    return `https://www.tcgplayer.com/product/${id}?Language=English${p ? `&Printing=${encodeURIComponent(p)}` : ''}`;
  }
  const q = c ? `${c.name} ${numLabel(c)}` : (name || '');
  return `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(q.trim())}&view=grid`;
}

/** TCGplayer Mass Entry for a list of lines. Exact products where we have them ("4-497557"), names otherwise. */
export function massEntry(lines: Line[], opts: { skipOwned?: Map<string, number> } = {}) {
  const byId = new Map<number, number>();
  const named = new Map<string, number>();
  for (const l of lines) {
    let qty = l.qty;
    if (opts.skipOwned) qty = Math.max(0, qty - (opts.skipOwned.get(l.cid) || 0));
    if (!qty) continue;
    const id = productId(l.card, finishOf(l));
    if (id) byId.set(id, (byId.get(id) || 0) + qty);
    else named.set(l.name, (named.get(l.name) || 0) + qty);
  }
  // Mass Entry takes either exact products ("4-497557||1-590025") or names, not both in one link.
  const url = byId.size
    ? `https://www.tcgplayer.com/massentry?productline=Pokemon&c=${[...byId].map(([id, q]) => `${q}-${id}`).join('||')}`
    : `https://www.tcgplayer.com/massentry?productline=Pokemon&c=${encodeURIComponent([...named].map(([n, q]) => `${q} ${n}`).join('||'))}`;
  return { url, exact: byId.size, missing: byId.size ? [...named.keys()] : [] };
}
