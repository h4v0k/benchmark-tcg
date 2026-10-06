// Everything the site reads and writes, in one place.
import * as sb from './supabase';
import type { Card, Comment, DeckEntry, DeckRow, Folder, Format, Profile, RuleChange, Rules, SearchHit } from './types';
import type { ParsedLine } from './decklist';

const CARD_COLS = 'id,set_id,local_id,name,category,stage,trainer_type,energy_type,suffix,evolves_from,types,hp,retreat,rarity,reg_mark,illustrator,effect,abilities,attacks,weaknesses,resistances,variants,image,is_ace,is_radiant,is_prism,is_basic_energy,tcgp_product_id,tcgp,prices,prices_at,legal_standard,legal_expanded,standard_from,rotating,rotating_on,banned_in,detail_at,set:sets(id,name,code,series,release_date,legal_date,symbol,logo,is_promo,is_classic)';
const DECK_LIST_COLS = 'id,owner,name,format,is_public,cover,price,card_count,like_count,view_count,comment_count,featured,tags,folder_id,archetype,created_at,updated_at,owner_profile:profiles!decks_owner_fkey(username,avatar_card)';
const DECK_COLS = '*,owner_profile:profiles!decks_owner_fkey(username,avatar_card)';

/* ---------------- cards ---------------- */
const cardCache = new Map<string, Card>();
export const cachedCard = (id: string) => cardCache.get(id);

export async function cardsById(ids: string[]): Promise<Map<string, Card>> {
  const want = [...new Set(ids)].filter(id => id && !cardCache.has(id));
  for (let i = 0; i < want.length; i += 80) {
    const chunk = want.slice(i, i + 80);
    const { rows } = await sb.select<Card>('cards', { select: CARD_COLS, id: `in.(${chunk.map(x => `"${x.replace(/"/g, '')}"`).join(',')})` });
    rows.forEach(c => cardCache.set(c.id, c));
  }
  const out = new Map<string, Card>();
  ids.forEach(id => { const c = cardCache.get(id); if (c) out.set(id, c); });
  return out;
}
export async function printingsOf(name: string): Promise<Card[]> {
  const { rows } = await sb.select<Card>('cards', { select: CARD_COLS, name: `eq.${name}`, limit: 300 });
  rows.forEach(c => cardCache.set(c.id, c));
  return rows
    .filter(c => !(c.set as any)?.hidden)
    .sort((a, b) => (b.set?.release_date || '').localeCompare(a.set?.release_date || '') || localNum(a.local_id) - localNum(b.local_id));
}
const localNum = (l: string) => { const n = parseInt(String(l).replace(/\D/g, ''), 10); return isNaN(n) ? 9999 : n; };

export const searchCards = (q: string, fmt: Format, cat = '', lim = 24) =>
  sb.rpc<SearchHit[]>('search_cards', { q, fmt, cat, lim });

/** Best catalog card for each parsed line. */
export async function resolveLines(lines: ParsedLine[], fmt: Format): Promise<Map<number, { id: string | null; how: string | null }>> {
  const out = new Map<number, { id: string | null; how: string | null }>();
  for (let i = 0; i < lines.length; i += 80) {
    const chunk = lines.slice(i, i + 80).map(l => ({ i: l.i, qty: l.qty, name: l.name, code: l.code, num: l.num }));
    const rows = await sb.rpc<{ i: number; card_id: string | null; how: string | null }[]>('resolve_decklist', { lines: chunk, fmt: fmt === 'unlimited' ? 'unlimited' : fmt });
    rows.forEach(r => out.set(r.i, { id: r.card_id, how: r.how }));
  }
  return out;
}

/* ---------------- import from links ---------------- */
export type ImportResult = { kind: 'youtube' | 'limitless'; title: string; author: string; text: string; linked_list?: string; linked_from?: string; error?: string };
export function youtubeId(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else { const m = u.pathname.match(/^\/(shorts|live|embed|v)\/([^/?#]+)/); if (m) id = m[2]; }
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}
export const isLimitless = (raw: string) => /^https?:\/\/(www\.|play\.)?limitlesstcg\.com\//i.test(raw.trim());

export async function importFromUrl(url: string, onStatus?: (s: string) => void): Promise<ImportResult> {
  const yt = youtubeId(url);
  if (yt) {
    onStatus?.('Reading the video description…');
    const rid = await sb.rpc<string>('youtube_request', { p_video: yt });
    const started = Date.now();
    let res: any = { pending: true };
    while (res?.pending && Date.now() - started < 45000) {
      await new Promise(r => setTimeout(r, 1200));
      res = await sb.rpc('youtube_result', { p_id: rid });
    }
    if (res?.pending) return { kind: 'youtube', title: '', author: '', text: '', error: 'YouTube took too long to answer. Try again.' };
    if (res?.error) return { kind: 'youtube', title: '', author: '', text: '', error: res.error };
    const description: string = res.description || '';
    const out: ImportResult = { kind: 'youtube', title: res.title || '', author: res.author || '', text: description };
    // A Limitless list linked from the description is usually the cleanest copy.
    const link = (description.match(/https?:\/\/(?:www\.|play\.)?limitlesstcg\.com\/[^\s)]+/i) || [])[0];
    if (link) {
      onStatus?.('Reading the linked Limitless list…');
      try {
        const lim = await sb.invoke<ImportResult>('deck-import', { url: link });
        if (lim?.text) { out.linked_list = lim.text; out.linked_from = link; }
      } catch { /* the description may still have the list */ }
    }
    return out;
  }
  if (isLimitless(url)) {
    onStatus?.('Reading the Limitless list…');
    return sb.invoke<ImportResult>('deck-import', { url });
  }
  throw new Error('Paste a YouTube video link or a Limitless deck list link.');
}

/* ---------------- rules ---------------- */
let rulesP: Promise<Rules> | null = null;
export const rules = (fresh = false) => { if (!rulesP || fresh) rulesP = sb.rpc<Rules>('current_rules').catch(e => { rulesP = null; throw e; }); return rulesP; };
export const ruleChanges = async (limit = 30) => (await sb.select<RuleChange>('rule_changes', { select: '*', order: 'happened_at.desc', limit })).rows;

/* ---------------- profiles ---------------- */
export async function myProfile(uid: string): Promise<Profile | null> {
  const { rows } = await sb.select<Profile>('profiles', { select: '*', id: `eq.${uid}` });
  return rows[0] || null;
}
export async function profileByName(username: string): Promise<Profile | null> {
  const { rows } = await sb.select<Profile>('profiles', { select: '*', username: `ilike.${username.replace(/[%_*,()]/g, '')}` });
  return rows[0] || null;
}
export async function createProfile(id: string, username: string): Promise<Profile> {
  const [p] = await sb.insert<Profile>('profiles', { id, username }, { select: '*' });
  return p;
}
export async function updateProfile(id: string, patch: Partial<Pick<Profile, 'bio' | 'avatar_card'>>) {
  await sb.update('profiles', { id: `eq.${id}` }, patch);
}
export async function searchUsers(q: string): Promise<Profile[]> {
  const { rows } = await sb.select<Profile>('profiles', { select: '*', username: `ilike.*${q.replace(/[%_*,()]/g, '')}*`, order: 'follower_count.desc', limit: 20 });
  return rows;
}

/* ---------------- decks ---------------- */
export type DeckQuery = { format?: Format | ''; sort?: 'likes' | 'views' | 'updated' | 'new' | 'price'; q?: string; card?: string; tag?: string; owner?: string; featured?: boolean; owners?: string[]; page?: number; per?: number; folder?: string | null };
const SORT: Record<string, string> = { likes: 'like_count.desc,updated_at.desc', views: 'view_count.desc,updated_at.desc', updated: 'updated_at.desc', new: 'created_at.desc', price: 'price.desc' };

export async function listDecks(o: DeckQuery & { mine?: boolean } = {}) {
  const q: sb.Query = { select: DECK_LIST_COLS, order: SORT[o.sort || 'updated'] };
  if (!o.mine) q.is_public = 'eq.true';
  if (o.owner) q.owner = `eq.${o.owner}`;
  if (o.owners) q.owner = `in.(${o.owners.join(',') || '00000000-0000-0000-0000-000000000000'})`;
  if (o.format) q.format = `eq.${o.format}`;
  if (o.featured) q.featured = 'eq.true';
  if (o.q) q.name = `ilike.*${o.q.replace(/[%_*,()]/g, ' ').trim()}*`;
  if (o.card) q.card_names = `cs.{"${o.card.replace(/["{}\\]/g, '')}"}`;
  if (o.tag) q.tags = `cs.{"${o.tag.toLowerCase().replace(/["{}\\]/g, '')}"}`;
  if (o.folder !== undefined) q.folder_id = o.folder === null ? 'is.null' : `eq.${o.folder}`;
  const per = o.per || 24, page = o.page || 0;
  return sb.select<DeckRow>('decks', q, { count: true, range: [page * per, page * per + per - 1] });
}
export async function getDeck(id: string): Promise<DeckRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await sb.select<DeckRow>('decks', { select: DECK_COLS, id: `eq.${id}` });
  return rows[0] || null;
}
export type DeckWrite = Partial<Pick<DeckRow, 'name' | 'format' | 'description' | 'primer' | 'is_public' | 'cards' | 'cover' | 'price' | 'card_count' | 'tags' | 'folder_id' | 'archetype'>>;
export async function createDeck(row: DeckWrite): Promise<DeckRow> {
  const [d] = await sb.insert<DeckRow>('decks', row, { select: DECK_COLS });
  return d;
}
export async function saveDeck(id: string, patch: DeckWrite) {
  await sb.update('decks', { id: `eq.${id}` }, patch);
}
export const deleteDeck = (id: string) => sb.remove('decks', { id: `eq.${id}` });
export const recordView = (deck: string) => {
  let v = '';
  try { v = localStorage.getItem('bm:viewer') || ''; if (!v) { v = crypto.randomUUID(); localStorage.setItem('bm:viewer', v); } } catch { v = 'nostorage'; }
  return sb.rpc('record_view', { p_deck: deck, p_viewer: v }).catch(() => {});
};
export const setFeatured = (deck: string, on: boolean) => sb.rpc('set_featured', { p_deck: deck, p_featured: on });

/* ---------------- likes ---------------- */
export async function likedSet(uid: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { rows } = await sb.select<{ deck_id: string }>('deck_likes', { select: 'deck_id', user_id: `eq.${uid}`, deck_id: `in.(${ids.join(',')})` });
  return new Set(rows.map(r => r.deck_id));
}
export async function setLike(uid: string, deck: string, on: boolean) {
  if (on) await sb.insert('deck_likes', { deck_id: deck, user_id: uid });
  else await sb.remove('deck_likes', { deck_id: `eq.${deck}`, user_id: `eq.${uid}` });
}

/* ---------------- comments ---------------- */
export async function comments(deck: string): Promise<Comment[]> {
  const { rows } = await sb.select<Comment>('deck_comments', { select: '*,author:profiles!deck_comments_user_id_fkey(username,avatar_card)', deck_id: `eq.${deck}`, order: 'created_at.asc', limit: 500 });
  return rows;
}
export async function addComment(deck: string, body: string): Promise<Comment> {
  const [c] = await sb.insert<Comment>('deck_comments', { deck_id: deck, body }, { select: '*,author:profiles!deck_comments_user_id_fkey(username,avatar_card)' });
  return c;
}
export const deleteComment = (id: string) => sb.remove('deck_comments', { id: `eq.${id}` });

/* ---------------- follows ---------------- */
export async function isFollowing(me: string, them: string) {
  const { rows } = await sb.select('follows', { select: 'followee', follower: `eq.${me}`, followee: `eq.${them}` });
  return rows.length > 0;
}
export async function setFollow(me: string, them: string, on: boolean) {
  if (on) await sb.insert('follows', { follower: me, followee: them });
  else await sb.remove('follows', { follower: `eq.${me}`, followee: `eq.${them}` });
}
export async function followingIds(me: string): Promise<string[]> {
  const { rows } = await sb.select<{ followee: string }>('follows', { select: 'followee', follower: `eq.${me}`, limit: 1000 });
  return rows.map(r => r.followee);
}
export async function followList(uid: string, dir: 'followers' | 'following'): Promise<{ username: string; avatar_card: string }[]> {
  const q = dir === 'followers'
    ? { select: 'p:profiles!follows_follower_fkey(username,avatar_card)', followee: `eq.${uid}`, limit: 500 }
    : { select: 'p:profiles!follows_followee_fkey(username,avatar_card)', follower: `eq.${uid}`, limit: 500 };
  const { rows } = await sb.select<{ p: { username: string; avatar_card: string } }>('follows', q);
  return rows.map(r => r.p).filter(Boolean);
}

/* ---------------- folders ---------------- */
export async function folders(): Promise<Folder[]> {
  return (await sb.select<Folder>('folders', { select: '*', order: 'name.asc' })).rows;
}
export async function createFolder(name: string): Promise<Folder> { const [f] = await sb.insert<Folder>('folders', { name }, { select: '*' }); return f; }
export const renameFolder = (id: string, name: string) => sb.update('folders', { id: `eq.${id}` }, { name });
export const deleteFolder = (id: string) => sb.remove('folders', { id: `eq.${id}` });

/* ---------------- admin ---------------- */
export async function adminData() {
  const [runs, rotations, bans] = await Promise.all([
    sb.select('sync_runs', { select: '*', order: 'started_at.desc', limit: 25 }),
    sb.select('rotations', { select: '*', order: 'new_min_mark.desc' }),
    sb.select('bans', { select: '*', order: 'format.asc,card_name.asc' }),
  ]);
  return { runs: runs.rows, rotations: rotations.rows, bans: bans.rows };
}
export const runSync = (fn: 'catalog-sync' | 'rules-sync', body: object = {}) => sb.invoke(fn, body);
export const saveRotation = (id: number | null, row: object) => id ? sb.update('rotations', { id: `eq.${id}` }, row) : sb.insert('rotations', row);
export const saveBan = (row: object) => sb.insert('bans', row);
export const setBanActive = (id: number, active: boolean) => sb.update('bans', { id: `eq.${id}` }, { active, removed_at: active ? null : new Date().toISOString() });

export type { DeckEntry };
