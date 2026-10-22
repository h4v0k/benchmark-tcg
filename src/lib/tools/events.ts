// Links into the official Play! Pokémon event locator, already searched. The locator reads these query parameters
// (checked against events.pokemon.com on 2026-10-21); the monthly recheck confirms they still work.
import { SOURCES } from './policy';

export const EVENT_FILTERS = [
  { key: 'league_cup', label: 'League Cups' },
  { key: 'league_challenge', label: 'League Challenges' },
  { key: 'prerelease', label: 'Prereleases' },
  { key: 'league', label: 'League nights' },
] as const;
export type EventFilter = (typeof EVENT_FILTERS)[number]['key'];

/** Coordinates are rounded to 2 decimals (about half a mile) so an exact location never ends up in a link. */
export function locatorUrl(o: { lat: number; lng: number; miles: number; filters: EventFilter[]; today?: string }): string {
  const q = new URLSearchParams({
    locale: 'en-US',
    range: String(o.miles),
    iskm: 'false',
    latitude: o.lat.toFixed(2),
    longitude: o.lng.toFixed(2),
  });
  if (o.today) q.set('startdate', o.today);
  if (o.filters.length) q.set('filters', o.filters.join(','));
  return `${SOURCES.eventLocator}?${q.toString().replace(/%2C/g, ',')}`;
}
