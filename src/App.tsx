import { useEffect, useState, type ReactElement } from 'react';
import { AuthProvider, Toasts, toast, useAuth, useTheme } from './state';
import { Link, match, navigate, useRoute } from './router';
import { Avatar, HoverPreview, Icon, Menu, MenuItem, Modal, Spinner } from './components/ui';
import { NewDeckButton } from './components/NewDeck';
import { GlobalSearch } from './components/GlobalSearch';
import * as api from './lib/api';
import * as sb from './lib/supabase';
import { Home } from './pages/Home';
import { Browse } from './pages/Browse';
import { DeckPage } from './pages/Deck';
import { ProfilePage } from './pages/Profile';
import { MyDecks } from './pages/MyDecks';
import { Feed } from './pages/Feed';
import { CardsPage, CardPage } from './pages/Cards';
import { RulesPage } from './pages/Rules';
import { EventsPage, EventPage, EventDeckPage } from './pages/Events';
import { MatchupsPage } from './pages/Matchups';
import { DeckListsPage } from './pages/DeckLists';
import { ArchetypePage } from './pages/Archetype';
import { LoginPage } from './pages/Login';
import { SettingsPage } from './pages/Settings';
import { AdminPage } from './pages/Admin';
import { UsersPage } from './pages/Users';

export function App({ authLink }: { authLink: { type?: string; error?: string } | null }) {
  return (
    <AuthProvider>
      <Shell authLink={authLink} />
    </AuthProvider>
  );
}

const ROUTES: [string, (p: Record<string, string>) => ReactElement][] = [
  ['/', () => <Home />],
  ['/decks', () => <Browse />],
  ['/decks/:id', p => <DeckPage id={p.id} />],
  ['/users', () => <UsersPage />],
  ['/users/:name', p => <ProfilePage username={p.name} />],
  ['/my/decks', () => <MyDecks />],
  ['/feed', () => <Feed />],
  ['/cards', () => <CardsPage />],
  ['/cards/:id', p => <CardPage id={p.id} />],
  ['/rules', () => <RulesPage />],
  ['/events', () => <EventsPage />],
  ['/events/:id', p => <EventPage id={+p.id} />],
  ['/events/:id/:place', p => <EventDeckPage id={+p.id} place={+p.place} />],
  ['/matchups', () => <MatchupsPage />],
  ['/matchups/:deck', p => <MatchupsPage deck={p.deck} />],
  ['/matchups/:deck/lists', p => <DeckListsPage deck={p.deck} />],
  ['/archetype/:name', p => <ArchetypePage name={p.name} />],
  ['/login', () => <LoginPage mode="signin" />],
  ['/signup', () => <LoginPage mode="signup" />],
  ['/settings', () => <SettingsPage />],
  ['/admin', () => <AdminPage />],
];

function Shell({ authLink }: { authLink: { type?: string; error?: string } | null }) {
  const { path } = useRoute();
  const { ready, session, needsUsername } = useAuth();
  const [recovery, setRecovery] = useState(authLink?.type === 'recovery');
  useEffect(() => {
    if (authLink?.error) toast(authLink.error, 'bad');
    else if (authLink?.type === 'signup') toast('Email confirmed. Welcome to Benchmark!', 'ok');
    else if (authLink?.type === 'magiclink') toast('Signed in', 'ok');
  }, []);
  let page: ReactElement | null = null;
  for (const [pattern, render] of ROUTES) { const m = match(pattern, path); if (m) { page = render(m); break; } }
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <TopBar />
      <main id="main" tabIndex={-1}>
        {!ready ? <Spinner /> : page || <NotFound />}
      </main>
      <Footer />
      {needsUsername && <UsernameModal />}
      {!needsUsername && session && <PasskeyNudge />}
      {recovery && session && <NewPasswordModal onDone={() => setRecovery(false)} />}
      <HoverPreview />
      <ToTop />
      <Toasts />
    </>
  );
}

function TopBar() {
  const { session, profile } = useAuth();
  const { path } = useRoute();
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const nav = [
    ['/decks', 'Decks'],
    ['/cards', 'Cards'],
    ['/events', 'Tournaments'],
    ['/matchups', 'Matchups'],
    ['/rules', 'Formats & bans'],
    ...(session ? [['/feed', 'Following'], ['/my/decks', 'My decks']] : []),
  ];
  return (
    <header className="topbar">
      <div className="topbar-inner wrap">
        <Link to="/" className="brand" aria-label="Benchmark home"><span className="brand-mark" aria-hidden="true" /><span>Benchmark</span></Link>
        <button className="icon-btn nav-toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(o => !o)}><Icon name="list" /></button>
        <nav className={`nav ${open ? 'open' : ''}`} aria-label="Main">
          {nav.map(([to, label]) => <Link key={to} to={to} className={path === to || (to !== '/' && path.startsWith(to + '/')) ? 'active' : ''}>{label}</Link>)}
        </nav>
        <GlobalSearch />
        <div className="topbar-actions">
          <NewDeckButton />
          <button className="icon-btn theme-btn" aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} title="Theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
          {session ? (
            <Menu className="account-btn" label={<><Avatar card={profile?.avatar_card} name={profile?.username || session.user.email || '?'} /><span className="hide-sm">{profile?.username || 'Account'}</span><Icon name="chevron" size={14} /></>}>
              {profile && <MenuItem icon="user" onClick={() => navigate(`/users/${profile.username}`)}>Profile</MenuItem>}
              <MenuItem icon="folder" onClick={() => navigate('/my/decks')}>My decks</MenuItem>
              <MenuItem icon="edit" onClick={() => navigate('/settings')}>Settings</MenuItem>
              {profile?.is_admin && <MenuItem icon="shield" onClick={() => navigate('/admin')}>Admin</MenuItem>}
              <MenuItem icon="back" onClick={async () => { await sb.auth.signOut(); navigate('/'); toast('Signed out'); }}>Sign out</MenuItem>
            </Menu>
          ) : (
            <><Link to="/login" className="btn ghost">Sign in</Link><Link to="/signup" className="btn primary hide-sm">Sign up</Link></>
          )}
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-inner">
        <div><strong>Benchmark</strong> · build, price and share Pokémon TCG decks.</div>
        <div className="muted">Card data from <a href="https://tcgdex.dev" target="_blank" rel="noopener noreferrer">TCGdex</a>, prices from TCGplayer via <a href="https://tcgcsv.com" target="_blank" rel="noopener noreferrer">TCGCSV</a>, bans from <a href="https://www.pokemon.com/us/play-pokemon/about/pokemon-tcg-banned-card-list" target="_blank" rel="noopener noreferrer">Play! Pokémon</a>. Not affiliated with The Pokémon Company, Nintendo, Creatures or Game Freak.</div>
      </div>
    </footer>
  );
}

function NotFound() {
  return <div className="wrap page"><div className="empty"><h2>Page not found</h2><p>That link doesn't go anywhere.</p><Link to="/" className="btn primary">Go home</Link></div></div>;
}

function UsernameModal() {
  const { session, setProfile } = useAuth();
  // Suggest a username from their Google name or email so most people just press Continue.
  const [name, setName] = useState(() => {
    const meta: any = session?.user.user_metadata || {};
    const base = String(meta.preferred_username || meta.name || meta.full_name || (session?.user.email || '').split('@')[0] || '');
    const s = base.normalize('NFKD').replace(/[^A-Za-z0-9_]/g, '').slice(0, 20);
    return s.length >= 3 ? s : '';
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) { setErr('3 to 20 letters, numbers or underscores.'); return; }
    setBusy(true); setErr('');
    try { setProfile(await api.createProfile(session!.user.id, name)); toast(`Welcome, ${name}!`, 'ok'); }
    catch (e: any) { setErr(/duplicate|unique|23505/i.test(e.message + (e.code || '')) ? 'That username is taken.' : e.message); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Pick a username" onClose={() => sb.auth.signOut()}>
      <p className="muted">This is how other players see you and the address of your profile.</p>
      <form onSubmit={e => { e.preventDefault(); save(); }}>
        <label className="field"><span>Username</span><input value={name} onChange={e => setName(e.target.value.trim())} autoComplete="username" maxLength={20} placeholder="e.g. havok" /></label>
        {err && <p className="form-error">{err}</p>}
        <div className="row-end"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button></div>
      </form>
    </Modal>
  );
}

function NewPasswordModal({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const save = async () => {
    if (pw.length < 8) { setErr('Use at least 8 characters.'); return; }
    try { await sb.auth.setPassword(pw); toast('Password updated', 'ok'); onDone(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal title="Set a new password" onClose={onDone}>
      <form onSubmit={e => { e.preventDefault(); save(); }}>
        <label className="field"><span>New password</span><input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" /></label>
        {err && <p className="form-error">{err}</p>}
        <div className="row-end"><button className="btn primary">Save password</button></div>
      </form>
    </Modal>
  );
}

// After someone signs in, offer once to save a passkey so next time is one tap.
function PasskeyNudge() {
  const { session } = useAuth();
  const key = `bm-passkey-nudge-${session?.user.id}`;
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    try { if (localStorage.getItem(key)) return; } catch { return; }
    if (!sb.auth.passkeysSupported()) return;
    sb.auth.passkeys().then(list => { if (alive && !list.length) setShow(true); }).catch(() => {});
    return () => { alive = false; };
  }, [key]);
  if (!show) return null;
  const done = () => { try { localStorage.setItem(key, '1'); } catch { /* ignore */ } setShow(false); };
  const save = async () => {
    setBusy(true);
    try { await sb.auth.passkeyRegister(); toast('Passkey saved. Next time, sign in with one tap.', 'ok'); done(); }
    catch (e: any) { if (!/NotAllowedError|cancel/i.test(String(e?.message || e) + (e?.name || ''))) toast(e.message, 'bad'); }
    finally { setBusy(false); }
  };
  return (
    <div className="passkey-nudge" role="dialog" aria-label="Save a passkey">
      <div><b>Sign in faster next time</b><span className="muted small">Save a passkey and use your fingerprint, face or device PIN instead of a password or email link.</span></div>
      <div className="row-gap"><button className="btn small" onClick={done}>Not now</button><button className="btn small primary" onClick={save} disabled={busy}>{busy ? 'One moment…' : 'Save a passkey'}</button></div>
    </div>
  );
}

// Phones: a button back to the top once you've scrolled down a long page.
function ToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 700);
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  if (!show) return null;
  return <button className="to-top" aria-label="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="chevron" /></span></button>;
}
