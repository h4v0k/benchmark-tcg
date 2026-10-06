import { useEffect, useMemo, useState } from 'react';
import { CardImg, Icon, Modal, Spinner, Tag } from '../ui';
import * as api from '../../lib/api';
import { FINISH_LABEL, finishOf, fmtDate, FORMAT_LABEL, legalIn, linePrice, money, printLabel, type Line } from '../../lib/cards';
import { cardProblem } from '../../lib/legality';
import { buyUrl } from '../../lib/tcgplayer';
import type { Board, Card, Finish, Format } from '../../lib/types';
import { Link } from '../../router';
import { toast, useAuth } from '../../state';

type Props = {
  line: Line;
  format: Format;
  editable: boolean;
  isCover: boolean;
  onClose: () => void;
  onChange?: (patch: { qty?: number; board?: Board; variant?: Finish; cid?: string }) => void;
  onCover?: () => void;
};

export function CardText({ c }: { c: Card }) {
  return (
    <div className="card-text">
      <div className="card-type">
        {c.category === 'Pokemon' ? <>{c.stage || 'Pokémon'}{c.evolves_from ? <> · evolves from {c.evolves_from}</> : null}{c.hp ? <> · {c.hp} HP</> : null}{c.types?.length ? <> · {c.types.join('/')}</> : null}</>
          : <>{c.category}{c.trainer_type ? ` · ${c.trainer_type}` : ''}{c.energy_type && c.energy_type !== 'Normal' ? ` · ${c.energy_type}` : ''}</>}
      </div>
      {c.abilities?.map((a, i) => <div key={'a' + i} className="ability"><b>{a.type || 'Ability'}: {a.name}</b><p>{a.effect}</p></div>)}
      {c.attacks?.map((a, i) => (
        <div key={'t' + i} className="attack">
          <div className="attack-head"><span className="cost">{(a.cost || []).map((t, j) => <i key={j} className={`e e-${t.toLowerCase()}`} title={t} />)}</span><b>{a.name}</b><span className="dmg">{a.damage}</span></div>
          {a.effect && <p>{a.effect}</p>}
        </div>
      ))}
      {c.effect && <p className="effect">{c.effect}</p>}
      {c.category === 'Pokemon' && (
        <div className="wrr">
          <span>Weakness: {c.weaknesses?.map(w => `${w.type} ${w.value}`).join(', ') || '—'}</span>
          <span>Resistance: {c.resistances?.map(w => `${w.type} ${w.value}`).join(', ') || '—'}</span>
          <span>Retreat: {c.retreat ?? '—'}</span>
        </div>
      )}
      <div className="card-meta muted">{c.set?.name} · {printLabel(c)} · {c.rarity || '—'}{c.reg_mark ? ` · Mark ${c.reg_mark}` : ''}{c.illustrator ? ` · Illus. ${c.illustrator}` : ''}</div>
    </div>
  );
}

export function LegalityBadges({ c }: { c: Card }) {
  return (
    <div className="legal-badges">
      {(['standard', 'expanded'] as const).map(f => {
        const ok = legalIn(c, f);
        const banned = c.banned_in?.includes(f);
        const label = banned ? 'Banned' : ok ? (f === 'standard' && c.rotating ? 'Rotating' : 'Legal') : (f === 'standard' && c.standard_from ? `From ${fmtDate(c.standard_from, { month: 'short', day: 'numeric' })}` : 'Not legal');
        return <span key={f} className={`legal-badge ${banned || !ok ? 'bad' : c.rotating && f === 'standard' ? 'warn' : 'ok'}`}><b>{FORMAT_LABEL[f]}</b>{label}</span>;
      })}
    </div>
  );
}

export function CardModal({ line, format, editable, isCover, onClose, onChange, onCover }: Props) {
  const c = line.card;
  const [prints, setPrints] = useState<Card[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { session } = useAuth();
  const [prefId, setPrefId] = useState<string | null>(null);
  useEffect(() => { let alive = true; api.printingsOf(line.name).then(p => alive && setPrints(p)).catch(() => alive && setPrints([])); return () => { alive = false; }; }, [line.name]);
  useEffect(() => {
    let alive = true;
    if (session) api.printingPrefs().then(ps => alive && setPrefId(ps.find(p => p.name === line.name)?.card_id || null)).catch(() => {});
    return () => { alive = false; };
  }, [line.name, session?.user.id]);
  const togglePref = async (p: Card) => {
    try {
      if (prefId === p.id) { await api.clearPrintingPref(p.name); setPrefId(null); toast(`Cleared your default printing of ${p.name}`, 'ok'); }
      else { await api.setPrintingPref(p); setPrefId(p.id); toast(`New decks and imports will use ${printLabel(p)} for ${p.name} when it's legal`, 'ok'); }
    } catch (e: any) { toast(e.message, 'bad'); }
  };
  const finish = finishOf(line);
  const finishes = useMemo(() => {
    const keys = new Set<string>([...(c?.variants || []), ...Object.keys(c?.prices || {})]);
    if (!keys.size) keys.add('normal');
    return [...keys] as Finish[];
  }, [c]);
  const problem = cardProblem(line, format);
  const visiblePrints = (prints || []).filter(p => showAll || format === 'unlimited' || legalIn(p, format) || p.id === line.cid);
  const hiddenCount = (prints || []).length - visiblePrints.length;
  return (
    <Modal title={line.name} onClose={onClose} wide="xl">
      <div className="card-modal">
        <div className="card-modal-art">
          <CardImg src={c?.image || ''} alt={line.name} q="high" />
          {editable && onCover && c?.image && <button className="btn small block" onClick={onCover} disabled={isCover}>{isCover ? 'Deck cover' : 'Use as deck cover'}</button>}
        </div>
        <div className="card-modal-info">
          {c ? <LegalityBadges c={c} /> : <p className="muted">This card isn’t in the card database.</p>}
          {problem && <p className={`notice ${problem.level}`}><Icon name="warn" size={15} />{problem.why}</p>}
          {c && <CardText c={c} />}

          <div className="buy-row">
            <div>
              <div className="muted small">{c ? printLabel(c) : ''} · {FINISH_LABEL[finish] || finish}</div>
              <div className="big-price">{money(linePrice(line))}</div>
            </div>
            <a className="btn primary" href={buyUrl(c, finish, line.name)} target="_blank" rel="noopener noreferrer"><Icon name="cart" />Buy this printing on TCGplayer</a>
          </div>

          {editable && onChange && (
            <div className="edit-row">
              <div className="stepper" aria-label="Quantity">
                <button className="btn small" onClick={() => onChange({ qty: line.qty - 1 })} aria-label="One fewer"><Icon name="minus" size={14} /></button>
                <span className="qty">{line.qty}</span>
                <button className="btn small" onClick={() => onChange({ qty: line.qty + 1 })} aria-label="One more"><Icon name="plus" size={14} /></button>
              </div>
              {finishes.length > 1 && (
                <select value={finish} onChange={e => onChange({ variant: e.target.value as Finish })} aria-label="Finish">
                  {finishes.map(f => <option key={f} value={f}>{FINISH_LABEL[f] || f}{c?.prices?.[f] != null ? ` · ${money(c.prices[f]!)}` : ''}</option>)}
                </select>
              )}
              <button className="btn small" onClick={() => onChange({ board: line.board === 'main' ? 'maybe' : 'main' })}>{line.board === 'main' ? 'Move to Considering' : 'Move to deck'}</button>
              <button className="btn small danger" onClick={() => { onChange({ qty: 0 }); onClose(); }}><Icon name="trash" size={14} />Remove</button>
            </div>
          )}

          <div className="printings">
            <div className="printings-head">
              <h4>Printings {prints && <span className="muted">({prints.length})</span>}</h4>
              {session && <span className="muted small">★ marks your default printing</span>}
              {format !== 'unlimited' && hiddenCount > 0 && <button className="link-btn" onClick={() => setShowAll(true)}>Show {hiddenCount} not {FORMAT_LABEL[format]} legal</button>}
            </div>
            {!prints ? <Spinner /> : (
              <div className="print-grid">
                {visiblePrints.map(p => {
                  const legal = legalIn(p, format);
                  const price = p.prices?.normal ?? p.prices?.holo ?? p.prices?.reverse ?? null;
                  return (
                    <div key={p.id} className={`print ${p.id === line.cid ? 'current' : ''} ${legal ? '' : 'illegal'}`}>
                      <button className="print-pick" disabled={!editable || p.id === line.cid} onClick={() => onChange?.({ cid: p.id })} title={editable ? 'Use this printing' : undefined} data-preview={p.image || undefined}>
                        <CardImg src={p.image} alt={`${p.name} ${printLabel(p)}`} />
                      </button>
                      <div className="print-info">
                        <span className="print-set">{p.set?.name}</span>
                        <span className="muted">{printLabel(p)} · {p.rarity || '—'}</span>
                        <span className="print-foot">
                          {!legal && format !== 'unlimited' ? <Tag tone="bad">Not legal</Tag> : <span>{money(price)}</span>}
                          {session && <button className={`link-btn pref-star ${prefId === p.id ? 'on' : ''}`} onClick={() => togglePref(p)} title={prefId === p.id ? 'Your default printing (click to clear)' : 'Make this my default printing'} aria-pressed={prefId === p.id}>{prefId === p.id ? '★' : '☆'}</button>}
                          <a href={buyUrl(p)} target="_blank" rel="noopener noreferrer" className="link-btn" title="Buy on TCGplayer"><Icon name="cart" size={13} />Buy</a>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {c && <p className="muted small"><Link to={`/cards/${c.id}`}>Open card page</Link> · <Link to={`/decks?card=${encodeURIComponent(line.name)}`}>Decks with {line.name}</Link></p>}
        </div>
      </div>
    </Modal>
  );
}
