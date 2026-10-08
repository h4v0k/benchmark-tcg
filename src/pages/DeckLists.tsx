// Winning lists for one deck: the best-performing list shown in full, then other strong lists with their records.
// Lists come from online events on Limitless (top 16 of each event with 32+ players).
import { useMemo, useState } from 'react';
import { Empty, ErrorBox, Icon, Spinner, useAsync } from '../components/ui';
import { DeckView } from '../components/deck/Views';
import { CardModal } from '../components/deck/CardModal';
import { ExportModal } from '../components/deck/DeckModals';
import { Link, navigate, setQuery, useRoute } from '../router';
import { useAuth, toast } from '../state';
import * as api from '../lib/api';
import { parseDeckText } from '../lib/decklist';
import { fmtDate, type Line } from '../lib/cards';

const DAYS = ['14', '30', '60'] as const;
const ord = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const record = (l: { wins: number; losses: number; ties: number }) => `${l.wins}-${l.losses}-${l.ties}`;
const finish = (l: api.DeckListRow) => l.place ? `${ord(l.place)}${l.event_players ? ` of ${l.event_players}` : ''}` : '';

export function DeckListsPage({ deck }: { deck: string }) {
  const { query } = useRoute();
  const days = (DAYS as readonly string[]).includes(query.get('days') || '') ? query.get('days')! : '30';
  const name = useAsync(() => api.archetypeName(deck), [deck]);
  const lists = useAsync(() => api.deckLists(deck, +days), [deck, days]);
  const picked = Number(query.get('list')) || null;
  const rows = lists.data || [];
  const currentId = picked && rows.some(r => r.id === picked) ? picked : rows[0]?.id ?? null;
  const title = name.data || deck.replace(/-/g, ' ');
  const back = `/matchups/${encodeURIComponent(deck)}`;

  return (
    <div className="wrap page mu-page">
      <p className="crumbs"><Link to={back}><Icon name="back" size={14} />{title} matchups</Link></p>
      <div className="page-head mu-head"><h1>{title} lists</h1></div>
      <div className="mu-filters">
        <label className="select-inline">
          <span className="sr-only">Period</span>
          <select value={days} onChange={e => setQuery({ days: e.target.value === '30' ? null : e.target.value, list: null })}>
            {DAYS.map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </label>
        <span className="muted small">Top 16 from online events</span>
      </div>

      {lists.loading ? <Spinner /> : lists.error ? <ErrorBox error={lists.error} onRetry={lists.reload} /> : !rows.length ? (
        <Empty title="No lists yet" icon="list">
          <p>Lists are added as online events are collected, every few hours. Try a longer period.</p>
          <Link className="btn" to={back}>Back to matchups</Link>
        </Empty>
      ) : (
        <>
          {currentId != null && <ListView id={currentId} best={currentId === rows[0].id} deck={deck} title={title} />}
          <section className="mu-section">
            <h2 className="mu-h">{rows.length > 1 ? 'Other lists' : 'Lists'} <span className="muted small">best record first</span></h2>
            <ul className="mu-list">
              {rows.filter(r => r.id !== currentId).map(r => (
                <li key={r.id} className="mu-item">
                  <button type="button" className="mu-row mu-pick" onClick={() => { setQuery({ list: r.id === rows[0].id ? null : r.id }); window.scrollTo(0, 0); }}>
                    <span className="mu-name"><b>{record(r)}</b>
                      <span className="muted small">{[finish(r), r.event_name, fmtDate(r.date)].filter(Boolean).join(' · ')}</span></span>
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
        <p className="muted small">Lists and records from <a href="https://play.limitlesstcg.com" target="_blank" rel="noopener noreferrer">Limitless online tournaments</a> · updated every 6 hours</p>
      </footer>
    </div>
  );
}

function ListView({ id, best, deck, title }: { id: number; best: boolean; deck: string; title: string }) {
  const { session, profile } = useAuth();
  const r = useAsync(async () => {
    const l = await api.deckList(id);
    if (!l) return null;
    const parsed = parseDeckText(l.list);
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
  const label = `${title} (${l.player}, ${record(l)}${l.place ? `, ${ord(l.place)}` : ''} ${l.event_name})`.slice(0, 80);

  const copy = async () => {
    if (!session || !profile) { navigate('/signup'); return; }
    setBusy(true);
    try {
      const d = await api.createDeck({ name: label, format: 'standard', cards: lines.map(({ card, ...e }) => e), archetype: title,
        description: `${record(l)}${l.place ? `, ${ord(l.place)}${l.event_players ? ` of ${l.event_players}` : ''}` : ''} at ${l.event_name} (${fmtDate(l.date)}) by ${l.player}. List from Limitless.`, is_public: false });
      toast('Copied to your decks', 'ok'); navigate(`/decks/${d.id}`);
    } catch (e: any) { toast(e.message, 'bad'); setBusy(false); }
  };

  return (
    <section className="mu-section mu-listview" aria-label="Selected list">
      <p className="mu-kicker">{best ? 'Winningest list' : 'Selected list'}</p>
      <p className="mu-record"><span className="mu-pct">{record(l)}</span>
        <span className="muted small">{[finish(l), l.event_name, fmtDate(l.date), `by ${l.player}`].filter(Boolean).join(' · ')}</span></p>
      <div className="deck-actions">
        <button className="btn primary" onClick={copy} disabled={busy || !lines.length}><Icon name="copy" />{busy ? 'Copying…' : 'Copy to my decks'}</button>
        <button className="btn" onClick={() => setExporting(true)} disabled={!lines.length}><Icon name="download" />Export</button>
        <a className="btn" href={`https://play.limitlesstcg.com/tournament/${encodeURIComponent(l.event_id)}/standings`} target="_blank" rel="noopener noreferrer"><Icon name="external" />Event</a>
      </div>
      {!!missing.length && <p className="notice warn"><Icon name="warn" size={15} />Not matched to a card yet: {missing.join(', ')}.</p>}
      <DeckView mode="text" lines={lines} format="standard" group="type" sort="default" editable={false} onOpen={setOpen} onQty={() => {}} />
      {open && <CardModal line={open} format="standard" editable={false} isCover={false} onClose={() => setOpen(null)} />}
      {exporting && <ExportModal lines={lines} name={label} onClose={() => setExporting(false)} />}
    </section>
  );
}
