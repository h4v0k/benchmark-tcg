import { useEffect, useState } from 'react';
import { Avatar, Empty, Icon, useDebounced } from '../components/ui';
import { Link } from '../router';
import { useAuth, toast, useTheme } from '../state';
import * as api from '../lib/api';
import * as sb from '../lib/supabase';
import { img, printLabel } from '../lib/cards';
import type { SearchHit } from '../lib/types';

export function SettingsPage() {
  const { session, profile, refreshProfile } = useAuth();
  const [bio, setBio] = useState(profile?.bio || '');
  const [avatar, setAvatar] = useState(profile?.avatar_card || '');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pw, setPw] = useState('');
  const [theme, setTheme] = useTheme();
  useEffect(() => { setBio(profile?.bio || ''); setAvatar(profile?.avatar_card || ''); }, [profile?.id]);
  useEffect(() => { let alive = true; if (dq.length >= 2) api.searchCards(dq, 'unlimited', 'Pokemon', 12).then(h => alive && setHits(h)).catch(() => {}); else setHits([]); return () => { alive = false; }; }, [dq]);
  if (!session || !profile) return <div className="wrap page"><Empty title="Sign in to change your settings" icon="user"><Link to="/login" className="btn primary">Sign in</Link></Empty></div>;
  const save = async () => {
    try { await api.updateProfile(profile.id, { bio: bio.slice(0, 500), avatar_card: avatar }); await refreshProfile(); toast('Profile saved', 'ok'); } catch (e: any) { toast(e.message, 'bad'); }
  };
  const changePw = async () => {
    if (pw.length < 8) { toast('Use at least 8 characters', 'bad'); return; }
    try { await sb.auth.setPassword(pw); setPw(''); toast('Password changed', 'ok'); } catch (e: any) { toast(e.message, 'bad'); }
  };
  return (
    <div className="wrap page narrow">
      <div className="page-head"><h1>Settings</h1><Link to={`/users/${profile.username}`}>View profile</Link></div>
      <section className="panel">
        <h2>Profile</h2>
        <div className="avatar-pick">
          <Avatar card={avatar} name={profile.username} size={64} />
          <div className="grow">
            <label className="field"><span>Profile picture: pick any Pokémon card’s art</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search Pokémon, e.g. Pikachu" /></label>
            <div className="avatar-hits">{hits.map(h => h.image && <button key={h.card_id} className={avatar === h.image ? 'on' : ''} onClick={() => setAvatar(h.image)} title={h.name}><img src={img(h.image)} alt={h.name} /></button>)}</div>
            {avatar && <button className="link-btn" onClick={() => setAvatar('')}>Remove picture</button>}
          </div>
        </div>
        <label className="field"><span>Bio</span><textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={500} rows={4} placeholder="Who you are, what you play, links to your channel…" /></label>
        <div className="row-end"><span className="muted small">{bio.length}/500</span><button className="btn primary" onClick={save}>Save profile</button></div>
      </section>
      <section className="panel">
        <h2>Appearance</h2>
        <label className="check-field"><input type="checkbox" checked={theme === 'dark'} onChange={e => setTheme(e.target.checked ? 'dark' : 'light')} /> Dark theme</label>
      </section>
      <DefaultPrintings />
      <section className="panel">
        <h2>Account</h2>
        <p className="muted">Signed in as {session.user.email}. Your username is <b>{profile.username}</b>.</p>
        <form onSubmit={e => { e.preventDefault(); changePw(); }} className="field-row">
          <label className="field grow"><span>Password (optional: Google, email links and passkeys work without one)</span><input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" /></label>
          <button className="btn"><Icon name="check" />Set password</button>
        </form>
      </section>
      <Passkeys />
    </div>
  );
}

function DefaultPrintings() {
  const [prefs, setPrefs] = useState<api.PrintingPref[] | null>(null);
  useEffect(() => { api.printingPrefs().then(setPrefs).catch(() => setPrefs([])); }, []);
  const clear = async (name: string) => {
    try { await api.clearPrintingPref(name); setPrefs(ps => ps && ps.filter(p => p.name !== name)); } catch (e: any) { toast(e.message, 'bad'); }
  };
  return (
    <section className="panel">
      <h2>Default printings</h2>
      <p className="muted">When you import a list or add a card, Benchmark uses your default printing if it’s legal in the deck’s format, and otherwise the cheapest legal printing. Set a default with the ☆ on any printing in a card’s window.</p>
      {prefs && prefs.length > 0 && (
        <ul className="pref-list">
          {prefs.map(p => (
            <li key={p.name}>
              {p.card?.image && <img src={img(p.card.image)} alt="" />}
              <span className="grow"><b>{p.name}</b> <span className="muted">{p.card ? `${p.card.set?.name || ''} · ${printLabel(p.card)}` : p.card_id}</span></span>
              <button className="btn small" onClick={() => clear(p.name)}>Clear</button>
            </li>
          ))}
        </ul>
      )}
      {prefs && !prefs.length && <p className="muted small">No default printings yet.</p>}
    </section>
  );
}

function Passkeys() {
  const [list, setList] = useState<{ id: string; friendly_name?: string; created_at: string; last_used_at?: string }[] | null>(null);
  const [err, setErr] = useState('');
  const load = () => sb.auth.passkeys().then(setList).catch((e: any) => { setList([]); setErr(/passkey_disabled|not enabled|404/i.test(e.message) ? 'Passkeys aren’t switched on for Benchmark yet.' : ''); });
  useEffect(() => { load(); }, []);
  if (!sb.auth.passkeysSupported()) return null;
  const add = async () => {
    try { await sb.auth.passkeyRegister(); toast('Passkey saved', 'ok'); load(); }
    catch (e: any) { if (!/NotAllowedError|cancel/i.test(String(e?.message || e) + (e?.name || ''))) toast(/credential_exists/i.test(e.message) ? 'This device already has a passkey for Benchmark.' : e.message, 'bad'); }
  };
  const del = async (id: string) => {
    try { await sb.auth.deletePasskey(id); setList(l => l && l.filter(p => p.id !== id)); } catch (e: any) { toast(e.message, 'bad'); }
  };
  return (
    <section className="panel">
      <h2>Passkeys</h2>
      <p className="muted">Sign in with your fingerprint, face or device PIN. Passkeys sync through your password manager (iCloud Keychain, Google Password Manager, 1Password…).</p>
      {err && <p className="muted small">{err}</p>}
      {list && list.length > 0 && (
        <ul className="pref-list">
          {list.map(p => (
            <li key={p.id}><span className="grow"><b>{p.friendly_name || 'Passkey'}</b> <span className="muted small">added {new Date(p.created_at).toLocaleDateString()}{p.last_used_at ? ` · last used ${new Date(p.last_used_at).toLocaleDateString()}` : ''}</span></span>
              <button className="btn small" onClick={() => del(p.id)}>Remove</button></li>
          ))}
        </ul>
      )}
      <div className="row-end"><button className="btn primary" onClick={add} disabled={!!err}>Add a passkey</button></div>
    </section>
  );
}
