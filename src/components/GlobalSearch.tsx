import { useEffect, useRef, useState } from 'react';
import { navigate } from '../router';
import { Icon, useDebounced } from './ui';
import * as api from '../lib/api';
import { img } from '../lib/cards';
import type { SearchHit } from '../lib/types';

// Header search: card names as you type; Enter searches decks.
export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const dq = useDebounced(q, 200);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    if (dq.trim().length < 2) { setHits([]); return; }
    api.searchCards(dq, 'unlimited', '', 8).then(r => alive && setHits(r)).catch(() => {});
    return () => { alive = false; };
  }, [dq]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === '/' && !/input|textarea|select/i.test((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).isContentEditable) { e.preventDefault(); ref.current?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  const go = (to: string) => { setOpen(false); setQ(''); ref.current?.blur(); navigate(to); };
  return (
    <div className="gsearch">
      <Icon name="search" />
      <input ref={ref} value={q} placeholder="Search cards or decks  ( / )" aria-label="Search cards or decks"
        onChange={e => { setQ(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(hits.length, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(-1, a - 1)); }
          else if (e.key === 'Enter') {
            if (active >= 0 && active < hits.length) go(`/cards/${hits[active].card_id}`);
            else if (q.trim()) go(`/decks?q=${encodeURIComponent(q.trim())}`);
          } else if (e.key === 'Escape') { setOpen(false); ref.current?.blur(); }
        }} />
      {open && q.trim().length >= 2 && (
        <div className="gsearch-pop" role="listbox">
          {hits.map((h, i) => (
            <button key={h.card_id} role="option" aria-selected={i === active} className={`gsearch-item ${i === active ? 'active' : ''}`} onMouseDown={e => e.preventDefault()} onClick={() => go(`/cards/${h.card_id}`)}>
              {h.image ? <img src={img(h.image)} alt="" /> : <span className="thumb-ph" />}
              <span><strong>{h.name}</strong><small>{h.sub || h.category} · {h.printings} printing{h.printings > 1 ? 's' : ''}</small></span>
            </button>
          ))}
          <button className={`gsearch-item decks ${active === hits.length ? 'active' : ''}`} onMouseDown={e => e.preventDefault()} onClick={() => go(`/decks?q=${encodeURIComponent(q.trim())}`)}>
            <Icon name="search" /><span>Decks named “{q.trim()}”</span>
          </button>
          {hits.length > 0 && <button className="gsearch-item decks" onMouseDown={e => e.preventDefault()} onClick={() => go(`/decks?card=${encodeURIComponent(hits[0].name)}`)}><Icon name="grid" /><span>Decks with {hits[0].name}</span></button>}
        </div>
      )}
    </div>
  );
}
