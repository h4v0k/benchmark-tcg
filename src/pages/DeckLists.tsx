// Winning lists for one deck: the strongest finish shown in full, then other strong lists.
// Lists come from major official events (top 32) and online events on Limitless (top 16 of events with 32+ players).
// Ranking weighs field size and event tier (see migration 019), so deep runs at big majors rank above small online wins.
import { useMemo, useState } from 'react';
import { Empty, ErrorBox, Icon, Spinner, Tag, useAsync } from '../components/ui';
import { DeckView } from '../components/deck/Views';
import { CardModal } from '../components/deck/CardModal';
import { ExportModal } from '../components/deck/DeckModals';
import { Link, navigate, setQuery, useRoute } from '../router';
import { useAuth, toast } from '../state';
import * as api from '../lib/api';
import { parseDeckText } from '../lib/decklist';
import { fmtDate, type Line } from '../lib/cards';

const DAYS = ['30', '60', '90'] as const;
const DEFAULT_DAYS = '60';
const TIER: Record<api.ListTier, string> = { worlds: 'Worlds', international: 'International', regional: 'Regional', online: 'Online' };
const TIER_TONE: Record<api.ListTier, 'ok' | 'accent' | 'info' | ''> = { worlds: 'ok', international: 'accent', regional: 'info', online: '' };
const ord = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const hasRecord = (l: api.DeckListRow) => l.wins != null && l.losses != null && l.ties != null;
const record = (l: api.DeckListRow) => hasRecord(l) ? `${l.wins}-${l.losses}-${l.ties}` : '';
const finish = (l: api.DeckListRow) => l.place ? `${ord(l.place)}${l.event_players ? ` of ${l.event_players.toLocaleString()}` : ''}` : '';
// The big number: placing for official events (no per-player record), record for online ones.
const headline = (l: api.DeckListRow) => l.tier === 'online' ? record(l) : (l.place ? ord(l.place) : '');
const details = (l: api.DeckListRow) => l.tier === 'online' ? [finish(l), l.event_name, fmtDate(l.date)] : [l.event_players ? `of ${l.event_players.toLocaleString()}` : '', l.event_name, fmtDate(l.date)];

export function DeckListsPage({ deck }: { deck: string }) {
  const { query } = useRoute();
  const days = (DAYS as readonly string[]).includes(query.get('days') || '') ? query.get('days')! : DEFAULT_DAYS;
  const name = useAsync(() => api.archetypeName(deck), [deck]);
  const lists = useAsync(() => api.deckLists(deck, +days), [deck, days]);
  const raw = query.get('list');
  const picked = raw && /^\d+$/.test(raw) ? `o${raw}` : raw; // links shared before majors were added used plain numbers
  const rows = lists.data || [];
  const currentId = picked && rows.some(r => r.key === picked) ? picked : rows[0]?.key ?? null;
  const title = name.data || deck.replace(/-/g, ' ');
  const back = `/matchups/${encodeURIComponent(deck)}`;

  return (
    <div className="wrap page mu-page">
      <p className="crumbs"><Link to={back}><Icon name="back" size={14} />{title} matchups</Link></p>
      <div className="page-head mu-head"><h1>{title} lists</h1></div>
      <div className="mu-filters">
        <label className="select-inline">
          <span className="sr-only">Period</span>
          <select value={days} onChange={e => setQuery({ days: e.target.value === DEFAULT_DAYS ? null : e.target.value, list: null })}>
            {DAYS.map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </label>
        <span className="muted small">Big tournaments count for more than small online events</span>
      </div>

      {lists.loading ? <Spinner /> : lists.error ? <ErrorBox error={lists.error} onRetry={lists.reload} /> : !rows.length ? (
        <Empty title="No lists yet" icon="list">
          <p>Lists are added as events finish, every few hours. Try a longer period.</p>
          <Link className="btn" to={back}>Back to matchups</Link>
        </Empty>
      ) : (
        <>
          {currentId != null && <ListView id={currentId} best={currentId === rows[0].key} title={title} />}
          <section className="mu-section">
            <h2 className="mu-h">{rows.length > 1 ? 'Other lists' : 'Lists'} <span className="muted small">strongest finish first</span></h2>
            <ul className="mu-list">
              {rows.filter(r => r.key !== currentId).map(r => (
                <li key={r.key} className="mu-item">
                  <button type="button" className="mu-row mu-pick" onClick={() => { setQuery({ list: r.key === rows[0].key ? null : r.key }); window.scrollTo(0, 0); }}>
                    <span className="mu-name"><span className="mu-line"><b>{headline(r)}</b><Tag tone={TIER_TONE[r.tier]}>{TIER[r.tier]}</Tag></span>
                      <span className="muted small">{details(r).filter(Boolean).join(' · ')}</span></span>
                    <Icon name="forward" size={16} className="mu-go" />
                  </button>
                </li>
              ))}
              {rows.length === 1 && <li className="muted small mu-item">This is the only list so far.</li>}
            </ul>
          </section>
        </>
      )}
      <footer className="mu-about">
        <p className="muted small">Ranked by finish, weighted by field size and event: Worlds and Internationals count most, then Regionals, then online events. Lists from <a href="https://limitlesstcg.com" target="_blank" rel="noopener noreferrer">Limitless</a> · updated every 6 hours</p>
      </footer>
    </div>
  );
}

function ListView({ id, best, title }: { id: string; best: boolean; title: string }) {
  const { session, profile } = useAuth();
  const r = useAsync(async () => {
    const l = await api.deckList(id);
    if (!l) return null;
    if (l.cards) {
      // Official lists are already matched to cards.
      const cards = await api.cardsById(l.cards.map(e => e.cid));
      return { l, lines: l.cards.map(e => ({ ...e, card: cards.get(e.cid) })) as Line[], missing: l.missing || [] };
    }
    const parsed = parseDeckText(l.list || '');
    const res = await api.resolveLines(parsed, 'standard', 'exact');
    const cards = await api.cardsById([...res.values()].map(x => x.id).filter(Boolean) as string[]);
    const merged = new Map<string, Line>();
    const missing: string[] = [];
    for (const p of parsed) {
      const cid = res.get(p.i)?.id;
      const card = cid ? cards.get(cid) : undefined;
      if (!cid || !card) { missing.push(p.name); continue; }
      const e = merged.get(cid);
      if (e) e.qty += p.qty;
      else merged.set(cid, { cid, qty: p.qty, board: 'main', name: card.name, cat: card.category, card });
    }
    return { l, lines: [...merged.values()], missing };
  }, [id]);
  const [open, setOpen] = useState<Line | null>(null);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const lines = useMemo(() => r.data?.lines || [], [r.data]);

  if (r.loading) return <section className="mu-section"><Spinner label="Loading the list…" /></section>;
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  if (!r.data) return null;
  const { l, missing } = r.data;
  const label = `${title} (${l.player}, ${[record(l), l.place ? ord(l.place) : ''].filter(Boolean).join(', ')} ${l.event_name})`.slice(0, 80);
  const eventHref = l.tier === 'online' ? `https://play.limitlesstcg.com/tournament/${encodeURIComponent(l.event_id)}/standings` : null;

  const copy = async () => {
    if (!session || !profile) { navigate('/signup'); return; }
    setBusy(true);
    try {
      const d = await api.createDeck({ name: label, format: 'standard', cards: lines.map(({ card, ...e }) => e), archetype: title,
        description: `${[record(l), finish(l)].filter(Boolean).join(', ')} at ${l.event_name} (${fmtDate(l.date)}) by ${l.player}. List from Limitless.`, is_public: false });
      toast('Copied to your decks', 'ok'); navigate(`/decks/${d.id}`);
    } catch (e: any) { toast(e.message, 'bad'); setBusy(false); }
  };

  return (
    <section className="mu-section mu-listview" aria-label="Selected list">
      <p className="mu-kicker">{best ? 'Winningest list' : 'Selected list'}</p>
      <p className="mu-record"><span className="mu-pct">{headline(l)}</span> <Tag tone={TIER_TONE[l.tier]}>{TIER[l.tier]}</Tag>
        <span className="muted small">{[...details(l), `by ${l.player}`].filter(Boolean).join(' · ')}</span></p>
      <div className="deck-actions">
        <button className="btn primary" onClick={copy} disabled={busy || !lines.length}><Icon name="copy" />{busy ? 'Copying…' : 'Copy to my decks'}</button>
        <button className="btn" onClick={() => setExporting(true)} disabled={!lines.length}><Icon name="download" />Export</button>
        {eventHref ? <a className="btn" href={eventHref} target="_blank" rel="noopener noreferrer"><Icon name="external" />Event</a>
          : <Link className="btn" to={`/events/${encodeURIComponent(l.event_id)}`}><Icon name="forward" />Event</Link>}
      </div>
      {!!missing.length && <p className="notice warn"><Icon name="warn" size={15} />Not matched to a card yet: {missing.join(', ')}.</p>}
      <DeckView mode="text" lines={lines} format="standard" group="type" sort="default" editable={false} onOpen={setOpen} onQty={() => {}} />
      {open && <CardModal line={open} format="standard" editable={false} isCover={false} onClose={() => setOpen(null)} />}
      {exporting && <ExportModal lines={lines} name={label} onClose={() => setExporting(false)} />}
    </section>
  );
}
