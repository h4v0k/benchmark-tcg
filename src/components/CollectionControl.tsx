import { useEffect, useState } from 'react';
import { Icon } from './ui';
import * as col from '../lib/collection';
import { toast, useAuth } from '../state';
import { Link } from '../router';

/** "In my collection: [-] n [+]" for one printing. Shows nothing when signed out. */
export function OwnControl({ cardId }: { cardId: string }) {
  const { session } = useAuth();
  const [qty, setQty] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = session?.user.id;
  useEffect(() => {
    let alive = true;
    setQty(null);
    if (uid) col.ownedQty(cardId).then(q => alive && setQty(q)).catch(() => alive && setQty(0));
    return () => { alive = false; };
  }, [cardId, uid]);
  if (!uid) return null;
  const change = async (n: number) => {
    if (busy || qty == null) return;
    setBusy(true);
    try { setQty(await col.setOwned(uid, cardId, n)); } catch (e: any) { toast(e.message, 'bad'); }
    setBusy(false);
  };
  return (
    <div className="own-ctl">
      <span>In my collection</span>
      <div className="stepper" aria-label="Copies in my collection">
        <button className="btn small" onClick={() => change((qty || 0) - 1)} disabled={busy || !qty} aria-label="One fewer"><Icon name="minus" size={14} /></button>
        <span className="qty" aria-live="polite">{qty ?? '–'}</span>
        <button className="btn small" onClick={() => change((qty || 0) + 1)} disabled={busy || qty == null || qty >= col.MAX_QTY} aria-label="One more"><Icon name="plus" size={14} /></button>
      </div>
      <Link to="/collection" className="muted small">My collection</Link>
    </div>
  );
}
