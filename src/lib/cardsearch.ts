// Runs a parsed card query in the database (search_cards_q), or the old name search for plain words.
import * as sb from './supabase';
import { searchCards } from './api';
import { parseCardQuery } from './cardquery';
import type { Format, SearchHit } from './types';

export type CardSearchResult = { hits: SearchHit[]; error?: string };
/** Plain words keep using the original name search (fuzzy, ranked); anything with fields goes to search_cards_q. */
export async function runCardSearch(q: string, fmt: Format, cat: string, limit = 60, offset = 0): Promise<CardSearchResult> {
  const parsed = parseCardQuery(q);
  if (parsed.error) return { hits: [], error: parsed.error };
  if (parsed.empty) return { hits: [] };
  if (parsed.simple) return { hits: offset ? [] : await searchCards(q, fmt, cat, limit) };
  const groups = cat ? parsed.groups.map(g => [...g, { f: 'cat', v: cat }]) : parsed.groups;
  const hits = await sb.rpc<SearchHit[]>('search_cards_q', { p_clauses: groups, p_fmt: fmt, p_sort: 'relevance', p_limit: limit, p_offset: offset });
  return { hits };
}
