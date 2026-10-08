// One archetype's finishes at Regionals, Internationals and Worlds (top 32 with lists, from Limitless),
// best placement first, so the highest-scoring lists are at the top.
import { Empty, ErrorBox, Icon, Spinner, Tag, useAsync } from '../components/ui';
import { Link, setQuery, useRoute } from '../router';
import * as api from '../lib/api';
import { fmtDate, money } from '../lib/cards';

const DAYS = ['30', '60', '120'] as const;
const KIND: Record<string, string> = { regional: 'Regional', international: 'International', worlds: 'Worlds' };
const ord = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

export function ArchetypePage({ name }: { name: string }) {
  const { query } = useRoute();
  const days = (DAYS as readonly string[]).includes(query.get('days') || '') ? query.get('days')! : '60';
  const r = useAsync(() => api.archetypeFinishes(name, +days), [name, days]);
  const rows = r.data || [];
  const wins = rows.filter(x => x.place === 1).length;
  const top8 = rows.filter(x => x.place <= 8).length;
  const events = new Set(rows.map(x => x.tournament_id)).size;

  return (
    <div className="wrap page mu-page">
      <p className="crumbs"><Link to="/events"><Icon name="back" size={14} />Tournaments</Link></p>
      <div className="page-head mu-head"><h1>{name}</h1></div>
      <div className="mu-filters">
        <label className="select-inline">
          <span className="sr-only">Period</span>
          <select value={days} onChange={e => setQuery({ days: e.target.value === '60' ? null : e.target.value })}>
            {DAYS.map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </label>
        {!!rows.length && <span className="muted small">{rows.length} top 32 finish{rows.length === 1 ? '' : 'es'} · {top8} top 8{wins ? ` · ${wins} win${wins === 1 ? '' : 's'}` : ''} · {events} event{events === 1 ? '' : 's'}</span>}
      </div>
      {r.loading ? <Spinner /> : r.error ? <ErrorBox error={r.error} onRetry={r.reload} /> : !rows.length ? (
        <Empty title="No top 32 finishes in this period" icon="list"><p>Try a longer period.</p><Link className="btn" to="/events">All tournaments</Link></Empty>
      ) : (
        <ul className="mu-list mu-cards">
          {rows.map(x => {
            const ready = x.card_count != null;
            const body = (
              <>
                <span className="mu-place">{ord(x.place)}</span>
                <span className="mu-name"><b>{x.tournaments.name}</b>
                  <span className="muted small">{[fmtDate(x.tournaments.date), x.player + (x.country ? ` (${x.country})` : ''), x.tournaments.players ? `${x.tournaments.players.toLocaleString()} players` : ''].filter(Boolean).join(' · ')}</span></span>
                <span className="mu-side">
                  <Tag tone={x.place === 1 ? 'ok' : x.place <= 8 ? 'accent' : ''}>{KIND[x.tournaments.kind] || 'Event'}</Tag>
                  {ready ? <span className="muted small">{money(x.price)}</span> : <span className="muted small">{x.list_id ? 'Loading list' : 'List coming'}</span>}
                </span>
                {ready && <Icon name="forward" size={16} className="mu-go" />}
              </>
            );
            return <li key={`${x.tournament_id}-${x.place}`}>{ready
              ? <Link to={`/events/${x.tournament_id}/${x.place}`} className="mu-row mu-link">{body}</Link>
              : <div className="mu-row mu-link off">{body}</div>}</li>;
          })}
        </ul>
      )}
      <footer className="mu-about"><p className="muted small">Top 32 results and lists from <a href="https://limitlesstcg.com" target="_blank" rel="noopener noreferrer">Limitless</a>. Prices from TCGplayer.</p></footer>
    </div>
  );
}
