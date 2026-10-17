import { useState } from 'react';
import { Icon, Modal } from './ui';
import { navigate } from '../router';
import { useAuth, toast } from '../state';
import * as sb from '../lib/supabase';

const NAME_RE = /^[A-Za-z0-9_]{3,20}$/;

/** Change username / email, download my data, delete my account. */
export function AccountTools() {
  const { session, profile, refreshProfile } = useAuth();
  const [name, setName] = useState('');
  const [nameErr, setNameErr] = useState('');
  const [email, setEmail] = useState('');
  const [emailMsg, setEmailMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [del, setDel] = useState(false);
  const [typed, setTyped] = useState('');
  if (!session || !profile) return null;

  const rename = async () => {
    setNameErr('');
    if (!NAME_RE.test(name)) { setNameErr('3 to 20 letters, numbers or underscores.'); return; }
    if (name === profile.username) { setNameErr('That’s already your username.'); return; }
    setBusy('name');
    try { await sb.rpc('change_username', { p_new: name }); await refreshProfile(); setName(''); toast('Username changed', 'ok'); }
    catch (e: any) { setNameErr(e.message); }
    setBusy('');
  };
  const changeEmail = async () => {
    setEmailMsg('');
    const v = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { setEmailMsg('Enter a valid email address.'); return; }
    setBusy('email');
    try { await sb.auth.changeEmail(v); setEmail(''); setEmailMsg(`We sent a confirmation link to ${v}. Your email changes after you open it. You may also get one at your current address.`); }
    catch (e: any) { setEmailMsg(e.message); }
    setBusy('');
  };
  const download = async () => {
    setBusy('dl');
    try {
      const data = await sb.rpc('export_my_data');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `benchmark-${profile.username}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e: any) { toast(e.message, 'bad'); }
    setBusy('');
  };
  const destroy = async () => {
    setBusy('del');
    try { await sb.rpc('delete_my_account'); await sb.auth.signOut(); setDel(false); navigate('/'); toast('Your account was deleted', 'ok'); }
    catch (e: any) { toast(e.message, 'bad'); setBusy(''); }
  };

  return (
    <section className="panel account-tools">
      <h2>Your account</h2>
      <form onSubmit={e => { e.preventDefault(); rename(); }} className="field-row">
        <label className="field grow"><span>Change username</span>
          <input value={name} onChange={e => setName(e.target.value.trim())} maxLength={20} autoComplete="off" placeholder={profile.username} aria-describedby="un-help" />
          <small id="un-help" className="muted field-help">3 to 20 letters, numbers or underscores. You can change it once every 7 days. Links to your old profile stop working.</small>
        </label>
        <button className="btn" disabled={busy === 'name' || !name}>Change username</button>
      </form>
      {nameErr && <p className="form-error" role="alert">{nameErr}</p>}
      <form onSubmit={e => { e.preventDefault(); changeEmail(); }} className="field-row">
        <label className="field grow"><span>Change email</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder={session.user.email} />
        </label>
        <button className="btn" disabled={busy === 'email' || !email}>Change email</button>
      </form>
      {emailMsg && <p className="muted" role="status">{emailMsg}</p>}
      <div className="account-row">
        <p className="muted grow">Download a copy of your profile, decks and their saved versions, collection, likes, follows and settings as a JSON file.</p>
        <button className="btn" onClick={download} disabled={busy === 'dl'}><Icon name="download" />Download my data</button>
      </div>
      <div className="account-row">
        <p className="muted grow">Delete your account and everything on it: decks, folders, likes and follows. This can’t be undone.</p>
        <button className="btn danger" onClick={() => { setTyped(''); setDel(true); }}>Delete my account</button>
      </div>
      {del && (
        <Modal title="Delete your account?" onClose={() => setDel(false)} footer={<><button className="btn ghost" onClick={() => setDel(false)}>Cancel</button><button className="btn danger" onClick={destroy} disabled={typed !== profile.username || busy === 'del'}>{busy === 'del' ? 'Deleting…' : 'Delete forever'}</button></>}>
          <p>All your decks, deck history, collection, folders, likes, follows and settings will be deleted. Download your data first if you want a copy.</p>
          <label className="field"><span>Type <b>{profile.username}</b> to confirm</span><input value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} /></label>
        </Modal>
      )}
    </section>
  );
}
