import { useMemo, type ReactNode } from 'react';
import { CardImg, Icon, Tag } from '../ui';
import { FINISH_LABEL, finishOf, groupOf, GROUPS, linePrice, money, printLabel, sortLines, sum, SUPER, type Line, type SortKey } from '../../lib/cards';
import { cardProblem } from '../../lib/legality';
import type { Format } from '../../lib/types';

export type ViewMode = 'text' | 'visual' | 'stacks' | 'table';
export type GroupMode = 'type' | 'super' | 'set' | 'rarity' | 'none';

export type ViewProps = {
  lines: Line[];
  format: Format;
  group: GroupMode;
  sort: SortKey;
  editable: boolean;
  onOpen: (l: Line) => void;
  onQty: (l: Line, qty: number) => void;
  highlight?: Set<string>;
};

const SUPER_ORDER = ['Pokémon', 'Trainer', 'Energy', 'Other'];
export function groupLines(lines: Line[], mode: GroupMode, sort: SortKey): { name: string; lines: Line[] }[] {
  const by = new Map<string, Line[]>();
  const keyOf = (l: Line) => {
    if (mode === 'type') return groupOf(l);
    if (mode === 'super') return SUPER(groupOf(l));
    if (mode === 'set') return l.card?.set?.name || 'Unknown set';
    if (mode === 'rarity') return l.card?.rarity || 'Unknown rarity';
    return 'Cards';
  };
  for (const l of lines) { const k = keyOf(l); if (!by.has(k)) by.set(k, []); by.get(k)!.push(l); }
  const order = (a: string, b: string) => {
    if (mode === 'type') return GROUPS.indexOf(a as any) - GROUPS.indexOf(b as any);
    if (mode === 'super') return SUPER_ORDER.indexOf(a) - SUPER_ORDER.indexOf(b);
    if (mode === 'set') {
      const da = by.get(a)![0].card?.set?.release_date || '', db = by.get(b)![0].card?.set?.release_date || '';
      return db.localeCompare(da);
    }
    return a.localeCompare(b);
  };
  return [...by.keys()].sort(order).map(name => ({ name, lines: sortLines(by.get(name)!, sort) }));
}

function Problem({ l, format }: { l: Line; format: Format }) {
  const p = cardProblem(l, format);
  if (!p) return null;
  return <span title={p.why}><Tag tone={p.level === 'bad' ? 'bad' : 'warn'}>{p.label}</Tag></span>;
}
const Finish = ({ l }: { l: Line }) => {
  const f = finishOf(l);
  return f !== 'normal' && (l.card?.variants?.length || 0) > 1 ? <Tag tone="info">{FINISH_LABEL[f] || f}</Tag> : null;
};

function QtyControls({ l, onQty }: { l: Line; onQty: (l: Line, q: number) => void }) {
  return (
    <span className="qty-ctl" onClick={e => e.stopPropagation()}>
      <button className="mini" aria-label={`One fewer ${l.name}`} onClick={() => onQty(l, l.qty - 1)}><Icon name="minus" size={12} /></button>
      <button className="mini" aria-label={`One more ${l.name}`} onClick={() => onQty(l, l.qty + 1)}><Icon name="plus" size={12} /></button>
    </span>
  );
}

const GroupHead = ({ name, lines, extra }: { name: string; lines: Line[]; extra?: ReactNode }) => (
  <h3 className="group-head"><span>{name}</span><span className="count">{sum(lines, l => l.qty)}</span>{extra}</h3>
);

export function TextView(p: ViewProps) {
  const groups = useMemo(() => groupLines(p.lines, p.group, p.sort), [p.lines, p.group, p.sort]);
  return (
    <div className="text-view">
      {groups.map(g => (
        <section key={g.name} className="group">
          <GroupHead name={g.name} lines={g.lines} extra={<span className="group-price">{money(sum(g.lines, l => (linePrice(l) || 0) * l.qty))}</span>} />
          <ul>
            {g.lines.map(l => (
              <li key={l.cid + l.board} className={`row ${p.highlight?.has(l.name) ? 'hl' : ''}`} data-preview={l.card?.image || undefined}>
                <button className="row-main" onClick={() => p.onOpen(l)}>
                  <span className="qty">{l.qty}</span>
                  <span className="name">{l.name}</span>
                  <span className="row-tags"><Finish l={l} /><Problem l={l} format={p.format} /></span>
                  <span className="set-code">{printLabel(l.card)}</span>
                  <span className="price">{money(linePrice(l))}</span>
                </button>
                {p.editable && <QtyControls l={l} onQty={p.onQty} />}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function VisualView(p: ViewProps) {
  const groups = useMemo(() => groupLines(p.lines, p.group, p.sort), [p.lines, p.group, p.sort]);
  return (
    <div className="visual-view">
      {groups.map(g => (
        <section key={g.name} className="group">
          <GroupHead name={g.name} lines={g.lines} />
          <div className="visual-grid">
            {g.lines.map(l => (
              <div key={l.cid + l.board} className={`visual-card ${p.highlight?.has(l.name) ? 'hl' : ''}`}>
                <button onClick={() => p.onOpen(l)} aria-label={`${l.qty} ${l.name}`}>
                  <CardImg src={l.card?.image || ''} alt={l.name} />
                  <span className="qty-badge">{l.qty}</span>
                  <span className="visual-tags"><Problem l={l} format={p.format} /></span>
                </button>
                {p.editable && <QtyControls l={l} onQty={p.onQty} />}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function StacksView(p: ViewProps) {
  const groups = useMemo(() => groupLines(p.lines, p.group, p.sort), [p.lines, p.group, p.sort]);
  return (
    <div className="stacks-view">
      {groups.map(g => (
        <section key={g.name} className="stack-col">
          <GroupHead name={g.name} lines={g.lines} />
          <div className="stack">
            {g.lines.map(l => (
              <button key={l.cid + l.board} className={`stack-card ${p.highlight?.has(l.name) ? 'hl' : ''}`} onClick={() => p.onOpen(l)} aria-label={`${l.qty} ${l.name}`}>
                <CardImg src={l.card?.image || ''} alt={l.name} />
                <span className="qty-badge">{l.qty}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function TableView(p: ViewProps) {
  const groups = useMemo(() => groupLines(p.lines, p.group, p.sort), [p.lines, p.group, p.sort]);
  return (
    <div className="table-view">
      <table>
        <thead><tr><th className="num">Qty</th><th>Name</th><th>Set</th><th>Finish</th><th>Type</th><th title="Regulation mark">Mark</th><th>Legality</th><th className="num">Each</th><th className="num">Total</th>{p.editable && <th aria-label="Change quantity" />}</tr></thead>
        {groups.map(g => (
          <tbody key={g.name}>
            {p.group !== 'none' && <tr className="table-group"><td colSpan={p.editable ? 10 : 9}>{g.name} · {sum(g.lines, l => l.qty)}</td></tr>}
            {g.lines.map(l => (
              <tr key={l.cid + l.board} className={p.highlight?.has(l.name) ? 'hl' : ''} data-preview={l.card?.image || undefined} onClick={() => p.onOpen(l)}>
                <td className="num">{l.qty}</td>
                <td className="name">{l.name}</td>
                <td>{l.card?.set?.name || '—'} <span className="muted">{printLabel(l.card)}</span></td>
                <td>{FINISH_LABEL[finishOf(l)] || finishOf(l)}</td>
                <td>{l.card ? (l.card.category === 'Pokemon' ? l.card.stage || 'Pokémon' : l.card.trainer_type || l.card.energy_type || l.card.category) : '—'}</td>
                <td>{l.card?.reg_mark || '—'}</td>
                <td>{cardProblem(l, p.format)?.label || <span className="ok-text">Legal</span>}</td>
                <td className="num">{money(linePrice(l))}</td>
                <td className="num">{money(linePrice(l) == null ? null : (linePrice(l) || 0) * l.qty)}</td>
                {p.editable && <td onClick={e => e.stopPropagation()}><QtyControls l={l} onQty={p.onQty} /></td>}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

export function DeckView({ mode, ...p }: ViewProps & { mode: ViewMode }) {
  if (mode === 'visual') return <VisualView {...p} />;
  if (mode === 'stacks') return <StacksView {...p} />;
  if (mode === 'table') return <TableView {...p} />;
  return <TextView {...p} />;
}
