import { useEffect, useRef, useState } from 'react';
import { Icon, useDebounced } from '../ui';
import * as api from '../../lib/api';
import { img } from '../../lib/cards';
import { cleanName, parseDeckText } from '../../lib/decklist';
import type { Board, Format, SearchHit } from '../../lib/types';
import { toast } from '../../state';

// "4 Iono", "Iono x2", "2 Iono PAL 185" or just "Iono". Enter adds the highlighted card.
function parseEntry(raw: string): { qty: number; name: string; code: string; num: string } {
  const p = parseDeckText(raw)[0];
  if (p) return { qty: p.qty, name: p.name, code: p.code, num: p.num };
  return { qty: 1, name: cleanName(raw), code: '', num: '' };
}

export function AddCard({ format, board, onAdd }: { format: Format; board: Board; onAdd: (cardId: string, qty: number, board: Board) => Promise<void> | void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [onlyLegal, setOnlyLegal] = useState(true);
  const entry = parseEntry(q);
  const dq = useDebounced(entry.name, 180);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    if (dq.length < 2) { setHits([]); return; }
    api.searchCards(dq, onlyLegal ? format : 'unlimited', '', 12).then(r => { if (alive) { setHits(r); setActive(0); } }).catch(() => {});
    return () => { alive = false; };
  }, [dq, format, onlyLegal]);

  const add = async (hit?: SearchHit) => {
    let id = hit?.card_id;
    if (!hit && entry.code && entry.num) {
      const r = await api.resolveLines([{ i: 0, qty: entry.qty, name: entry.name, code: entry.code, num: entry.num, board, raw: q }], format);
      id = r.get(0)?.id || undefined;
    }
    if (!id && hits[active]) id = hits[active].card_id;
    if (!id) { toast(`No card named “${entry.name}”`, 'bad'); return; }
    await onAdd(id, Math.max(1, Math.min(60, entry.qty)), board);
    setQ(''); setHits([]); ref.current?.focus();
  };

  return (
    <div className="add-card">
      <div className="add-input">
        <Icon name="plus" />
        <input ref={ref} value={q} placeholder={`Add to ${board === 'main' ? 'deck' : 'considering'}: “4 Iono” or “2 Iono PAL 185”`} aria-label="Add a card"
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(hits.length - 1, a + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); add(entry.code && entry.num ? undefined : hits[active]); }
            else if (e.key === 'Escape') setOpen(false);
          }} />
        {format !== 'unlimited' && (
          <label className="legal-toggle" title="Only show cards legal in this deck's format">
            <input type="checkbox" checked={onlyLegal} onChange={e => setOnlyLegal(e.target.checked)} /> Legal only
          </label>
        )}
      </div>
      {open && hits.length > 0 && (
        <div className="add-pop" role="listbox">
          {hits.map((h, i) => (
            <button key={h.card_id} role="option" aria-selected={i === active} className={`add-item ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => add(h)} data-preview={h.image || undefined}>
              {h.image ? <img src={img(h.image)} alt="" /> : <span className="thumb-ph" />}
              <span className="add-item-text"><strong>{h.name}</strong><small>{h.sub || h.category}{h.printings > 1 ? ` · ${h.printings} printings` : ''}{!h.legal && format !== 'unlimited' ? ' · not legal' : ''}</small></span>
              <span className="add-qty">+{entry.qty}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
