import * as sb from './supabase';
import type { DeckEntry } from './types';

export type DeckVersion = { id: number; created_at: string; card_count: number; note: string; cards: DeckEntry[] };

export async function listVersions(deckId: string): Promise<DeckVersion[]> {
  const { rows } = await sb.select<DeckVersion>('deck_versions', { select: 'id,created_at,card_count,note,cards', deck_id: `eq.${deckId}`, order: 'created_at.desc,id.desc', limit: 50 });
  return rows.map(r => ({ ...r, cards: Array.isArray(r.cards) ? r.cards : [] }));
}
export const restoreVersion = (id: number) => sb.rpc('restore_deck_version', { p_version: id });

export type DiffRow = { name: string; cat: string; from: number; to: number };
const key = (e: DeckEntry) => `${e.board === 'maybe' ? 'maybe' : 'main'}|${e.name}`;
/** Per card name (main deck and maybe-board apart), copies in the old list vs the current one. Unchanged cards are left out. */
export function diffCards(old: DeckEntry[], cur: DeckEntry[]): { main: DiffRow[]; maybe: DiffRow[] } {
  const m = new Map<string, DiffRow & { board: string }>();
  const add = (list: DeckEntry[], side: 'from' | 'to') => {
    for (const e of list) {
      if (!e || !e.name || !(e.qty > 0)) continue;
      const k = key(e);
      const r = m.get(k) || { name: e.name, cat: String(e.cat || ''), from: 0, to: 0, board: e.board === 'maybe' ? 'maybe' : 'main' };
      r[side] += e.qty; m.set(k, r);
    }
  };
  add(old, 'from'); add(cur, 'to');
  const rows = [...m.values()].filter(r => r.from !== r.to);
  const sort = (a: DiffRow, b: DiffRow) => a.name.localeCompare(b.name);
  return { main: rows.filter(r => (r as any).board === 'main').sort(sort), maybe: rows.filter(r => (r as any).board === 'maybe').sort(sort) };
}
export const superOf = (cat: string) => (cat === 'Pokemon' ? 'Pokémon' : cat === 'Energy' ? 'Energy' : cat === 'Trainer' ? 'Trainer' : 'Other');
