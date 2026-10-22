import { Component, Suspense, lazy, useEffect, useState, type ErrorInfo, type ReactElement, type ReactNode } from 'react';
import { reportError } from './lib/errors';
import { AuthProvider, Toasts, toast, useAuth, useTheme } from './state';
import { Link, match, navigate, useRoute } from './router';
import { Avatar, HoverPreview, Icon, Menu, MenuItem, Modal, Spinner } from './components/ui';
import { NewDeckButton } from './components/NewDeck';
import { GlobalSearch } from './components/GlobalSearch';
import { ReportIssueButton, SupportButton } from './components/ReportIssue';
import * as api from './lib/api';
import * as sb from './lib/supabase';
import { Home } from './pages/Home';
import { Browse } from './pages/Browse';
import { CardsPage, CardPage } from './pages/Cards';

// Pages most first-time visitors never open are split into their own chunks.
const DeckPage = lazy(() => import('./pages/Deck').then(m => ({ default: m.DeckPage })));
const ProfilePage = lazy(() => import('./pages/Profile').then(m => ({ default: m.ProfilePage })));
const MyDecks = lazy(() => import('./pages/MyDecks').then(m => ({ default: m.MyDecks })));
const CollectionPage = lazy(() => import('./pages/Collection').then(m => ({ default: m.CollectionPage })));
const Feed = lazy(() => import('./pages/Feed').then(m => ({ default: m.Feed })));
const RulesPage = lazy(() => import('./pages/Rules').then(m => ({ default: m.RulesPage })));
const EventsPage = lazy(() => import('./pages/Events').then(m => ({ default: m.EventsPage })));
const LiveEventPage = lazy(() => import('./pages/Events').then(m => ({ default: m.LiveEventPage })));
const EventPage = lazy(() => import('./pages/Events').then(m => ({ default: m.EventPage })));
const EventDeckPage = lazy(() => import('./pages/Events').then(m => ({ default: m.EventDeckPage })));
const JapanPage = lazy(() => import('./pages/Japan').then(m => ({ default: m.JapanPage })));
const JapanEventPage = lazy(() => import('./pages/Japan').then(m => ({ default: m.JapanEventPage })));
const JapanDeckPage = lazy(() => import('./pages/Japan').then(m => ({ default: m.JapanDeckPage })));
const JapanCardPage = lazy(() => import('./pages/Japan').then(m => ({ default: m.JapanCardPage })));
const MatchupsPage = lazy(() => import('./pages/Matchups').then(m => ({ default: m.MatchupsPage })));
const DeckListsPage = lazy(() => import('./pages/DeckLists').then(m => ({ default: m.DeckListsPage })));
const ArchetypePage = lazy(() => import('./pages/Archetype').then(m => ({ default: m.ArchetypePage })));
const LoginPage = lazy(() => import('./pages/Login').then(m => ({ default: m.LoginPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then(m => ({ default: m.SettingsPage })));
const PrivacyPage = lazy(() => import('./pages/Legal').then(m => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('./pages/Legal').then(m => ({ default: m.TermsPage })));
const CopyrightPage = lazy(() => import('./pages/Legal').then(m => ({ default: m.CopyrightPage })));
const AccessibilityPage = lazy(() => import('./pages/Legal').then(m => ({ default: m.AccessibilityPage })));
const CreditsPage = lazy(() => import('./pages/Legal').then(m => ({ default: m.CreditsPage })));
const AdminPage = lazy(() => import('./pages/Admin').then(m => ({ default: m.AdminPage })));
const ToolsHome = lazy(() => import('./pages/Tools').then(m => ({ default: m.ToolsHome })));
const DamageTool = lazy(() => import('./pages/Tools').then(m => ({ default: m.DamageTool })));
const TrackerTool = lazy(() => import('./pages/Tools').then(m => ({ default: m.TrackerTool })));
const CpTool = lazy(() => import('./pages/Tools').then(m => ({ default: m.CpTool })));
const EventFinder = lazy(() => import('./pages/Tools').then(m => ({ default: m.EventFinder })));
const UsersPage = lazy(() => import('./pages/Users').then(m => ({ default: m.UsersPage })));

const isId = (v: string) => /^[1-9]\d{0,14}$/.test(v);
const isJpId = (v: string) => /^[cm][1-9]\d{0,9}$/.test(v);

// A stale tab after a deploy can't fetch old chunk files; show a reload prompt instead of a blank page.
class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); reportError(error, 'Page crashed'); }
  render() {
    if (!this.state.error) return this.props.children;
    const stale = /dynamically imported module|Importing a module script|ChunkLoadError|Loading chunk/i.test(String(this.state.error.message || this.state.error));
    return (
      <div className="wrap page"><div className="empty" role="alert">
        <h2>{stale ? 'The site was updated' : 'Something went wrong'}</h2>
        <p>{stale ? 'A newer version of Benchmark is available. Reload to continue.' : 'This page failed to load. Reloading may fix it.'}</p>
        <button className="btn primary" onClick={() => location.reload()}>Reload</button>
      </div></div>
    );
  }
}

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
  ['/collection', () => <CollectionPage />],
  ['/feed', () => <Feed />],
  ['/cards', () => <CardsPage />],
  ['/cards/:id', p => <CardPage id={p.id} />],
  ['/rules', () => <RulesPage />],
  ['/events', () => <EventsPage />],
  ['/events/japan', () => <JapanPage />],
  ['/events/japan/card/:name', p => <JapanCardPage name={p.name} />],
  ['/events/japan/:id', p => isJpId(p.id) ? <JapanEventPage id={p.id} /> : <NotFound />],
  ['/events/japan/:id/:place', p => isJpId(p.id) && isId(p.place) ? <JapanDeckPage id={p.id} place={+p.place} /> : <NotFound />],
  ['/events/live/:id', p => /^\d{1,6}$/.test(p.id) ? <LiveEventPage id={p.id} /> : <NotFound />],
  ['/events/:id', p => isId(p.id) ? <EventPage id={+p.id} /> : <NotFound />],
  ['/events/:id/:place', p => isId(p.id) && isId(p.place) ? <EventDeckPage id={+p.id} place={+p.place} /> : <NotFound />],
  ['/matchups', () => <MatchupsPage />],
  ['/matchups/:deck', p => <MatchupsPage deck={p.deck} />],
  ['/matchups/:deck/lists', p => <DeckListsPage deck={p.deck} />],
  ['/archetype/:name', p => <ArchetypePage name={p.name} />],
  ['/login', () => <LoginPage mode="signin" />],
  ['/signup', () => <LoginPage mode="signup" />],
  ['/settings', () => <SettingsPage />],
  ['/privacy', () => <PrivacyPage />],
  ['/terms', () => <TermsPage />],
  ['/copyright', () => <CopyrightPage />],
  ['/accessibility', () => <AccessibilityPage />],
  ['/credits', () => <CreditsPage />],
  ['/admin', () => <AdminPage />],
  ['/tools', () => <ToolsHome />],
  ['/tools/damage', () => <DamageTool />],
  ['/tools/tracker', () => <TrackerTool />],
  ['/tools/cp', () => <CpTool />],
  ['/tools/events', () => <EventFinder />],
];

function Shell({ authLink }: { authLink: { type?: string; error?: string } | null }) {
  const { path } = useRoute();
  const { ready, session, needsUsername } = useAuth();
  const [recovery, setRecovery] = useState(authLink?.type === 'recovery');
  useEffect(() => {
    if (authLink?.error) toast(authLink.error, 'bad');
    else if (authLink?.type === 'signup') toast('Email confirmed. Welcome to Benchmark!', 'ok');
    else if (authLink?.type === 'recovery') toast('Choose a new password for this account.', 'ok');
    else if (authLink?.type === 'magiclink') toast('Signed in', 'ok');
  }, []);
  let page: ReactElement | null = null;
  for (const [pattern, render] of ROUTES) { const m = match(pattern, path); if (m) { page = render(m); break; } }
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <TopBar />
      <main id="main" tabIndex={-1}>
        {!ready ? <Spinner /> : <PageBoundary key={path}><Suspense fallback={<Spinner />}>{page || <NotFound />}</Suspense></PageBoundary>}
      </main>
      {ready && !session && <SignupNudge path={path} />}
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
    ...(session ? [['/feed', 'Following'], ['/my/decks', 'My decks'], ['/collection', 'Collection']] : []),
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
          <Menu className="btn ghost toolbox-btn" title="Toolbox" label={<><Icon name="tool" /><span className="hide-sm">Toolbox</span></>}>
            <MenuItem icon="bolt" onClick={() => navigate('/tools/damage')}>Damage & prize trade</MenuItem>
            <MenuItem icon="list" onClick={() => navigate('/tools/tracker')}>Game tracker</MenuItem>
            <MenuItem icon="star" onClick={() => navigate('/tools/cp')}>Championship Points</MenuItem>
            <MenuItem icon="search" onClick={() => navigate('/tools/events')}>Event finder</MenuItem>
            <MenuItem icon="tool" onClick={() => navigate('/tools')}>All tools</MenuItem>
          </Menu>
          <NewDeckButton />
          <button className="icon-btn theme-btn" aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} title="Theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
          {session ? (
            <Menu className="account-btn" label={<><Avatar card={profile?.avatar_card} name={profile?.username || session.user.email || '?'} /><span className="hide-sm">{profile?.username || 'Account'}</span><Icon name="chevron" size={14} /></>}>
              {profile && <MenuItem icon="user" onClick={() => navigate(`/users/${profile.username}`)}>Profile</MenuItem>}
              <MenuItem icon="folder" onClick={() => navigate('/my/decks')}>My decks</MenuItem>
              <MenuItem icon="stack" onClick={() => navigate('/collection')}>My collection</MenuItem>
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
        <div className="foot-top"><div><strong>Benchmark</strong> · build, price and share Pokémon TCG decks.</div><div className="foot-links"><a className="foot-social" href="https://x.com/benchmark_tcg" target="_blank" rel="noopener noreferrer" aria-label="Follow Benchmark on X"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>Follow on X</a><SupportButton /><ReportIssueButton /></div></div>
        <nav className="foot-links foot-legal" aria-label="Legal"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/copyright">Copyright</Link><Link to="/accessibility">Accessibility</Link><Link to="/credits">Data credits</Link></nav>
        <p className="muted foot-credit">Card data from <a href="https://tcgdex.dev" target="_blank" rel="noopener noreferrer">TCGdex</a>, prices from TCGplayer via <a href="https://tcgcsv.com" target="_blank" rel="noopener noreferrer">TCGCSV</a>, tournament and matchup data from <a href="https://limitlesstcg.com" target="_blank" rel="noopener noreferrer">Limitless TCG</a>, bans from <a href="https://www.pokemon.com/us/play-pokemon/about/pokemon-tcg-banned-card-list" target="_blank" rel="noopener noreferrer">Play! Pokémon</a>. <Link to="/credits">All data credits</Link>.</p>
        <p className="muted foot-credit">Benchmark is an unofficial fan project, not affiliated with, endorsed by or sponsored by The Pokémon Company, Nintendo, Creatures or GAME FREAK. Pokémon and Pokémon card names, text and images are © and ™ their respective owners.</p>
      </div>
    </footer>
  );
}

function NotFound() {
  return <div className="wrap page"><div className="empty"><h1>Page not found</h1><p>That link doesn't go anywhere.</p><Link to="/" className="btn primary">Go home</Link></div></div>;
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
// Signed-out visitors reading meta and tournament data: one quiet line at the end of the page, dismissible.
const NUDGE_PATHS = /^\/(matchups|archetype|events|cards\/)/;
function SignupNudge({ path }: { path: string }) {
  const [off, setOff] = useState(() => { try { return !!localStorage.getItem('bm-signup-nudge-off'); } catch { return false; } });
  if (off || !NUDGE_PATHS.test(path)) return null;
  const hide = () => { try { localStorage.setItem('bm-signup-nudge-off', '1'); } catch { /* ignore */ } setOff(true); };
  return (
    <aside className="wrap signup-nudge" aria-label="Create an account">
      <div><b>Keep your decks next to the meta.</b> <span className="muted">Copy any winning list, check legality as sets rotate, and buy the exact printings. Free.</span></div>
      <div className="row-gap"><button className="btn small ghost" onClick={hide}>No thanks</button><Link to={'/signup?next=' + encodeURIComponent(path)} className="btn small primary">Sign up free</Link></div>
    </aside>
  );
}

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
