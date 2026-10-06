import { useMemo, useState } from 'react';
import { Link } from '../../router';
import { CardImg, Icon, Tag } from '../ui';
import { ago, atLeast, choose, ENERGY_TYPES, energyTypeOf, fmtDate, FORMAT_LABEL, groupOf, isBasicEnergy, linePrice, money, sum, SUPER, TYPE_COLOR, type Line } from '../../lib/cards';
import { validateDeck, type Check } from '../../lib/legality';
import { massEntry } from '../../lib/tcgplayer';
import type { Format, Rules } from '../../lib/types';

const ICON: Record<Check['level'], string> = { ok: 'check', bad: 'x', warn: 'warn', info: 'info' };

export function LegalityPanel({ lines, format, rules, onHighlight }: { lines: Line[]; format: Format; rules?: Rules | null; onHighlight: (names: string[]) => void }) {
  const checks = useMemo(() => validateDeck(lines, format, rules), [lines, format, rules]);
  const legal = !checks.some(c => c.level === 'bad');
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Legality</h3>
        <Tag tone={legal ? 'ok' : 'bad'}>{legal ? `${FORMAT_LABEL[format]} legal` : 'Not legal'}</Tag>
      </div>
      <ul className="checks">
        {checks.map((c, i) => (
          <li key={i} className={`check ${c.level}`}>
            <Icon name={ICON[c.level]} size={15} />
            <div>
              <div className="check-msg">{c.msg}{c.cards?.length ? <button className="link-btn" onClick={() => onHighlight(c.cards!)}>show</button> : null}</div>
              {c.detail && <div className="check-detail">{c.detail}</div>}
            </div>
          </li>
        ))}
      </ul>
      {format !== 'unlimited' && rules && (
        <p className="panel-foot">
          {format === 'standard' ? <>Standard: regulation mark {rules.standard_min_mark} and later{rules.next_rotation ? <>; {String.fromCharCode(rules.next_rotation.new_min_mark.charCodeAt(0) - 1)} rotates {rules.next_rotation.effective_date ? fmtDate(rules.next_rotation.effective_date) : '(date TBA)'}</> : null}. </> : <>Expanded: Black & White onward, minus the ban list. </>}
          Rules checked {ago(rules.last_checked) || 'recently'}. <Link to="/rules">Formats & bans</Link>
        </p>
      )}
    </section>
  );
}

export function BuyPanel({ lines }: { lines: Line[] }) {
  const main = lines.filter(l => l.board === 'main');
  const total = sum(main, l => (linePrice(l) || 0) * l.qty);
  const me = massEntry(main);
  // Mass Entry can't mix exact products and names, so unmatched cards get their own link.
  const rest = me.missing.length ? massEntry(main.filter(l => me.missing.includes(l.name)).map(l => ({ ...l, card: undefined }))) : null;
  const priced = main.filter(l => linePrice(l) != null).length;
  const top = [...main].sort((a, b) => (linePrice(b) || 0) * b.qty - (linePrice(a) || 0) * a.qty).slice(0, 5).filter(l => linePrice(l));
  const oldest = main.map(l => l.card?.prices_at).filter(Boolean).sort()[0];
  return (
    <section className="panel">
      <div className="panel-head"><h3>Price</h3><span className="big-price">{money(total)}</span></div>
      <a className="btn primary block" href={me.url} target="_blank" rel="noopener noreferrer"><Icon name="cart" />Buy this deck on TCGplayer</a>
      <p className="panel-foot">
        {me.exact ? `Opens TCGplayer Mass Entry with the exact printing of ${me.exact} card${me.exact > 1 ? 's' : ''}.` : 'Opens TCGplayer Mass Entry by card name.'}
      </p>
      {me.missing.length > 0 && rest && (
        <div className="notice warn">
          <Icon name="warn" size={15} />
          <span>{me.missing.length} card{me.missing.length > 1 ? 's aren’t' : ' isn’t'} matched to an exact TCGplayer product yet ({me.missing.join(', ')}). <a href={rest.url} target="_blank" rel="noopener noreferrer">Buy {me.missing.length > 1 ? 'those' : 'it'} by name</a>.</span>
        </div>
      )}
      {top.length > 0 && (
        <ul className="price-top">
          {top.map(l => <li key={l.cid}><span>{l.qty}× {l.name}</span><span>{money((linePrice(l) || 0) * l.qty)}</span></li>)}
        </ul>
      )}
      <p className="panel-foot muted">TCGplayer market prices{priced < main.length ? ` (${main.length - priced} without a price)` : ''}{oldest ? `, updated ${ago(oldest)}` : ''}.</p>
    </section>
  );
}

export function StatsPanel({ lines }: { lines: Line[] }) {
  const main = lines.filter(l => l.board === 'main');
  const N = sum(main, l => l.qty);
  const supers = ['Pokémon', 'Trainer', 'Energy'].map(s => ({ s, n: sum(main.filter(l => SUPER(groupOf(l)) === s), l => l.qty) }));
  const sub = ['Supporter', 'Item', 'Pokémon Tool', 'Stadium', 'Special Energy', 'Basic Energy'].map(g => ({ g, n: sum(main.filter(l => groupOf(l) === g), l => l.qty) })).filter(x => x.n);
  const energy = new Map<string, number>();
  main.filter(l => isBasicEnergy(l)).forEach(l => { const t = energyTypeOf(l.name); energy.set(t, (energy.get(t) || 0) + l.qty); });
  const pokeTypes = new Map<string, number>();
  main.filter(l => l.card?.category === 'Pokemon').forEach(l => (l.card!.types || []).forEach(t => pokeTypes.set(t, (pokeTypes.get(t) || 0) + l.qty)));
  const basics = sum(main.filter(l => l.card?.category === 'Pokemon' && /^basic$/i.test(l.card.stage)), l => l.qty);
  const pOpen = N >= 7 ? atLeast(N, basics, 7, 1) : 0;
  const names = [...new Map(main.map(l => [l.name, sum(main.filter(x => x.name === l.name), x => x.qty)])).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const [pick, setPick] = useState('');
  const pickN = names.find(([n]) => n === pick)?.[1] || 0;
  return (
    <section className="panel">
      <div className="panel-head"><h3>Stats</h3><span className="muted">{N} cards</span></div>
      <div className="bar-stack" aria-label="Card types">
        {supers.filter(x => x.n).map(x => <span key={x.s} className={`seg ${x.s === 'Pokémon' ? 'p' : x.s === 'Trainer' ? 't' : 'e'}`} style={{ flex: x.n }} title={`${x.s}: ${x.n}`} />)}
      </div>
      <ul className="legend">{supers.map(x => <li key={x.s}><i className={`dot ${x.s === 'Pokémon' ? 'p' : x.s === 'Trainer' ? 't' : 'e'}`} />{x.s}<b>{x.n}</b></li>)}</ul>
      {sub.length > 0 && <ul className="mini-stats">{sub.map(x => <li key={x.g}><span>{x.g}</span><b>{x.n}</b></li>)}</ul>}
      {(pokeTypes.size > 0 || energy.size > 0) && (
        <div className="types-row">
          {[...pokeTypes].sort((a, b) => b[1] - a[1]).map(([t, n]) => <span key={'p' + t} className="type-chip" style={{ ['--c' as any]: TYPE_COLOR[t] || '#888' }} title={`${t} Pokémon`}>{t} <b>{n}</b></span>)}
          {[...energy].filter(([t]) => ENERGY_TYPES.includes(t)).map(([t, n]) => <span key={'e' + t} className="type-chip energy" style={{ ['--c' as any]: TYPE_COLOR[t] || '#888' }} title={`Basic ${t} Energy`}>⚡ {t} <b>{n}</b></span>)}
        </div>
      )}
      <div className="odds">
        <div><span>Basic Pokémon in opening hand</span><b>{N >= 7 && basics ? (pOpen * 100).toFixed(1) + '%' : '—'}</b></div>
        <div><span>Mulligan chance</span><b>{N >= 7 && basics ? ((1 - pOpen) * 100).toFixed(1) + '%' : '—'}</b></div>
      </div>
      <label className="field compact">
        <span>Odds for a card</span>
        <select value={pick} onChange={e => setPick(e.target.value)}>
          <option value="">Choose a card…</option>
          {names.map(([n, q]) => <option key={n} value={n}>{q}× {n}</option>)}
        </select>
      </label>
      {pick && N >= 13 && (
        <div className="odds">
          <div><span>In opening 7</span><b>{(atLeast(N, pickN, 7) * 100).toFixed(1)}%</b></div>
          <div><span>By your first turn (8 cards)</span><b>{(atLeast(N, pickN, 8) * 100).toFixed(1)}%</b></div>
          <div><span>All {pickN} prized</span><b>{pickN <= 6 ? (choose(N - pickN, 6 - pickN) / choose(N, 6) * 100).toFixed(2) + '%' : '0%'}</b></div>
        </div>
      )}
    </section>
  );
}

// A quick goldfish: shuffle, draw 7 (redraw on no Basic), set 6 prizes, draw more.
export function SampleHand({ lines }: { lines: Line[] }) {
  const main = lines.filter(l => l.board === 'main');
  const deck = useMemo(() => main.flatMap(l => Array.from({ length: l.qty }, () => l)), [lines]);
  const [state, setState] = useState<{ hand: Line[]; prizes: Line[]; rest: Line[]; mulls: number } | null>(null);
  const shuffle = <T,>(a: T[]) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const deal = () => {
    if (deck.length < 13) return;
    let mulls = 0, d = shuffle(deck);
    const hasBasic = (h: Line[]) => h.some(l => l.card?.category === 'Pokemon' && /^basic$/i.test(l.card.stage));
    if (deck.some(l => l.card?.category === 'Pokemon' && /^basic$/i.test(l.card!.stage))) {
      while (!hasBasic(d.slice(0, 7)) && mulls < 20) { d = shuffle(deck); mulls++; }
    }
    setState({ hand: d.slice(0, 7), prizes: d.slice(7, 13), rest: d.slice(13), mulls });
  };
  const draw = () => state && state.rest.length && setState({ ...state, hand: [...state.hand, state.rest[0]], rest: state.rest.slice(1) });
  return (
    <section className="panel">
      <div className="panel-head"><h3>Sample hand</h3>
        <div className="row-gap">
          {state && <button className="btn small" onClick={draw} disabled={!state.rest.length}>Draw</button>}
          <button className="btn small" onClick={deal} disabled={deck.length < 13}><Icon name="shuffle" size={14} />{state ? 'New hand' : 'Deal'}</button>
        </div>
      </div>
      {!state ? <p className="muted small">Shuffle and draw an opening 7, with 6 Prize cards set aside.</p> : (
        <>
          {state.mulls > 0 && <p className="muted small">{state.mulls} mulligan{state.mulls > 1 ? 's' : ''} before a hand with a Basic Pokémon.</p>}
          <div className="hand">{state.hand.map((l, i) => <div key={i} className="hand-card" data-preview={l.card?.image || undefined}><CardImg src={l.card?.image || ''} alt={l.name} /></div>)}</div>
          <p className="muted small">Prizes: {state.prizes.map(l => l.name).join(', ')}</p>
        </>
      )}
    </section>
  );
}
