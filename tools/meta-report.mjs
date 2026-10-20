// Weekly meta report: reads the public site data and writes ready-to-review drafts for Reddit, X and Discord.
// Nothing is posted; a person reviews the drafts and posts them. Run: node tools/meta-report.mjs [out-dir]
// The scheduled workflow (.github/workflows/meta-report.yml) runs it every Monday and attaches the drafts.
// Event mode: node tools/meta-report.mjs [out-dir] --events [hours] writes Top 8 drafts for each major whose
// lists landed in the last `hours` (default 24); .github/workflows/event-drafts.yml runs it daily.
import fs from 'node:fs';
import path from 'node:path';
import { SITE, SUPABASE_URL, SUPABASE_ANON_KEY } from '../worker/config.js';

const rest = async p => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!res.ok) throw new Error(`${p.split('?')[0]}: ${res.status}`);
  return res.json();
};

/** Everything the report needs, in one object (also the shape the unit test feeds renderReport). */
export async function loadData(now = new Date()) {
  const since = new Date(now.getTime() - 7 * 864e5).toISOString().slice(0, 10);
  const soft = p => p.catch(() => null);
  const [week, month, events, winners, meta, jp, movers] = await Promise.all([
    rest('rpc/matchup_decks?p_source=online&p_days=7'),
    rest('rpc/matchup_decks?p_source=online&p_days=30'),
    rest(`tournaments?select=id,name,date,players&date=gte.${since}&order=date.desc`),
    rest(`tournament_decks?select=tournament_id,player,archetype,card_count,tournaments!inner(date)&place=eq.1&tournaments.date=gte.${since}`),
    rest('rpc/tourney_meta?days=60'),
    soft(rest('rpc/jp_meta?p_days=14&p_preview_only=false')),
    soft(rest('rpc/price_movers?p_days=7&p_limit=5&p_standard=true')),
  ]);
  return { date: now.toISOString().slice(0, 10), week, month, events, winners, meta, jp: jp || [], movers };
}

const pct = (a, b) => (b ? (100 * a) / b : 0);
const wr = x => (x.win_pct == null ? '?' : Number(x.win_pct).toFixed(1));
const signed = n => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1);
const url = (p, campaign) => `${SITE}${p}?utm_source=${campaign.source}&utm_medium=social&utm_campaign=${campaign.campaign || `meta-${campaign.date}`}`;

/** Builds the meta numbers once, then formats them per channel. Pure: no network, so it can be tested. */
export function renderReport(d) {
  const total = d.week.reduce((n, x) => n + x.games, 0);
  const totalM = d.month.reduce((n, x) => n + x.games, 0);
  const prev = new Map(d.month.map(x => [x.deck, pct(x.games, totalM)]));
  const decks = d.week.filter(x => x.games >= 50).map(x => ({ ...x, share: pct(x.games, total), delta: pct(x.games, total) - (prev.get(x.deck) ?? 0) }))
    .sort((a, b) => b.share - a.share);
  const top = decks.slice(0, 8);
  const risers = [...decks].filter(x => x.share >= 1).sort((a, b) => b.delta - a.delta).slice(0, 3).filter(x => x.delta > 0.3);
  const bestWr = [...decks].filter(x => x.games >= 300 && x.win_pct != null).sort((a, b) => b.win_pct - a.win_pct).slice(0, 3);
  const byEvent = new Map(d.winners.map(w => [w.tournament_id, w]));
  const results = d.events.map(e => ({ ...e, win: byEvent.get(e.id) })).filter(e => e.win);
  const jp = (d.jp || []).slice(0, 5);
  const up = d.movers?.risers?.slice(0, 3) || [];

  const out = {};
  for (const source of ['reddit', 'x', 'discord']) {
    const c = { source, date: d.date };
    const L = (p, text) => (source === 'reddit' || source === 'discord' ? `[${text}](${url(p, c)})` : text);
    const lines = [];
    if (source === 'reddit') {
      lines.push(`# Weekly Standard meta snapshot (${d.date})`, '',
        `Numbers from ${total.toLocaleString('en-US')} games in Limitless online tournaments this week, plus this week's major results. Full matchup tables are free on ${L('/matchups', 'Benchmark')}.`, '',
        '## Most played', '', '| Deck | Share | Change vs 30 days | Win rate |', '|---|---|---|---|',
        ...top.map(x => `| ${L(`/matchups/${encodeURIComponent(x.deck)}`, x.name)} | ${x.share.toFixed(1)}% | ${signed(x.delta)} pts | ${wr(x)}% |`), '');
      if (risers.length) lines.push('## On the rise', '', ...risers.map(x => `- **${x.name}**: ${signed(x.delta)} pts of the field (now ${x.share.toFixed(1)}%)`), '');
      if (bestWr.length) lines.push('## Best win rates (300+ games)', '', ...bestWr.map(x => `- **${x.name}**: ${wr(x)}% over ${x.games.toLocaleString('en-US')} games`), '');
      if (results.length) lines.push('## Major results', '', ...results.map(e => `- ${L(`/events/${e.id}`, e.name)}${e.players ? ` (${e.players.toLocaleString('en-US')} players)` : ''}: won by ${e.win.player} with ${e.win.card_count != null ? L(`/events/${e.id}/1`, e.win.archetype) : e.win.archetype}`), '');
      if (jp.length) lines.push("## What's winning in Japan", '', ...jp.map(x => `- ${x.archetype}: ${x.wins} win${x.wins === 1 ? '' : 's'}, ${x.top8} top 8`), '', `More on the ${L('/events/japan', 'Japan page')}.`, '');
      if (up.length) lines.push('## Price risers', '', ...up.map(m => `- ${m.name} (${m.set_code} ${m.local_id}): $${m.from_price} → $${m.to_price} (${signed(m.pct)}%)`), '');
      lines.push('---', '', "I build Benchmark, a free deck builder that prices lists, checks legality and pulls these matchup numbers. Happy to answer questions about the data or take requests for next week's post.");
    } else if (source === 'x') {
      const t1 = [`Standard meta this week (${total.toLocaleString('en-US')} games):`, '', ...top.slice(0, 5).map((x, i) => `${i + 1}. ${x.name} ${x.share.toFixed(1)}% (${wr(x)}% WR)`)].join('\n');
      const t2 = risers.length ? ['Rising:', ...risers.map(x => `📈 ${x.name} ${signed(x.delta)} pts`)].join('\n') : '';
      const t3 = results.length ? ['Major winners:', ...results.slice(0, 4).map(e => `🏆 ${e.name}: ${e.win.archetype}`)].join('\n') : '';
      const t4 = `Full matchup tables, free:\n${url('/matchups', c)}`;
      lines.push(...[t1, t2, t3, t4].filter(Boolean).flatMap((t, i, a) => [`--- tweet ${i + 1}/${a.length} (${t.length} chars) ---`, t, '']));
    } else {
      lines.push(`**Weekly meta snapshot, ${d.date}** (${total.toLocaleString('en-US')} online games)`,
        ...top.slice(0, 6).map(x => `• ${x.name}: ${x.share.toFixed(1)}% of the field, ${wr(x)}% WR (${signed(x.delta)})`));
      if (results.length) lines.push('', ...results.slice(0, 4).map(e => `🏆 ${e.name}: ${e.win.archetype}`));
      lines.push('', `Matchups: <${url('/matchups', c)}>`);
    }
    out[source] = lines.join('\n').trim() + '\n';
  }
  return out;
}

/** Majors whose decklists landed recently, each with its standings (at least a full top 8 of lists). */
export async function loadEvents(hours = 24, now = new Date()) {
  const since = new Date(now.getTime() - hours * 36e5).toISOString();
  const fresh = await rest(`tournament_decks?select=tournament_id&card_count=not.is.null&fetched_at=gte.${since}`);
  const ids = [...new Set(fresh.map(r => r.tournament_id))];
  if (!ids.length) return [];
  const [ts, decks] = await Promise.all([
    rest(`tournaments?select=id,name,date,country,players,kind&id=in.(${ids.join(',')})`),
    rest(`tournament_decks?select=tournament_id,place,player,country,archetype,card_count,price&tournament_id=in.(${ids.join(',')})&order=place.asc`),
  ]);
  return ts.map(t => ({ t, decks: decks.filter(d => d.tournament_id === t.id) }))
    .filter(e => e.decks.filter(d => d.place <= 8 && d.card_count != null).length >= 8);
}

const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

/** Top 8 and archetype breakdown for one event, per channel. Pure, like renderReport. */
export function renderEvent({ t, decks }, date = t.date) {
  const top8 = decks.filter(d => d.place <= 8).sort((a, b) => a.place - b.place);
  const counts = new Map();
  for (const d of decks) if (d.archetype) counts.set(d.archetype, (counts.get(d.archetype) || 0) + 1);
  const field = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const win = top8[0];
  const slug = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const out = {};
  for (const source of ['reddit', 'x', 'discord']) {
    const c = { source, campaign: `event-${date}-${slug}` };
    const L = (p, text) => `[${text}](${url(p, c)})`;
    const lines = [];
    if (source === 'reddit') {
      lines.push(`# ${t.name}${t.players ? ` (${t.players.toLocaleString('en-US')} players)` : ''}: Top 8 decklists`, '',
        `${win.player} won with **${win.archetype}**. Every list below opens with prices, legality and a one-click TCGplayer cart.`, '',
        '| Place | Player | Deck | List |', '|---|---|---|---|',
        ...top8.map(d => `| ${ord(d.place)} | ${d.player}${d.country ? ` (${d.country})` : ''} | ${d.archetype} | ${d.card_count != null ? L(`/events/${t.id}/${d.place}`, 'View list') : 'coming'} |`), '');
      if (field.length) lines.push(`## Most played in the top ${decks.length}`, '', ...field.map(([a, n]) => `- ${L(`/archetype/${encodeURIComponent(a)}`, a)}: ${n}`), '');
      lines.push(`Full standings: ${L(`/events/${t.id}`, t.name)}`, '', '---', '', 'Lists from Limitless. I build Benchmark; questions about the data welcome.');
    } else if (source === 'x') {
      const t1 = [`🏆 ${t.name}${t.players ? ` (${t.players.toLocaleString('en-US')} players)` : ''}`, '', ...top8.map(d => `${ord(d.place)} ${d.archetype}`)].join('\n');
      const t2 = field.length ? [`Top ${decks.length} breakdown:`, ...field.slice(0, 6).map(([a, n]) => `${a}: ${n}`)].join('\n') : '';
      const t3 = `Winning list (${win.player}), priced and buyable:\n${url(`/events/${t.id}/1`, c)}`;
      lines.push(...[t1, t2, t3].filter(Boolean).flatMap((x, i, a) => [`--- tweet ${i + 1}/${a.length} (${x.length} chars) ---`, x, '']));
    } else {
      lines.push(`**${t.name} Top 8**${t.players ? ` (${t.players.toLocaleString('en-US')} players)` : ''}`,
        ...top8.map(d => `${ord(d.place)} ${d.archetype}: ${d.player}`), '', `Lists: <${url(`/events/${t.id}`, c)}>`);
    }
    out[source] = lines.join('\n').trim() + '\n';
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || 'meta-report';
  fs.mkdirSync(dir, { recursive: true });
  const ev = process.argv.indexOf('--events');
  if (ev > 0) {
    const events = await loadEvents(+process.argv[ev + 1] || 24);
    for (const e of events) for (const [k, v] of Object.entries(renderEvent(e))) fs.writeFileSync(path.join(dir, `event-${e.t.id}-${k}.md`), v);
    console.log(`wrote drafts for ${events.length} event(s) to ${dir}/`);
    process.exit(0);
  }
  const data = await loadData();
  const out = renderReport(data);
  for (const [k, v] of Object.entries(out)) fs.writeFileSync(path.join(dir, `${data.date}-${k}.md`), v);
  console.log(`wrote ${Object.keys(out).length} drafts to ${dir}/`);
}
