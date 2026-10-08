// Matchups: pick an archetype, see what it beats and what beats it.
// Two data sets, kept apart: online tournaments (Limitless Play) and official events (Limitless Labs).
// Built for quick use at a tournament: on a deck's page, "Who are you facing?" comes first.
import { useMemo, useState, type ReactElement } from 'react';
import { Empty, ErrorBox, Icon, Segmented, Spinner, useAsync } from '../components/ui';
import { Link, navigate, setQuery, useRoute } from '../router';
import * as api from '../lib/api';
import { fmtDate } from '../lib/cards';

type Days = '14' | '30' | '60' | '90' | '180';
// Online results are kept for 60 days; official events (only a few a month) for 180.
const PERIODS: Record<api.MatchupSource, { options: Days[]; def: Days }> = {
  online: { options: ['14', '30', '60'], def: '30' },
  official: { options: ['30', '60', '90', '180'], def: '90' },
};
const SOURCES: { value: api.MatchupSource; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'official', label: 'Official' },
];
// Fewer games than this and a percentage can swing wildly, so it's shown as "few games".
const MIN_GAMES: Record<api.MatchupSource, number> = { online: 20, official: 8 };
const GOOD = 55, BAD = 45;
const TOP = 3;        // best and worst matchups shown on a deck's page
const FIRST = 8;      // matchups shown before "Show all"

// Everything is judged on the whole-number percentage people see, so "55%" is always favored.
const whole = (n: number | null) => (n == null ? null : Math.round(n));
const pct = (n: number | null) => (n == null ? '–' : `${whole(n)}%`);
const record = (m: { wins: number; losses: number; ties: number }) => `${m.wins}-${m.losses}-${m.ties}`;
const tone = (n: number | null): 'ok' | 'bad' | '' => { const p = whole(n); return p == null ? '' : p >= GOOD ? 'ok' : p <= BAD ? 'bad' : ''; };
const verdict = (n: number | null) => ({ ok: 'favored', bad: 'unfavored', '': 'even' }[tone(n)]);
const games = (n: number) => `${n.toLocaleString()} game${n === 1 ? '' : 's'}`;

function useFilters() {
  const { query } = useRoute();
  const source: api.MatchupSource = query.get('src') === 'official' ? 'official' : 'online';
  const per = PERIODS[source];
  const days = (per.options as string[]).includes(query.get('days') || '') ? (query.get('days') as Days) : per.def;
  const controls = (
    <div className="mu-filters">
      <Segmented label="Results from" value={source} onChange={v => setQuery({ src: v === 'online' ? null : v, days: null })} options={SOURCES} />
      <label className="select-inline">
        <span className="sr-only">Period</span>
        <select value={days} onChange={e => setQuery({ days: e.target.value === per.def ? null : e.target.value })}>
          {per.options.map(d => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </label>
    </div>
  );
  return { source, days, controls };
}

function SearchBox({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  return (
    <label className="search-field mu-search">
      <span className="sr-only">{label}</span>
      <Icon name="search" />
      <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" />
    </label>
  );
}

// One line of credit stays visible; the method, thresholds and coverage fold away.
function About({ source, cover }: { source: api.MatchupSource; cover?: api.MatchupCoverage }) {
  const min = MIN_GAMES[source];
  return (
    <footer className="mu-about">
      <p className="muted small">
        Data from <a href={source === 'online' ? 'https://play.limitlesstcg.com' : 'https://labs.limitlesstcg.com'} target="_blank" rel="noopener noreferrer">
          {source === 'online' ? 'Limitless online tournaments' : 'Limitless Labs'}</a> · updated every 6 hours
      </p>
      <details>
        <summary className="small">How these numbers work</summary>
        <ul className="muted small">
          <li>Win rate counts a tie as a third of a win, like tournament points. Mirror matches are left out.</li>
          <li>{GOOD}% or better is favored, {BAD}% or worse unfavored.</li>
          <li>Under {min} games is marked “few games”: it can swing a lot, so it’s greyed out and left out of best and worst.</li>
          {source === 'online'
            ? <li>Online: Standard events with 32+ players on Limitless.</li>
            : <li>Official: Regionals, Internationals and Worlds, Masters division.</li>}
          {cover?.events ? (
            <li>Built from {cover.events} events{cover.from && cover.to ? `, ${fmtDate(cover.from)} to ${fmtDate(cover.to)}` : ''}{cover.pending ? `; ${cover.pending} more being added` : ''}
              {!!cover.event_names?.length && <>. Latest: {cover.event_names.slice(0, 3).join(', ')}.</>}</li>
          ) : null}
        </ul>
      </details>
    </footer>
  );
}

export function MatchupsPage({ deck }: { deck?: string }) {
  const { source, days, controls } = useFilters();
  const decks = useAsync(() => api.matchupDecks(source, +days), [source, days]);
  const cover = useAsync(() => api.matchupCoverage(source, +days), [source, days]);
  const [find, setFind] = useState('');
  const min = MIN_GAMES[source];

  if (deck) return <DeckMatchups key={deck} deck={deck} source={source} days={days} decks={decks.data} cover={cover.data} controls={controls} />;

  const q = find.trim().toLowerCase();
  const list = (decks.data || []).filter(d => !q || d.name.toLowerCase().includes(q));

  return (
    <div className="wrap page mu-page">
      <div className="page-head"><h1>Matchups</h1></div>
      <p className="muted lede">See what a deck beats and what beats it, from real tournament results.</p>
      {controls}
      {decks.loading ? <Spinner /> : decks.error ? <ErrorBox error={decks.error} onRetry={decks.reload} /> : !decks.data?.length ? (
        <Empty title="Collecting results" icon="list">
          <p>Match results are being gathered{cover.data?.pending ? ` (${cover.data.pending} events in the queue)` : ''}. New results are added every 6 hours.</p>
        </Empty>
      ) : (
        <>
          <SearchBox value={find} onChange={setFind} label="Find a deck" placeholder="Find a deck" />
          {!list.length ? <p className="muted">No deck matches “{find}”.</p> : (
            <ul className="mu-list mu-cards">
              {list.map(d => {
                const few = d.games < min;
                return (
                  <li key={d.deck}>
                    <Link to={`/matchups/${encodeURIComponent(d.deck)}${location.search}`} className={`mu-row mu-link${few ? ' few' : ''}`}>
                      <span className="mu-name"><b>{d.name}</b><span className="muted small">{games(d.games)}{few ? ' · few games' : ''}</span></span>
                      <span className={`mu-pct ${few ? '' : tone(d.win_pct)}`}>{pct(d.win_pct)}<span className="sr-only"> win rate</span></span>
                      <Icon name="forward" size={16} className="mu-go" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <About source={source} cover={cover.data} />
    </div>
  );
}

function DeckMatchups({ deck, source, days, decks, cover, controls }: { deck: string; source: api.MatchupSource; days: Days; decks?: api.MatchupDeck[]; cover?: api.MatchupCoverage; controls: ReactElement }) {
  const r = useAsync(() => api.matchups(deck, source, +days), [deck, source, days]);
  const [find, setFind] = useState('');
  // "Show all" belongs to one data set: changing source or period starts collapsed again (the search is kept)
  const [openFor, setOpenFor] = useState('');
  const all = openFor === `${source}|${days}`;
  const setAll = (on: boolean) => setOpenFor(on ? `${source}|${days}` : '');
  const me = decks?.find(d => d.deck === deck);
  const name = me?.name || deck.replace(/-/g, ' ');
  const min = MIN_GAMES[source];
  const rows = r.data || [];
  const { best, worst } = useMemo(() => {
    const solid = rows.filter(m => m.games >= min);
    return {
      best: solid.filter(m => tone(m.win_pct) === 'ok').sort((a, b) => (b.win_pct ?? 0) - (a.win_pct ?? 0)).slice(0, TOP),
      worst: solid.filter(m => tone(m.win_pct) === 'bad').sort((a, b) => (a.win_pct ?? 0) - (b.win_pct ?? 0)).slice(0, TOP),
    };
  }, [rows, min]);
  const q = find.trim().toLowerCase();
  const found = q ? rows.filter(m => m.name.toLowerCase().includes(q)) : [];
  // "Other matchups" = everything not already in best/worst, so nothing is shown twice
  const others = rows.filter(m => !best.includes(m) && !worst.includes(m));
  const shown = all ? others : others.slice(0, FIRST);
  const meFew = me ? me.games < min : false;

  return (
    <div className="wrap page mu-page">
      <p className="crumbs"><Link to={`/matchups${location.search}`}><Icon name="back" size={14} />Matchups</Link></p>
      <div className="page-head mu-head">
        <h1>{name}</h1>
        {me && <p className="mu-overall"><span className={`mu-pct ${meFew ? '' : tone(me.win_pct)}`}>{pct(me.win_pct)}</span>
          <span className="muted small">overall · {games(me.games)}{meFew ? ' · few games' : ''}</span></p>}
      </div>
      {controls}
      {r.loading ? <Spinner /> : r.error ? <ErrorBox error={r.error} onRetry={r.reload} /> : !rows.length ? (
        <Empty title="No results for this deck yet" icon="list"><p>Try a longer period or the other results.</p>
          <button className="btn" onClick={() => navigate(`/matchups${location.search}`)}>Pick another deck</button></Empty>
      ) : (
        <>
          <SearchBox value={find} onChange={setFind} label="Who are you facing?" placeholder="Who are you facing?" />
          <p className="sr-only" aria-live="polite">{q ? `${found.length} result${found.length === 1 ? '' : 's'}` : ''}</p>
          {q ? (
            <section className="mu-section">
              {!found.length ? <p className="muted">No results against “{find}” {source === 'online' ? 'online' : 'at official events'} in this period.</p>
                : <ul className="mu-list">{found.map(m => <MuRow key={m.opp} m={m} min={min} bar big />)}</ul>}
            </section>
          ) : (
            <>
              <div className="mu-split">
                <section className="mu-section">
                  <h2 className="mu-h"><span className="mu-dot ok" aria-hidden="true" />Best matchups <span className="muted small">top {TOP}</span></h2>
                  {best.length ? <ul className="mu-list">{best.map(m => <MuRow key={m.opp} m={m} min={min} />)}</ul>
                    : <p className="muted small">None at {GOOD}%+ yet.</p>}
                </section>
                <section className="mu-section">
                  <h2 className="mu-h"><span className="mu-dot bad" aria-hidden="true" />Worst matchups <span className="muted small">top {TOP}</span></h2>
                  {worst.length ? <ul className="mu-list">{worst.map(m => <MuRow key={m.opp} m={m} min={min} />)}</ul>
                    : <p className="muted small">None at {BAD}% or worse yet.</p>}
                </section>
              </div>
              <section className="mu-section">
                <h2 className="mu-h">{best.length || worst.length ? 'Other matchups' : 'All matchups'} <span className="muted small">most played first</span></h2>
                {others.length ? <ul className="mu-list">{shown.map(m => <MuRow key={m.opp} m={m} min={min} note />)}</ul>
                  : <p className="muted small">Every matchup is listed above.</p>}
                {others.length > FIRST && (
                  <button className="btn block mu-more" onClick={() => setAll(!all)} aria-expanded={all}>
                    {all ? 'Show fewer' : `Show all ${others.length}`}
                  </button>
                )}
              </section>
            </>
          )}
        </>
      )}
      <About source={source} cover={cover} />
    </div>
  );
}

function MuRow({ m, min, bar = false, big = false, note = false }: { m: api.Matchup; min: number; bar?: boolean; big?: boolean; note?: boolean }) {
  const few = m.games < min;
  const t = few ? '' : tone(m.win_pct);
  return (
    <li className={`mu-item${few ? ' few' : ''}${big ? ' big' : ''}`}>
      <div className="mu-row">
        <span className="mu-name"><b>{m.name}</b>
          <span className="muted small">{games(m.games)} · {record(m)}{few ? ' · few games' : note && t ? ` · ${verdict(m.win_pct)}` : ''}</span></span>
        {big ? (
          <span><span className={`mu-pct ${t}`}>{pct(m.win_pct)}</span>
            <span className={`mu-verdict ${t}`}>{few ? 'Few games' : verdict(m.win_pct).replace(/^./, c => c.toUpperCase())}</span></span>
        ) : <span className={`mu-pct ${t}`}>{pct(m.win_pct)}<span className="sr-only"> win rate, {few ? 'few games' : verdict(m.win_pct)}</span></span>}
      </div>
      {bar && <div className={`mu-bar ${t}`} aria-hidden="true"><span style={{ width: `${Math.max(2, Math.min(100, m.win_pct ?? 0))}%` }} /><i /></div>}
    </li>
  );
}
