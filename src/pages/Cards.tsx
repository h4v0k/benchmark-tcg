import { useEffect, useState } from 'react';
import { CardImg, Empty, ErrorBox, Icon, Spinner, Tag, useAsync, useDebounced } from '../components/ui';
import { CardText, LegalityBadges } from '../components/deck/CardModal';
import { Link, setQuery, useRoute } from '../router';
import * as api from '../lib/api';
import { FINISH_LABEL, fmtDate, legalIn, money, printLabel } from '../lib/cards';
import { buyUrl } from '../lib/tcgplayer';
import type { Card, Finish, Format, SearchHit } from '../lib/types';

export function CardsPage() {
  const { query } = useRoute();
  const [q, setQ] = useState(query.get('q') || '');
  const fmt = (query.get('format') || 'unlimited') as Format;
  const cat = query.get('cat') || '';
  const dq = useDebounced(q, 250);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => { setQuery({ q: dq || null }); }, [dq]);
  useEffect(() => {
    let alive = true;
    if (dq.trim().length < 2) { setHits(null); return; }
    setError(null);
    api.searchCards(dq, fmt, cat, 60).then(h => alive && setHits(h)).catch(e => alive && setError(e));
    return () => { alive = false; };
  }, [dq, fmt, cat]);
  return (
    <div className="wrap page">
      <div className="page-head"><h1>Cards</h1></div>
      <div className="filters">
        <div className="search-field grow"><Icon name="search" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Card name, e.g. Iono or Charizard ex" aria-label="Card name" autoFocus /></div>
        <select value={fmt} onChange={e => setQuery({ format: e.target.value === 'unlimited' ? null : e.target.value })} aria-label="Legal in">
          <option value="unlimited">Any format</option><option value="standard">Standard legal</option><option value="expanded">Expanded legal</option>
        </select>
        <select value={cat} onChange={e => setQuery({ cat: e.target.value || null })} aria-label="Card type">
          <option value="">All types</option><option value="Pokemon">Pokémon</option><option value="Trainer">Trainer</option><option value="Energy">Energy</option>
        </select>
      </div>
      {error ? <ErrorBox error={error} /> : hits === null ? <p className="muted">Type at least 2 letters to search every English card.</p> : !hits.length ? <Empty title="No cards found" icon="search" /> : (
        <div className="card-grid">
          {hits.map(h => (
            <Link key={h.card_id} to={`/cards/${h.card_id}`} className="card-tile" data-preview={h.image || undefined}>
              <CardImg src={h.image} alt={h.name} />
              <span className="card-tile-name">{h.name}</span>
              <span className="muted small">{h.printings} printing{h.printings > 1 ? 's' : ''}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function CardPage({ id }: { id: string }) {
  const r = useAsync(async () => {
    const m = await api.cardsById([id]);
    const c = m.get(id) || null;
    const prints = c ? await api.printingsOf(c.name) : [];
    return { c, prints };
  }, [id]);
  const [finish, setFinish] = useState<Finish | ''>('');
  if (r.loading) return <Spinner />;
  if (r.error) return <div className="wrap page"><ErrorBox error={r.error} onRetry={r.reload} /></div>;
  const c = r.data?.c;
  if (!c) return <div className="wrap page"><Empty title="Card not found" icon="warn" /></div>;
  const finishes = [...new Set([...(c.variants || []), ...Object.keys(c.prices || {})])] as Finish[];
  const f = (finish || (finishes.includes('normal') ? 'normal' : finishes[0]) || 'normal') as Finish;
  return (
    <div className="wrap page">
      <div className="card-page">
        <div className="card-page-art"><CardImg src={c.image} alt={c.name} q="high" /></div>
        <div className="card-page-info">
          <h1>{c.name}</h1>
          <p className="muted">{c.set?.name} · {printLabel(c)} · released {fmtDate(c.set?.release_date)}</p>
          <LegalityBadges c={c} />
          {c.rotating && <p className="notice warn"><Icon name="warn" size={15} />Leaves Standard {c.rotating_on ? `on ${fmtDate(c.rotating_on)}` : 'at the next rotation'}.</p>}
          {c.standard_from && !c.legal_standard && <p className="notice info"><Icon name="info" size={15} />Becomes Standard legal on {fmtDate(c.standard_from)}.</p>}
          <CardText c={c} />
          <div className="buy-box">
            <div className="finish-prices">
              {finishes.map(k => (
                <button key={k} className={`finish ${k === f ? 'on' : ''}`} onClick={() => setFinish(k)}>
                  <span>{FINISH_LABEL[k] || k}</span><b>{money(c.prices?.[k] ?? null)}</b>
                </button>
              ))}
            </div>
            <a className="btn primary big" href={buyUrl(c, f)} target="_blank" rel="noopener noreferrer"><Icon name="cart" />Buy {FINISH_LABEL[f] || ''} on TCGplayer</a>
          </div>
          <p><Link to={`/decks?card=${encodeURIComponent(c.name)}`} className="btn">Decks with {c.name}</Link></p>
        </div>
      </div>
      <h2 className="section-title">All printings</h2>
      <div className="print-table">
        <table>
          <thead><tr><th>Set</th><th>#</th><th>Rarity</th><th>Mark</th><th>Standard</th><th>Expanded</th><th className="num">Price</th><th /></tr></thead>
          <tbody>
            {(r.data?.prints || []).map(p => (
              <tr key={p.id} className={p.id === c.id ? 'current' : ''} data-preview={p.image || undefined}>
                <td><Link to={`/cards/${p.id}`}>{p.set?.name}</Link></td>
                <td>{printLabel(p)}</td>
                <td>{p.rarity || '—'}</td>
                <td>{p.reg_mark || '—'}</td>
                <td>{legalIn(p, 'standard') ? <Tag tone={p.rotating ? 'warn' : 'ok'}>{p.rotating ? 'Rotating' : 'Legal'}</Tag> : <Tag tone="bad">{p.banned_in?.includes('standard') ? 'Banned' : 'No'}</Tag>}</td>
                <td>{legalIn(p, 'expanded') ? <Tag tone="ok">Legal</Tag> : <Tag tone="bad">{p.banned_in?.includes('expanded') ? 'Banned' : 'No'}</Tag>}</td>
                <td className="num">{money(p.prices?.normal ?? p.prices?.holo ?? p.prices?.reverse ?? null)}</td>
                <td><a href={buyUrl(p)} target="_blank" rel="noopener noreferrer" className="link-btn"><Icon name="cart" size={13} />Buy</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export type { Card };
