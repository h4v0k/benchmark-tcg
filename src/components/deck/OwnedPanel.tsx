import { useEffect, useMemo, useState } from 'react';
import { Icon, Spinner } from '../ui';
import { Link } from '../../router';
import { linePrice, money, sum, type Line } from '../../lib/cards';
import { massEntry } from '../../lib/tcgplayer';
import * as col from '../../lib/collection';
import { useAuth } from '../../state';

/** "Show what I own" for the signed-in viewer: which deck lines are covered by my collection, and what to buy for the rest. */
export function OwnedPanel({ lines }: { lines: Line[] }) {
  const { session } = useAuth();
  const [on, setOn] = useState(false);
  const [rows, setRows] = useState<col.OwnRow[] | null>(null);
  const [error, setError] = useState('');
  const main = useMemo(() => lines.filter(l => l.board === 'main'), [lines]);
  const sigKey = col.sigsOf(main).sort().join('|');
  const uid = session?.user.id;
  useEffect(() => {
    let alive = true;
    if (!on || !uid) return;
    setError('');
    col.ownedForSigs(col.sigsOf(main)).then(r => alive && setRows(r)).catch(e => alive && setError(e.message || 'Couldn’t load your collection.'));
    return () => { alive = false; };
  }, [on, uid, sigKey]);
  if (!uid) return null;
  const own = rows ? col.ownership(main, rows) : null;
  const missing = own ? main.filter(l => (own.get(l)?.missing || 0) > 0) : [];
  const buyLines = missing.map(l => ({ ...l, qty: own!.get(l)!.missing }));
  const cost = sum(buyLines, l => (linePrice(l) || 0) * l.qty);
  const needed = sum(buyLines, l => l.qty);
  const me = buyLines.length ? massEntry(buyLines) : null;
  const rest = me && me.missing.length ? massEntry(buyLines.filter(l => me.missing.includes(l.name)).map(l => ({ ...l, card: undefined }))) : null;
  return (
    <section className="panel owned-panel">
      <div className="panel-head">
        <h3>My collection</h3>
        <label className="toggle"><input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} /> Show what I own</label>
      </div>
      {!on && <p className="muted small">See which cards you already have, and buy only the rest. <Link to="/collection">Edit my collection</Link></p>}
      {on && error && <p className="notice bad" role="alert"><Icon name="warn" size={15} />{error}</p>}
      {on && !error && !own && <Spinner />}
      {on && own && (
        <>
          {missing.length === 0 ? (
            <p className="notice ok"><Icon name="check" size={15} />You own every card in this deck.</p>
          ) : (
            <p><b>{needed}</b> card{needed === 1 ? '' : 's'} missing, about <b>{money(cost)}</b>.</p>
          )}
          <ul className="own-list">
            {main.map(l => {
              const o = own.get(l)!;
              return (
                <li key={l.cid + l.board} className={o.missing ? 'miss' : 'have'}>
                  <Icon name={o.missing ? 'x' : 'check'} size={14} />
                  <span className="own-name">{l.qty}× {l.name}</span>
                  <span className="own-note small">
                    {o.missing ? `need ${o.missing} more` : o.exact >= l.qty ? 'owned' : `owned (${o.exact} of this printing)`}
                  </span>
                </li>
              );
            })}
          </ul>
          {me && (
            <>
              <a className="btn primary block" href={me.url} target="_blank" rel="noopener noreferrer"><Icon name="cart" />Buy missing on TCGplayer</a>
              {rest && <p className="panel-foot">{me.missing.length} card{me.missing.length > 1 ? 's' : ''} without an exact product ({me.missing.join(', ')}). <a href={rest.url} target="_blank" rel="noopener noreferrer">Buy by name</a>.</p>}
            </>
          )}
          <p className="panel-foot muted">Any printing of the same card counts as owned.</p>
        </>
      )}
    </section>
  );
}
