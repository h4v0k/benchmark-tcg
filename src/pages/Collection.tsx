import { useEffect, useMemo, useState } from 'react';
import { CardImg, Empty, ErrorBox, Icon, Modal, Spinner, copyText, useDebounced } from '../components/ui';
import { Link } from '../router';
import { toast, useAuth } from '../state';
import * as api from '../lib/api';
import * as col from '../lib/collection';
import { money, numLabel, printLabel, setCode } from '../lib/cards';
import type { Card } from '../lib/types';

type Item = { card: Card; qty: number };

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function CollectionPage() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const [have, setHave] = useState<Map<string, number> | null>(null);
  const [cards, setCards] = useState<Map<string, Card>>(new Map());
  const [error, setError] = useState<Error | null>(null);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200).trim().toLowerCase();
  const [importing, setImporting] = useState(false);
  const load = () => {
    if (!uid) return;
    setError(null);
    col.myCollection().then(async m => { setCards(await api.cardsById([...m.keys()])); setHave(m); }).catch(setError);
  };
  useEffect(load, [uid]);
  const items: Item[] = useMemo(() => [...(have || [])].filter(([, n]) => n > 0).map(([id, qty]) => ({ card: cards.get(id)!, qty })).filter(i => i.card)
    .sort((a, b) => a.card.name.localeCompare(b.card.name) || (b.card.set?.release_date || '').localeCompare(a.card.set?.release_date || '')), [have, cards]);
  const shown = items.filter(i => !dq || `${i.card.name} ${setCode(i.card)} ${numLabel(i.card)} ${i.card.set?.name || ''}`.toLowerCase().includes(dq));
  if (!session) return <div className="wrap page"><Empty title="Sign in to keep a collection" icon="user"><Link to="/login" className="btn primary">Sign in</Link></Empty></div>;
  if (error) return <div className="wrap page"><ErrorBox error={error} onRetry={load} /></div>;
  if (!have) return <Spinner />;
  const change = async (it: Item, n: number) => {
    try {
      const v = await col.setOwned(uid!, it.card.id, n);
      setHave(h => { const m = new Map(h); if (v) m.set(it.card.id, v); else m.delete(it.card.id); return m; });
    } catch (e: any) { toast(e.message, 'bad'); }
  };
  const total = items.reduce((s, i) => s + i.qty, 0);
  return (
    <div className="wrap page">
      <div className="page-head">
        <h1>My collection</h1>
        <div className="row-gap">
          <button className="btn" onClick={() => setImporting(true)}><Icon name="upload" />Import</button>
          <button className="btn" disabled={!items.length} onClick={async () => toast((await copyText(col.exportText(items))) ? 'List copied' : 'Couldn’t copy', 'ok')}><Icon name="copy" />Copy list</button>
          <button className="btn" disabled={!items.length} onClick={() => download('collection.csv', col.exportCsv(items), 'text/csv')}><Icon name="download" />CSV</button>
        </div>
      </div>
      <p className="muted">{total} card{total === 1 ? '' : 's'} ({items.length} printing{items.length === 1 ? '' : 's'}), worth about <b>{money(col.collectionValue(items))}</b> at TCGplayer market prices. Only you can see this.</p>
      <div className="filters">
        <div className="search-field grow"><Icon name="search" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search your collection" aria-label="Search your collection" /></div>
      </div>
      {!items.length ? (
        <Empty title="Nothing here yet" icon="folder">
          <p>Import a list, or open any card and add it with the “In my collection” buttons.</p>
          <button className="btn primary" onClick={() => setImporting(true)}><Icon name="upload" />Import a list</button>
        </Empty>
      ) : !shown.length ? <Empty title="No matches" icon="search" /> : (
        <ul className="coll-list">
          {shown.map(it => (
            <li key={it.card.id} className="coll-row">
              <Link to={`/cards/${it.card.id}`} className="coll-card" data-preview={it.card.image || undefined}>
                <CardImg src={it.card.image} alt="" />
                <span className="coll-name"><b>{it.card.name}</b><span className="muted small">{it.card.set?.name} · {printLabel(it.card)}{it.card.rarity ? ` · ${it.card.rarity}` : ''}</span></span>
              </Link>
              <span className="coll-price small">{money(col.unitPrice(it.card))}</span>
              <div className="stepper" aria-label={`Copies of ${it.card.name}`}>
                <button className="btn small" onClick={() => change(it, it.qty - 1)} aria-label={`One fewer ${it.card.name}`}><Icon name="minus" size={14} /></button>
                <span className="qty">{it.qty}</span>
                <button className="btn small" onClick={() => change(it, it.qty + 1)} disabled={it.qty >= col.MAX_QTY} aria-label={`One more ${it.card.name}`}><Icon name="plus" size={14} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {importing && <ImportModal uid={uid!} have={have} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
    </div>
  );
}

function ImportModal({ uid, have, onClose, onDone }: { uid: string; have: Map<string, number>; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState<string[]>([]);
  const run = async () => {
    setBusy(true);
    try {
      const r = await col.importText(uid, text, have);
      if (!r.kinds && !r.unknown.length) { toast('No cards found in that text', 'bad'); setBusy(false); return; }
      toast(`Added ${r.added} card${r.added === 1 ? '' : 's'} to your collection`, 'ok');
      if (r.unknown.length) { setUnknown(r.unknown); setBusy(false); if (!r.kinds) return; }
      else return onDone();
    } catch (e: any) { toast(e.message, 'bad'); }
    setBusy(false);
  };
  return (
    <Modal title="Import to my collection" onClose={onClose} footer={<>
      {unknown.length > 0 ? <button className="btn primary" onClick={onDone}>Done</button> : <><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={run} disabled={busy || !text.trim()}>{busy ? 'Adding…' : 'Add to collection'}</button></>}
    </>}>
      <p className="muted small">One card per line, like “4 Boss's Orders PAL 172”. Add the set and number to pick the exact printing. These are added to what you already have.</p>
      <textarea rows={10} value={text} onChange={e => setText(e.target.value)} aria-label="Cards to import" placeholder={"4 Boss's Orders PAL 172\n2 Iono PAL 185"} disabled={unknown.length > 0} />
      {unknown.length > 0 && <div className="notice warn"><Icon name="warn" size={15} /><span>Couldn’t find {unknown.length} line{unknown.length === 1 ? '' : 's'}: {unknown.slice(0, 8).join('; ')}{unknown.length > 8 ? '…' : ''}</span></div>}
    </Modal>
  );
}
