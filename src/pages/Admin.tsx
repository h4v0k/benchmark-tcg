import { useState } from 'react';
import { Avatar, Empty, ErrorBox, Icon, Spinner, Tag, useAsync } from '../components/ui';
import { Link } from '../router';
import { useAuth, toast } from '../state';
import * as api from '../lib/api';
import { ago, fmtDate } from '../lib/cards';

// For admins: watch the sync jobs, run them now, and correct rules by hand if a source is wrong.
export function AdminPage() {
  const { profile } = useAuth();
  const r = useAsync(() => (profile?.is_admin ? api.adminData() : Promise.resolve(null)), [profile?.id]);
  const [busy, setBusy] = useState('');
  const [rot, setRot] = useState({ new_min_mark: '', season: '', effective_date: '', online_date: '' });
  const [ban, setBan] = useState({ format: 'standard', card_name: '', set: '', num: '' });
  if (!profile?.is_admin) return <div className="wrap page"><Empty title="Admins only" icon="shield" /></div>;
  if (r.loading) return <Spinner />;
  if (r.error) return <div className="wrap page"><ErrorBox error={r.error} onRetry={r.reload} /></div>;
  const run = async (fn: 'catalog-sync' | 'rules-sync', body: object = {}) => {
    setBusy(fn);
    try { const res: any = await api.runSync(fn, body); toast(res.ok === false ? `Failed: ${res.error}` : 'Done', res.ok === false ? 'bad' : 'ok'); api.rules(true); r.reload(); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(''); }
  };
  const addRotation = async () => {
    if (!/^[A-Z]$/.test(rot.new_min_mark)) { toast('Mark must be one capital letter', 'bad'); return; }
    try { await api.saveRotation(null, { new_min_mark: rot.new_min_mark, season: rot.season, effective_date: rot.effective_date || null, online_date: rot.online_date || null, source: 'admin' }); toast('Rotation saved. Legality updates on the next sync.', 'ok'); r.reload(); } catch (e: any) { toast(e.message, 'bad'); }
  };
  const datedRotation = async (id: number, effective_date: string) => {
    try { await api.saveRotation(id, { effective_date: effective_date || null }); toast('Saved', 'ok'); r.reload(); } catch (e: any) { toast(e.message, 'bad'); }
  };
  const addBan = async () => {
    if (!ban.card_name.trim()) return;
    const printings = ban.set && ban.num ? [{ set: ban.set, num: ban.num }] : [];
    try { await api.saveBan({ format: ban.format, card_name: ban.card_name.trim(), printings, printings_key: `admin:${ban.set}:${ban.num}`, source: 'admin', note: 'Added by an admin' }); toast('Ban saved. Run the rules sync to match it to cards.', 'ok'); r.reload(); } catch (e: any) { toast(e.message, 'bad'); }
  };
  const { runs, rotations, bans } = r.data!;
  return (
    <div className="wrap page">
      <div className="page-head"><h1>Admin</h1></div>
      <UsersPanel />
      <div className="rules-grid">
        <section className="panel">
          <h2>Sync jobs</h2>
          <p className="muted">The catalog syncs every 2 minutes (sets, card details, prices) and the rules sync runs daily. Run either now:</p>
          <div className="row-gap wrap-row">
            <button className="btn" disabled={!!busy} onClick={() => run('catalog-sync', { job: 'sets' })}><Icon name="refresh" />Check for new sets</button>
            <button className="btn" disabled={!!busy} onClick={() => run('catalog-sync', { job: 'cards', limit: 300 })}><Icon name="refresh" />Fetch card details</button>
            <button className="btn" disabled={!!busy} onClick={() => run('catalog-sync', { job: 'prices', legality: true })}><Icon name="refresh" />Refresh prices</button>
            <button className="btn primary" disabled={!!busy} onClick={() => run('rules-sync')}><Icon name="shield" />Check bans & rotation</button>
          </div>
          {busy && <Spinner label={`Running ${busy}…`} />}
          <table className="runs">
            <thead><tr><th>Job</th><th>Started</th><th>Result</th></tr></thead>
            <tbody>{runs.map((x: any) => <tr key={x.id}><td>{x.job}</td><td>{ago(x.started_at)}</td><td>{x.ok === null ? <Tag tone="info">running</Tag> : x.ok ? <Tag tone="ok">ok</Tag> : <Tag tone="bad">failed</Tag>} <small className="muted">{summarize(x.detail)}</small></td></tr>)}</tbody>
          </table>
        </section>
        <section className="panel">
          <h2>Rotations</h2>
          <table className="runs">
            <thead><tr><th>New minimum mark</th><th>Season</th><th>In person</th><th>Source</th></tr></thead>
            <tbody>{rotations.map((x: any) => <tr key={x.id}><td><b>{x.new_min_mark}</b></td><td>{x.season}</td><td><input type="date" defaultValue={x.effective_date || ''} onBlur={e => e.target.value !== (x.effective_date || '') && datedRotation(x.id, e.target.value)} aria-label="Effective date" /></td><td className="muted small">{x.source === 'admin' ? 'admin' : <a href={x.source} target="_blank" rel="noopener noreferrer">link</a>}</td></tr>)}</tbody>
          </table>
          <h3>Add a rotation</h3>
          <div className="field-row">
            <label className="field"><span>Mark</span><input value={rot.new_min_mark} onChange={e => setRot({ ...rot, new_min_mark: e.target.value.toUpperCase().slice(0, 1) })} placeholder="I" /></label>
            <label className="field"><span>Season</span><input value={rot.season} onChange={e => setRot({ ...rot, season: e.target.value })} placeholder="2027-28" /></label>
            <label className="field"><span>In person</span><input type="date" value={rot.effective_date} onChange={e => setRot({ ...rot, effective_date: e.target.value })} /></label>
            <label className="field"><span>TCG Live</span><input type="date" value={rot.online_date} onChange={e => setRot({ ...rot, online_date: e.target.value })} /></label>
          </div>
          <button className="btn" onClick={addRotation}>Save rotation</button>
        </section>
      </div>
      <section className="panel">
        <h2>Bans</h2>
        <table className="runs">
          <thead><tr><th>Format</th><th>Card</th><th>Printings</th><th>Matched</th><th>Since</th><th>Status</th></tr></thead>
          <tbody>{bans.map((b: any) => <tr key={b.id}><td>{b.format}</td><td>{b.card_name}</td><td className="small">{b.printings.map((p: any) => `${p.set} ${p.num}`).join(', ') || 'all printings'}</td><td>{b.card_ids.length || <Tag tone="warn">0</Tag>}</td><td className="small">{fmtDate(b.first_seen)}</td><td>{b.active ? <button className="link-btn" onClick={async () => { await api.setBanActive(b.id, false); r.reload(); }}>Lift</button> : <button className="link-btn" onClick={async () => { await api.setBanActive(b.id, true); r.reload(); }}>Reinstate</button>}</td></tr>)}</tbody>
        </table>
        <h3>Add a ban by hand</h3>
        <p className="muted small">The daily sync follows the official list and will add or lift bans on its own; use this only for something the official page hasn’t posted yet.</p>
        <div className="field-row">
          <label className="field"><span>Format</span><select value={ban.format} onChange={e => setBan({ ...ban, format: e.target.value })}><option value="standard">Standard</option><option value="expanded">Expanded</option></select></label>
          <label className="field grow"><span>Card name</span><input value={ban.card_name} onChange={e => setBan({ ...ban, card_name: e.target.value })} /></label>
          <label className="field"><span>Set name</span><input value={ban.set} onChange={e => setBan({ ...ban, set: e.target.value })} placeholder="Paldea Evolved" /></label>
          <label className="field"><span>Number</span><input value={ban.num} onChange={e => setBan({ ...ban, num: e.target.value })} placeholder="185" /></label>
        </div>
        <button className="btn" onClick={addBan}>Save ban</button>
      </section>
    </div>
  );
}

function summarize(d: any) {
  if (!d) return '';
  if (d.error) return String(d.error).slice(0, 120);
  const parts: string[] = [];
  if (d.cards) parts.push(`${d.cards} cards`);
  if (d.price_sets) parts.push(`${d.price_sets} sets priced`);
  if (d.sets?.sets_added) parts.push(`${d.sets.sets_added} new sets`);
  if (d.legality_updated) parts.push(`${d.legality_updated} legality changes`);
  if (d.bans) parts.push(`${d.bans.standard_bans}/${d.bans.expanded_bans} bans`);
  if (d.bans_error) parts.push(`bans: ${d.bans_error}`);
  if (d.rotation?.latest_season) parts.push(`season ${d.rotation.latest_season}`);
  return parts.join(' · ');
}

function UsersPanel() {
  const u = useAsync(() => api.adminUsers(), []);
  const [q, setQ] = useState('');
  const list = (u.data || []).filter(x => !q || `${x.username || ''} ${x.email}`.toLowerCase().includes(q.toLowerCase()));
  const label = (p: string) => p.split(', ').map(x => x === 'email' ? 'Email' : x === 'google' ? 'Google' : x).join(' + ');
  return (
    <section className="panel">
      <div className="panel-head"><h2>Users {u.data && <span className="muted">({u.data.length})</span>}</h2>
        <button className="btn small" onClick={u.reload}><Icon name="refresh" size={14} />Refresh</button></div>
      {u.loading ? <Spinner /> : u.error ? <ErrorBox error={u.error} onRetry={u.reload} /> : (
        <>
          {(u.data?.length || 0) > 8 && <label className="field"><span>Find a user</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="Username or email" /></label>}
          <ul className="admin-users">
            {list.map(x => (
              <li key={x.id}>
                <Avatar name={x.username || x.email} size={36} />
                <div className="grow">
                  <div className="au-name">
                    {x.username ? <Link to={`/users/${x.username}`}>{x.username}</Link> : <span className="muted">No username yet</span>}
                    {x.is_admin && <Tag tone="accent">Admin</Tag>}
                    {!x.confirmed && <Tag tone="warn">Email not confirmed</Tag>}
                  </div>
                  <div className="muted au-email">{x.email}</div>
                  <div className="muted small">
                    Signs in with {label(x.sign_in) || '—'} · joined {fmtDate(x.created_at)} · last seen {x.last_sign_in_at ? ago(x.last_sign_in_at) : 'never'}
                  </div>
                </div>
                <div className="au-decks"><b>{x.deck_count}</b><span className="muted small">deck{x.deck_count === 1 ? '' : 's'}{x.public_deck_count ? ` · ${x.public_deck_count} public` : ''}</span></div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
