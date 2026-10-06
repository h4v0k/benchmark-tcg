import { useEffect, useState } from 'react';
import { Avatar, Empty, Icon, useDebounced } from '../components/ui';
import { Link } from '../router';
import { useAuth, toast, useTheme } from '../state';
import * as api from '../lib/api';
import * as sb from '../lib/supabase';
import { img } from '../lib/cards';
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
      <section className="panel">
        <h2>Account</h2>
        <p className="muted">Signed in as {session.user.email}. Your username is <b>{profile.username}</b>.</p>
        <form onSubmit={e => { e.preventDefault(); changePw(); }} className="field-row">
          <label className="field grow"><span>New password</span><input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" /></label>
          <button className="btn"><Icon name="check" />Change password</button>
        </form>
      </section>
    </div>
  );
}
