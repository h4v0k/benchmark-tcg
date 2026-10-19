// Japan preview: City League and Champions League results. Japan plays the next set before the US does,
// so these lists can hold cards (the preview set, e.g. Delta Reign) that aren't legal in US Standard yet.
// Nothing here is shown as Standard legal: preview cards are marked, and there's no legality panel or "copy to my decks".
import { useMemo, useState } from 'react';
import { Empty, ErrorBox, Icon, Segmented, Spinner, Tag, copyText, useAsync } from '../components/ui';
import { Link, navigate, setQuery, useRoute } from '../router';
import { toast } from '../state';
import * as api from '../lib/api';
import { fmtDate, money, sum } from '../lib/cards';
import type { Card } from '../lib/types';

const ord = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const DAYS = ['7', '14', '30', '90'] as const;
type Days = typeof DAYS[number];
const KIND: Record<api.JpKind, string> = { city_league: 'City League', major: 'Champions League' };
const SEC: Record<string, string> = { pokemon: 'Pokémon', trainer: 'Trainer', energy: 'Energy', other: 'Other' };

const Credit = () => <p className="muted small credit">Japanese results and lists from <a href="https://limitlesstcg.com/tournaments/jp" target="_blank" rel="noopener noreferrer">Limitless</a>. Card names for unreleased cards are Limitless’s unofficial translations.</p>;

/** The marker used everywhere a preview-set card appears. */
export const PreviewTag = ({ info }: { info?: api.JpInfo }) => <span className="tag dr" title={info ? `${info.name} (${info.jp_name} in Japan): not legal in US Standard yet` : undefined}>{info?.name || 'New set'}</span>;

/** Worldwide / Japan switch shown at the top of both tournament pages. */
export function RegionSwitch({ value }: { value: 'world' | 'jp' }) {
  return <Segmented label="Region" value={value} onChange={v => navigate(v === 'jp' ? '/events/japan' : '/events')}
    options={[{ value: 'world', label: 'Worldwide' }, { value: 'jp', label: <>Japan <span className="dr-dot" aria-hidden="true" /></> }]} />;
}

function PreviewNotice({ info }: { info?: api.JpInfo }) {
  if (!info?.name) return null;
  const legal = info.us_legal ? `becomes legal in US Standard on ${fmtDate(info.us_legal)}` : 'isn’t legal in US Standard yet';
  const arrives = info.us_release ? ` on ${fmtDate(info.us_release)}` : '';
  return (
    <div className="notice dr-notice">
      <Icon name="info" size={15} />
      <span>Japan already plays <b>{info.jp_name}</b>. It comes to the US as <b>{info.name}</b>{arrives} and {legal}. Its cards are marked <PreviewTag info={info} />. These decks preview the coming format; they aren’t lists you can bring to a US event today.</span>
    </div>
  );
}

const useInfo = () => useAsync(() => api.jpInfo(), []);
const cardPath = (name: string, days?: string) => `/events/japan/card/${encodeURIComponent(name)}${days && days !== '14' ? `?days=${days}` : ''}`;
const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;
/** Banner while Japanese results are still being collected. */
export function SyncNote({ info, compact = false }: { info?: api.JpInfo; compact?: boolean }) {
  const q = info?.queued;
  if (!q || (!q.lists && !q.standings)) return null;
  const left = [q.lists ? plural(q.lists, 'list') : '', q.standings ? plural(q.standings, 'event') : ''].filter(Boolean).join(' and ');
  if (compact) return <p className="notice sync-note"><span className="spinner" aria-hidden="true" /><span><b>Japan tournament sync in progress.</b> {left} still loading. <Link to="/events/japan">See Japan results so far</Link>.</span></p>;
  return (
    <div className="notice sync-note" role="status">
      <span className="spinner" aria-hidden="true" />
      <span><b>Tournament sync in progress.</b> We’re still collecting Japanese results: {left} to go. Wins and top finishes load first, so rankings and counts will keep moving until it’s done.</span>
    </div>
  );
}
const ONLY = 'dr';

export function JapanPage() {
  const { query } = useRoute();
  const days: Days = (DAYS as readonly string[]).includes(query.get('days') || '') ? query.get('days') as Days : '14';
  const only = query.get('only') === ONLY;
  const info = useInfo();
  const sort: api.JpCardSort = query.get('sort') === 'played' ? 'played' : 'wins';
  const cards = useAsync(() => api.jpPreviewCards(+days, sort), [days, sort]);
  const meta = useAsync(() => api.jpMeta(+days, only), [days, only]);
  const ev = useAsync(() => api.jpEvents(+days), [days]);
  const [kind, setKind] = useState<'all' | api.JpKind>('all');
  const events = (ev.data || []).filter(t => (kind === 'all' || t.kind === kind) && (!only || t.preview_lists > 0));
  const maxPts = Math.max(1, ...(meta.data || []).map(m => m.points));
  const cardVal = (c: api.JpCardRow) => sort === 'played' ? (c.share || 0) : c.points;
  const maxCard = Math.max(1, ...(cards.data || []).map(cardVal));
  const name = info.data?.name || 'new set';
  const q = (o: Record<string, string | null>) => setQuery(o);

  return (
    <div className="wrap page">
      <div className="page-head"><h1>Tournaments</h1><RegionSwitch value="jp" /></div>
      <p className="muted lede">City League and Champions League results from Japan, with lists down to 32nd where the event posts them (City Leagues usually post 16).</p>
      <PreviewNotice info={info.data} />
      <SyncNote info={info.data} />

      <div className="mu-filters jp-filters">
        <Segmented label="Period" value={days} onChange={v => q({ days: v === '14' ? null : v })} options={DAYS.map(d => ({ value: d, label: `${d} days` }))} />
        <button type="button" className={`chip dr-toggle ${only ? 'on' : ''}`} aria-pressed={only} onClick={() => q({ only: only ? null : ONLY })}>
          <span className="dr-dot" aria-hidden="true" />Only decks with {name}
        </button>
      </div>

      <section className="panel meta-panel">
        <div className="panel-head"><h2>{sort === 'wins' ? `Winningest ${name} cards` : `Most played ${name} cards`}</h2>
          <Segmented label="Rank cards by" value={sort} onChange={v => q({ sort: v === 'wins' ? null : v })} options={[{ value: 'wins', label: 'Results' }, { value: 'played', label: 'Play rate' }]} />
        </div>
        <p className="muted small jp-explain">{sort === 'wins' ? 'Ranked by finishes of the lists that play each card: a win counts 8, 2nd 6, top 4 4, top 8 2, top 16 1, top 32 ½.' : 'Ranked by the share of lists in this period that play each card.'}</p>
        {cards.loading ? <Spinner /> : cards.error ? <ErrorBox error={cards.error} onRetry={cards.reload} /> : !cards.data?.length ? <p className="muted">No lists with {name} cards in this period yet.</p> : (
          <ol className="meta-list jp-cards">
            {cards.data.slice(0, 25).map((c, i) => (
              <li key={c.name}>
                <div className="meta-row">
                  <Link className="meta-name mu-deck-link" to={cardPath(c.name, days)}><span className="jp-rank">{i + 1}</span><b>{c.name}</b></Link>
                  <span className="meta-stats">{[c.wins ? plural(c.wins, 'win') : '', c.top4 ? `${c.top4} top 4` : '', c.top8 ? `${c.top8} top 8` : '', `in ${c.share ?? 0}% of lists (${c.lists})`, `${c.avg_copies} ${c.avg_copies === 1 ? 'copy' : 'copies'}`].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="meta-bar dr" aria-hidden="true"><span style={{ width: `${Math.max(3, (cardVal(c) / maxCard) * 100)}%` }} /></div>
                <div className="small muted">
                  {c.top_decks?.length ? <>Most played in {c.top_decks.join(', ')}</> : null}
                  {c.best_tournament && c.best_place ? <>{c.top_decks?.length ? ' · ' : ''}<Link to={`/events/japan/${c.best_tournament}/${c.best_place}`}>Best: {ord(c.best_place)} place list →</Link></> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel meta-panel">
        <div className="panel-head"><h2>What’s winning in Japan</h2></div>
        {meta.loading ? <Spinner /> : meta.error ? <ErrorBox error={meta.error} onRetry={meta.reload} /> : !meta.data?.length ? <p className="muted">No results in this period yet.</p> : (
          <ol className="meta-list">
            {meta.data.slice(0, 15).map(m => (
              <li key={m.archetype}>
                <div className="meta-row">
                  <span className="meta-name"><b>{m.archetype}</b>{m.preview_lists > 0 && <> <PreviewTag info={info.data} /></>}</span>
                  <span className="meta-stats">{[m.wins ? plural(m.wins, 'win') : '', `${m.top4} top 4`, `${m.top8} top 8`, `${m.placings} placings`].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="meta-bar" aria-hidden="true"><span style={{ width: `${Math.max(3, (m.points / maxPts) * 100)}%` }} /></div>
                <div className="small muted">
                  {m.lists ? `${name} in ${m.preview_lists} of ${m.lists} list${m.lists > 1 ? 's' : ''}` : 'No lists yet'}
                  {m.best_tournament && m.best_place ? <> · <Link to={`/events/japan/${m.best_tournament}/${m.best_place}`}>Best finish: {ord(m.best_place)} place list →</Link></> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="events-head">
        <h2>Events</h2>
        <Segmented label="Type" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'city_league', label: 'City Leagues' }, { value: 'major', label: 'Champions League' }]} />
      </div>
      {ev.loading ? <Spinner /> : ev.error ? <ErrorBox error={ev.error} onRetry={ev.reload} /> : !events.length ? <Empty title="No events yet" icon="list"><p>Japanese results are added automatically through the day.</p></Empty> : (
        <ul className="event-list">
          {events.map(t => (
            <li key={t.id}>
              <Link to={`/events/japan/${t.id}`} className="event-row">
                <div className="grow">
                  <div className="event-name">{t.name}</div>
                  <div className="muted small">{[fmtDate(t.date), t.shop, t.players ? `${t.players.toLocaleString()} players` : '', t.winner ? `Won by ${t.winner}` : ''].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="event-side">
                  <Tag tone={t.kind === 'major' ? 'ok' : 'info'}>{KIND[t.kind]}</Tag>
                  <span className="muted small">{t.lists ? `${t.lists} list${t.lists > 1 ? 's' : ''}` : 'Lists coming'}</span>
                  {t.preview_lists > 0 && <span className="small dr-text">{t.preview_lists} with {name}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Credit />
    </div>
  );
}

export function JapanEventPage({ id }: { id: string }) {
  const info = useInfo();
  const r = useAsync(() => api.jpEvent(id), [id]);
  if (r.loading) return <Spinner />;
  if (r.error) return <div className="wrap page"><ErrorBox error={r.error} onRetry={r.reload} /></div>;
  if (!r.data) return <div className="wrap page"><Empty title="Event not found" icon="list"><Link to="/events/japan" className="btn">Japanese tournaments</Link></Empty></div>;
  const { t, decks } = r.data;
  const listTop = 32;
  return (
    <div className="wrap page">
      <p className="crumbs"><Link to="/events">Tournaments</Link> › <Link to="/events/japan">Japan</Link></p>
      <SyncNote info={info.data} />
      <div className="page-head"><h1>{t.name}</h1></div>
      <p className="muted">{[fmtDate(t.date), t.shop, t.players ? `${t.players.toLocaleString()} players` : ''].filter(Boolean).join(' · ')} · <Tag tone={t.kind === 'major' ? 'ok' : 'info'}>{KIND[t.kind]}</Tag> <Tag tone="warn">Japan format</Tag></p>
      <PreviewNotice info={info.data} />
      {!decks.length ? <Empty title="Standings coming soon" icon="list"><p>They’re added automatically once Limitless posts them.</p></Empty> : (
        <ol className="standings">
          {decks.map(d => {
            const ready = d.card_count != null;
            const body = (
              <>
                <span className="st-place">{ord(d.place)}</span>
                <span className="grow st-main">
                  <b>{d.archetype || 'Unknown deck'}{d.has_preview && <> <PreviewTag info={info.data} /></>}</b>
                  <span className="muted small">{d.player}</span>
                </span>
                <span className="st-side">{ready ? <><span className="muted small">{d.has_preview ? `${d.preview_qty} new` : 'No new cards'}</span><Icon name="chevron" size={14} /></> : <span className="muted small">{!d.list_ref ? 'No list' : d.place <= listTop ? 'Loading list' : 'On Limitless'}</span>}</span>
              </>
            );
            return <li key={d.place}>{ready
              ? <Link to={`/events/japan/${t.id}/${d.place}`} className={`st-row ${d.has_preview ? 'dr-row' : ''}`}>{body}</Link>
              : d.list_ref ? <a href={`https://limitlesstcg.com/decks/list/${d.list_ref}`} target="_blank" rel="noopener noreferrer" className="st-row off">{body}</a>
              : <div className="st-row off">{body}</div>}</li>;
          })}
        </ol>
      )}
      <Credit />
    </div>
  );
}

const lineText = (l: api.JpLine) => `${l.qty} ${l.name} ${l.code} ${l.num}`.trim();

export function JapanDeckPage({ id, place }: { id: string; place: number }) {
  const info = useInfo();
  const r = useAsync(async () => {
    const x = await api.jpDeck(id, place);
    const ids = (x?.d.cards || []).map(l => l.cid).filter((c): c is string => !!c);
    return x ? { ...x, cards: ids.length ? await api.cardsById(ids) : new Map<string, Card>() } : null;
  }, [id, place]);
  const groups: { sec: string; lines: api.JpLine[] }[] = useMemo(() => {
    const lines = r.data?.d.cards || [];
    return ['pokemon', 'trainer', 'energy', 'other'].map(s => ({ sec: s, lines: lines.filter(l => l.sec === s) })).filter(g => g.lines.length);
  }, [r.data]);
  if (r.loading) return <Spinner />;
  if (r.error) return <div className="wrap page"><ErrorBox error={r.error} onRetry={r.reload} /></div>;
  if (!r.data || !r.data.d.cards) return <div className="wrap page"><Empty title="List not available yet" icon="list"><Link to={`/events/japan/${id}`} className="btn">Back to the event</Link></Empty></div>;
  const { t, d, cards } = r.data;
  const name = info.data?.name || 'new set';
  const preview = d.cards!.filter(l => l.preview);
  const copy = async () => {
    const text = groups.map(g => `${SEC[g.sec]}: ${sum(g.lines, l => l.qty)}\n${g.lines.map(lineText).join('\n')}`).join('\n\n');
    toast(await copyText(text) ? 'List copied' : 'Couldn’t copy', 'ok');
  };
  return (
    <div className="event-deck">
      <div className="deck-hero"><div className="wrap deck-hero-inner"><div className="deck-hero-text">
        <p className="crumbs"><Link to="/events">Tournaments</Link> › <Link to="/events/japan">Japan</Link> › <Link to={`/events/japan/${t.id}`}>{t.name}</Link></p>
        <div className="row-gap"><Tag tone="accent">{ord(d.place)} place</Tag><Tag tone={t.kind === 'major' ? 'ok' : 'info'}>{KIND[t.kind]}</Tag>{d.has_preview && <PreviewTag info={info.data} />}</div>
        <h1 className="deck-title">{d.archetype || 'Deck'}</h1>
        <p className="muted">{d.player} · {t.name}{t.shop ? ` (${t.shop})` : ''} · {fmtDate(t.date)}</p>
        <div className="deck-actions">
          <button className="btn" onClick={copy}><Icon name="copy" />Copy list</button>
          {d.list_ref && <a className="btn" href={`https://limitlesstcg.com/decks/list/${d.list_ref}`} target="_blank" rel="noopener noreferrer"><Icon name="link" />Limitless</a>}
        </div>
      </div></div></div>
      <div className="wrap">
        <SyncNote info={info.data} />
        <PreviewNotice info={info.data} />
        {preview.length > 0
          ? <div className="dr-summary"><b><span className="dr-dot" aria-hidden="true" /> {sum(preview, l => l.qty)} {name} card{sum(preview, l => l.qty) > 1 ? 's' : ''} in this list</b><span className="muted">{[...new Set(preview.map(l => l.name))].join(', ')}. Not legal in US Standard yet.</span></div>
          : <p className="muted">Every card in this list is from a set already out in the US.</p>}
        {!!d.missing?.length && <p className="notice warn"><Icon name="warn" size={15} />Not matched to a card yet: {d.missing.join(', ')}.</p>}
        <div className="text-view jp-list">
          {groups.map(g => (
            <section key={g.sec} className="group">
              <h3 className="group-head"><span>{SEC[g.sec]}</span><span className="count">{sum(g.lines, l => l.qty)}</span></h3>
              <ul>
                {g.lines.map(l => {
                  const c = l.cid ? cards.get(l.cid) : undefined;
                  const inner = (
                    <>
                      <span className="qty">{l.qty}</span>
                      <span className="name">{l.name}</span>
                      {l.preview && <span className="row-tags"><PreviewTag info={info.data} /></span>}
                      <span className="set-code">{l.code} {l.num}</span>
                    </>
                  );
                  return (
                    <li key={l.i} className={`row ${l.preview ? 'dr' : ''}`} data-preview={c?.image || undefined}>
                      {l.preview
                        ? <Link className="row-main" to={cardPath(l.name)} title={`How ${l.name} is doing in Japan`}>{inner}</Link>
                        : c ? <Link className="row-main" to={`/cards/${encodeURIComponent(c.id)}`}>{inner}</Link>
                        : <span className="row-main">{inner}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <p className="muted small">{d.card_count} cards{d.price ? ` · ${money(d.price)} for the cards already sold in the US` : ''}.</p>
        <Credit />
      </div>
    </div>
  );
}

/** One preview-set card: its results, every list that plays it, and what those lists play with it. */
export function JapanCardPage({ name }: { name: string }) {
  const { query } = useRoute();
  const days: Days = (DAYS as readonly string[]).includes(query.get('days') || '') ? query.get('days') as Days : '14';
  const info = useInfo();
  const stats = useAsync(async () => (await api.jpPreviewCards(+days, 'wins')).find(c => c.name === name) || null, [name, days]);
  const fin = useAsync(() => api.jpCardFinishes(name, +days), [name, days]);
  const partners = useAsync(() => api.jpCardPartners(name, +days), [name, days]);
  const s = stats.data;
  const set = info.data?.name || 'new set';
  return (
    <div className="wrap page mu-page">
      <p className="crumbs"><Link to="/events">Tournaments</Link> › <Link to={`/events/japan${days !== '14' ? `?days=${days}` : ''}`}>Japan</Link></p>
      <div className="page-head mu-head"><h1>{name}</h1></div>
      <div className="row-gap"><PreviewTag info={info.data} />{s && <a className="small" href={api.jpCardHref(s.code, s.num)} target="_blank" rel="noopener noreferrer">Translated card text on Limitless ({s.code} {s.num})<Icon name="forward" size={12} /></a>}</div>
      <div className="mu-filters jp-filters">
        <Segmented label="Period" value={days} onChange={v => setQuery({ days: v === '14' ? null : v })} options={DAYS.map(d => ({ value: d, label: `${d} days` }))} />
      </div>
      <SyncNote info={info.data} />
      {stats.loading ? <Spinner /> : !s ? <Empty title={`No lists with ${name} in this period`} icon="list"><p>Try a longer period.</p></Empty> : (
        <>
          <dl className="jp-stats">
            <div><dt>Wins</dt><dd>{s.wins}</dd></div>
            <div><dt>Top 4</dt><dd>{s.top4}</dd></div>
            <div><dt>Top 8</dt><dd>{s.top8}</dd></div>
            <div><dt>Lists</dt><dd>{s.lists}</dd></div>
            <div><dt>Play rate</dt><dd>{s.share ?? 0}%</dd></div>
            <div><dt>Copies</dt><dd>{s.avg_copies}</dd></div>
            <div><dt>Avg finish</dt><dd>{s.avg_place != null ? ord(Math.round(s.avg_place)) : '—'}</dd></div>
          </dl>
          {s.top_decks?.length ? <p className="muted">Most played in {s.top_decks.join(', ')}.</p> : null}

          <section className="panel meta-panel">
            <div className="panel-head"><h2>Played with</h2></div>
            <p className="muted small jp-explain">Other cards in lists that play {name}: how many of those lists include each, and how many copies.</p>
            {partners.loading ? <Spinner /> : partners.error ? <ErrorBox error={partners.error} onRetry={partners.reload} /> : (
              <ul className="jp-partners">
                {(partners.data || []).map(p => (
                  <li key={p.name} className={p.preview ? 'dr' : ''}>
                    <span className="grow">{p.preview ? <Link to={cardPath(p.name, days)}>{p.name}</Link> : p.cid ? <Link to={`/cards/${encodeURIComponent(p.cid)}`}>{p.name}</Link> : p.name}{p.preview && <> <PreviewTag info={info.data} /></>}</span>
                    <span className="muted small">{p.share ?? 0}% · {p.avg_copies}×</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel meta-panel">
            <div className="panel-head"><h2>Finishes</h2></div>
            {fin.loading ? <Spinner /> : fin.error ? <ErrorBox error={fin.error} onRetry={fin.reload} /> : (
              <ol className="standings">
                {(fin.data || []).map(f => (
                  <li key={`${f.tournament_id}-${f.place}`}>
                    <Link to={`/events/japan/${f.tournament_id}/${f.place}`} className="st-row dr-row">
                      <span className="st-place">{ord(f.place)}</span>
                      <span className="grow st-main"><b>{f.archetype || 'Deck'}</b><span className="muted small">{[f.event_name, fmtDate(f.date), f.player].filter(Boolean).join(' · ')}</span></span>
                      <span className="st-side"><span className="muted small">{f.qty}×</span><Icon name="chevron" size={14} /></span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
      <p className="muted small">{set} cards aren’t legal in US Standard yet.</p>
      <Credit />
    </div>
  );
}
