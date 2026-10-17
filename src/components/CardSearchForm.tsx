// "Advanced search": plain fields that build a query in the card search syntax (lib/cardquery.ts).
import { useMemo, useState, type FormEvent } from 'react';
import { Icon } from './ui';
import { buildCardQuery, emptyCardForm, type CardFormValues, type CmpField } from '../lib/cardquery';

const KEY = 'bm.cardSearchForm';
const TYPES = ['Fire', 'Water', 'Grass', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon', 'Colorless'];
const OPS: [string, string][] = [['=', 'is'], ['<=', 'at most'], ['>=', 'at least'], ['<', 'less than'], ['>', 'more than'], ['!=', 'is not']];

function load(): CardFormValues {
  try { const raw = sessionStorage.getItem(KEY); if (raw) return { ...emptyCardForm(), ...JSON.parse(raw) }; } catch { /* storage unavailable */ }
  return emptyCardForm();
}
function save(v: CardFormValues) { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* ignore */ } }

export function CardSearchForm({ onSearch, onClear }: { onSearch: (q: string) => void; onClear: () => void }) {
  const [v, setV] = useState<CardFormValues>(load);
  const set = (p: Partial<CardFormValues>) => setV(o => { const n = { ...o, ...p }; save(n); return n; });
  const query = useMemo(() => buildCardQuery(v), [v]);
  const submit = (e: FormEvent) => { e.preventDefault(); onSearch(query); };
  const clear = () => { const e = emptyCardForm(); setV(e); save(e); onClear(); };
  const text = (id: string, label: string, key: 'name' | 'text' | 'attack' | 'ability' | 'set' | 'rarity' | 'artist', ph: string) => (
    <div className="sf-field">
      <label htmlFor={`sf-${id}`} className="sf-label">{label}</label>
      <input id={`sf-${id}`} value={v[key]} placeholder={ph} onChange={e => set({ [key]: e.target.value })} spellCheck={false} autoComplete="off" />
    </div>
  );
  const cmp = (id: string, label: string, key: 'hp' | 'retreat' | 'damage' | 'cost' | 'usd') => {
    const c: CmpField = v[key];
    return (
      <div className="sf-field">
        <label htmlFor={`sf-${id}-v`} className="sf-label">{label}</label>
        <div className="sf-pair">
          <select value={c.op} onChange={e => set({ [key]: { ...c, op: e.target.value } })} aria-label={`${label} comparison`}>
            {OPS.map(([o, t]) => <option key={o} value={o}>{t}</option>)}
          </select>
          <input id={`sf-${id}-v`} value={c.val} inputMode="decimal" placeholder="any" onChange={e => set({ [key]: { ...c, val: e.target.value } })} />
        </div>
      </div>
    );
  };
  const pick = (id: string, label: string, value: string, opts: [string, string][], on: (x: string) => void) => (
    <div className="sf-field">
      <label htmlFor={`sf-${id}`} className="sf-label">{label}</label>
      <select id={`sf-${id}`} value={value} onChange={e => on(e.target.value)}>
        <option value="">Any</option>{opts.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
      </select>
    </div>
  );
  const flag = (k: string, label: string) => (
    <button type="button" key={k} className="sf-toggle" aria-pressed={v.flags.includes(k)} onClick={() => set({ flags: v.flags.includes(k) ? v.flags.filter(x => x !== k) : [...v.flags, k] })}>{label}</button>
  );
  return (
    <form className="panel sf" onSubmit={submit} aria-label="Advanced search">
      <div className="sf-grid">
        {text('name', 'Card name contains', 'name', 'e.g. charizard')}
        {text('text', 'Rules text contains', 'text', 'e.g. draw 3 cards')}
        {text('atk', 'Attack name', 'attack', 'e.g. burning')}
        {text('ab', 'Ability name', 'ability', 'e.g. infernal reign')}
        {pick('cat', 'Category', v.category, [['pokemon', 'Pokémon'], ['trainer', 'Trainer'], ['energy', 'Energy']], x => set({ category: x as CardFormValues['category'] }))}
        {pick('type', 'Energy type', v.types[0] || '', TYPES.map(t => [t.toLowerCase(), t] as [string, string]), x => set({ types: x ? [x] : [] }))}
        {pick('stage', 'Stage or rule box', v.stage, [['basic', 'Basic'], ['stage1', 'Stage 1'], ['stage2', 'Stage 2'], ['mega', 'Mega'], ['ex', 'ex'], ['v', 'V'], ['vstar', 'VSTAR'], ['vmax', 'VMAX'], ['gx', 'GX']], x => set({ stage: x }))}
        {pick('tt', 'Trainer type', v.trainer, [['item', 'Item'], ['supporter', 'Supporter'], ['stadium', 'Stadium'], ['tool', 'Pokémon Tool']], x => set({ trainer: x }))}
        {cmp('hp', 'HP', 'hp')}
        {cmp('retreat', 'Retreat cost', 'retreat')}
        {cmp('damage', 'Attack damage', 'damage')}
        {cmp('cost', 'Attack energy cost', 'cost')}
        {pick('weak', 'Weakness', v.weak, TYPES.map(t => [t.toLowerCase(), t] as [string, string]), x => set({ weak: x }))}
        {text('set', 'Set (code or name)', 'set', 'e.g. sv04.5 or paldea')}
        {pick('reg', 'Regulation mark', v.marks[0] || '', ['G', 'H', 'I', 'J'].map(m => [m, m] as [string, string]), x => set({ marks: x ? [x] : [] }))}
        {text('rarity', 'Rarity', 'rarity', 'e.g. ultra rare')}
        {text('artist', 'Illustrator', 'artist', 'e.g. 5ban graphics')}
        {cmp('usd', 'Price (USD)', 'usd')}
        {pick('legal', 'Legal in', v.legal, [['standard', 'Standard'], ['expanded', 'Expanded']], x => set({ legal: x as CardFormValues['legal'] }))}
        <fieldset className="sf-field sf-wide">
          <legend className="sf-label">Only show</legend>
          <div className="sf-chips">{flag('ace', 'ACE SPEC')}{flag('radiant', 'Radiant')}{flag('ex', 'Pokémon ex')}{flag('basic-energy', 'Basic Energy')}</div>
        </fieldset>
      </div>
      <div className="sf-actions">
        <button type="submit" className="btn primary"><Icon name="search" />Search</button>
        <button type="button" className="btn" onClick={clear}>Clear</button>
      </div>
      <p className="muted small sf-used">Search used: <code>{query || '(nothing yet)'}</code></p>
    </form>
  );
}
