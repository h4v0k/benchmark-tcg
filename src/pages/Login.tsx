import { useState } from 'react';
import { Link, navigate, useRoute } from '../router';
import { useAuth, toast } from '../state';
import * as sb from '../lib/supabase';

export function LoginPage({ mode }: { mode: 'signin' | 'signup' }) {
  const { session, profile } = useAuth();
  const { query } = useRoute();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<'' | 'confirm' | 'reset'>('');
  if (session && profile) { setTimeout(() => navigate(query.get('next') === 'new' ? '/my/decks' : '/'), 0); return null; }
  const submit = async () => {
    setErr('');
    if (!/^\S+@\S+\.\S+$/.test(email)) { setErr('Enter a valid email address.'); return; }
    if (pw.length < (mode === 'signup' ? 8 : 1)) { setErr(mode === 'signup' ? 'Use at least 8 characters for your password.' : 'Enter your password.'); return; }
    setBusy(true);
    try {
      if (mode === 'signin') { await sb.auth.signIn(email, pw); toast('Signed in', 'ok'); navigate('/'); }
      else { const ready = await sb.auth.signUp(email, pw); if (ready) navigate('/'); else setSent('confirm'); }
    } catch (e: any) {
      setErr(/invalid login/i.test(e.message) ? 'Wrong email or password.' : /not confirmed/i.test(e.message) ? 'Confirm your email first: check your inbox for the link.' : e.message);
    } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) { setErr('Enter your email above first.'); return; }
    try { await sb.auth.resetPassword(email); setSent('reset'); } catch (e: any) { setErr(e.message); }
  };
  if (sent) return (
    <div className="wrap page narrow"><div className="auth-card">
      <h1>Check your email</h1>
      <p>{sent === 'confirm' ? <>We sent a confirmation link to <b>{email}</b>. Open it to finish creating your account.</> : <>If <b>{email}</b> has an account, a link to reset the password is on its way.</>}</p>
      <Link to="/login" className="btn">Back to sign in</Link>
    </div></div>
  );
  return (
    <div className="wrap page narrow">
      <div className="auth-card">
        <h1>{mode === 'signin' ? 'Sign in' : 'Create your account'}</h1>
        <p className="muted">{mode === 'signin' ? 'Welcome back.' : 'Save decks, share them, like and comment, and follow other players.'}</p>
        <form onSubmit={e => { e.preventDefault(); submit(); }}>
          <label className="field"><span>Email</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
          <label className="field"><span>Password</span><input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></label>
          {err && <p className="form-error">{err}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        </form>
        <p className="auth-alt">
          {mode === 'signin' ? <>New here? <Link to="/signup">Create an account</Link> · <button className="link-btn" onClick={reset}>Forgot password?</button></> : <>Have an account? <Link to="/login">Sign in</Link></>}
        </p>
      </div>
    </div>
  );
}
