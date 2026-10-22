// Every official rule and organized-play number the Toolbox relies on, in one file.
// The monthly rules & policy recheck compares this file against the official sources listed in SOURCES,
// updates anything that changed, bumps `checked`, and opens a pull request. Keep numbers here, not in components.

export const SOURCES = {
  rulebook: 'https://www.pokemon.com/us/pokemon-tcg/rules',
  documents: 'https://play.pokemon.com/en-us/resources/documents/', // Tournament Rules Handbook, Penalty Guidelines
  championshipSeries: 'https://championships.pokemon.com/en-us/about/?pillar=tcg', // invites, rating zones
  seasonChanges: 'https://championships.pokemon.com/en-us/about/2027-season-changes', // age divisions
  leagueCp: 'https://championships.pokemon.com/en-us/about/league-challenges-and-league-cup?pillar=tcg',
  regionalCp: 'https://championships.pokemon.com/en-us/about/pokemon-regional-and-special-championships?pillar=tcg',
  internationalCp: 'https://championships.pokemon.com/en-us/about/international-championships?pillar=tcg',
};

export const POLICY = {
  /** Date this file was last checked against the official sources (YYYY-MM-DD). */
  checked: '2026-10-21',

  /** Order the rulebook applies damage changes in (shown in the damage calculator). */
  damageOrder: [
    'Base damage printed on the attack',
    'Effects on the Attacking Pokémon (Tools, Abilities, the attack’s own text)',
    'Weakness (Active Pokémon only)',
    'Resistance (Active Pokémon only)',
    'Effects on the Defending Pokémon (damage reduction, prevention)',
  ],

  /** Prize cards taken per Knock Out. First matching rule wins; tested against "suffix|name". */
  prizes: {
    default: 1,
    rules: [
      { match: '^ex\\|Mega .* ex$', prizes: 3, label: 'Mega Evolution Pokémon ex' },
      { match: '^TAG TEAM', prizes: 3, label: 'TAG TEAM Pokémon-GX' },
      { match: '^V\\|.*VMAX$', prizes: 3, label: 'Pokémon VMAX' },
      { match: '^V\\|.*V-UNION$', prizes: 3, label: 'Pokémon V-UNION' },
      { match: '^V\\|', prizes: 2, label: 'Pokémon V and VSTAR' },
      { match: '^ex\\|', prizes: 2, label: 'Pokémon ex' },
      { match: '^(EX|GX)\\|', prizes: 2, label: 'Pokémon-EX and Pokémon-GX' },
    ],
  },
  prizeCount: 6,
  benchSize: 5,

  /** Pokémon Checkup (between turns), in the rulebook's order. */
  checkup: [
    { condition: 'poisoned', text: 'Poisoned: put 1 damage counter on it (more if the effect says so).' },
    { condition: 'burned', text: 'Burned: put 2 damage counters on it, then flip a coin. Heads, it recovers.' },
    { condition: 'asleep', text: 'Asleep: flip a coin. Heads, it wakes up.' },
    { condition: 'paralyzed', text: 'Paralyzed: it recovers if it was Paralyzed since the start of its owner’s last turn.' },
  ],
  /** Asleep, Confused and Paralyzed replace each other; Poisoned and Burned stack with anything. */
  exclusiveConditions: ['asleep', 'confused', 'paralyzed'],

  /** Once-per-turn and once-per-game things players lose track of (in-game tracker). */
  perTurn: ['Supporter played', 'Energy attached', 'Retreated', 'Stadium played'],
  perGame: ['VSTAR Power used', 'GX attack used (Expanded)'],
};

export type CpEventType = 'challenge' | 'cup' | 'regional' | 'special' | 'international';
/** A placement bracket pays `cp` only when the event (in your age division) had at least `kicker` players. */
export type CpRow = { from: number; to: number; kicker: number; cp: number };

/** Championship Series season data for the CP tracker and age divisions. */
export const SEASON = {
  season: '2027',
  /** true once every number below has been read off the official championships.pokemon.com pages (SOURCES). */
  verified: true,
  source: SOURCES.championshipSeries,
  firstEvent: '2026-09-18',
  worlds: { date: '2027-08-13', where: 'Singapore' },
  events: {
    challenge: { label: 'League Challenge', best: 4, rows: [
      { from: 1, to: 1, kicker: 0, cp: 15 }, { from: 2, to: 2, kicker: 4, cp: 12 }, { from: 3, to: 4, kicker: 8, cp: 10 },
      { from: 5, to: 8, kicker: 14, cp: 8 }, { from: 9, to: 16, kicker: 25, cp: 6 }, { from: 17, to: 32, kicker: 48, cp: 4 },
    ] },
    cup: { label: 'League Cup', best: 4, rows: [
      { from: 1, to: 1, kicker: 0, cp: 50 }, { from: 2, to: 2, kicker: 4, cp: 40 }, { from: 3, to: 4, kicker: 8, cp: 32 },
      { from: 5, to: 8, kicker: 17, cp: 25 }, { from: 9, to: 16, kicker: 48, cp: 20 }, { from: 17, to: 32, kicker: 80, cp: 16 },
      { from: 33, to: 64, kicker: 128, cp: 13 },
    ] },
    regional: { label: 'Regional Championship', best: 5, pool: 'major', rows: [
      { from: 1, to: 1, kicker: 0, cp: 350 }, { from: 2, to: 2, kicker: 4, cp: 325 }, { from: 3, to: 4, kicker: 8, cp: 300 },
      { from: 5, to: 8, kicker: 17, cp: 280 }, { from: 9, to: 16, kicker: 33, cp: 200 }, { from: 17, to: 32, kicker: 65, cp: 160 },
      { from: 33, to: 64, kicker: 129, cp: 120 }, { from: 65, to: 128, kicker: 257, cp: 80 }, { from: 129, to: 256, kicker: 513, cp: 60 },
      { from: 257, to: 512, kicker: 1025, cp: 45 }, { from: 513, to: 1024, kicker: 2049, cp: 22 },
    ] },
    special: { label: 'Special Event', best: 5, pool: 'major', rows: [] as CpRow[] }, // same table as Regionals (filled below)
    international: { label: 'International Championship', best: 5, pool: 'major', rows: [
      { from: 1, to: 1, kicker: 0, cp: 500 }, { from: 2, to: 2, kicker: 4, cp: 480 }, { from: 3, to: 4, kicker: 8, cp: 420 },
      { from: 5, to: 8, kicker: 17, cp: 380 }, { from: 9, to: 16, kicker: 33, cp: 300 }, { from: 17, to: 32, kicker: 65, cp: 240 },
      { from: 33, to: 64, kicker: 129, cp: 180 }, { from: 65, to: 128, kicker: 257, cp: 140 }, { from: 129, to: 256, kicker: 513, cp: 100 },
      { from: 257, to: 512, kicker: 1025, cp: 85 }, { from: 513, to: 1024, kicker: 2049, cp: 42 },
    ] },
  } as Record<CpEventType, { label: string; best: number; pool?: 'major'; rows: CpRow[] }>,
  /** Regionals, Special Events and Internationals share one "best N" pool. */
  majorBest: 5,
  /** Worlds invites: a set number per rating zone and division, filled from the CP leaderboard (no fixed threshold). */
  invites: {
    note: 'Invites go to the top of each rating zone’s CP leaderboard, so the cutoff moves with the season.',
    zones: [
      { zone: 'USA & Canada', junior: 100, senior: 100, masters: 140 },
      { zone: 'Europe', junior: 100, senior: 100, masters: 140 },
      { zone: 'Latin America', junior: 75, senior: 75, masters: 125 },
      { zone: 'Oceania', junior: 15, senior: 15, masters: 20 },
      { zone: 'Middle East & South Africa', junior: 5, senior: 5, masters: 10 },
    ],
    direct: '1st at a Regional or Special Championship, top 4 at an International Championship, or top 4 at the previous Worlds.',
  },
  /** Age divisions by birth year, fixed for the whole season. */
  divisions: { junior: 2015, senior: 2011 }, // born 2015+ Junior, 2011–2014 Senior, 2010 or earlier Masters
};
SEASON.events.special.rows = SEASON.events.regional.rows;
