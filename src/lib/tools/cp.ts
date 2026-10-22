// Championship Points math for the Toolbox CP tracker. Numbers come from SEASON in ./policy.ts.
import { SEASON, type CpEventType } from './policy';

export type Finish = { id?: number | string; event_type: CpEventType; event_name: string; event_date: string | null; players: number | null; placement: number; cp: number };

/** CP for a placement at an event of this size (attendance in your age division). Unknown attendance: assume the bracket unlocked. */
export function cpFor(type: CpEventType, placement: number, players: number | null): number {
  const rows = SEASON.events[type]?.rows || [];
  const row = rows.find(r => placement >= r.from && placement <= r.to);
  if (!row) return 0;
  // A placement pays only from its own bracket, so a bracket the attendance didn't unlock pays nothing.
  return players != null && players < row.kicker ? 0 : row.cp;
}

export type Totals = { total: number; counted: Set<Finish>; byType: Record<string, { counted: number; logged: number; cp: number; best: number }> };

/** Season total with each event type's best-finish limit applied (highest CP counts, not best placement). */
export function seasonTotals(list: Finish[]): Totals {
  const counted = new Set<Finish>();
  const byType: Totals['byType'] = {};
  const pick = (items: Finish[], n: number) => [...items].sort((a, b) => b.cp - a.cp).slice(0, n).forEach(f => counted.add(f));
  pick(list.filter(f => f.event_type === 'challenge'), SEASON.events.challenge.best);
  pick(list.filter(f => f.event_type === 'cup'), SEASON.events.cup.best);
  pick(list.filter(f => SEASON.events[f.event_type]?.pool === 'major'), SEASON.majorBest);
  for (const [t, e] of Object.entries(SEASON.events)) {
    const mine = list.filter(f => f.event_type === t);
    const used = mine.filter(f => counted.has(f));
    byType[t] = { counted: used.length, logged: mine.length, cp: used.reduce((s, f) => s + f.cp, 0), best: e.pool === 'major' ? SEASON.majorBest : e.best };
  }
  return { total: [...counted].reduce((s, f) => s + f.cp, 0), counted, byType };
}

/** What a new finish would add to the season total once limits are applied. */
export const gainFrom = (list: Finish[], f: Finish) => seasonTotals([...list, f]).total - seasonTotals(list).total;

export type Division = 'Junior' | 'Senior' | 'Masters';
export function divisionFor(birthYear: number): Division {
  if (birthYear >= SEASON.divisions.junior) return 'Junior';
  if (birthYear >= SEASON.divisions.senior) return 'Senior';
  return 'Masters';
}
