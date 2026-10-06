import { useState } from 'react';
import { Link, navigate, useRoute } from '../router';
import { useAuth, toast } from '../state';
import * as sb from '../lib/supabase';

const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

export function LoginPage({ mode }: { mode: 'signin' | 'signup' }) {
  const { session, profile } = useAuth();
  const { query } = useRoute();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [usePw, setUsePw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<'' | 'link' | 'confirm' | 'reset'>('');
  const next = query.get('next') === 'new' ? '/my/decks' : '/';
  if (session && profile) { setTimeout(() => navigate(next), 0); return null; }

  const validEmail = () => { if (!/^\S+@\S+\.\S+$/.test(email)) { setErr('Enter a valid email address.'); return false; } return true; };
  const run = async (f: () => Promise<void>) => {
    setErr(''); setBusy(true);
    try { await f(); } catch (e: any) {
      const m = String(e?.message || e);
      setErr(/invalid login/i.test(m) ? 'Wrong email or password.'
        : /not confirmed/i.test(m) ? 'Confirm your email first: check your inbox for the link.'
        : /passkey_disabled|not enabled/i.test(m) ? 'Passkey sign-in isn’t switched on yet. Use Google or an email link for now.'
        : /NotAllowedError|cancel|aborted/i.test(m) ? 'Passkey sign-in was cancelled.'
        : /credential_not_found/i.test(m) ? 'That passkey isn’t linked to a Benchmark account. Sign in another way, then add a passkey in Settings.'
        : /rate limit|too many/i.test(m) ? 'Too many emails sent. Wait a minute and try again.'
        : m);
    } finally { setBusy(false); }
  };
  const emailLink = () => validEmail() && run(async () => { await sb.auth.emailLink(email); setSent('link'); });
  const withPassword = () => validEmail() && run(async () => {
    if (pw.length < (mode === 'signup' ? 8 : 1)) throw new Error(mode === 'signup' ? 'Use at least 8 characters for your password.' : 'Enter your password.');
    if (mode === 'signin') { await sb.auth.signIn(email, pw); toast('Signed in', 'ok'); navigate(next); }
    else { const ready = await sb.auth.signUp(email, pw); if (ready) navigate(next); else setSent('confirm'); }
  });
  const passkey = () => run(async () => { await sb.auth.passkeySignIn(); toast('Signed in', 'ok'); navigate(next); });
  const reset = () => validEmail() && run(async () => { await sb.auth.resetPassword(email); setSent('reset'); });

  if (sent) return (
    <div className="wrap page narrow"><div className="auth-card">
      <h1>Check your email</h1>
      <p>{sent === 'link' ? <>We sent a sign-in link to <b>{email}</b>. Click it and you’re in. No password needed{mode === 'signup' ? ', and that click confirms your email' : ''}.</>
        : sent === 'confirm' ? <>We sent a confirmation link to <b>{email}</b>. One click finishes creating your account and signs you in.</>
        : <>If <b>{email}</b> has an account, a link to reset the password is on its way.</>}</p>
      <p className="muted small">Not there? Check spam, or <button className="link-btn" onClick={() => setSent('')}>try again</button>.</p>
    </div></div>
  );

  return (
    <div className="wrap page narrow">
      <div className="auth-card">
        <h1>{mode === 'signin' ? 'Sign in' : 'Create your account'}</h1>
        <p className="muted">{mode === 'signin' ? 'Welcome back.' : 'Save decks, share them, like and comment, and follow other players.'}</p>

        <div className="auth-quick">
          <button className="btn block auth-google" onClick={() => sb.auth.oauth('google', next)} disabled={busy}><GoogleMark />Continue with Google</button>
          {sb.auth.passkeysSupported() && mode === 'signin' && (
            <button className="btn block" onClick={passkey} disabled={busy}>Sign in with a passkey</button>
          )}
        </div>
        <div className="auth-or"><span>or use your email</span></div>

        <form onSubmit={e => { e.preventDefault(); usePw ? withPassword() : emailLink(); }}>
          <label className="field"><span>Email</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email webauthn" /></label>
          {usePw && <label className="field"><span>Password</span><input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} autoFocus /></label>}
          {err && <p className="form-error">{err}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? 'One moment…' : usePw ? (mode === 'signin' ? 'Sign in' : 'Create account') : 'Email me a sign-in link'}</button>
        </form>
        <p className="auth-alt">
          <button className="link-btn" onClick={() => { setUsePw(!usePw); setErr(''); }}>{usePw ? 'Use an email link instead' : 'Use a password instead'}</button>
          {usePw && mode === 'signin' && <> · <button className="link-btn" onClick={reset}>Forgot password?</button></>}
        </p>
        <p className="auth-alt">
          {mode === 'signin' ? <>New here? <Link to="/signup">Create an account</Link></> : <>Have an account? <Link to="/login">Sign in</Link></>}
        </p>
      </div>
    </div>
  );
}
