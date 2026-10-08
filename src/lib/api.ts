// Everything the site reads and writes, in one place.
import * as sb from './supabase';
import type { Card, Comment, DeckEntry, DeckRow, Folder, Format, Profile, RuleChange, Rules, SearchHit } from './types';
import type { ParsedLine } from './decklist';

const CARD_COLS = 'id,set_id,local_id,name,category,stage,trainer_type,energy_type,suffix,evolves_from,types,hp,retreat,rarity,reg_mark,illustrator,effect,abilities,attacks,weaknesses,resistances,variants,image,is_ace,is_radiant,is_prism,is_basic_energy,tcgp_product_id,tcgp,prices,prices_at,legal_standard,legal_expanded,standard_from,rotating,rotating_on,banned_in,detail_at,set:sets!inner(id,name,code,series,release_date,legal_date,symbol,logo,is_promo,is_classic,hidden)';
const DECK_LIST_COLS = 'id,owner,name,format,is_public,cover,price,card_count,like_count,view_count,comment_count,featured,tags,archetype,created_at,updated_at,owner_profile:profiles!decks_owner_fkey(username,avatar_card)';
const DECK_COLS = '*,owner_profile:profiles!decks_owner_fkey(username,avatar_card)';

/* ---------------- cards ---------------- */
const cardCache = new Map<string, Card>();
export const cachedCard = (id: string) => cardCache.get(id);

// Card ids currently being fetched, so concurrent callers asking for the same ids share one request.
const cardInflight = new Map<string, Promise<void>>();

export async function cardsById(ids: string[]): Promise<Map<string, Card>> {
  const want = [...new Set(ids)].filter(id => id && !cardCache.has(id));
  const waits: Promise<void>[] = [];
  const fresh: string[] = [];
  for (const id of want) {
    const p = cardInflight.get(id);
    if (p) waits.push(p); else fresh.push(id);
  }
  for (let i = 0; i < fresh.length; i += 80) {
    const chunk = fresh.slice(i, i + 80);
    const req = sb.select<Card>('cards', { select: CARD_COLS, id: `in.(${chunk.map(x => `"${x.replace(/"/g, '')}"`).join(',')})` })
      .then(({ rows }) => { rows.forEach(c => cardCache.set(c.id, c)); })
      .finally(() => chunk.forEach(id => cardInflight.delete(id)));
    chunk.forEach(id => cardInflight.set(id, req));
    waits.push(req);
  }
  await Promise.all(waits);
  const out = new Map<string, Card>();
  ids.forEach(id => { const c = cardCache.get(id); if (c) out.set(id, c); });
  return out;
}
export async function printingsOf(name: string): Promise<Card[]> {
  // Pokémon TCG Pocket (digital-only) sets are hidden from printings.
  const { rows } = await sb.select<Card>('cards', { select: CARD_COLS, name: `eq.${name}`, 'set.hidden': 'is.false', limit: 300 });
  rows.forEach(c => cardCache.set(c.id, c));
  return rows
    .sort((a, b) => (b.set?.release_date || '').localeCompare(a.set?.release_date || '') || localNum(a.local_id) - localNum(b.local_id));
}
const localNum = (l: string) => { const n = parseInt(String(l).replace(/\D/g, ''), 10); return isNaN(n) ? 9999 : n; };

/* Preferred printings: card name → card id. */
export type PrintingPref = { name: string; card_id: string; card?: Card };
export async function printingPrefs(): Promise<PrintingPref[]> {
  if (!sb.getSession()) return [];
  const { rows } = await sb.select<PrintingPref>('printing_prefs', { select: `name,card_id,card:cards(${CARD_COLS})`, order: 'name.asc', limit: 1000 });
  return rows;
}
export async function setPrintingPref(card: Pick<Card, 'id' | 'name'>) {
  await sb.remove('printing_prefs', { name: `eq.${card.name}` });
  await sb.insert('printing_prefs', { card_id: card.id }, { select: 'name,card_id' });
}
export async function clearPrintingPref(name: string) {
  await sb.remove('printing_prefs', { name: `eq.${name}` });
}

export const searchCards =(q: string, fmt: Format, cat = '', lim = 24) =>
  sb.rpc<SearchHit[]>('search_cards', { q, fmt, cat, lim });

/** Best catalog card for each parsed line. */
/** 'cheapest': each card becomes your preferred printing, else the cheapest legal printing of
 *  that same card. 'exact': keep the printing the list names. */
export type PrintingMode = 'cheapest' | 'exact';
export async function resolveLines(lines: ParsedLine[], fmt: Format, mode: PrintingMode = 'cheapest'): Promise<Map<number, { id: string | null; how: string | null }>> {
  const out = new Map<number, { id: string | null; how: string | null }>();
  const chunks: ParsedLine[][] = [];
  for (let i = 0; i < lines.length; i += 80) chunks.push(lines.slice(i, i + 80));
  const results = await Promise.all(chunks.map(ch => sb.rpc<{ i: number; card_id: string | null; how: string | null }[]>('resolve_decklist_v2', { lines: ch.map(l => ({ i: l.i, qty: l.qty, name: l.name, code: l.code, num: l.num })), fmt: fmt === 'unlimited' ? 'unlimited' : fmt, p_mode: mode })));
  results.forEach(rows => rows.forEach(r => out.set(r.i, { id: r.card_id, how: r.how })));
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
  // Folders are private, so folder_id is only selected for your own decks.
  const q: sb.Query = { select: o.mine ? DECK_LIST_COLS + ',folder_id' : DECK_LIST_COLS, order: SORT[o.sort || 'updated'] };
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
export type AdminUser = { id: string; username: string | null; email: string; sign_in: string; confirmed: boolean; created_at: string; last_sign_in_at: string | null; deck_count: number; public_deck_count: number; is_admin: boolean };
export const adminUsers = () => sb.rpc<AdminUser[]>('admin_users');

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

/* ---------------- Tournaments (Regionals, Internationals, Worlds; from Limitless) ---------------- */
export type Tournament = { id: number; name: string; date: string; country: string; players: number | null; kind: 'regional' | 'international' | 'worlds'; status: string };
export type TourneyDeck = { tournament_id: number; place: number; player: string; country: string; archetype: string; list_id: number | null; card_count: number | null; price: number | null; cards?: DeckEntry[] | null; missing?: string[] };
export type MetaRow = { archetype: string; top32: number; top8: number; wins: number; events: number; best_tournament: number | null; best_place: number | null };
const T_COLS = 'id,name,date,country,players,kind,status';
export async function tournaments(): Promise<(Tournament & { lists: number })[]> {
  const { rows } = await sb.select<Tournament & { tournament_decks: { count: number }[] }>('tournaments',
    { select: `${T_COLS},tournament_decks(count)`, 'tournament_decks.cards': 'not.is.null', status: 'neq.new', order: 'date.desc', limit: 60 });
  return rows.map(r => ({ ...r, lists: r.tournament_decks?.[0]?.count || 0 }));
}
export async function tournament(id: number): Promise<{ t: Tournament; decks: TourneyDeck[] } | null> {
  const [{ rows: ts }, { rows: decks }] = await Promise.all([
    sb.select<Tournament>('tournaments', { select: T_COLS, id: `eq.${id}` }),
    sb.select<TourneyDeck>('tournament_decks', { select: 'tournament_id,place,player,country,archetype,list_id,card_count,price', tournament_id: `eq.${id}`, order: 'place.asc' }),
  ]);
  return ts[0] ? { t: ts[0], decks } : null;
}
export async function tournamentDeck(id: number, place: number): Promise<{ t: Tournament; d: TourneyDeck } | null> {
  const [{ rows: ts }, { rows: ds }] = await Promise.all([
    sb.select<Tournament>('tournaments', { select: T_COLS, id: `eq.${id}` }),
    sb.select<TourneyDeck>('tournament_decks', { select: '*', tournament_id: `eq.${id}`, place: `eq.${place}` }),
  ]);
  return ts[0] && ds[0] ? { t: ts[0], d: ds[0] } : null;
}
export const tourneyMeta = (days = 60) => sb.rpc<MetaRow[]>('tourney_meta', { days });

/* ---------------- Matchups (how archetypes do against each other; from Limitless) ---------------- */
export type MatchupSource = 'online' | 'official';
export type MatchupDeck = { deck: string; name: string; icons: string[]; games: number; wins: number; losses: number; ties: number; win_pct: number | null; events: number };
export type Matchup = { opp: string; name: string; icons: string[]; games: number; wins: number; losses: number; ties: number; win_pct: number | null };
export type MatchupCoverage = { events: number; pending: number; from: string | null; to: string | null; event_names: string[] | null };
export const matchupDecks = (source: MatchupSource, days: number) => sb.rpc<MatchupDeck[]>('matchup_decks', { p_source: source, p_days: days });
export const matchups = (deck: string, source: MatchupSource, days: number) => sb.rpc<Matchup[]>('matchups', { p_deck: deck, p_source: source, p_days: days });
export const matchupCoverage = (source: MatchupSource, days: number) => sb.rpc<MatchupCoverage>('matchup_coverage', { p_source: source, p_days: days });

/* Winning lists: top decklists from online events, with records */
export type ListTier = 'online' | 'regional' | 'international' | 'worlds';
export type DeckListRow = { key: string; tier: ListTier; event_name: string; date: string; event_players: number | null; player: string; place: number | null; wins: number | null; losses: number | null; ties: number | null; score: number };
export type DeckListFull = DeckListRow & { deck: string | null; event_id: string; list: string | null; cards: DeckEntry[] | null; missing: string[] | null; list_id: number | null };
export const deckLists = (deck: string, days: number) => sb.rpc<DeckListRow[]>('deck_lists', { p_deck: deck, p_days: days });
export const deckList = async (key: string) => (await sb.rpc<DeckListFull[]>('deck_list', { p_key: key }))[0] || null;
export async function archetypeName(slug: string): Promise<string | null> {
  const { rows } = await sb.select<{ name: string }>('archetypes', { select: 'name', slug: `eq.${slug}` });
  return rows[0]?.name || null;
}

/** Every top-32 finish of one archetype across Regionals, Internationals and Worlds, best placement first. */
export type ArchetypeFinish = TourneyDeck & { tournaments: Pick<Tournament, 'id' | 'name' | 'date' | 'kind' | 'players'> };
export async function archetypeFinishes(archetype: string, days: number): Promise<ArchetypeFinish[]> {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const { rows } = await sb.select<ArchetypeFinish>('tournament_decks', {
    select: 'tournament_id,place,player,country,archetype,list_id,card_count,price,tournaments!inner(id,name,date,kind,players)',
    archetype: `eq.${archetype}`, 'tournaments.date': `gte.${since}`, order: 'place.asc', limit: 300,
  });
  return rows.sort((a, b) => a.place - b.place || b.tournaments.date.localeCompare(a.tournaments.date));
}
