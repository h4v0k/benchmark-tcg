// Price history and movers (from the daily snapshots).
import * as sb from './supabase';

export type PricePoint = { day: string; market: number };
export type Mover = { card_id: string; name: string; image: string; tcgp_product_id: number | null; set_name: string; set_code: string; local_id: string; from_price: number; to_price: number; pct: number };
export type Movers = { last_day: string | null; base_day: string | null; risers: Mover[]; fallers: Mover[] };

export const priceHistory = async (cardId: string, days = 90): Promise<PricePoint[]> =>
  (await sb.rpc<PricePoint[]>('card_price_history', { p_card: cardId, p_days: days })).map(p => ({ day: p.day, market: Number(p.market) }));
export const priceMovers = (days = 7, standard = true, limit = 20) => sb.rpc<Movers>('price_movers', { p_days: days, p_limit: limit, p_standard: standard });
