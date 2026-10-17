// My collection: owned cards per printing (card id) with a quantity. Private to the signed-in person.
import * as sb from './supabase';
import * as api from './api';
import { numLabel, setCode, linePrice, money, type Line } from './cards';
import { parseDeckText } from './decklist';
import type { Card, Format } from './types';

export type OwnRow = { card_id: string; sig: string; qty: number };
export const MAX_QTY = 999;

/** Every row of my collection: card id → quantity. */
export async function myCollection(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { rows } = await sb.select<{ card_id: string; qty: number }>('collection', { select: 'card_id,qty', qty: 'gt.0', order: 'card_id.asc' }, { range: [from, from + 999] });
    rows.forEach(r => out.set(r.card_id, r.qty));
    if (rows.length < 1000) break;
  }
  return out;
}
export async function ownedQty(cardId: string): Promise<number> {
  const { rows } = await sb.select<{ qty: number }>('collection', { select: 'qty', card_id: `eq.${cardId}` });
  return rows[0]?.qty || 0;
}
export async function setOwned(uid: string, cardId: string, qty: number): Promise<number> {
  const q = Math.max(0, Math.min(MAX_QTY, Math.floor(qty) || 0));
  if (!q) await sb.remove('collection', { card_id: `eq.${cardId}` });
  else await sb.upsert('collection', { user_id: uid, card_id: cardId, qty: q }, 'user_id,card_id');
  return q;
}
/** Owned printings (any printing counts) of the cards with these gameplay identities. */
export async function ownedForSigs(sigs: string[]): Promise<OwnRow[]> {
  const uniq = [...new Set(sigs.filter(Boolean))];
  if (!uniq.length) return [];
  const out: OwnRow[] = [];
  for (let i = 0; i < uniq.length; i += 150) out.push(...await sb.rpc<OwnRow[]>('my_collection_for', { p_sigs: uniq.slice(i, i + 150) }));
  return out;
}

export type LineOwn = { owned: number; exact: number; missing: number };
/** For each main-board line: how many I own (any printing of the same card), how many of the exact printing, and how many I still need. */
export function ownership(lines: Line[], rows: OwnRow[]): Map<Line, LineOwn> {
  const bySig = new Map<string, number>();
  const exact = new Map<string, number>();
  for (const r of rows) { bySig.set(r.sig, (bySig.get(r.sig) || 0) + r.qty); exact.set(r.card_id, r.qty); }
  const left = new Map(bySig);
  const out = new Map<Line, LineOwn>();
  for (const l of lines) {
    const sig = l.card?.sig;
    const have = sig ? Math.min(l.qty, left.get(sig) || 0) : Math.min(l.qty, exact.get(l.cid) || 0);
    if (sig) left.set(sig, (left.get(sig) || 0) - have);
    out.set(l, { owned: have, exact: Math.min(l.qty, exact.get(l.cid) || 0), missing: l.qty - have });
  }
  return out;
}
export const sigsOf = (lines: Line[]) => lines.map(l => l.card?.sig).filter((s): s is string => !!s);

/* ---------- text in and out ---------- */
export async function importText(uid: string, text: string, have: Map<string, number>, fmt: Format = 'unlimited') {
  const parsed = parseDeckText(text);
  const res = await api.resolveLines(parsed, fmt, 'exact');
  const add = new Map<string, number>();
  const unknown: string[] = [];
  for (const p of parsed) {
    const id = res.get(p.i)?.id;
    if (!id) { unknown.push(p.raw); continue; }
    add.set(id, (add.get(id) || 0) + p.qty);
  }
  const rows = [...add].map(([card_id, q]) => ({ user_id: uid, card_id, qty: Math.min(MAX_QTY, (have.get(card_id) || 0) + q) }));
  for (let i = 0; i < rows.length; i += 200) await sb.upsert('collection', rows.slice(i, i + 200), 'user_id,card_id');
  return { added: [...add.values()].reduce((s, n) => s + n, 0), kinds: rows.length, unknown };
}
type Owned = { card: Card; qty: number };
const asLine = (o: Owned): Line => ({ cid: o.card.id, qty: o.qty, board: 'main', name: o.card.name, card: o.card });
export const collectionValue = (items: Owned[]) => items.reduce((s, o) => s + (linePrice(asLine(o)) || 0) * o.qty, 0);
export const unitPrice = (c: Card) => linePrice(asLine({ card: c, qty: 1 }));
export const exportText = (items: Owned[]) => items.map(o => `${o.qty} ${o.card.name} ${setCode(o.card)} ${numLabel(o.card)}`).join('\n');
const csvCell = (s: string | number) => /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
export const exportCsv = (items: Owned[]) => ['Quantity,Name,Set,Number,Rarity,Price', ...items.map(o => [o.qty, o.card.name, setCode(o.card), numLabel(o.card), o.card.rarity || '', unitPrice(o.card) ?? ''].map(csvCell).join(','))].join('\n');
export { money };
