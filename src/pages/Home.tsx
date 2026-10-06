import { useEffect, useState } from 'react';
import { DeckGrid } from '../components/DeckTile';
import { NewDeckModal } from '../components/NewDeck';
import { Icon, Spinner } from '../components/ui';
import { Link, navigate } from '../router';
import { useAuth } from '../state';
import * as api from '../lib/api';
import { ago, fmtDate } from '../lib/cards';
import type { DeckRow, RuleChange, Rules } from '../lib/types';

export function Home() {
  const { session, profile } = useAuth();
  const [featured, setFeatured] = useState<DeckRow[] | null>(null);
  const [popular, setPopular] = useState<DeckRow[] | null>(null);
  const [recent, setRecent] = useState<DeckRow[] | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [changes, setChanges] = useState<RuleChange[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => {
    api.listDecks({ featured: true, per: 6 }).then(r => setFeatured(r.rows)).catch(() => setFeatured([]));
    api.listDecks({ sort: 'likes', per: 8, format: 'standard' }).then(r => setPopular(r.rows)).catch(() => setPopular([]));
    api.listDecks({ sort: 'updated', per: 8 }).then(r => setRecent(r.rows)).catch(() => setRecent([]));
    api.rules().then(setRules).catch(() => {});
    api.ruleChanges(6).then(setChanges).catch(() => {});
  }, []);
  const start = () => (session && profile ? setImportOpen(true) : navigate('/signup'));
  return (
    <div className="home">
      <section className="hero">
        <div className="wrap hero-inner">
          <div>
            <h1>The Pokémon TCG deck builder that keeps up with the game.</h1>
            <p className="lead">Paste a list or a YouTube link and get a priced, legality-checked deck in seconds. Standard and Expanded legality update on their own as sets release, bans land and cards rotate. Buy the exact printings on TCGplayer in one click.</p>
            <div className="row-gap">
              <button className="btn primary big" onClick={start}><Icon name="upload" />Import a deck</button>
              <Link to="/decks" className="btn big">Browse decks</Link>
            </div>
          </div>
          {rules && (
            <div className="hero-card">
              <h3><Icon name="shield" />Current formats</h3>
              <dl>
                <dt>Standard</dt><dd>Regulation mark <b>{rules.standard_min_mark}</b> and later</dd>
                <dt>Next rotation</dt><dd>{rules.next_rotation ? <>Mark {rules.next_rotation.new_min_mark}+ {rules.next_rotation.effective_date ? `on ${fmtDate(rules.next_rotation.effective_date)}` : '(date TBA)'}</> : 'Not announced yet'}</dd>
                <dt>Bans</dt><dd>{rules.bans.filter(b => b.format === 'standard').length} in Standard · {rules.bans.filter(b => b.format === 'expanded').length} in Expanded</dd>
                {rules.upcoming_sets.length > 0 && <><dt>Coming up</dt><dd>{rules.upcoming_sets.map(s => `${s.name} (legal ${fmtDate(s.legal_date, { month: 'short', day: 'numeric' })})`).join(', ')}</dd></>}
              </dl>
              <p className="muted small">Checked {ago(rules.last_checked) || 'daily'} · <Link to="/rules">Formats & bans</Link></p>
            </div>
          )}
        </div>
      </section>

      <div className="wrap page">
        {featured && featured.length > 0 && (
          <section className="home-section">
            <div className="section-head"><h2><Icon name="star" />Featured</h2></div>
            <DeckGrid decks={featured} />
          </section>
        )}
        <section className="home-section">
          <div className="section-head"><h2>Popular Standard decks</h2><Link to="/decks?format=standard&sort=likes">See all</Link></div>
          {!popular ? <Spinner /> : popular.length ? <DeckGrid decks={popular} /> : <p className="muted">No public decks yet. <button className="link-btn" onClick={start}>Import the first one.</button></p>}
        </section>
        <section className="home-section">
          <div className="section-head"><h2>Recently updated</h2><Link to="/decks?sort=updated">See all</Link></div>
          {!recent ? <Spinner /> : <DeckGrid decks={recent} />}
        </section>
        {changes.length > 0 && (
          <section className="home-section">
            <div className="section-head"><h2>Rules updates</h2><Link to="/rules">All updates</Link></div>
            <ul className="changes">{changes.map(c => <li key={c.id}><span className={`chg ${c.kind}`}>{c.kind.replace('_', ' ')}</span><span>{c.title}</span><span className="muted">{ago(c.happened_at)}</span></li>)}</ul>
          </section>
        )}
      </div>
      {importOpen && <NewDeckModal startWith="import" onClose={() => setImportOpen(false)} />}
    </div>
  );
}
