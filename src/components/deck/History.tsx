import { useState } from 'react';
import { Empty, ErrorBox, Modal, Spinner, useAsync } from '../ui';
import { diffCards, listVersions, restoreVersion, superOf, type DeckVersion, type DiffRow } from '../../lib/history';
import type { DeckEntry } from '../../lib/types';
import { toast } from '../../state';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function Diff({ rows }: { rows: DiffRow[] }) {
  if (!rows.length) return null;
  return (
    <>
      {['Pokémon', 'Trainer', 'Energy', 'Other'].map(g => {
        const list = rows.filter(r => superOf(r.cat) === g);
        if (!list.length) return null;
        return (
          <div key={g} className="hist-group">
            <h4>{g}</h4>
            <ul>{list.map(r => {
              const kind = r.from === 0 ? 'add' : r.to === 0 ? 'rem' : 'chg';
              return <li key={r.name} className={`hist-${kind}`}>
                <b aria-hidden="true">{kind === 'add' ? '+' : kind === 'rem' ? '−' : '±'}</b>
                <span className="hist-name">{r.name}</span>
                <span className="muted">{kind === 'add' ? `${r.to} added` : kind === 'rem' ? `${r.from} removed` : `${r.from} → ${r.to}`}</span>
              </li>;
            })}</ul>
          </div>
        );
      })}
    </>
  );
}

export function HistoryModal({ deckId, current, beforeRestore, onRestored, onClose }: {
  deckId: string; current: DeckEntry[]; beforeRestore: () => Promise<void>; onRestored: () => Promise<void> | void; onClose: () => void;
}) {
  const { data, error, loading, reload } = useAsync(() => listVersions(deckId), [deckId]);
  const [sel, setSel] = useState<DeckVersion | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const diff = sel ? diffCards(sel.cards, current) : null;
  const same = !!diff && !diff.main.length && !diff.maybe.length;
  const restore = async () => {
    if (!sel) return;
    setBusy(true);
    try { await beforeRestore(); await restoreVersion(sel.id); await onRestored(); toast('Restored. The list from before is saved in History.', 'ok'); onClose(); }
    catch (e: any) { toast(`Couldn’t restore: ${e.message}`, 'bad'); setBusy(false); setConfirm(false); }
  };
  return (
    <Modal title={sel ? 'Compare with current' : 'Deck history'} wide onClose={onClose}
      footer={sel ? (
        confirm
          ? <><span className="muted small">Replace the current list with this one?</span><button className="btn ghost" onClick={() => setConfirm(false)} disabled={busy}>Cancel</button><button className="btn primary" onClick={restore} disabled={busy}>{busy ? 'Restoring…' : 'Yes, restore'}</button></>
          : <><button className="btn ghost" onClick={() => setSel(null)}>Back</button><button className="btn primary" onClick={() => setConfirm(true)} disabled={same}>Restore this version</button></>
      ) : undefined}>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading || !data ? <Spinner /> : sel && diff ? (
        <div className="hist-diff">
          <p className="muted small">{when(sel.created_at)} · {sel.card_count} cards. Restoring changes the current list like this:</p>
          {same ? <p>This version is the same as the current list.</p> : (
            <>
              <Diff rows={diff.main} />
              {diff.maybe.length > 0 && <><h3 className="small">Maybe board</h3><Diff rows={diff.maybe} /></>}
            </>
          )}
          <p className="muted small">"Added" and "removed" are from the point of view of restoring: a card shown as added is in this version but not in the current list.</p>
        </div>
      ) : !data.length ? (
        <Empty title="No earlier versions yet" icon="info"><p className="muted">When you change the cards in this deck, the list from before is saved here.</p></Empty>
      ) : (
        <ul className="hist-list">
          {data.map(v => <li key={v.id}><button className="hist-item" onClick={() => { setSel(v); setConfirm(false); }}><span>{when(v.created_at)}</span><span className="muted">{v.card_count} cards</span></button></li>)}
        </ul>
      )}
    </Modal>
  );
}
