// Weekly meta report: reads the public site data and writes ready-to-review drafts for Reddit, X and Discord.
// Nothing is posted; a person reviews the drafts and posts them. Run: node tools/meta-report.mjs [out-dir]
// The scheduled workflow (.github/workflows/meta-report.yml) runs it every Monday and attaches the drafts.
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
const signed = n => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1);
const url = (p, campaign) => `${SITE}${p}?utm_source=${campaign.source}&utm_medium=social&utm_campaign=meta-${campaign.date}`;

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
        ...top.map(x => `| ${L(`/matchups/${encodeURIComponent(x.deck)}`, x.name)} | ${x.share.toFixed(1)}% | ${signed(x.delta)} pts | ${x.win_pct ?? '?'}% |`), '');
      if (risers.length) lines.push('## On the rise', '', ...risers.map(x => `- **${x.name}**: ${signed(x.delta)} pts of the field (now ${x.share.toFixed(1)}%)`), '');
      if (bestWr.length) lines.push('## Best win rates (300+ games)', '', ...bestWr.map(x => `- **${x.name}**: ${x.win_pct}% over ${x.games.toLocaleString('en-US')} games`), '');
      if (results.length) lines.push('## Major results', '', ...results.map(e => `- ${L(`/events/${e.id}`, e.name)}${e.players ? ` (${e.players} players)` : ''}: won by ${e.win.player} with ${e.win.card_count != null ? L(`/events/${e.id}/1`, e.win.archetype) : e.win.archetype}`), '');
      if (jp.length) lines.push("## What's winning in Japan", '', ...jp.map(x => `- ${x.archetype}: ${x.wins} win${x.wins === 1 ? '' : 's'}, ${x.top8} top 8`), '', `More on the ${L('/events/japan', 'Japan page')}.`, '');
      if (up.length) lines.push('## Price risers', '', ...up.map(m => `- ${m.name} (${m.set_code} ${m.local_id}): $${m.from_price} → $${m.to_price} (${signed(m.pct)}%)`), '');
      lines.push('---', '', "I build Benchmark, a free deck builder that prices lists, checks legality and pulls these matchup numbers. Happy to answer questions about the data or take requests for next week's post.");
    } else if (source === 'x') {
      const t1 = [`Standard meta this week (${total.toLocaleString('en-US')} games):`, '', ...top.slice(0, 5).map((x, i) => `${i + 1}. ${x.name} ${x.share.toFixed(1)}% (${x.win_pct ?? '?'}% WR)`)].join('\n');
      const t2 = risers.length ? ['Rising:', ...risers.map(x => `📈 ${x.name} ${signed(x.delta)} pts`)].join('\n') : '';
      const t3 = results.length ? ['Major winners:', ...results.slice(0, 4).map(e => `🏆 ${e.name}: ${e.win.archetype}`)].join('\n') : '';
      const t4 = `Full matchup tables, free:\n${url('/matchups', c)}`;
      lines.push(...[t1, t2, t3, t4].filter(Boolean).flatMap((t, i, a) => [`--- tweet ${i + 1}/${a.length} (${t.length} chars) ---`, t, '']));
    } else {
      lines.push(`**Weekly meta snapshot, ${d.date}** (${total.toLocaleString('en-US')} online games)`,
        ...top.slice(0, 6).map(x => `• ${x.name}: ${x.share.toFixed(1)}% of the field, ${x.win_pct ?? '?'}% WR (${signed(x.delta)})`));
      if (results.length) lines.push('', ...results.slice(0, 4).map(e => `🏆 ${e.name}: ${e.win.archetype}`));
      lines.push('', `Matchups: <${url('/matchups', c)}>`);
    }
    out[source] = lines.join('\n').trim() + '\n';
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || 'meta-report';
  const data = await loadData();
  const out = renderReport(data);
  fs.mkdirSync(dir, { recursive: true });
  for (const [k, v] of Object.entries(out)) fs.writeFileSync(path.join(dir, `${data.date}-${k}.md`), v);
  console.log(`wrote ${Object.keys(out).length} drafts to ${dir}/`);
}
