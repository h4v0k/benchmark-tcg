import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CardImg, Icon } from '../ui';
import type { Line } from '../../lib/cards';

/** Solo practice table. Everything lives in React state; nothing is saved or sent. */
type Inst = { id: number; line: Line };
type Slot = { cards: Inst[]; dmg: number }; // cards[0] is the Pokémon shown; the rest sit under it
type G = { deck: Inst[]; hand: Inst[]; prizes: Inst[]; discard: Inst[]; lost: Inst[]; stadium: Inst[]; slots: Slot[]; turn: number; mulls: number; note: string };
type Dlg = { k: 'card'; id: number } | { k: 'slot'; i: number } | { k: 'search' };

const isBasic = (l: Line) => l.card?.category === 'Pokemon' && /^basic$/i.test(l.card.stage);
const isMon = (l: Line) => (l.card?.category || l.cat) === 'Pokemon';
const shuffle = <T,>(a: T[]) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const slotName = (i: number) => (i === 0 ? 'Active' : `Bench ${i}`);

function deal(lines: Line[]): G {
  let n = 0;
  const all: Inst[] = lines.filter(l => l.board === 'main').flatMap(l => Array.from({ length: l.qty }, () => ({ id: n++, line: l })));
  const canMull = all.some(c => isBasic(c.line));
  let deck = shuffle(all), mulls = 0, note = '';
  while (canMull && !deck.slice(0, 7).some(c => isBasic(c.line)) && mulls < 30) {
    note = `Mulligan ${mulls + 1}. Hand shown: ${deck.slice(0, 7).map(c => c.line.name).join(', ')}.`;
    mulls++; deck = shuffle(all);
  }
  if (!canMull && all.length) note = 'This deck has no Basic Pokémon with card data, so no mulligans were checked.';
  const hand = deck.slice(0, 7), prizes = deck.slice(7, 13);
  return { deck: deck.slice(13), hand, prizes, discard: [], lost: [], stadium: [], slots: Array.from({ length: 6 }, () => ({ cards: [], dmg: 0 })), turn: 1, mulls, note };
}
const clone = (g: G): G => ({ ...g, deck: [...g.deck], hand: [...g.hand], prizes: [...g.prizes], discard: [...g.discard], lost: [...g.lost], stadium: [...g.stadium], slots: g.slots.map(s => ({ ...s, cards: [...s.cards] })) });
const LISTS = ['deck', 'hand', 'prizes', 'discard', 'lost', 'stadium'] as const;
function find(g: G, id: number): Inst | undefined {
  for (const z of LISTS) { const c = g[z].find(x => x.id === id); if (c) return c; }
  for (const s of g.slots) { const c = s.cards.find(x => x.id === id); if (c) return c; }
}
/** Take a card out of whatever zone holds it. Call on a clone. */
function take(g: G, id: number): Inst | undefined {
  for (const z of LISTS) { const i = g[z].findIndex(x => x.id === id); if (i >= 0) return g[z].splice(i, 1)[0]; }
  for (const s of g.slots) { const i = s.cards.findIndex(x => x.id === id); if (i >= 0) { const c = s.cards.splice(i, 1)[0]; if (!s.cards.length) s.dmg = 0; return c; } }
}
function zoneOf(g: G, id: number): string {
  for (const z of LISTS) if (g[z].some(x => x.id === id)) return z;
  const i = g.slots.findIndex(s => s.cards.some(x => x.id === id));
  return i >= 0 ? `s${i}` : '';
}
function put(g: G, c: Inst, to: string) {
  if (to === 'hand' || to === 'discard' || to === 'lost') g[to].push(c);
  else if (to === 'stadium') { g.discard.push(...g.stadium); g.stadium = [c]; }
  else if (to === 'top') g.deck.unshift(c);
  else if (to === 'bottom') g.deck.push(c);
  else if (to === 'shuffle') g.deck = shuffle([...g.deck, c]);
  else if (to[0] === 's') g.slots[+to.slice(1)].cards.push(c); // attach under
  else if (to[0] === 'e') g.slots[+to.slice(1)].cards.unshift(c); // evolve on top
}

function Card({ c, onClick, label }: { c: Inst; onClick: () => void; label?: string }) {
  return (
  <button type="button" className="pt-card" onClick={onClick} aria-label={label || c.line.name} title={c.line.name}><CardImg src={c.line.card?.image || ''} alt={c.line.name} /></button>
  );
}
function Back({ onClick, label, children }: { onClick?: () => void; label: string; children?: ReactNode }) {
  return (
  <button type="button" className="pt-card pt-back" onClick={onClick} aria-label={label} disabled={!onClick}>{children}</button>
  );
}
function Zone({ title, count, children, cls = '' }: { title: string; count?: number; children: ReactNode; cls?: string }) {
  return (
  <section className={`pt-zone ${cls}`}><h3>{title}{count != null && <span className="muted"> {count}</span>}</h3><div className="pt-row">{children}</div></section>
  );
}

export function Playtest({ lines, onClose }: { lines: Line[]; onClose: () => void }) {
  const [g, setG] = useState<G>(() => deal(lines));
  const [dlg, setDlg] = useState<Dlg[]>([]);
  const [n, setN] = useState(2);
  const upd = (f: (g: G) => void) => setG(p => { const c = clone(p); f(c); return c; });
  const top = dlg[dlg.length - 1];

  const stateRef = useRef({ dlg, onClose }); stateRef.current = { dlg, onClose };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); e.preventDefault();
      const s = stateRef.current;
      if (s.dlg.length) setDlg(d => d.slice(0, -1)); else s.onClose();
    };
    document.addEventListener('keydown', key, true);
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', key, true); document.body.classList.remove('modal-open'); };
  }, []);

  const draw = (k: number) => upd(c => { c.hand.push(...c.deck.splice(0, Math.max(0, k))); });
  const move = (id: number, to: string) => { upd(c => { const x = take(c, id); if (x) put(c, x, to); }); setDlg(d => d.filter(x => x.k !== 'card')); };
  const dmg = (i: number, d: number) => upd(c => { const s = c.slots[i]; if (s.cards.length) s.dmg = Math.max(0, s.dmg + d); });
  const nextTurn = () => upd(c => { c.turn++; c.hand.push(...c.deck.splice(0, 1)); });
  const swap = (i: number) => upd(c => { [c.slots[0], c.slots[i]] = [c.slots[i], c.slots[0]]; });
  const discardAll = (i: number) => { upd(c => { c.discard.push(...c.slots[i].cards); c.slots[i] = { cards: [], dmg: 0 }; }); setDlg([]); };
  const pick = (c: Inst) => setDlg(d => [...d, { k: 'card', id: c.id }]);

  const slotView = (i: number) => {
    const s = g.slots[i], c = s.cards[0];
    return (
      <div className="pt-slot">
        {c ? (
          <div className="pt-slot-main">
            <Card c={c} onClick={() => setDlg([{ k: 'slot', i }])} label={`${slotName(i)}: ${c.line.name}`} />
            {s.cards.length > 1 && <span className="pt-badge">×{s.cards.length}</span>}
            {s.dmg > 0 && <span className="pt-dmg">{s.dmg}</span>}
          </div>
        ) : <div className="pt-empty">{slotName(i)}</div>}
        <div className="pt-dmg-btns">
          <button className="btn small" onClick={() => dmg(i, -10)} disabled={!c || !s.dmg} aria-label={`${slotName(i)} remove 10 damage`}>−10</button>
          <button className="btn small" onClick={() => dmg(i, 10)} disabled={!c} aria-label={`${slotName(i)} add 10 damage`}>+10</button>
        </div>
      </div>
    );
  };

  const menu = () => {
    if (!top) return null;
    if (top.k === 'card') {
      const c = find(g, top.id);
      if (!c) return null;
      const from = zoneOf(g, c.id), mon = isMon(c.line);
      const dests: [string, string][] = [];
      if (from !== 'hand') dests.push(['hand', 'To hand']);
      for (let i = 0; i < 6; i++) {
        const has = g.slots[i].cards.length > 0;
        if (from === `s${i}`) continue;
        if (!has) { if (mon || i === 0) dests.push([`s${i}`, `Put in ${slotName(i)}`]); }
        else {
          if (mon && !isBasic(c.line)) dests.push([`e${i}`, `Evolve ${slotName(i)}`]);
          dests.push([`s${i}`, `Attach to ${slotName(i)}`]);
        }
      }
      if (from !== 'stadium') dests.push(['stadium', 'Play as Stadium']);
      if (from !== 'discard') dests.push(['discard', 'Discard']);
      if (from !== 'lost') dests.push(['lost', 'Lost Zone']);
      dests.push(['top', 'Top of deck'], ['bottom', 'Bottom of deck'], ['shuffle', 'Shuffle into deck']);
      return (
        <div className="pt-menu-card">
          <div className="pt-menu-art"><CardImg src={c.line.card?.image || ''} alt={c.line.name} q="high" /></div>
          <div className="pt-menu-opts"><h3>{c.line.name}</h3>{dests.map(([to, label]) => <button key={to} className="btn" onClick={() => move(c.id, to)}>{label}</button>)}</div>
        </div>
      );
    }
    if (top.k === 'slot') {
      const s = g.slots[top.i];
      if (!s.cards.length) return null;
      return (
        <div>
          <h3>{slotName(top.i)}{s.dmg > 0 ? ` · ${s.dmg} damage` : ''}</h3>
          <p className="muted small">Top card first. Tap a card to move it.</p>
          <div className="pt-row">{s.cards.map(c => <Card key={c.id} c={c} onClick={() => pick(c)} />)}</div>
          <div className="pt-actions">
            <button className="btn" onClick={() => dmg(top.i, 10)}>+10 damage</button>
            <button className="btn" onClick={() => dmg(top.i, -10)} disabled={!s.dmg}>−10 damage</button>
            {top.i > 0 && <button className="btn" onClick={() => { swap(top.i); setDlg([]); }}>Switch with Active</button>}
            <button className="btn danger" onClick={() => discardAll(top.i)}>Discard all</button>
          </div>
        </div>
      );
    }
    const sorted = [...g.deck].sort((a, b) => a.line.name.localeCompare(b.line.name));
    return (
      <div>
        <h3>Search deck <span className="muted">{g.deck.length}</span></h3>
        <p className="muted small">Tap a card to choose where it goes.</p>
        <div className="pt-row">{sorted.map(c => <Card key={c.id} c={c} onClick={() => pick(c)} />)}</div>
      </div>
    );
  };

  const closeTop = () => setDlg(d => d.slice(0, -1));
  const m = menu();
  useEffect(() => { if (top && !m) setDlg(d => d.slice(0, -1)); }, [top, m === null]);

  return createPortal(
    <div className="pt-root" role="dialog" aria-modal="true" aria-label="Playtest">
      <header className="pt-bar">
        <h2>Playtest</h2>
        <span className="tag">Turn {g.turn}</span>
        <button className="btn primary" onClick={nextTurn} disabled={!g.deck.length}>Next turn</button>
        <button className="btn" onClick={() => draw(1)} disabled={!g.deck.length}>Draw 1</button>
        <span className="pt-drawn"><input type="number" min={1} max={60} value={n} aria-label="Cards to draw" onChange={e => setN(Math.max(1, Math.min(60, +e.target.value || 1)))} /><button className="btn" onClick={() => draw(n)} disabled={!g.deck.length}>Draw {n}</button></span>
        <button className="btn" onClick={() => upd(c => { c.deck = shuffle(c.deck); })}><Icon name="shuffle" size={14} />Shuffle</button>
        <button className="btn" onClick={() => setDlg([{ k: 'search' }])}><Icon name="search" size={14} />Search deck</button>
        <button className="btn" onClick={() => { setG(deal(lines)); setDlg([]); }}><Icon name="refresh" size={14} />New game</button>
        <button className="btn ghost" onClick={onClose} aria-label="Close playtest"><Icon name="x" />Close</button>
      </header>
      <div className="pt-body">
        {g.mulls > 0 && <p className="notice info">{g.mulls} mulligan{g.mulls > 1 ? 's' : ''}. Opponent may draw {g.mulls} card{g.mulls > 1 ? 's' : ''}.{g.note && <> <span className="muted">{g.note}</span></>}</p>}
        {g.mulls === 0 && g.note && <p className="notice info">{g.note}</p>}
        {!g.deck.length && g.hand.length + g.prizes.length === 0 && <p className="muted">This deck has no main-deck cards to play with.</p>}
        <div className="pt-field">
          <Zone title="Active" cls="pt-active">{slotView(0)}</Zone>
          <Zone title="Bench" cls="pt-bench">{[1, 2, 3, 4, 5].map(i => <Fragment key={i}>{slotView(i)}</Fragment>)}</Zone>
        </div>
        <div className="pt-field">
          <Zone title="Deck" count={g.deck.length}><Back label={`Deck, ${g.deck.length} cards. Tap to draw one`} onClick={g.deck.length ? () => draw(1) : undefined}><span>{g.deck.length}</span></Back></Zone>
          <Zone title="Prizes" count={g.prizes.length}>{g.prizes.length ? g.prizes.map(c => <Back key={c.id} label="Prize card. Tap to take it into your hand" onClick={() => move(c.id, 'hand')} />) : <span className="muted small">None left</span>}</Zone>
          <Zone title="Stadium">{g.stadium[0] ? <Card c={g.stadium[0]} onClick={() => pick(g.stadium[0])} /> : <div className="pt-empty">Empty</div>}</Zone>
        </div>
        <div className="pt-field">
          <Zone title="Discard" count={g.discard.length}>{g.discard.length ? <Card c={g.discard[g.discard.length - 1]} onClick={() => pick(g.discard[g.discard.length - 1])} /> : <div className="pt-empty">Empty</div>}</Zone>
          <Zone title="Lost Zone" count={g.lost.length}>{g.lost.length ? <Card c={g.lost[g.lost.length - 1]} onClick={() => pick(g.lost[g.lost.length - 1])} /> : <div className="pt-empty">Empty</div>}</Zone>
        </div>
        {(g.discard.length > 1 || g.lost.length > 1) && (
          <details className="pt-more"><summary>Show all discarded and Lost Zone cards</summary>
            <div className="pt-row">{[...g.discard].reverse().map(c => <Card key={c.id} c={c} onClick={() => pick(c)} />)}{[...g.lost].reverse().map(c => <Card key={c.id} c={c} onClick={() => pick(c)} />)}</div>
          </details>
        )}
        <Zone title="Hand" count={g.hand.length} cls="pt-hand">{g.hand.length ? g.hand.map(c => <Card key={c.id} c={c} onClick={() => pick(c)} />) : <span className="muted small">Empty</span>}</Zone>
      </div>
      {top && m && (
        <div className="pt-pop-back" onMouseDown={e => { if (e.target === e.currentTarget) closeTop(); }}>
          <div className="pt-pop" role="dialog" aria-modal="true">
            <button className="icon-btn pt-pop-x" onClick={closeTop} aria-label="Close"><Icon name="x" /></button>
            {m}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
