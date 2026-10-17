// Deck → Print proxies: tick the cards you need (basic Energy starts unticked), pick how many, and get a PDF of
// text-only proxies at 85% of card size, nine to a Letter page.
import { useMemo, useState } from 'react';
import { Icon, Modal } from '../ui';
import { toast } from '../../state';
import { pokeProxyPdf, proxyOf } from '../../lib/pokeproxy';
import { openPdf } from '../../lib/openpdf';
import { sortLines, type Line } from '../../lib/cards';

type Pick = { key: string; name: string; n: number; on: boolean; line: Line };

export function ProxyModal({ lines, deckName, onClose }: { lines: Line[]; deckName: string; onClose: () => void }) {
  const [picks, setPicks] = useState<Pick[]>(() => {
    const m = new Map<string, Pick>();
    for (const l of sortLines(lines.filter(x => x.board === 'main' && x.qty > 0))) {
      const key = l.card?.id || `${l.name}`;
      const cur = m.get(key);
      if (cur) cur.n += l.qty; else m.set(key, { key, name: l.name, n: l.qty, on: !l.card?.is_basic_energy, line: l });
    }
    return [...m.values()];
  });
  const [busy, setBusy] = useState(false);
  const chosen = useMemo(() => picks.filter(p => p.on && p.n > 0), [picks]);
  const count = chosen.reduce((t, p) => t + p.n, 0);
  const pages = Math.ceil(count / 9);
  const set = (key: string, patch: Partial<Pick>) => setPicks(ps => ps.map(p => p.key === key ? { ...p, ...patch } : p));
  const all = (on: boolean, filter?: (p: Pick) => boolean) => setPicks(ps => ps.map(p => (!filter || filter(p)) ? { ...p, on } : p));

  const make = () => {
    if (!count) return;
    setBusy(true);
    try {
      const cards = chosen.flatMap(p => {
        const c = p.line.card;
        const one = c ? proxyOf(c) : { name: p.name, hp: '', head: [], body: [], foot: [], tag: '' };
        return Array.from({ length: p.n }, () => one);
      });
      openPdf(pokeProxyPdf(cards, `${deckName} - Proxies`), `${deckName} - Proxies.pdf`);
    } catch (e: any) { toast(e.message || 'Couldn’t make the PDF', 'bad'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Print proxies" onClose={onClose} wide footer={<>
      <span className="muted small">{count} card{count === 1 ? '' : 's'} · {pages} page{pages === 1 ? '' : 's'}</span>
      <button className="btn ghost" onClick={onClose}>Close</button>
      <button className="btn primary" onClick={make} disabled={!count || busy}><Icon name="download" />{busy ? 'Making PDF…' : 'Open PDF to print'}</button>
    </>}>
      <p className="muted small">Black and white, 85% of card size, nine to a Letter page with cut lines. Print at 100% (“Actual size”), not “Fit to page”. For playtesting only.</p>
      <div className="row-gap px-tools">
        <button className="btn small" onClick={() => all(true)}>Select all</button>
        <button className="btn small" onClick={() => all(false)}>Select none</button>
        <button className="btn small" onClick={() => all(false, p => !!p.line.card?.is_basic_energy)}>No basic Energy</button>
      </div>
      <ul className="px-list">
        {picks.map(p => (
          <li key={p.key} className={p.on ? '' : 'off'}>
            <label className="px-check"><input type="checkbox" checked={p.on} onChange={e => set(p.key, { on: e.target.checked })} /> <span>{p.name}</span>{p.line.card?.set?.code && <span className="muted small"> {p.line.card.set.code}</span>}</label>
            <span className="px-qty">
              <button className="mini" onClick={() => set(p.key, { n: Math.max(0, p.n - 1), on: true })} aria-label={`Fewer ${p.name}`}>−</button>
              <b>{p.n}</b>
              <button className="mini" onClick={() => set(p.key, { n: Math.min(99, p.n + 1), on: true })} aria-label={`More ${p.name}`}>+</button>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
