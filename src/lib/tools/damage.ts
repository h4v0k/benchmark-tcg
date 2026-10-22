// Damage and prize math for the Toolbox. Pure functions, no network, unit tested in tests/unit.mjs.
// Rule sources live in ./policy.ts so the monthly recheck has one place to compare against the official rulebook.
import type { Card } from '../types';
import { POLICY } from './policy';

export type Mod = { label: string; amount: number };
export type DamageInput = {
  base: number;                      // printed damage, after any "x" or "+" the attack itself works out
  attackerMods: Mod[];               // effects on the attacking Pokémon (Tools, Abilities, attack text: "+30")
  weakness: string;                  // the defender's weakness value if it's weak to the attacker's type: "×2", "+20" or ''
  resistance: string;                // the defender's resistance value if it resists the attacker's type: "-30" or ''
  defenderMods: Mod[];               // effects on the defending Pokémon ("takes 30 less damage")
  counters?: boolean;                // the attack places damage counters instead of doing damage: skip every step
  benched?: boolean;                 // damage to a Benched Pokémon: no Weakness or Resistance
};
export type DamageStep = { label: string; value: number; note?: string };

/** Damage dealt, step by step, in the order the Pokémon TCG rulebook applies modifiers. */
export function calcDamage(i: DamageInput): { total: number; steps: DamageStep[] } {
  const steps: DamageStep[] = [];
  let d = Math.max(0, Math.round(i.base));
  steps.push({ label: 'Base damage', value: d });
  if (i.counters) return { total: d, steps: [{ label: 'Damage counters placed', value: d, note: 'Placing damage counters isn’t damage: Weakness, Resistance and damage changes don’t apply.' }] };
  if (d === 0 && !i.attackerMods.some(m => m.amount > 0)) return { total: 0, steps: [...steps, { label: 'No damage', value: 0, note: 'An attack that does no damage isn’t changed by Weakness, Resistance or other effects.' }] };
  for (const m of i.attackerMods) { d = Math.max(0, d + m.amount); steps.push({ label: m.label || 'Attacker effect', value: d }); }
  if (!i.benched && i.weakness) {
    const w = parseMod(i.weakness);
    if (w) { d = w.mult ? d * w.mult : d + w.add; steps.push({ label: `Weakness ${i.weakness}`, value: d }); }
  }
  if (!i.benched && i.resistance) {
    const r = parseMod(i.resistance);
    if (r) { d = Math.max(0, r.mult ? d * r.mult : d + r.add); steps.push({ label: `Resistance ${i.resistance}`, value: d }); }
  }
  for (const m of i.defenderMods) { d = Math.max(0, d + m.amount); steps.push({ label: m.label || 'Defender effect', value: d }); }
  if (i.benched && (i.weakness || i.resistance)) steps.push({ label: 'Benched target', value: d, note: 'Weakness and Resistance only apply to the Active Pokémon.' });
  return { total: d, steps };
}

/** "×2", "x2", "+20", "-30", "−30" → multiplier or addend. */
export function parseMod(v: string): { mult?: number; add: number } | null {
  const s = String(v || '').replace(/\s+/g, '').replace(/[−–]/g, '-');
  const m = s.match(/^[×x*](\d+)$/i);
  if (m) return { mult: +m[1], add: 0 };
  const a = s.match(/^([+-])(\d+)$/);
  if (a) return { add: (a[1] === '-' ? -1 : 1) * +a[2] };
  return null;
}

/** "120", "120+", "30×", "30x" → the printed number (the effect text says what the + or × does). */
export const printedDamage = (dmg: string) => +(String(dmg || '').match(/\d+/)?.[0] || 0);

/** Prize cards an opponent takes for Knocking Out this Pokémon. */
export function prizeValue(c: Pick<Card, 'name' | 'suffix' | 'category'> & { stage?: string }): number {
  // Rules are tested in order against "suffix|name", e.g. "ex|Mega Lucario ex" or "V|Zeraora VSTAR".
  const key = `${c.suffix || ''}|${c.name || ''}`;
  for (const rule of POLICY.prizes.rules) if (new RegExp(rule.match).test(key)) return rule.prizes;
  return POLICY.prizes.default;
}

/** Every distinct way (as a multiset of prize values) to take `need` prizes from the targets available. */
export function prizePaths(targets: number[], need: number): number[][] {
  const vals = [...targets].filter(v => v > 0).sort((a, b) => b - a);
  const out = new Map<string, number[]>();
  const walk = (i: number, got: number, path: number[]) => {
    if (got >= need) { const k = path.join(','); if (!out.has(k)) out.set(k, [...path]); return; }
    for (let j = i; j < vals.length; j++) {
      if (j > i && vals[j] === vals[j - 1]) continue; // skip duplicate branches
      path.push(vals[j]); walk(j + 1, got + vals[j], path); path.pop();
    }
  };
  walk(0, 0, []);
  // Drop paths that overshoot with a KO you didn't need (a path is minimal if removing its smallest KO falls short)
  return [...out.values()].filter(p => p.reduce((a, b) => a + b, 0) - p[p.length - 1] < need).sort((a, b) => a.length - b.length || b[0] - a[0]);
}

/** Fewest Knock Outs to take `need` prizes, or null if the targets can't add up. */
export const fewestKOs = (targets: number[], need: number) => { const p = prizePaths(targets, need); return p.length ? p[0].length : null; };
