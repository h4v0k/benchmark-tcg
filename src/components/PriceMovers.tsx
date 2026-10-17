import { useEffect, useState } from 'react';
import { CardImg, Segmented } from './ui';
import { Link } from '../router';
import { priceMovers, type Movers } from '../lib/prices';
import { money } from '../lib/cards';
import { TCGP_IMG } from '../lib/cards';

export function PriceMovers() {
  const [side, setSide] = useState<'risers' | 'fallers'>('risers');
  const [days, setDays] = useState<'7' | '30'>('7');
  const [std, setStd] = useState(true);
  const [data, setData] = useState<Movers | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setData(null); setFailed(false);
    priceMovers(+days, std).then(d => alive && setData(d)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [days, std]);
  if (failed) return null;
  const rows = data?.[side] || [];
  return (
    <section className="movers" aria-label="Price movers">
      <div className="movers-head">
        <h2>Price movers</h2>
        <Segmented label="Direction" value={side} onChange={setSide} options={[{ value: 'risers', label: 'Risers' }, { value: 'fallers', label: 'Fallers' }]} />
        <Segmented label="Period" value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} />
        <label className="movers-std"><input type="checkbox" checked={std} onChange={e => setStd(e.target.checked)} /> Standard only</label>
      </div>
      {!data ? <p className="muted small">Loading…</p> : !rows.length ? (
        <p className="muted small">{data.base_day ? 'No big moves in this period.' : 'Not enough price history yet. Movers show up once we have this many days of prices.'}</p>
      ) : (
        <ol className="mover-list">
          {rows.map(m => (
            <li key={m.card_id}>
              <Link to={`/cards/${m.card_id}`} className="mover" data-preview={m.image || (m.tcgp_product_id ? TCGP_IMG + m.tcgp_product_id : undefined)}>
                <CardImg src={m.image || (m.tcgp_product_id ? TCGP_IMG + m.tcgp_product_id : '')} alt="" />
                <span className="mover-name"><b>{m.name}</b><span className="muted small">{m.set_code} {m.local_id}</span></span>
                <span className="mover-price small">{money(m.from_price)} → {money(m.to_price)}</span>
                <span className={`mover-pct ${m.pct < 0 ? 'pc-down' : 'pc-up'}`}>{m.pct > 0 ? '+' : ''}{m.pct}%</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">Cards priced $1 or more at both ends. Daily TCGplayer market prices.</p>
    </section>
  );
}
