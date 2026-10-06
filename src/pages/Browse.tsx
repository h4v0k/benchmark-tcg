import { useEffect, useState } from 'react';
import { DeckGrid } from '../components/DeckTile';
import { Empty, ErrorBox, Icon, Spinner, useDebounced } from '../components/ui';
import { setQuery, useRoute } from '../router';
import * as api from '../lib/api';
import type { DeckRow, Format } from '../lib/types';

const PER = 24;
export function Browse() {
  const { query } = useRoute();
  const format = (query.get('format') || '') as Format | '';
  const sort = (query.get('sort') || 'likes') as api.DeckQuery['sort'];
  const card = query.get('card') || '';
  const tag = query.get('tag') || '';
  const page = Math.max(0, parseInt(query.get('page') || '0', 10) || 0);
  const [q, setQ] = useState(query.get('q') || '');
  const dq = useDebounced(q, 300);
  const [res, setRes] = useState<{ rows: DeckRow[]; count: number | null } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => { if ((query.get('q') || '') !== dq) setQuery({ q: dq || null, page: null }); }, [dq]);
  useEffect(() => {
    let alive = true;
    setRes(null); setError(null);
    api.listDecks({ format, sort, q: query.get('q') || '', card, tag, page, per: PER }).then(r => alive && setRes(r)).catch(e => alive && setError(e));
    return () => { alive = false; };
  }, [format, sort, query.get('q'), card, tag, page]);
  const pages = res?.count ? Math.ceil(res.count / PER) : 1;
  return (
    <div className="wrap page">
      <div className="page-head"><h1>Decks</h1>{res?.count != null && <span className="muted">{res.count} public deck{res.count === 1 ? '' : 's'}</span>}</div>
      <div className="filters">
        <div className="search-field"><Icon name="search" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Deck name" aria-label="Search deck names" /></div>
        <select value={format} onChange={e => setQuery({ format: e.target.value || null, page: null })} aria-label="Format">
          <option value="">All formats</option><option value="standard">Standard</option><option value="expanded">Expanded</option><option value="unlimited">Unlimited</option>
        </select>
        <select value={sort} onChange={e => setQuery({ sort: e.target.value, page: null })} aria-label="Sort">
          <option value="likes">Most liked</option><option value="views">Most viewed</option><option value="updated">Recently updated</option><option value="new">Newest</option><option value="price">Most expensive</option>
        </select>
        {card && <button className="chip" onClick={() => setQuery({ card: null, page: null })}>With {card} <Icon name="x" size={12} /></button>}
        {tag && <button className="chip" onClick={() => setQuery({ tag: null, page: null })}>#{tag} <Icon name="x" size={12} /></button>}
      </div>
      {error ? <ErrorBox error={error} /> : !res ? <Spinner /> : res.rows.length ? (
        <>
          <DeckGrid decks={res.rows} />
          {pages > 1 && (
            <div className="pager">
              <button className="btn" disabled={page === 0} onClick={() => setQuery({ page: page - 1 || null })}>Previous</button>
              <span className="muted">Page {page + 1} of {pages}</span>
              <button className="btn" disabled={page + 1 >= pages} onClick={() => setQuery({ page: page + 1 })}>Next</button>
            </div>
          )}
        </>
      ) : <Empty title="No decks match" icon="search"><p>Try a different name or filter.</p></Empty>}
    </div>
  );
}
