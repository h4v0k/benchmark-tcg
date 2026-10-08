// Matchups: pick an archetype, see what it beats and what beats it.
// Two data sets, kept apart: online tournaments (Limitless Play) and official events (Limitless Labs).
import { useMemo, useState, type ReactElement } from 'react';
import { Empty, ErrorBox, Icon, Segmented, Spinner, Tag, useAsync } from '../components/ui';
import { Link, navigate, setQuery, useRoute } from '../router';
import * as api from '../lib/api';
import { fmtDate } from '../lib/cards';

type Days = '14' | '30' | '60' | '90';
const SOURCES: { value: api.MatchupSource; label: string }[] = [
  { value: 'online', label: 'Online events' },
  { value: 'official', label: 'Official events' },
];
// Fewer games than this and a percentage can swing wildly, so it's marked as a small sample.
const MIN_GAMES: Record<api.MatchupSource, number> = { online: 20, official: 8 };
const GOOD = 55, BAD = 45;

// Everything is judged on the whole-number percentage people see, so "55%" is always "Favored".
const whole = (n: number | null) => (n == null ? null : Math.round(n));
const pct = (n: number | null) => (n == null ? '–' : `${whole(n)}%`);
const record = (m: { wins: number; losses: number; ties: number }) => `${m.wins}-${m.losses}-${m.ties}`;
const verdict = (n: number | null) => { const p = whole(n); return p == null ? '' : p >= GOOD ? 'Favored' : p <= BAD ? 'Unfavored' : 'Even'; };
const tone = (n: number | null): 'ok' | 'bad' | '' => { const p = whole(n); return p == null ? '' : p >= GOOD ? 'ok' : p <= BAD ? 'bad' : ''; };

function Credit({ source }: { source: api.MatchupSource }) {
  return (
    <p className="muted small credit">
      Match results from <a href={source === 'online' ? 'https://play.limitlesstcg.com' : 'https://labs.limitlesstcg.com'} target="_blank" rel="noopener noreferrer">
        {source === 'online' ? 'Limitless online tournaments' : 'Limitless Labs'}</a>.
      {' '}Win rate counts a tie as a third of a win, like tournament points. Mirror matches are left out.
    </p>
  );
}

export function MatchupsPage({ deck }: { deck?: string }) {
  const { query } = useRoute();
  const source: api.MatchupSource = query.get('src') === 'official' ? 'official' : 'online';
  const days = (['14', '30', '60', '90'].includes(query.get('days') || '') ? query.get('days') : source === 'official' ? '60' : '30') as Days;
  const decks = useAsync(() => api.matchupDecks(source, +days), [source, days]);
  const cover = useAsync(() => api.matchupCoverage(source, +days), [source, days]);
  const [find, setFind] = useState('');

  const list = useMemo(() => {
    const q = find.trim().toLowerCase();
    return (decks.data || []).filter(d => !q || d.name.toLowerCase().includes(q));
  }, [decks.data, find]);
  const min = MIN_GAMES[source];

  const controls = (
    <div className="mu-controls">
      <Segmented label="Data" value={source} onChange={v => setQuery({ src: v === 'online' ? null : v, days: null })} options={SOURCES} />
      <Segmented label="Period" value={days} onChange={v => setQuery({ days: v })}
        options={[{ value: '14', label: '14 days' }, { value: '30', label: '30 days' }, { value: '60', label: '60 days' }, { value: '90', label: '90 days' }]} />
    </div>
  );

  if (deck) return <DeckMatchups deck={deck} source={source} days={days} decks={decks.data} cover={cover.data} controls={controls} />;

  return (
    <div className="wrap page narrow-wide">
      <div className="page-head"><h1>Matchups</h1></div>
      <p className="muted lede">Pick a deck to see what it beats and what beats it, from real tournament results.</p>
      {controls}
      <label className="field mu-find"><span>Find a deck</span>
        <input type="search" value={find} onChange={e => setFind(e.target.value)} placeholder="Dragapult, Gardevoir…" autoComplete="off" />
      </label>
      {decks.loading ? <Spinner /> : decks.error ? <ErrorBox error={decks.error} onRetry={decks.reload} /> : !decks.data?.length ? (
        <Empty title="Collecting results" icon="list">
          <p>Match results are being gathered{cover.data?.pending ? ` (${cover.data.pending} events in the queue)` : ''}. Check back in a little while.</p>
        </Empty>
      ) : !list.length ? <p className="muted">No deck matches “{find}”.</p> : (
        <>
          <p className="muted small">{list.length} decks{cover.data?.events ? ` · from ${cover.data.events} events` : ''}</p>
          <ul className="mu-decks">
            {list.map(d => (
              <li key={d.deck}>
                <Link to={`/matchups/${encodeURIComponent(d.deck)}${location.search}`} className="mu-deck-row">
                  <span className="grow mu-deck-main">
                    <b>{d.name}</b>
                    <span className="muted small">{d.games.toLocaleString()} games · {record(d)}{d.games < min ? ' · small sample' : ''}</span>
                  </span>
                  <span className={`mu-pct ${d.games < min ? '' : tone(d.win_pct)}`}>{pct(d.win_pct)}<span className="sr-only"> win rate</span></span>
                  <Icon name="chevron" size={14} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <Coverage cover={cover.data} />
      <Credit source={source} />
    </div>
  );
}

function DeckMatchups({ deck, source, days, decks, cover, controls }: { deck: string; source: api.MatchupSource; days: Days; decks?: api.MatchupDeck[]; cover?: api.MatchupCoverage; controls: ReactElement }) {
  const r = useAsync(() => api.matchups(deck, source, +days), [deck, source, days]);
  const [find, setFind] = useState('');
  const me = decks?.find(d => d.deck === deck);
  const name = me?.name || deck.replace(/-/g, ' ');
  const min = MIN_GAMES[source];
  const rows = r.data || [];
  const solid = rows.filter(m => m.games >= min);
  const strong = solid.filter(m => tone(m.win_pct) === 'ok').sort((a, b) => (b.win_pct ?? 0) - (a.win_pct ?? 0));
  const weak = solid.filter(m => tone(m.win_pct) === 'bad').sort((a, b) => (a.win_pct ?? 0) - (b.win_pct ?? 0));
  const q = find.trim().toLowerCase();
  const all = rows.filter(m => !q || m.name.toLowerCase().includes(q));

  return (
    <div className="wrap page narrow-wide">
      <p className="crumbs"><Link to={`/matchups${location.search}`}>Matchups</Link></p>
      <div className="page-head"><h1>{name}</h1></div>
      {me && (
        <p className="mu-summary">
          <span className={`mu-pct big ${me.games < min ? '' : tone(me.win_pct)}`}>{pct(me.win_pct)}</span>
          <span className="muted">overall win rate · {me.games.toLocaleString()} games ({record(me)}) across {me.events} events{me.games < min ? ' · small sample' : ''}</span>
        </p>
      )}
      {controls}
      {r.loading ? <Spinner /> : r.error ? <ErrorBox error={r.error} onRetry={r.reload} /> : !rows.length ? (
        <Empty title="No results for this deck yet" icon="list"><p>Try a longer period or the other data set.</p>
          <button className="btn" onClick={() => navigate(`/matchups${location.search}`)}>Pick another deck</button></Empty>
      ) : (
        <>
          <div className="mu-split">
            <section className="panel">
              <div className="panel-head"><h2>Strong against</h2><Tag tone="ok">{GOOD}%+</Tag></div>
              <MuList rows={strong} empty={`No matchup at ${GOOD}% or better with ${min}+ games.`} />
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Weak against</h2><Tag tone="bad">{BAD}% or less</Tag></div>
              <MuList rows={weak} empty={`No matchup at ${BAD}% or worse with ${min}+ games.`} />
            </section>
          </div>

          <section className="panel">
            <div className="panel-head"><h2>Every matchup</h2><span className="muted small">most played first</span></div>
            <label className="field mu-find"><span>Find an opponent</span>
              <input type="search" value={find} onChange={e => setFind(e.target.value)} placeholder="Opponent's deck" autoComplete="off" />
            </label>
            {!all.length ? <p className="muted">No opponent matches “{find}”.</p> : <MuList rows={all} min={min} showBar />}
          </section>
        </>
      )}
      <Coverage cover={cover} />
      <Credit source={source} />
    </div>
  );
}

function MuList({ rows, empty, min = 0, showBar = false }: { rows: api.Matchup[]; empty?: string; min?: number; showBar?: boolean }) {
  if (!rows.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="mu-list">
      {rows.map(m => {
        const small = min > 0 && m.games < min;
        return (
          <li key={m.opp} className={small ? 'small-sample' : ''}>
            <div className="mu-row">
              <span className="grow mu-opp">
                <b>{m.name}</b>
                <span className="muted small">{m.games} game{m.games === 1 ? '' : 's'} · {record(m)}{small ? ' · small sample' : ''}</span>
              </span>
              <span className="mu-right">
                <span className={`mu-pct ${small ? '' : tone(m.win_pct)}`}>{pct(m.win_pct)}</span>
                {!small && <span className={`mu-verdict ${tone(m.win_pct)}`}>{verdict(m.win_pct)}</span>}
              </span>
            </div>
            {showBar && <div className={`mu-bar ${small ? '' : tone(m.win_pct)}`} aria-hidden="true"><span style={{ width: `${Math.max(2, Math.min(100, m.win_pct ?? 0))}%` }} /><i /></div>}
          </li>
        );
      })}
    </ul>
  );
}

function Coverage({ cover }: { cover?: api.MatchupCoverage }) {
  if (!cover || !cover.events) return null;
  return (
    <details className="mu-coverage">
      <summary className="muted small">Built from {cover.events} events{cover.from && cover.to ? `, ${fmtDate(cover.from)} to ${fmtDate(cover.to)}` : ''}{cover.pending ? ` · ${cover.pending} more being added` : ''}</summary>
      {!!cover.event_names?.length && <ul className="muted small">{cover.event_names.map((n, i) => <li key={i}>{n}</li>)}</ul>}
    </details>
  );
}
