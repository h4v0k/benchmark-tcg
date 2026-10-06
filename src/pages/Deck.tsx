import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Empty, ErrorBox, Icon, Menu, MenuItem, Modal, Segmented, Spinner, copyText } from '../components/ui';
import { DeckView, type GroupMode, type ViewMode } from '../components/deck/Views';
import { BuyPanel, LegalityPanel, SampleHand, StatsPanel } from '../components/deck/Sidebar';
import { AddCard } from '../components/deck/AddCard';
import { CardModal } from '../components/deck/CardModal';
import { ImportModal } from '../components/deck/ImportModal';
import { ExportModal, SettingsModal } from '../components/deck/DeckModals';
import { Comments } from '../components/deck/Comments';
import { Markdown } from '../components/Markdown';
import { coverUrl } from '../components/DeckTile';
import { Link, navigate, setQuery, useRoute } from '../router';
import { useAuth, toast } from '../state';
import * as api from '../lib/api';
import { ago, FORMAT_LABEL, linePrice, sum, type Line, type SortKey } from '../lib/cards';
import { exportPTCGL } from '../lib/decklist';
import { validateDeck } from '../lib/legality';
import { massEntry } from '../lib/tcgplayer';
import type { Board, Card, DeckEntry, DeckRow, Finish, Rules } from '../lib/types';

const pref = <T extends string>(k: string, d: T): T => { try { return (localStorage.getItem('bm:' + k) as T) || d; } catch { return d; } };
const setPref = (k: string, v: string) => { try { localStorage.setItem('bm:' + k, v); } catch {} };
const slim = (e: DeckEntry): DeckEntry => ({ cid: e.cid, qty: e.qty, board: e.board, ...(e.variant && e.variant !== 'normal' ? { variant: e.variant } : {}), name: e.name, cat: e.cat || '' });

function autoCover(lines: Line[]): string {
  const main = lines.filter(l => l.board === 'main' && l.card?.image);
  const score = (l: Line) => (l.card!.category === 'Pokemon' ? 100 : 0) + (/( ex| V| VSTAR| VMAX| GX| EX)$/i.test(l.name) ? 50 : 0) + (/stage ?2|vstar|vmax|mega/i.test(l.card!.stage) ? 10 : 0) + l.qty;
  const best = main.sort((a, b) => score(b) - score(a))[0];
  return best?.card?.image || '';
}

export function DeckPage({ id }: { id: string }) {
  const { session, profile } = useAuth();
  const { query } = useRoute();
  const [row, setRow] = useState<DeckRow | null>(null);
  const [entries, setEntries] = useState<DeckEntry[]>([]);
  const [cards, setCards] = useState<Map<string, Card>>(new Map());
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState(false);
  const [rules, setRules] = useState<Rules | null>(null);
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState<'deck' | 'primer' | 'comments'>('deck');
  const [board, setBoard] = useState<Board>('main');
  const [mode, setMode] = useState<ViewMode>(pref('view', 'text'));
  const [group, setGroup] = useState<GroupMode>(pref('group', 'type'));
  const [sort, setSort] = useState<SortKey>(pref('sort', 'default'));
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<null | { kind: 'card'; cid: string; board: Board } | { kind: 'import' | 'bulk' | 'export' | 'settings' | 'delete' }>(null);
  const [editing, setEditing] = useState(query.get('edit') === '1');
  const isOwner = !!session && !!row && session.user.id === row.owner;
  const editable = isOwner && editing;

  /* ---------- load ---------- */
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await api.getDeck(id);
      if (!d) { setRow(null); setLoading(false); return; }
      const list = (Array.isArray(d.cards) ? d.cards : []).filter(e => e && e.cid && e.qty > 0).map(e => ({ ...e, board: (e.board === 'maybe' ? 'maybe' : 'main') as Board, name: e.name || String(e.cid) }));
      const map = await api.cardsById(list.map(e => e.cid));
      setRow(d); setEntries(list); setCards(map);
      if (session?.user && session.user.id !== d.owner) api.likedSet(session.user.id, [d.id]).then(s => setLiked(s.has(d.id))).catch(() => {});
      if (!session || session.user.id !== d.owner) api.recordView(d.id);
    } catch (e: any) { setError(e); } finally { setLoading(false); }
  }, [id, session?.user?.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.rules().then(setRules).catch(() => {}); }, []);
  useEffect(() => { if (query.get('import') === '1' && isOwner) { setEditing(true); setModal({ kind: 'import' }); setQuery({ import: null, edit: '1' }); } }, [isOwner]);

  const lines: Line[] = useMemo(() => entries.map(e => ({ ...e, card: cards.get(e.cid) })), [entries, cards]);
  const boardLines = useMemo(() => lines.filter(l => l.board === board), [lines, board]);
  const mainLines = useMemo(() => lines.filter(l => l.board === 'main'), [lines]);
  const total = sum(mainLines, l => l.qty);
  const checks = useMemo(() => row ? validateDeck(lines, row.format, rules) : [], [lines, row?.format, rules]);
  const legal = !checks.some(c => c.level === 'bad');

  /* ---------- saving ---------- */
  const pending = useRef<api.DeckWrite>({});
  const timer = useRef<number | undefined>(undefined);
  // Saves run one at a time, in order, so an older save can never land after a newer one.
  const inflight = useRef<Promise<void>>(Promise.resolve());
  const flush = useCallback(() => {
    inflight.current = inflight.current.then(async () => {
      const p = pending.current; pending.current = {};
      if (!Object.keys(p).length) return;
      setStatus('Saving…');
      try { await api.saveDeck(id, p); if (!Object.keys(pending.current).length) setStatus('Saved'); }
      catch (e: any) { pending.current = { ...p, ...pending.current }; setStatus('Not saved'); toast(`Couldn’t save: ${e.message}`, 'bad'); }
    });
    return inflight.current;
  }, [id]);
  const queue = useCallback((patch: api.DeckWrite) => {
    pending.current = { ...pending.current, ...patch };
    setStatus('Saving…');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 700);
  }, [flush]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (Object.keys(pending.current).length) { flush(); e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); clearTimeout(timer.current); flush(); };
  }, [flush]);

  const commit = (next: DeckEntry[], map = cards) => {
    setEntries(next);
    const ls: Line[] = next.map(e => ({ ...e, card: map.get(e.cid) }));
    const main = ls.filter(l => l.board === 'main');
    const keepCover = row?.cover && ls.some(l => l.card?.image === row.cover);
    queue({ cards: next.map(slim), card_count: sum(main, l => l.qty), price: Math.round(sum(main, l => (linePrice(l) || 0) * l.qty) * 100) / 100, cover: keepCover ? row!.cover : autoCover(ls) });
  };
  const patchRow = (patch: Partial<DeckRow>) => {
    setRow(r => r && { ...r, ...patch });
    // An empty name is only a moment while typing; don't send it.
    const send = { ...patch } as api.DeckWrite;
    if ('name' in send && !String(send.name || '').trim()) delete send.name;
    if (Object.keys(send).length) queue(send);
  };

  /* ---------- edits ---------- */
  const addCard = async (cid: string, qty: number, b: Board) => {
    const map = new Map(cards);
    if (!map.has(cid)) { const got = await api.cardsById([cid]); got.forEach((v, k) => map.set(k, v)); setCards(map); }
    const c = map.get(cid);
    if (!c) { toast('That card couldn’t be found', 'bad'); return; }
    const i = entries.findIndex(e => e.cid === cid && e.board === b);
    const next = i >= 0 ? entries.map((e, j) => j === i ? { ...e, qty: Math.min(60, e.qty + qty) } : e) : [...entries, { cid, qty, board: b, name: c.name, cat: c.category }];
    commit(next, map);
    toast(`Added ${qty}× ${c.name}`, 'ok');
  };
  const changeLine = async (l: Line, patch: { qty?: number; board?: Board; variant?: Finish; cid?: string }) => {
    let map = cards;
    if (patch.cid && !cards.has(patch.cid)) { map = new Map(cards); (await api.cardsById([patch.cid])).forEach((v, k) => map.set(k, v)); setCards(map); }
    let next = entries.map(e => {
      if (e.cid !== l.cid || e.board !== l.board) return e;
      const n = { ...e };
      if (patch.qty !== undefined) n.qty = Math.max(0, Math.min(60, patch.qty));
      if (patch.variant) n.variant = patch.variant;
      if (patch.board) n.board = patch.board;
      if (patch.cid) { const c = map.get(patch.cid)!; n.cid = patch.cid; n.name = c.name; n.cat = c.category; if (n.variant && !(c.variants || []).includes(n.variant as string) && !(n.variant in (c.prices || {}))) delete n.variant; }
      return n;
    }).filter(e => e.qty > 0);
    // merge duplicates created by moving boards or swapping printings
    const merged = new Map<string, DeckEntry>();
    for (const e of next) { const k = `${e.cid}|${e.board}`; const m = merged.get(k); if (m) m.qty = Math.min(60, m.qty + e.qty); else merged.set(k, { ...e }); }
    next = [...merged.values()];
    commit(next, map);
    if (modal?.kind === 'card' && (patch.cid || patch.board)) setModal({ kind: 'card', cid: patch.cid || l.cid, board: patch.board || l.board });
  };
  const applyImport = async (incoming: DeckEntry[], how: 'add' | 'replace', meta: { title?: string }) => {
    const map = new Map(cards);
    (await api.cardsById(incoming.map(e => e.cid))).forEach((v, k) => map.set(k, v));
    setCards(map);
    let next: DeckEntry[];
    if (how === 'replace') {
      // keep chosen finishes for cards that stay
      next = incoming.map(e => { const old = entries.find(o => o.cid === e.cid && o.board === e.board); return old?.variant ? { ...e, variant: old.variant } : e; });
    } else {
      next = entries.map(e => ({ ...e }));
      for (const e of incoming) { const m = next.find(x => x.cid === e.cid && x.board === e.board); if (m) m.qty = Math.min(60, m.qty + e.qty); else next.push(e); }
    }
    commit(next, map);
    if (meta.title && row && /^untitled deck$/i.test(row.name)) patchRow({ name: meta.title.slice(0, 80) });
    setModal(null);
    toast(how === 'replace' ? 'Deck replaced' : `Added ${sum(incoming, e => e.qty)} cards`, 'ok');
  };

  /* ---------- actions ---------- */
  const toggleLike = async () => {
    if (!session || !profile) { navigate('/login'); return; }
    if (!row) return;
    const on = !liked;
    setLiked(on); setRow(r => r && { ...r, like_count: Math.max(0, r.like_count + (on ? 1 : -1)) });
    try { await api.setLike(session.user.id, row.id, on); } catch (e: any) { setLiked(!on); toast(e.message, 'bad'); }
  };
  const share = async () => { const ok = await copyText(location.origin + `/decks/${id}`); toast(ok ? (row?.is_public ? 'Link copied' : 'Link copied. This deck is private, so only you can open it.') : 'Couldn’t copy the link', ok ? 'ok' : 'bad'); };
  const clone = async () => {
    if (!session || !profile) { navigate('/login'); return; }
    if (!row) return;
    try {
      const d = await api.createDeck({ name: `Copy of ${row.name}`.slice(0, 80), format: row.format, cards: entries.map(slim), cover: row.cover, price: row.price, card_count: row.card_count, description: row.description, archetype: row.archetype, is_public: false });
      toast('Copied to your decks', 'ok'); navigate(`/decks/${d.id}?edit=1`);
    } catch (e: any) { toast(e.message, 'bad'); }
  };
  const remove = async () => {
    try { clearTimeout(timer.current); pending.current = {}; await api.deleteDeck(id); toast('Deck deleted'); navigate('/my/decks'); } catch (e: any) { toast(e.message, 'bad'); }
  };
  const feature = async () => {
    if (!row) return;
    try { await api.setFeatured(row.id, !row.featured); setRow({ ...row, featured: !row.featured }); toast(row.featured ? 'Removed from featured' : 'Featured on the home page', 'ok'); } catch (e: any) { toast(e.message, 'bad'); }
  };
  const showProblems = (names: string[]) => { setHighlight(new Set(names)); setTab('deck'); setBoard('main'); setTimeout(() => document.querySelector('.hl')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50); setTimeout(() => setHighlight(new Set()), 4000); };

  if (loading) return <Spinner label="Loading deck…" />;
  if (error) return <div className="wrap page"><ErrorBox error={error} onRetry={load} /></div>;
  if (!row) return <div className="wrap page"><Empty title="Deck not found" icon="warn"><p>It may have been deleted or made private.</p><Link to="/decks" className="btn">Browse decks</Link></Empty></div>;

  const cover = coverUrl(row.cover || autoCover(lines));
  const modalLine = modal?.kind === 'card' ? lines.find(l => l.cid === modal.cid && l.board === modal.board) : undefined;
  const me = massEntry(mainLines);
  const maybeCount = sum(lines.filter(l => l.board === 'maybe'), l => l.qty);
  const cardRefs = new Map(lines.filter(l => l.card).map(l => [l.name.toLowerCase(), { name: l.name, image: l.card!.image }]));

  return (
    <div className="deck-page">
      <header className="deck-hero" style={cover ? { ['--cover' as any]: `url("${cover}")` } : undefined}>
        <div className="wrap deck-hero-inner">
          <div className="deck-hero-text">
            <div className="deck-badges">
              <span className={`fmt-badge ${row.format}`}>{FORMAT_LABEL[row.format]}</span>
              {row.format !== 'unlimited' && <span className={`fmt-badge ${legal ? 'legal' : 'illegal'}`}>{legal ? 'Legal' : 'Not legal'}</span>}
              {!row.is_public && <span className="fmt-badge private">Private</span>}
              {row.featured && <span className="fmt-badge featured"><Icon name="star" size={11} />Featured</span>}
              {row.archetype && <span className="fmt-badge">{row.archetype}</span>}
            </div>
            {editable ? (
              <input className="deck-title-input" value={row.name} maxLength={80} aria-label="Deck name" onChange={e => patchRow({ name: e.target.value })} onBlur={e => { if (!e.target.value.trim()) patchRow({ name: 'Untitled deck' }); else if (e.target.value !== e.target.value.trim()) patchRow({ name: e.target.value.trim() }); }} />
            ) : <h1 className="deck-title">{row.name}</h1>}
            <div className="deck-byline">
              {row.owner_profile && <Link to={`/users/${row.owner_profile.username}`} className="author"><Avatar card={row.owner_profile.avatar_card} name={row.owner_profile.username} size={22} />{row.owner_profile.username}</Link>}
              <span>Updated {ago(row.updated_at)}</span>
              <span className="stat"><Icon name="heart" size={13} />{row.like_count}</span>
              <span className="stat"><Icon name="eye" size={13} />{row.view_count}</span>
              <span className="stat"><Icon name="chat" size={13} />{row.comment_count}</span>
              {row.tags?.map(t => <Link key={t} to={`/decks?tag=${encodeURIComponent(t)}`} className="tag">#{t}</Link>)}
            </div>
            {row.description && <p className="deck-desc">{row.description}</p>}
          </div>
          <div className="deck-actions">
            {isOwner && <button className={`btn ${editing ? 'primary' : ''}`} onClick={() => { setEditing(e => !e); setQuery({ edit: editing ? null : '1' }); }}><Icon name={editing ? 'check' : 'edit'} />{editing ? 'Done' : 'Edit'}</button>}
            {!isOwner && <button className={`btn ${liked ? 'liked' : ''}`} onClick={toggleLike} aria-pressed={liked}><Icon name="heart" />{liked ? 'Liked' : 'Like'}</button>}
            <a className="btn" href={me.url} target="_blank" rel="noopener noreferrer"><Icon name="cart" />Buy</a>
            <button className="btn" onClick={() => setModal({ kind: 'export' })}><Icon name="download" />Export</button>
            <Menu label={<Icon name="dots" />} className="btn" title="More">
              <MenuItem icon="share" onClick={share}>Copy link</MenuItem>
              <MenuItem icon="copy" onClick={async () => toast((await copyText(exportPTCGL(lines))) ? 'List copied for Pokémon TCG Live' : 'Couldn’t copy', 'ok')}>Copy for Pokémon TCG Live</MenuItem>
              <MenuItem icon="copy" onClick={clone}>Copy to my decks</MenuItem>
              {isOwner && <MenuItem icon="upload" onClick={() => { setEditing(true); setModal({ kind: 'import' }); }}>Import cards</MenuItem>}
              {isOwner && <MenuItem icon="list" onClick={() => { setEditing(true); setModal({ kind: 'bulk' }); }}>Edit as text</MenuItem>}
              {isOwner && <MenuItem icon="edit" onClick={() => setModal({ kind: 'settings' })}>Deck settings</MenuItem>}
              {profile?.is_admin && row.is_public && <MenuItem icon="star" onClick={feature}>{row.featured ? 'Unfeature' : 'Feature on home page'}</MenuItem>}
              {isOwner && <MenuItem icon="trash" danger onClick={() => setModal({ kind: 'delete' })}>Delete deck</MenuItem>}
            </Menu>
          </div>
        </div>
      </header>

      <div className="wrap deck-tabs-bar">
        <nav className="tabs" aria-label="Deck sections">
          <button className={tab === 'deck' ? 'on' : ''} onClick={() => setTab('deck')}>Deck <span className="count">{total}</span></button>
          <button className={tab === 'primer' ? 'on' : ''} onClick={() => setTab('primer')}>Primer</button>
          <button className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>Comments <span className="count">{row.comment_count}</span></button>
        </nav>
        {isOwner && <span className={`save-state ${status === 'Not saved' ? 'bad' : ''}`} aria-live="polite">{status}{status === 'Not saved' && <button className="link-btn" onClick={flush}>Retry</button>}</span>}
      </div>

      <div className="wrap deck-layout">
        <div className="deck-main">
          {tab === 'deck' && (
            <>
              <div className="deck-toolbar">
                <Segmented label="Board" value={board} onChange={setBoard} options={[{ value: 'main', label: <>Deck <b>{total}</b></> }, { value: 'maybe', label: <>Considering <b>{maybeCount}</b></> }]} />
                <div className="toolbar-right">
                  <Segmented label="View" value={mode} onChange={v => { setMode(v); setPref('view', v); }} options={[
                    { value: 'text', label: <Icon name="list" />, title: 'Text' },
                    { value: 'visual', label: <Icon name="grid" />, title: 'Visual' },
                    { value: 'stacks', label: <Icon name="stack" />, title: 'Stacks' },
                    { value: 'table', label: <Icon name="table" />, title: 'Table' },
                  ]} />
                  <label className="select-inline"><span>Group</span>
                    <select value={group} onChange={e => { setGroup(e.target.value as GroupMode); setPref('group', e.target.value); }}>
                      <option value="type">Card type</option><option value="super">Supertype</option><option value="set">Set</option><option value="rarity">Rarity</option><option value="none">None</option>
                    </select>
                  </label>
                  <label className="select-inline"><span>Sort</span>
                    <select value={sort} onChange={e => { setSort(e.target.value as SortKey); setPref('sort', e.target.value); }}>
                      <option value="default">Evolution lines</option><option value="qty">Quantity</option><option value="name">Name</option><option value="price">Price</option><option value="set">Newest set</option>
                    </select>
                  </label>
                </div>
              </div>
              {editable && (
                <div className="editor-bar">
                  <AddCard format={row.format} board={board} onAdd={addCard} />
                  <button className="btn" onClick={() => setModal({ kind: 'import' })}><Icon name="upload" />Import</button>
                  <button className="btn" onClick={() => setModal({ kind: 'bulk' })}><Icon name="list" />Edit as text</button>
                </div>
              )}
              {boardLines.length ? (
                <DeckView mode={mode} lines={boardLines} format={row.format} group={group} sort={sort} editable={editable} highlight={highlight}
                  onOpen={l => setModal({ kind: 'card', cid: l.cid, board: l.board })} onQty={(l, q) => changeLine(l, { qty: q })} />
              ) : (
                <Empty title={board === 'main' ? 'No cards yet' : 'Nothing in Considering'} icon="grid">
                  {isOwner ? <p>{board === 'main' ? 'Add cards above, or import a list or a YouTube link.' : 'Park cards you’re thinking about here; they don’t count toward the 60.'}</p> : <p>This board is empty.</p>}
                  {isOwner && board === 'main' && <button className="btn primary" onClick={() => { setEditing(true); setModal({ kind: 'import' }); }}><Icon name="upload" />Import a list</button>}
                </Empty>
              )}
            </>
          )}
          {tab === 'primer' && <Primer row={row} editable={isOwner} cards={cardRefs} onSave={primer => patchRow({ primer })} />}
          {tab === 'comments' && <Comments deckId={row.id} deckOwner={row.owner} onCount={n => setRow(r => r && { ...r, comment_count: Math.max(0, n) })} />}
        </div>
        <aside className="deck-side">
          <LegalityPanel lines={lines} format={row.format} rules={rules} onHighlight={showProblems} />
          <BuyPanel lines={lines} />
          <StatsPanel lines={lines} />
          <SampleHand lines={lines} />
        </aside>
      </div>

      {modal?.kind === 'card' && modalLine && (
        <CardModal line={modalLine} format={row.format} editable={editable || isOwner} isCover={!!modalLine.card?.image && row.cover === modalLine.card.image}
          onClose={() => setModal(null)} onChange={p => changeLine(modalLine, p)}
          onCover={() => { patchRow({ cover: modalLine.card!.image }); toast('Deck cover updated', 'ok'); }} />
      )}
      {modal?.kind === 'import' && <ImportModal format={row.format} onClose={() => setModal(null)} onApply={applyImport} defaultMode={entries.length ? 'add' : 'replace'} />}
      {modal?.kind === 'bulk' && (
        <ImportModal title="Edit as text" allowLink={false} format={row.format} defaultMode="replace" onClose={() => setModal(null)} onApply={applyImport}
          initialText={exportPTCGL(lines, 'main') + (maybeCount ? '\n\nConsidering:\n' + lines.filter(l => l.board === 'maybe').map(l => `${l.qty} ${l.name}${l.card ? ` ${l.card.set?.code || ''} ${/^\d+$/.test(l.card.local_id) ? parseInt(l.card.local_id, 10) : l.card.local_id}` : ''}`).join('\n') : '')} />
      )}
      {modal?.kind === 'export' && <ExportModal lines={lines} name={row.name} onClose={() => setModal(null)} />}
      {modal?.kind === 'settings' && <SettingsModal deck={row} onClose={() => setModal(null)} onSave={patchRow} />}
      {modal?.kind === 'delete' && (
        <Modal title="Delete this deck?" onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Cancel</button><button className="btn danger" onClick={remove}>Delete deck</button></>}>
          <p>“{row.name}” and its comments and likes will be deleted. This can’t be undone.</p>
        </Modal>
      )}
    </div>
  );
}

function Primer({ row, editable, cards, onSave }: { row: DeckRow; editable: boolean; cards: Map<string, { name: string; image?: string }>; onSave: (t: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(row.primer || '');
  if (edit) return (
    <div className="primer-edit">
      <textarea value={text} onChange={e => setText(e.target.value)} rows={18} maxLength={20000} aria-label="Primer"
        placeholder={'Explain how the deck plays.\n\n## Game plan\nUse **bold**, *italics*, lists, links and [[Card Name]] to link a card.'} />
      <div className="row-end"><span className="muted small">{text.length}/20000</span><button className="btn ghost" onClick={() => { setText(row.primer || ''); setEdit(false); }}>Cancel</button><button className="btn primary" onClick={() => { onSave(text); setEdit(false); }}>Save primer</button></div>
    </div>
  );
  return (
    <div className="primer">
      {row.primer ? <Markdown text={row.primer} cards={cards} /> : <p className="muted">{editable ? 'No primer yet. Write up how the deck plays, matchups and card choices.' : 'No primer for this deck.'}</p>}
      {editable && <button className="btn" onClick={() => setEdit(true)}><Icon name="edit" />{row.primer ? 'Edit primer' : 'Write a primer'}</button>}
    </div>
  );
}
