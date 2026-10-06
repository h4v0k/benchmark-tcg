import { ErrorBox, Icon, Spinner, useAsync } from '../components/ui';
import { Link } from '../router';
import * as api from '../lib/api';
import { ago, fmtDate } from '../lib/cards';

export function RulesPage() {
  const r = useAsync(async () => ({ rules: await api.rules(true), changes: await api.ruleChanges(60) }), []);
  if (r.loading) return <Spinner />;
  if (r.error) return <div className="wrap page"><ErrorBox error={r.error} onRetry={r.reload} /></div>;
  const { rules, changes } = r.data!;
  const std = rules.formats.find(f => f.format === 'standard');
  const bansBy = (f: string) => rules.bans.filter(b => b.format === f);
  const leaving = rules.next_rotation ? String.fromCharCode(rules.next_rotation.new_min_mark.charCodeAt(0) - 1) : '';
  return (
    <div className="wrap page narrow-wide">
      <div className="page-head"><h1>Formats & bans</h1><span className="muted">Checked {ago(rules.last_checked) || 'daily'} · catalog updated {ago(rules.last_catalog_sync) || 'recently'} · {rules.card_count.toLocaleString()} cards</span></div>
      <p className="lead">Benchmark checks the official Play! Pokémon ban list every day, reads each new rotation as soon as it’s announced, and adds new sets as they release. Every deck’s legality updates on its own.</p>

      <div className="rules-grid">
        <section className="panel">
          <div className="panel-head"><h2>Standard</h2>{std?.season && <span className="tag accent">{std.season} season</span>}</div>
          <p>Cards with regulation mark <b>{rules.standard_min_mark}</b> or later, plus Basic Energy. Older prints of a Trainer or Special Energy are legal when a print with a legal mark exists.</p>
          {rules.next_rotation ? (
            <p className="notice warn"><Icon name="warn" size={15} />Next rotation: mark {leaving} leaves Standard {rules.next_rotation.effective_date ? <>on <b>{fmtDate(rules.next_rotation.effective_date)}</b></> : <>(date to be confirmed)</>}{rules.next_rotation.online_date ? <> ({fmtDate(rules.next_rotation.online_date)} on Pokémon TCG Live)</> : null}.</p>
          ) : <p className="muted">No rotation announced yet.</p>}
          <h3>Banned in Standard</h3>
          {bansBy('standard').length ? <BanList bans={bansBy('standard')} /> : <p className="muted">No cards are banned.</p>}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Expanded</h2></div>
          <p>Cards from Black & White onward, minus the ban list below.</p>
          <h3>Banned in Expanded</h3>
          {bansBy('expanded').length ? <BanList bans={bansBy('expanded')} /> : <p className="muted">No cards are banned.</p>}
        </section>
      </div>

      {rules.upcoming_sets.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Coming up</h2></div>
          <ul className="changes">{rules.upcoming_sets.map(s => <li key={s.id}><span className="chg set_added">{s.code || 'set'}</span><span>{s.name}: released {fmtDate(s.release_date)}, tournament legal {fmtDate(s.legal_date)}</span></li>)}</ul>
        </section>
      )}

      <section className="panel">
        <div className="panel-head"><h2>Rules updates</h2></div>
        {changes.length ? (
          <ul className="changes">{changes.map(c => <li key={c.id}><span className={`chg ${c.kind}`}>{c.kind.replace('_', ' ')}</span><span><b>{c.title}</b>{c.detail ? <><br /><small className="muted">{c.detail}</small></> : null}</span><span className="muted">{fmtDate(c.happened_at)}</span></li>)}</ul>
        ) : <p className="muted">Changes to bans, rotation and set legality will show up here as they happen.</p>}
      </section>
      <p className="muted small">Sources: <a href="https://www.pokemon.com/us/play-pokemon/about/pokemon-tcg-banned-card-list" target="_blank" rel="noopener noreferrer">Play! Pokémon banned card list</a>, <a href="https://bulbapedia.bulbagarden.net/wiki/Standard_format_(TCG)" target="_blank" rel="noopener noreferrer">Bulbapedia format pages</a>, <a href="https://tcgdex.dev" target="_blank" rel="noopener noreferrer">TCGdex</a>. Something look wrong? <Link to="/users/Havok">Tell us</Link>.</p>
    </div>
  );
}

function BanList({ bans }: { bans: { card_name: string; printings: { set: string; num: string }[] }[] }) {
  return (
    <ul className="ban-list">
      {bans.map(b => <li key={b.card_name + b.printings.map(p => p.num).join()}><Link to={`/cards?q=${encodeURIComponent(b.card_name)}`}>{b.card_name}</Link> <span className="muted">{b.printings.map(p => `${p.set.replace(/^.*?[—–]\s*/, '')} ${p.num}`).join(', ')}</span></li>)}
    </ul>
  );
}
