// Toolbox: damage & prize-trade calculator, in-game tracker, Championship Points tracker, event finder.
// Every rule and organized-play number comes from src/lib/tools/policy.ts (checked monthly against the official sources).
import { useEffect, useMemo, useState } from 'react';
import { CardImg, ErrorBox, Icon, Segmented, Spinner, Tag, useDebounced } from '../components/ui';
import { Link } from '../router';
import { toast, useAuth } from '../state';
import * as api from '../lib/api';
import * as sb from '../lib/supabase';
import type { Card, SearchHit } from '../lib/types';
import { fmtDate } from '../lib/cards';
import { calcDamage, fewestKOs, prizePaths, prizeValue, printedDamage, type Mod } from '../lib/tools/damage';
import { POLICY, SEASON, SOURCES, type CpEventType } from '../lib/tools/policy';
import { cpFor, divisionFor, gainFrom, seasonTotals, type Finish } from '../lib/tools/cp';
import { EVENT_FILTERS, locatorUrl, type EventFilter } from '../lib/tools/events';

const load = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };

export const TOOLS = [
  { to: '/tools/damage', icon: 'bolt', title: 'Damage & prize trade', blurb: 'Work out exact damage with Weakness, Resistance and every modifier in the right order, and map the fewest Knock Outs to take your Prize cards.' },
  { to: '/tools/tracker', icon: 'list', title: 'Game tracker', blurb: 'Damage counters, Special Conditions, Prize cards and once-per-turn reminders for the table, with Pokémon Checkup built in.' },
  { to: '/tools/cp', icon: 'star', title: 'Championship Points', blurb: 'Log your finishes, see which ones count under the best-finish limits, and check your age division.' },
  { to: '/tools/events', icon: 'search', title: 'Event finder', blurb: 'Jump straight to League Cups, League Challenges and prereleases within 25, 50 or 100 miles of you.' },
];

function ToolHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <>
      <nav className="crumbs muted small" aria-label="Breadcrumb"><Link to="/tools">Toolbox</Link> / {title}</nav>
      <div className="page-head"><h1>{title}</h1></div>
      {children && <p className="lead">{children}</p>}
    </>
  );
}

export function ToolsHome() {
  return (
    <div className="wrap page narrow-wide">
      <div className="page-head"><h1>Toolbox</h1><span className="muted">Rules checked {fmtDate(POLICY.checked)}</span></div>
      <p className="lead">Calculators and trackers for Pokémon TCG players. The rules and Play! Pokémon numbers behind them are rechecked against the official sources every month.</p>
      <div className="tool-grid">
        {TOOLS.map(t => <Link key={t.to} to={t.to} className="panel tool-card"><span className="tool-icon"><Icon name={t.icon} size={20} /></span><span><b>{t.title}</b><span className="muted">{t.blurb}</span></span></Link>)}
      </div>
    </div>
  );
}

/* ---------------- card picker ---------------- */
function CardPicker({ label, value, onPick }: { label: string; value: Card | null; onPick: (c: Card | null) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    if (dq.length < 2) { setHits([]); return; }
    api.searchCards(dq, 'unlimited', 'Pokemon', 8).then(h => { if (alive) setHits(h); }).catch(() => alive && setHits([]));
    return () => { alive = false; };
  }, [dq]);
  const pick = async (h: SearchHit) => {
    setBusy(true);
    try { const m = await api.cardsById([h.card_id]); onPick(m.get(h.card_id) || null); setQ(''); setHits([]); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  if (value) return (
    <div className="picked">
      <CardImg src={value.image} alt={value.name} />
      <div><b>{value.name}</b><span className="muted small">{value.hp ? `${value.hp} HP` : ''}{value.types.length ? ` · ${value.types.join('/')}` : ''} · {prizeValue(value)} Prize card{prizeValue(value) > 1 ? 's' : ''}</span></div>
      <button className="btn small ghost" onClick={() => onPick(null)}>Change</button>
    </div>
  );
  return (
    <label className="field picker">
      <span>{label}</span>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a Pokémon" autoComplete="off" />
      {busy && <Spinner label="Loading card…" />}
      {hits.length > 0 && <ul className="picker-list" role="listbox">{hits.map(h => <li key={h.card_id}><button type="button" onClick={() => pick(h)}><CardImg src={h.image} alt="" /><span>{h.name}<small className="muted"> {h.set_name}</small></span></button></li>)}</ul>}
    </label>
  );
}

/* ---------------- damage & prize trade ---------------- */
function ModList({ title, mods, set, hint }: { title: string; mods: Mod[]; set: (m: Mod[]) => void; hint: string }) {
  return (
    <fieldset className="field mods">
      <legend>{title}</legend>
      {mods.map((m, i) => (
        <div className="mod-row" key={i}>
          <input aria-label="What it is" value={m.label} placeholder={hint} onChange={e => set(mods.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
          <input aria-label="Amount" type="number" inputMode="numeric" step={10} value={m.amount} onChange={e => set(mods.map((x, j) => j === i ? { ...x, amount: Math.round(+e.target.value || 0) } : x))} />
          <button type="button" className="icon-btn" aria-label="Remove" onClick={() => set(mods.filter((_, j) => j !== i))}><Icon name="x" /></button>
        </div>
      ))}
      <button type="button" className="btn small" onClick={() => set([...mods, { label: '', amount: title.includes('Defending') ? -30 : 30 }])}><Icon name="plus" />Add</button>
    </fieldset>
  );
}

export function DamageTool() {
  const [tab, setTab] = useState<'damage' | 'prizes'>(() => (new URLSearchParams(location.search).get('tab') === 'prizes' ? 'prizes' : 'damage'));
  return (
    <div className="wrap page narrow-wide">
      <ToolHead title="Damage & prize trade" />
      <Segmented label="Calculator" value={tab} onChange={setTab} options={[{ value: 'damage', label: 'Damage' }, { value: 'prizes', label: 'Prize trade' }]} />
      {tab === 'damage' ? <DamageCalc /> : <PrizeTrade />}
    </div>
  );
}

function DamageCalc() {
  const [atk, setAtk] = useState<Card | null>(null);
  const [def, setDef] = useState<Card | null>(null);
  const [attack, setAttack] = useState(0);
  const [base, setBase] = useState(0);
  const [atkMods, setAtkMods] = useState<Mod[]>([]);
  const [defMods, setDefMods] = useState<Mod[]>([]);
  const [already, setAlready] = useState(0);
  const [benched, setBenched] = useState(false);
  const [counters, setCounters] = useState(false);
  const [weakOn, setWeakOn] = useState<'auto' | 'on' | 'off'>('auto');
  const [resOn, setResOn] = useState<'auto' | 'on' | 'off'>('auto');
  useEffect(() => { setAttack(0); }, [atk?.id]);
  const atkObj = atk?.attacks[attack];
  useEffect(() => { if (atkObj) setBase(printedDamage(atkObj.damage)); }, [atk?.id, attack]);
  const weakAuto = def && atk ? def.weaknesses.find(w => atk.types.includes(w.type)) : undefined;
  const resAuto = def && atk ? def.resistances.find(r => atk.types.includes(r.type)) : undefined;
  const weakVal = weakOn === 'off' ? '' : weakOn === 'on' ? (def?.weaknesses[0]?.value || '×2') : (weakAuto?.value || '');
  const resVal = resOn === 'off' ? '' : resOn === 'on' ? (def?.resistances[0]?.value || '-30') : (resAuto?.value || '');
  const r = calcDamage({ base, attackerMods: atkMods, defenderMods: defMods, weakness: weakVal, resistance: resVal, benched, counters });
  const hp = def?.hp ?? null;
  const left = hp != null ? hp - already - r.total : null;
  const ko = left != null && left <= 0;
  return (
    <div className="tool-cols">
      <section className="panel">
        <h2>Attacker</h2>
        <CardPicker label="Attacking Pokémon" value={atk} onPick={setAtk} />
        {atk && atk.attacks.length > 0 && (
          <label className="field"><span>Attack</span>
            <select value={attack} onChange={e => setAttack(+e.target.value)}>{atk.attacks.map((a, i) => <option key={i} value={i}>{a.name}{a.damage ? ` (${a.damage})` : ''}</option>)}</select>
          </label>
        )}
        {atkObj?.effect && <p className="muted small attack-text">{atkObj.effect}</p>}
        <label className="field"><span>Base damage{atkObj && /[+×x]/.test(atkObj.damage) ? ' (work out the + or × from the attack text)' : ''}</span>
          <input type="number" inputMode="numeric" step={10} min={0} value={base} onChange={e => setBase(Math.max(0, Math.round(+e.target.value || 0)))} />
        </label>
        <ModList title="Effects on the Attacking Pokémon" hint="e.g. Maximum Belt" mods={atkMods} set={setAtkMods} />
        <label className="check"><input type="checkbox" checked={counters} onChange={e => setCounters(e.target.checked)} />The attack places damage counters (not damage)</label>
      </section>
      <section className="panel">
        <h2>Defender</h2>
        <CardPicker label="Defending Pokémon" value={def} onPick={setDef} />
        <label className="check"><input type="checkbox" checked={benched} onChange={e => setBenched(e.target.checked)} />It’s on the Bench</label>
        <div className="field-row">
          <label className="field"><span>Weakness{weakAuto ? ` (${weakAuto.type} ${weakAuto.value})` : ''}</span>
            <select value={weakOn} onChange={e => setWeakOn(e.target.value as any)}><option value="auto">From the cards</option><option value="on">Applies</option><option value="off">Doesn’t apply</option></select>
          </label>
          <label className="field"><span>Resistance{resAuto ? ` (${resAuto.type} ${resAuto.value})` : ''}</span>
            <select value={resOn} onChange={e => setResOn(e.target.value as any)}><option value="auto">From the cards</option><option value="on">Applies</option><option value="off">Doesn’t apply</option></select>
          </label>
        </div>
        <ModList title="Effects on the Defending Pokémon" hint="e.g. takes 30 less" mods={defMods} set={setDefMods} />
        <label className="field"><span>Damage already on it</span>
          <input type="number" inputMode="numeric" step={10} min={0} value={already} onChange={e => setAlready(Math.max(0, Math.round(+e.target.value || 0)))} />
        </label>
      </section>
      <section className={`panel result ${ko ? 'ko' : ''}`} aria-live="polite">
        <h2>Result</h2>
        <div className="big-num">{r.total}<span> damage</span></div>
        {left != null && <p className="result-line">{ko ? <><Tag tone="ok">Knock Out</Tag> takes {prizeValue(def!)} Prize card{prizeValue(def!) > 1 ? 's' : ''}</> : <>{left} HP left ({Math.ceil(left / 10)} more damage counter{Math.ceil(left / 10) === 1 ? '' : 's'} to KO)</>}</p>}
        <ol className="steps">{r.steps.map((s, i) => <li key={i}><span>{s.label}</span><b>{s.value}</b>{s.note && <small className="muted">{s.note}</small>}</li>)}</ol>
        <details><summary>Order the rulebook applies damage in</summary><ol className="small">{POLICY.damageOrder.map(o => <li key={o}>{o}</li>)}</ol></details>
      </section>
    </div>
  );
}

type Target = { label: string; prizes: number };
function TargetList({ title, items, set }: { title: string; items: Target[]; set: (t: Target[]) => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <h3>{title}</h3>
      <div className="row-gap">{[1, 2, 3].map(n => <button key={n} className="btn small" onClick={() => set([...items, { label: `${n}-Prize Pokémon`, prizes: n }])}><Icon name="plus" />{n}-Prize</button>)}<button className="btn small ghost" onClick={() => setAdding(a => !a)}>Pick a card</button></div>
      {adding && <CardPicker label="Pokémon" value={null} onPick={c => { if (c) { set([...items, { label: c.name, prizes: prizeValue(c) }]); setAdding(false); } }} />}
      {items.length ? <ul className="target-list">{items.map((t, i) => <li key={i}><span>{t.label}</span><Tag tone={t.prizes > 1 ? 'accent' : ''}>{t.prizes}</Tag><button className="icon-btn" aria-label={`Remove ${t.label}`} onClick={() => set(items.filter((_, j) => j !== i))}><Icon name="x" /></button></li>)}</ul>
        : <p className="muted small">Add the Pokémon that could be Knocked Out.</p>}
    </div>
  );
}

function PrizeTrade() {
  const [mine, setMine] = useState<Target[]>(() => load('bm:prize-mine', []));
  const [theirs, setTheirs] = useState<Target[]>(() => load('bm:prize-theirs', []));
  const [needMe, setNeedMe] = useState(POLICY.prizeCount);
  const [needThem, setNeedThem] = useState(POLICY.prizeCount);
  useEffect(() => save('bm:prize-mine', mine), [mine]);
  useEffect(() => save('bm:prize-theirs', theirs), [theirs]);
  const myKOs = fewestKOs(theirs.map(t => t.prizes), needMe);
  const theirKOs = fewestKOs(mine.map(t => t.prizes), needThem);
  const paths = useMemo(() => prizePaths(theirs.map(t => t.prizes), needMe).slice(0, 6), [theirs, needMe]);
  const verdict = myKOs == null || theirKOs == null ? null : myKOs < theirKOs ? 'You’re ahead on the trade' : myKOs > theirKOs ? 'They’re ahead on the trade' : 'Even trade: tempo decides it';
  return (
    <div className="tool-cols">
      <section className="panel">
        <h2>You</h2>
        <label className="field"><span>Prize cards you have left</span><input type="number" min={1} max={6} value={needMe} onChange={e => setNeedMe(Math.min(6, Math.max(1, +e.target.value || 1)))} /></label>
        <TargetList title="Their Pokémon you can Knock Out" items={theirs} set={setTheirs} />
      </section>
      <section className="panel">
        <h2>Opponent</h2>
        <label className="field"><span>Prize cards they have left</span><input type="number" min={1} max={6} value={needThem} onChange={e => setNeedThem(Math.min(6, Math.max(1, +e.target.value || 1)))} /></label>
        <TargetList title="Your Pokémon they can Knock Out" items={mine} set={setMine} />
      </section>
      <section className="panel result" aria-live="polite">
        <h2>Prize map</h2>
        <div className="kv"><span>Knock Outs you need</span><b>{myKOs ?? '—'}</b></div>
        <div className="kv"><span>Knock Outs they need</span><b>{theirKOs ?? '—'}</b></div>
        {verdict && <p className="result-line"><b>{verdict}</b></p>}
        {paths.length > 0 && <><h3>Your ways to {needMe}</h3><ul className="paths">{paths.map(p => <li key={p.join()}>{p.length} KO{p.length > 1 ? 's' : ''}: {p.map(v => `${v}-Prize`).join(' + ')}</li>)}</ul></>}
        {myKOs == null && theirs.length > 0 && <p className="muted small">Those Knock Outs don’t add up to {needMe} Prize cards. Add the Pokémon they’ll bench later.</p>}
        <p className="muted small">The side that needs fewer Knock Outs usually wins the trade, unless the other side gets more turns.</p>
      </section>
    </div>
  );
}

/* ---------------- game tracker ---------------- */
type Slot = { name: string; hp: number; dmg: number };
type Side = { prizes: boolean[]; slots: Slot[]; cond: string[]; turn: Record<string, boolean>; game: Record<string, boolean> };
type Game = { turn: number; who: 0 | 1; sides: [Side, Side] };
const blankSide = (): Side => ({ prizes: Array(POLICY.prizeCount).fill(false), slots: [{ name: '', hp: 0, dmg: 0 }], cond: [], turn: {}, game: {} });
const newGame = (): Game => ({ turn: 1, who: 0, sides: [blankSide(), blankSide()] });

export function TrackerTool() {
  const [g, setG] = useState<Game>(() => load('bm:tracker', newGame()));
  const [flip, setFlip] = useState<string>('');
  const [checkup, setCheckup] = useState(false);
  const [armed, setArmed] = useState(false); // New game needs a second tap so a stray tap mid-game doesn't wipe it
  useEffect(() => save('bm:tracker', g), [g]);
  const upd = (i: 0 | 1, f: (s: Side) => Side) => setG(x => ({ ...x, sides: (i === 0 ? [f(x.sides[0]), x.sides[1]] : [x.sides[0], f(x.sides[1])]) as [Side, Side] }));
  const endTurn = () => {
    setCheckup(true);
    setG(x => ({ ...x, who: x.who === 0 ? 1 : 0, turn: x.who === 1 ? x.turn + 1 : x.turn, sides: x.sides.map(s => ({ ...s, turn: {} })) as [Side, Side] }));
  };
  const coin = () => setFlip(Math.random() < 0.5 ? 'Heads' : 'Tails');
  const anyCond = g.sides.some(s => s.cond.length);
  return (
    <div className="wrap page tracker">
      <ToolHead title="Game tracker" />
      <div className="tracker-bar panel">
        <span><b>Turn {g.turn}</b> · {g.who === 0 ? 'Your' : 'Opponent’s'} turn</span>
        <div className="row-gap">
          <button className="btn" onClick={coin}>Flip a coin</button>
          <button className="btn primary" onClick={endTurn}>End turn</button>
          <button className={`btn ${armed ? 'danger' : 'ghost'}`} onClick={() => { if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; } setG(newGame()); setFlip(''); setCheckup(false); setArmed(false); }}>{armed ? 'Tap again to reset' : 'New game'}</button>
        </div>
        {flip && <p className="flip" aria-live="polite"><b>{flip}</b> <span className="muted small">For casual play. At sanctioned events, use a physical coin or die.</span></p>}
      </div>
      {checkup && anyCond && (
        <div className="notice warn checkup" role="status"><Icon name="warn" size={15} /><div><b>Pokémon Checkup</b><ul>{POLICY.checkup.filter(c => g.sides.some(s => s.cond.includes(c.condition))).map(c => <li key={c.condition}>{c.text}</li>)}</ul></div><button className="btn small" onClick={() => setCheckup(false)}>Done</button></div>
      )}
      <div className="tracker-sides">
        {g.sides.map((s, i) => <SidePanel key={i} title={i === 0 ? 'You' : 'Opponent'} side={s} active={g.who === i} set={f => upd(i as 0 | 1, f)} />)}
      </div>
    </div>
  );
}

function SidePanel({ title, side, active, set }: { title: string; side: Side; active: boolean; set: (f: (s: Side) => Side) => void }) {
  const left = side.prizes.filter(p => !p).length;
  const slot = (i: number, patch: Partial<Slot>) => set(s => ({ ...s, slots: s.slots.map((x, j) => j === i ? { ...x, ...patch } : x) }));
  const toggleCond = (c: string) => set(s => {
    const on = s.cond.includes(c);
    let cond = on ? s.cond.filter(x => x !== c) : [...s.cond, c];
    if (!on && POLICY.exclusiveConditions.includes(c)) cond = cond.filter(x => x === c || !POLICY.exclusiveConditions.includes(x));
    return { ...s, cond };
  });
  const promote = (i: number) => set(s => { const slots = [...s.slots]; [slots[0], slots[i]] = [slots[i], slots[0]]; return { ...s, slots, cond: [] }; });
  const ko = (i: number) => set(s => ({ ...s, slots: s.slots.length > 1 ? s.slots.filter((_, j) => j !== i) : [{ name: '', hp: 0, dmg: 0 }], cond: i === 0 ? [] : s.cond }));
  return (
    <section className={`panel side ${active ? 'on' : ''}`}>
      <div className="panel-head"><h2>{title}</h2><span className="muted">{left} Prize card{left === 1 ? '' : 's'} left</span></div>
      <div className="prizes" role="group" aria-label={`${title} Prize cards`}>
        {side.prizes.map((taken, i) => <button key={i} className={`prize ${taken ? 'taken' : ''}`} aria-pressed={taken} aria-label={`Prize ${i + 1}${taken ? ', taken' : ''}`} onClick={() => set(s => ({ ...s, prizes: s.prizes.map((p, j) => j === i ? !p : p) }))}>{taken ? '✓' : i + 1}</button>)}
      </div>
      {side.slots.map((p, i) => {
        const rem = p.hp ? p.hp - p.dmg : null;
        return (
          <div key={i} className={`slot ${i === 0 ? 'active' : ''}`}>
            <div className="slot-head">
              <Tag tone={i === 0 ? 'accent' : ''}>{i === 0 ? 'Active' : `Bench ${i}`}</Tag>
              <input aria-label="Pokémon name" placeholder="Pokémon" value={p.name} onChange={e => slot(i, { name: e.target.value })} />
              <input aria-label="HP" className="hp" type="number" inputMode="numeric" placeholder="HP" value={p.hp || ''} onChange={e => slot(i, { hp: Math.max(0, +e.target.value || 0) })} />
            </div>
            <div className="dmg-row">
              <button className="btn" aria-label="Remove 10 damage" onClick={() => slot(i, { dmg: Math.max(0, p.dmg - 10) })}>−10</button>
              <span className={`dmg ${rem != null && rem <= 0 ? 'dead' : ''}`}><b>{p.dmg}</b> damage{rem != null && <small>{rem > 0 ? `${rem} HP left` : 'Knocked Out'}</small>}</span>
              <button className="btn" aria-label="Add 10 damage" onClick={() => slot(i, { dmg: p.dmg + 10 })}>+10</button>
              <button className="btn" aria-label="Add 50 damage" onClick={() => slot(i, { dmg: p.dmg + 50 })}>+50</button>
            </div>
            <div className="row-gap small-gap">
              {i > 0 && <button className="btn small" onClick={() => promote(i)}>Make Active</button>}
              <button className="btn small ghost" onClick={() => slot(i, { dmg: 0 })}>Heal all</button>
              <button className="btn small danger" onClick={() => ko(i)}>Knocked Out</button>
            </div>
            {i === 0 && (
              <div className="conds" role="group" aria-label="Special Conditions">
                {['asleep', 'confused', 'paralyzed', 'poisoned', 'burned'].map(c => <button key={c} className={`chip-toggle ${side.cond.includes(c) ? 'on' : ''}`} aria-pressed={side.cond.includes(c)} onClick={() => toggleCond(c)}>{c[0].toUpperCase() + c.slice(1)}</button>)}
              </div>
            )}
          </div>
        );
      })}
      {side.slots.length < 1 + POLICY.benchSize + 3 && <button className="btn small" onClick={() => set(s => ({ ...s, slots: [...s.slots, { name: '', hp: 0, dmg: 0 }] }))}><Icon name="plus" />Bench a Pokémon</button>}
      <div className="flags">
        <span className="muted small">This turn</span>
        {POLICY.perTurn.map(f => <label key={f} className="check"><input type="checkbox" checked={!!side.turn[f]} onChange={e => set(s => ({ ...s, turn: { ...s.turn, [f]: e.target.checked } }))} />{f}</label>)}
        <span className="muted small">This game</span>
        {POLICY.perGame.map(f => <label key={f} className="check"><input type="checkbox" checked={!!side.game[f]} onChange={e => set(s => ({ ...s, game: { ...s.game, [f]: e.target.checked } }))} />{f}</label>)}
      </div>
    </section>
  );
}

/* ---------------- Championship Points ---------------- */
const LOCAL_CP = `bm:cp-${SEASON.season}`;
const TYPES = Object.entries(SEASON.events) as [CpEventType, (typeof SEASON.events)[CpEventType]][];

export function CpTool() {
  const { session } = useAuth();
  const [list, setList] = useState<Finish[] | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [year, setYear] = useState<string>(() => load('bm:birth-year', ''));
  const reload = async () => {
    setErr(null);
    try {
      if (session) setList((await sb.select<Finish>('cp_finishes', { select: 'id,event_type,event_name,event_date,players,placement,cp', season: `eq.${SEASON.season}`, order: 'event_date.desc.nullslast' })).rows);
      else setList(load<Finish[]>(LOCAL_CP, []));
    } catch (e: any) { setErr(e); }
  };
  useEffect(() => { reload(); }, [session?.user.id]);
  useEffect(() => save('bm:birth-year', year), [year]);
  const add = async (f: Finish) => {
    try {
      if (session) await sb.insert('cp_finishes', { ...f, season: SEASON.season, user_id: session.user.id });
      else save(LOCAL_CP, [{ ...f, id: Date.now() }, ...(list || [])]);
      toast('Finish added', 'ok'); reload();
    } catch (e: any) { toast(e.message, 'bad'); }
  };
  const del = async (f: Finish) => {
    try {
      if (session) await sb.remove('cp_finishes', { id: `eq.${f.id}` });
      else save(LOCAL_CP, (list || []).filter(x => x.id !== f.id));
      reload();
    } catch (e: any) { toast(e.message, 'bad'); }
  };
  const totals = useMemo(() => seasonTotals(list || []), [list]);
  const div = /^\d{4}$/.test(year) ? divisionFor(+year) : null;
  return (
    <div className="wrap page narrow-wide">
      <ToolHead title="Championship Points">Track your {SEASON.season} Championship Series finishes. Only your best finishes of each kind count toward your total.</ToolHead>
      {!SEASON.verified && <p className="notice warn"><Icon name="warn" size={15} />These CP values haven’t been confirmed against the official Play! Pokémon page yet. Check your official total in your <a href="https://www.pokemon.com/us/pokemon-trainer-club/play-pokemon-dashboard" target="_blank" rel="noopener noreferrer">Play! Pokémon dashboard</a>.</p>}
      {!session && <p className="muted small">Finishes are saved on this device. <Link to="/login?next=/tools/cp">Sign in</Link> to keep them with your account.</p>}
      <div className="tool-cols two">
        <section className="panel result">
          <h2>Season total</h2>
          <div className="big-num">{totals.total.toLocaleString()}<span> CP</span></div>
          <ul className="cp-pools">{TYPES.filter(([t]) => t !== 'special' && t !== 'international').map(([t, e]) => {
            const b = e.pool === 'major' ? ['regional', 'special', 'international'].reduce((a, k) => ({ counted: a.counted + totals.byType[k].counted, logged: a.logged + totals.byType[k].logged, cp: a.cp + totals.byType[k].cp }), { counted: 0, logged: 0, cp: 0 }) : totals.byType[t];
            return <li key={t}><span>{e.pool === 'major' ? 'Regionals, Specials & Internationals' : e.label + 's'}</span><span className="muted">{b.counted} of best {e.pool === 'major' ? SEASON.majorBest : e.best}{b.logged > b.counted ? ` (${b.logged} logged)` : ''}</span><b>{b.cp}</b></li>;
          })}</ul>
          <AddFinish list={list || []} onAdd={add} />
        </section>
        <section className="panel">
          <h2>Age division</h2>
          <label className="field"><span>Birth year</span><input inputMode="numeric" maxLength={4} value={year} onChange={e => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="e.g. 2012" /></label>
          {div && <p className="result-line">You play in <b>{div}</b> for the whole {SEASON.season} season.</p>}
          <p className="muted small">Junior: born {SEASON.divisions.junior} or later · Senior: {SEASON.divisions.senior}–{SEASON.divisions.junior - 1} · Masters: {SEASON.divisions.senior - 1} or earlier.</p>
          <h2>Worlds invites</h2>
          <p className="small">{SEASON.invites.note}</p>
          <table className="mini-table"><thead><tr><th>Zone</th><th>Jr</th><th>Sr</th><th>Ma</th></tr></thead><tbody>{SEASON.invites.zones.map(z => <tr key={z.zone}><td>{z.zone}</td><td>{z.junior}</td><td>{z.senior}</td><td>{z.masters}</td></tr>)}</tbody></table>
          <p className="muted small">Direct invites: {SEASON.invites.direct}</p>
        </section>
      </div>
      <section className="panel">
        <h2>Your finishes</h2>
        {err ? <ErrorBox error={err} onRetry={reload} /> : !list ? <Spinner /> : list.length ? (
          <ul className="finish-list">{list.map(f => (
            <li key={String(f.id)} className={totals.counted.has(f) ? '' : 'dim'}>
              <span><b>{f.event_name || SEASON.events[f.event_type]?.label}</b><small className="muted">{SEASON.events[f.event_type]?.label} · #{f.placement}{f.players ? ` of ${f.players}` : ''}{f.event_date ? ` · ${fmtDate(f.event_date)}` : ''}</small></span>
              <span>{totals.counted.has(f) ? <Tag tone="ok">Counts</Tag> : <Tag>Over the limit</Tag>}</span>
              <b>{f.cp} CP</b>
              <button className="icon-btn" aria-label="Delete finish" onClick={() => del(f)}><Icon name="trash" /></button>
            </li>
          ))}</ul>
        ) : <p className="muted">No finishes logged yet.</p>}
      </section>
      <p className="muted small">Source: <a href={SEASON.source} target="_blank" rel="noopener noreferrer">Play! Pokémon Championship Points</a> · checked {fmtDate(POLICY.checked)}</p>
    </div>
  );
}

function AddFinish({ list, onAdd }: { list: Finish[]; onAdd: (f: Finish) => void }) {
  const [type, setType] = useState<CpEventType>('cup');
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [players, setPlayers] = useState('');
  const [place, setPlace] = useState('');
  const [cpEdit, setCpEdit] = useState<string | null>(null);
  const auto = place ? cpFor(type, +place, players ? +players : null) : 0;
  const cp = cpEdit != null && cpEdit !== '' ? Math.max(0, +cpEdit || 0) : auto;
  const f: Finish = { event_type: type, event_name: name.trim().slice(0, 120), event_date: date || null, players: players ? +players : null, placement: +place || 0, cp };
  const gain = place ? gainFrom(list, f) : 0;
  return (
    <form className="add-finish" onSubmit={e => { e.preventDefault(); if (!f.placement) return toast('Enter your placement', 'bad'); onAdd(f); setName(''); setPlace(''); setPlayers(''); setCpEdit(null); }}>
      <h3>Add a finish</h3>
      <label className="field"><span>Event type</span><select value={type} onChange={e => { setType(e.target.value as CpEventType); setCpEdit(null); }}>{TYPES.map(([t, e]) => <option key={t} value={t}>{e.label}</option>)}</select></label>
      <label className="field"><span>Event name (optional)</span><input value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="e.g. Tampa League Cup" /></label>
      <div className="field-row">
        <label className="field"><span>Placement</span><input inputMode="numeric" value={place} onChange={e => { setPlace(e.target.value.replace(/\D/g, '').slice(0, 5)); setCpEdit(null); }} /></label>
        <label className="field"><span>Players in your division</span><input inputMode="numeric" value={players} onChange={e => { setPlayers(e.target.value.replace(/\D/g, '').slice(0, 5)); setCpEdit(null); }} /></label>
      </div>
      <div className="field-row">
        <label className="field"><span>Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className="field"><span>CP earned</span><input inputMode="numeric" value={cpEdit ?? String(auto)} onChange={e => setCpEdit(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
      </div>
      {place && <p className="small">{auto === 0 && cpEdit == null ? 'That placement doesn’t earn CP at this event size.' : gain > 0 ? `Adds ${gain} CP to your total.` : 'Wouldn’t raise your total: your counted finishes of this kind are already higher.'}</p>}
      <button className="btn primary block">Add finish</button>
    </form>
  );
}

/* ---------------- event finder ---------------- */
// The official locator has no public API, so this picks the spot, distance and event types here and opens the
// locator already searched. One tap from ZIP code to the list, instead of fighting its autocomplete.
export function EventFinder() {
  const [zip, setZip] = useState<string>(() => load('bm:ev-zip', ''));
  const [mi, setMi] = useState<'25' | '50' | '100'>(() => load('bm:ev-mi', '50'));
  const [kinds, setKinds] = useState<EventFilter[]>(() => load('bm:ev-kinds', ['league_cup', 'league_challenge']));
  const [where, setWhere] = useState<{ lat: number; lng: number; place: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { save('bm:ev-mi', mi); save('bm:ev-kinds', kinds); }, [mi, kinds]);
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the visitor's own time zone
  const url = where ? locatorUrl({ lat: where.lat, lng: where.lng, miles: +mi, filters: kinds, today }) : '';
  const lookup = async () => {
    setErr('');
    if (!/^\d{5}$/.test(zip)) { setErr('Enter a 5-digit ZIP code or use your location.'); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/geo?zip=${zip}`); const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'That ZIP code wasn’t found.');
      setWhere(d); save('bm:ev-zip', zip);
    } catch (e: any) { setErr(e.message); setWhere(null); } finally { setBusy(false); }
  };
  const locate = () => {
    setErr('');
    if (!navigator.geolocation) return setErr('This browser can’t share your location. Enter a ZIP code instead.');
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      pos => { setBusy(false); setWhere({ lat: pos.coords.latitude, lng: pos.coords.longitude, place: 'your location' }); },
      () => { setBusy(false); setErr('Location wasn’t shared. Enter a ZIP code instead.'); },
      { maximumAge: 600000, timeout: 10000 },
    );
  };
  const toggle = (k: EventFilter) => setKinds(ks => ks.includes(k) ? ks.filter(x => x !== k) : [...ks, k]);
  return (
    <div className="wrap page narrow-wide">
      <ToolHead title="Event finder">League Cups, League Challenges and prereleases near you. Pick a spot and we open the official Play! Pokémon event locator already searched, with the map and every event’s details.</ToolHead>
      <form className="panel ev-search" onSubmit={e => { e.preventDefault(); lookup(); }}>
        <div className="field-row">
          <label className="field"><span>ZIP code</span><input inputMode="numeric" autoComplete="postal-code" maxLength={5} value={zip} onChange={e => { setZip(e.target.value.replace(/\D/g, '').slice(0, 5)); setWhere(null); }} placeholder="33602" /></label>
        </div>
        <div className="row-gap"><button className="btn primary" disabled={busy}>Use this ZIP code</button><button type="button" className="btn" onClick={locate} disabled={busy}>Use my location</button></div>
        <Segmented label="Distance" value={mi} onChange={setMi} options={[{ value: '25', label: '25 mi' }, { value: '50', label: '50 mi' }, { value: '100', label: '100 mi' }]} />
        <div className="conds" role="group" aria-label="Event types">
          {EVENT_FILTERS.map(f => <button type="button" key={f.key} className={`chip-toggle ${kinds.includes(f.key) ? 'on' : ''}`} aria-pressed={kinds.includes(f.key)} onClick={() => toggle(f.key)}>{f.label}</button>)}
        </div>
      </form>
      {busy && <Spinner label="Finding that spot…" />}
      {err && <p className="form-error" role="alert">{err}</p>}
      {where && !busy && (
        <section className="panel ev-go" aria-live="polite">
          <p><b>{kinds.length ? EVENT_FILTERS.filter(f => kinds.includes(f.key)).map(f => f.label).join(', ') : 'All events'}</b> within {mi} miles of {where.place}</p>
          <a className="btn primary big" href={url} target="_blank" rel="noopener noreferrer">Show events<Icon name="external" size={14} /></a>
          <p className="muted small">Opens events.pokemon.com in a new tab. Your spot is rounded to about half a mile.</p>
        </section>
      )}
      <p className="muted small">Event data belongs to the <a href={SOURCES.eventLocator} target="_blank" rel="noopener noreferrer">Play! Pokémon event locator</a>. Always confirm times and fees with the store.</p>
    </div>
  );
}
