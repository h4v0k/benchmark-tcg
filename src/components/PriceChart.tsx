import { useEffect, useState } from 'react';
import { priceHistory, type PricePoint } from '../lib/prices';
import { money } from '../lib/cards';

const W = 300, H = 84, PAD = 6;

/** Small line chart of one printing's price. Inline SVG, colours from the theme. */
/** `price` (the card's current main price) lets us explain why cheap cards have no history: only $1+ cards are tracked. */
export function PriceChart({ cardId, days = 90, price }: { cardId: string; days?: number; price?: number | null }) {
  const [pts, setPts] = useState<PricePoint[] | null>(null);
  useEffect(() => {
    let alive = true;
    setPts(null);
    priceHistory(cardId, days).then(p => alive && setPts(p)).catch(() => alive && setPts([]));
    return () => { alive = false; };
  }, [cardId, days]);
  if (!pts) return null;
  if (pts.length < 2) return <p className="muted small price-chart-empty">{price != null && price < 1
    ? 'Price history is kept for cards worth $1 or more.'
    : 'Price history is saved once a day. Check back in a couple of days for a chart.'}</p>;
  const first = pts[0], last = pts[pts.length - 1];
  const pct = first.market ? (last.market - first.market) / first.market * 100 : 0;
  const t0 = Date.parse(first.day), t1 = Date.parse(last.day) || t0 + 1;
  const lo = Math.min(...pts.map(p => p.market)), hi = Math.max(...pts.map(p => p.market));
  const x = (d: string) => PAD + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - 2 * PAD);
  const y = (v: number) => hi === lo ? H / 2 : H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)} ${y(p.market).toFixed(1)}`).join('');
  const label = `Price history, ${first.day} to ${last.day}: ${money(first.market)} to ${money(last.market)}, ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  return (
    <figure className="price-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
        <path d={path} className={`pc-line ${pct < 0 ? 'down' : 'up'}`} fill="none" vectorEffect="non-scaling-stroke" />
        <circle cx={x(last.day)} cy={y(last.market)} r="3" className={`pc-dot ${pct < 0 ? 'down' : 'up'}`} />
      </svg>
      <figcaption className="small">
        <span>{money(first.market)} → <b>{money(last.market)}</b></span>
        <span className={pct < 0 ? 'pc-down' : 'pc-up'}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>
        <span className="muted">since {first.day}</span>
      </figcaption>
    </figure>
  );
}
