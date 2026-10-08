// Tournament results: Regionals, Internationals and Worlds (top 32 with lists, from Limitless).
import { useMemo, useState } from 'react';
import { Empty, ErrorBox, Icon, Segmented, Spinner, Tag, useAsync } from '../components/ui';
import { DeckView, type ViewMode } from '../components/deck/Views';
import { BuyPanel, LegalityPanel, SampleHand, StatsPanel } from '../components/deck/Sidebar';
import { CardModal } from '../components/deck/CardModal';
import { ExportModal } from '../components/deck/DeckModals';
import { Link, navigate } from '../router';
import { useAuth, toast } from '../state';
import * as api from '../lib/api';
import { fmtDate, money, type Line } from '../lib/cards';
import type { Card, Rules } from '../lib/types';

const KIND: Record<string, string> = { regional: 'Regional', international: 'International', worlds: 'Worlds' };
const KIND_TONE: Record<string, 'info' | 'accent' | 'ok'> = { regional: 'info', international: 'accent', worlds: 'ok' };
const ord = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const LimitlessCredit = () => <p className="muted small credit">Results and lists from <a href="https://limitlesstcg.com" target="_blank" rel="noopener noreferrer">Limitless</a>. Prices from TCGplayer.</p>;

export function EventsPage() {
  const ev = useAsync(() => api.tournaments(), []);
  const [days, setDays] = useState<'30' | '60' | '120'>('60');
  const meta = useAsync(() => api.tourneyMeta(+days), [days]);
  const [kind, setKind] = useState<'all' | 'regional' | 'international' | 'worlds'>('all');
  const list = (ev.data || []).filter(t => kind === 'all' || t.kind === kind);
  const maxTop32 = Math.max(1, ...(meta.data || []).map(m => m.top32));
  return (
    <div className="wrap page">
      <div className="page-head"><h1>Tournaments</h1></div>
      <p className="muted lede">Top 32 from Regionals, Internationals and Worlds. Open any list to test it, check prices, or copy it to your decks. To see what each deck beats and loses to, open <Link to="/matchups">Matchups</Link>.</p>

      <section className="panel meta-panel">
        <div className="panel-head"><h2>What’s winning</h2>
          <Segmented label="Period" value={days} onChange={setDays} options={[{ value: '30', label: '30 days' }, { value: '60', label: '60 days' }, { value: '120', label: '120 days' }]} />
        </div>
        {meta.loading ? <Spinner /> : meta.error ? <ErrorBox error={meta.error} onRetry={meta.reload} /> : !meta.data?.length ? <p className="muted">No results in this period yet.</p> : (
          <ol className="meta-list">
            {meta.data.slice(0, 12).map(m => (
              <li key={m.archetype}>
                <div className="meta-row">
                  <b className="meta-name">{m.archetype}</b>
                  <span className="meta-stats">{m.top32} in top 32 · {m.top8} top 8{m.wins ? ` · ${m.wins} win${m.wins > 1 ? 's' : ''}` : ''}</span>
                </div>
                <div className="meta-bar" aria-hidden="true"><span style={{ width: `${Math.max(3, (m.top32 / maxTop32) * 100)}%` }} /></div>
                {m.best_tournament && m.best_place ? <Link className="small" to={`/events/${m.best_tournament}/${m.best_place}`}>Best finish: {ord(m.best_place)} place list →</Link> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="events-head">
        <h2>Events</h2>
        <Segmented label="Type" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'regional', label: 'Regionals' }, { value: 'international', label: 'Internationals' }, { value: 'worlds', label: 'Worlds' }]} />
      </div>
      {ev.loading ? <Spinner /> : ev.error ? <ErrorBox error={ev.error} onRetry={ev.reload} /> : !list.length ? <Empty title="No events yet" icon="list"><p>New results are added automatically each day.</p></Empty> : (
        <ul className="event-list">
          {list.map(t => (
            <li key={t.id}>
              <Link to={`/events/${t.id}`} className="event-row">
                <div className="grow">
                  <div className="event-name">{t.name}</div>
                  <div className="muted small">{fmtDate(t.date)}{t.players ? ` · ${t.players.toLocaleString()} players` : ''}{t.country ? ` · ${t.country}` : ''}</div>
                </div>
                <div className="event-side">
                  <Tag tone={KIND_TONE[t.kind]}>{KIND[t.kind]}</Tag>
                  <span className="muted small">{t.lists ? `${t.lists} lists` : 'Lists coming'}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <LimitlessCredit />
    </div>
  );
}

export function EventPage({ id }: { id: number }) {
  const r = useAsync(() => api.tournament(id), [id]);
  if (r.loading) return <Spinner />;
  if (r.error) return <div className="wrap page"><ErrorBox error={r.error} onRetry={r.reload} /></div>;
  if (!r.data) return <div className="wrap page"><Empty title="Event not found" icon="list"><Link to="/events" className="btn">All tournaments</Link></Empty></div>;
  const { t, decks } = r.data;
  return (
    <div className="wrap page">
      <p className="crumbs"><Link to="/events">Tournaments</Link></p>
      <div className="page-head"><h1>{t.name}</h1></div>
      <p className="muted">{fmtDate(t.date)}{t.players ? ` · ${t.players.toLocaleString()} players` : ''} · <Tag tone={KIND_TONE[t.kind]}>{KIND[t.kind]}</Tag></p>
      {!decks.length ? <Empty title="Standings coming soon" icon="list"><p>They’re added automatically once Limitless posts them.</p></Empty> : (
        <ol className="standings">
          {decks.map(d => {
            const ready = d.card_count != null;
            const body = (
              <>
                <span className="st-place">{ord(d.place)}</span>
                <span className="grow st-main">
                  <b>{d.archetype || 'Unknown deck'}</b>
                  <span className="muted small">{d.player}{d.country ? ` · ${d.country}` : ''}</span>
                </span>
                <span className="st-side">{ready ? <>{money(d.price)}<Icon name="chevron" size={14} /></> : <span className="muted small">{d.list_id ? 'Loading list' : 'List coming'}</span>}</span>
              </>
            );
            return <li key={d.place}>{ready ? <Link to={`/events/${t.id}/${d.place}`} className="st-row">{body}</Link> : <div className="st-row off">{body}</div>}</li>;
          })}
        </ol>
      )}
      <LimitlessCredit />
    </div>
  );
}

export function EventDeckPage({ id, place }: { id: number; place: number }) {
  const { session, profile } = useAuth();
  const r = useAsync(async () => {
    const x = await api.tournamentDeck(id, place);
    if (!x?.d.cards) return x ? { ...x, cards: new Map<string, Card>() } : null;
    return { ...x, cards: await api.cardsById(x.d.cards.map(e => e.cid)) };
  }, [id, place]);
  const rules = useAsync(() => api.rules(), []);
  const [mode, setMode] = useState<ViewMode>('text');
  const [open, setOpen] = useState<Line | null>(null);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const lines: Line[] = useMemo(() => (r.data?.d.cards || []).map(e => ({ ...e, card: r.data!.cards.get(e.cid) })), [r.data]);
  if (r.loading) return <Spinner />;
  if (r.error) return <div className="wrap page"><ErrorBox error={r.error} onRetry={r.reload} /></div>;
  if (!r.data || !r.data.d.cards) return <div className="wrap page"><Empty title="List not available yet" icon="list"><Link to={`/events/${id}`} className="btn">Back to the event</Link></Empty></div>;
  const { t, d } = r.data;
  const title = `${d.archetype || 'Deck'}: ${ord(d.place)} at ${t.name}`;
  const copy = async () => {
    if (!session || !profile) { navigate('/signup'); return; }
    setBusy(true);
    try {
      const deck = await api.createDeck({ name: `${d.archetype || 'Deck'} (${d.player}, ${ord(d.place)} ${t.name})`.slice(0, 80), format: 'standard', cards: d.cards!, archetype: d.archetype, description: `${ord(d.place)} place at ${t.name} (${fmtDate(t.date)}) by ${d.player}. List from Limitless.`, is_public: false });
      toast('Copied to your decks', 'ok'); navigate(`/decks/${deck.id}`);
    } catch (e: any) { toast(e.message, 'bad'); setBusy(false); }
  };
  return (
    <div className="event-deck">
      <div className="deck-hero"><div className="wrap deck-hero-inner"><div className="deck-hero-text">
        <p className="crumbs"><Link to="/events">Tournaments</Link> › <Link to={`/events/${t.id}`}>{t.name}</Link></p>
        <div className="row-gap"><Tag tone="accent">{ord(d.place)} place</Tag><Tag tone={KIND_TONE[t.kind]}>{KIND[t.kind]}</Tag></div>
        <h1 className="deck-title">{d.archetype || 'Deck'}</h1>
        <p className="muted">{d.player}{d.country ? ` (${d.country})` : ''} · {t.name} · {fmtDate(t.date)}</p>
        <div className="deck-actions">
          <button className="btn primary" onClick={copy} disabled={busy}><Icon name="copy" />{busy ? 'Copying…' : 'Copy to my decks'}</button>
          <button className="btn" onClick={() => setExporting(true)}><Icon name="download" />Export</button>
          {d.list_id && <a className="btn" href={`https://limitlesstcg.com/decks/list/${d.list_id}`} target="_blank" rel="noopener noreferrer"><Icon name="link" />Limitless</a>}
        </div>
      </div></div></div>
      <div className="wrap deck-layout">
        <div className="deck-main">
          <div className="deck-toolbar">
            <Segmented label="View" value={mode} onChange={setMode} options={[{ value: 'text', label: <Icon name="list" />, title: 'Text' }, { value: 'visual', label: <Icon name="grid" />, title: 'Visual' }, { value: 'table', label: <Icon name="table" />, title: 'Table' }]} />
          </div>
          {!!d.missing?.length && <p className="notice warn"><Icon name="warn" size={15} />Not matched to a card yet: {d.missing.join(', ')}.</p>}
          <DeckView mode={mode} lines={lines} format="standard" group="type" sort="default" editable={false} onOpen={setOpen} onQty={() => {}} />
        </div>
        <aside className="deck-side">
          <LegalityPanel lines={lines} format="standard" rules={rules.data as Rules | undefined} onHighlight={() => {}} />
          <BuyPanel lines={lines} />
          <StatsPanel lines={lines} />
          <SampleHand lines={lines} />
        </aside>
      </div>
      {open && <CardModal line={open} format="standard" editable={false} isCover={false} onClose={() => setOpen(null)} />}
      {exporting && <ExportModal lines={lines} name={title} onClose={() => setExporting(false)} />}
      <div className="wrap"><LimitlessCredit /></div>
    </div>
  );
}
