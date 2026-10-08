// A small Supabase client (PostgREST, RPC, Auth, Edge Functions) built on fetch.
// Sessions use the same localStorage key as supabase-js, so people who were
// signed in on the old site stay signed in.
import { CONFIG } from '../config';

export type Session = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // seconds since epoch
  user: AuthUser;
};
export type AuthUser = { id: string; email?: string; user_metadata?: Record<string, unknown> };

const ref = (() => { try { return new URL(CONFIG.supabaseUrl).hostname.split('.')[0]; } catch { return 'local'; } })();
const STORE_KEY = `sb-${ref}-auth-token`;

export class ApiError extends Error {
  status: number; code?: string;
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code; }
}

type Listener = (s: Session | null) => void;
let session: Session | null = load();
const listeners = new Set<Listener>();
let refreshing: Promise<Session | null> | null = null;

function load(): Session | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    const cur = s?.currentSession || s; // very old supabase-js stored {currentSession}
    return cur?.access_token && cur?.refresh_token ? { access_token: cur.access_token, refresh_token: cur.refresh_token, expires_at: cur.expires_at || 0, user: cur.user } : null;
  } catch { return null; }
}
function save(s: Session | null) {
  session = s;
  try { s ? localStorage.setItem(STORE_KEY, JSON.stringify(s)) : localStorage.removeItem(STORE_KEY); } catch { /* storage blocked */ }
  listeners.forEach(f => f(s));
}
export const onAuthChange = (f: Listener) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const getSession = () => session;
// Another tab signed in, out, or rotated the token: follow it.
if (typeof window !== 'undefined') window.addEventListener('storage', e => {
  if (e.key !== null && e.key !== STORE_KEY) return;
  try { if (e.storageArea && e.storageArea !== localStorage) return; } catch { return; }
  const next = load();
  if (next?.access_token === session?.access_token && next?.refresh_token === session?.refresh_token) return;
  session = next;
  listeners.forEach(f => f(session));
});

// Every request gets a deadline so a hung server shows an error instead of an endless spinner.
const TIMEOUT_MS = (globalThis as any).__BM_TIMEOUT_MS || 15000;
// AbortSignal.timeout is missing before Safari 16, so build the same thing by hand there.
const timeoutSignal = (ms = TIMEOUT_MS): AbortSignal => {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
  return c.signal;
};
const isTimeout = (e: unknown) => (e as any)?.name === 'TimeoutError' || (e as any)?.name === 'AbortError';
const netError = (e: unknown) => isTimeout(e)
  ? new ApiError('The server took too long to answer. Try again in a moment.', 0)
  : new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
// The deadline also covers reading the body: report a timeout there the same friendly way.
const withDeadline = <T,>(p: Promise<T>): Promise<T> => p.catch(e => { throw isTimeout(e) ? netError(e) : e; });

const base = CONFIG.supabaseUrl.replace(/\/$/, '');
const anon = CONFIG.supabaseAnonKey;

async function readError(r: Response): Promise<ApiError> {
  let msg = `Request failed (${r.status})`, code: string | undefined;
  try {
    const j = await r.json();
    msg = j.msg || j.message || j.error_description || j.error || msg;
    code = j.code || j.error_code;
  } catch { /* not JSON */ }
  if (r.status === 0 || r.status >= 500) msg = `The server had a problem (${r.status}). Try again in a moment.`;
  return new ApiError(String(msg), r.status, code);
}

function sessionFrom(j: any): Session {
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: j.user };
}

async function refresh(): Promise<Session | null> {
  if (!session) return null;
  if (!refreshing) {
    const rt = session.refresh_token;
    refreshing = (async () => {
      try {
        const r = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }), signal: timeoutSignal() });
        if (r.ok) { const s = sessionFrom(await withDeadline(r.json())); save(s); return s; }
        if (r.status === 400 || r.status === 401 || r.status === 403) {
          // Another tab may have rotated the token already: use what it stored instead of signing out.
          // If both tabs refreshed at the same moment, the other one may not have stored its token yet: wait briefly.
          for (const wait of [0, 1500]) {
            if (wait) await new Promise(res => setTimeout(res, wait));
            const stored = load();
            if (stored && stored.refresh_token !== rt) { save(stored); return stored; }
          }
          if (session?.refresh_token !== rt) return session; // signed in again meanwhile
          save(null); // token revoked or expired
        }
        return session;
      } catch { return session; } finally { refreshing = null; }
    })();
  }
  return refreshing;
}

async function token(): Promise<string> {
  if (session && session.expires_at - 60 < Date.now() / 1000) await refresh();
  return session?.access_token || anon;
}

async function call(path: string, init: RequestInit = {}, retry = true, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('apikey', anon);
  headers.set('Authorization', `Bearer ${await token()}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let r: Response;
  try { r = await fetch(base + path, { ...init, headers, signal: timeoutSignal(timeoutMs) }); }
  catch (e) { throw netError(e); }
  if (r.status === 401 && retry && session) { await refresh(); return call(path, init, false, timeoutMs); }
  return r;
}

/* ---------------- PostgREST ---------------- */
export type Query = Record<string, string | number | boolean | undefined | null>;
const qs = (q: Query = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.append(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
};

export async function select<T = any>(table: string, q: Query = {}, opts: { count?: boolean; range?: [number, number]; single?: boolean } = {}): Promise<{ rows: T[]; count: number | null }> {
  const headers: Record<string, string> = {};
  if (opts.count) headers.Prefer = 'count=exact';
  if (opts.range) { headers['Range-Unit'] = 'items'; headers.Range = `${opts.range[0]}-${opts.range[1]}`; }
  const r = await call(`/rest/v1/${table}${qs(q)}`, { headers });
  if (!r.ok && r.status !== 416) throw await readError(r);
  const rows = r.status === 416 ? [] : await withDeadline(r.json());
  const cr = r.headers.get('content-range');
  const count = cr && cr.includes('/') && cr.split('/')[1] !== '*' ? parseInt(cr.split('/')[1], 10) : null;
  return { rows, count };
}
export async function insert<T = any>(table: string, row: object | object[], q: Query = {}): Promise<T[]> {
  const r = await call(`/rest/v1/${table}${qs(q)}`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!r.ok) throw await readError(r);
  return withDeadline(r.json());
}
export async function update<T = any>(table: string, q: Query, patch: object): Promise<T[]> {
  const r = await call(`/rest/v1/${table}${qs(q)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!r.ok) throw await readError(r);
  return withDeadline(r.json());
}
export async function remove(table: string, q: Query): Promise<void> {
  const r = await call(`/rest/v1/${table}${qs(q)}`, { method: 'DELETE' });
  if (!r.ok) throw await readError(r);
}
export async function rpc<T = any>(fn: string, args: object = {}): Promise<T> {
  const r = await call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) throw await readError(r);
  const t = await withDeadline(r.text());
  return (t ? JSON.parse(t) : null) as T;
}
// Edge functions can run long (catalog-sync works for up to 100 s; deck-import may chain several fetches).
const FN_TIMEOUT_MS: Record<string, number> = { 'catalog-sync': 130000, 'rules-sync': 130000, 'deck-import': 45000 };
export async function invoke<T = any>(fn: string, body: object): Promise<T> {
  const r = await call(`/functions/v1/${fn}`, { method: 'POST', body: JSON.stringify(body) }, true, Math.max(FN_TIMEOUT_MS[fn] || 0, TIMEOUT_MS));
  if (!r.ok) throw await readError(r);
  return withDeadline(r.json());
}

/* ---------------- Auth ---------------- */
const authFetch = async (path: string, body: object, withToken = false) => {
  const headers: Record<string, string> = { apikey: anon, 'Content-Type': 'application/json' };
  if (withToken) headers.Authorization = `Bearer ${await token()}`;
  let r: Response;
  try { r = await fetch(`${base}/auth/v1/${path}`, { method: path === 'user' ? 'PUT' : 'POST', headers, body: JSON.stringify(body), signal: timeoutSignal() }); }
  catch (e) { throw netError(e); }
  if (!r.ok) throw await readError(r);
  const t = await withDeadline(r.text());
  return t ? JSON.parse(t) : {};
};
const redirectTo = () => encodeURIComponent(location.origin + '/');

let passkeyShare: { at: number; p: Promise<any> } | null = null;
export const auth = {
  async signIn(email: string, password: string) {
    const j = await authFetch('token?grant_type=password', { email, password });
    save(sessionFrom(j));
    return session!;
  },
  /** Returns true when the account is ready now, false when an email confirmation is needed. */
  async signUp(email: string, password: string): Promise<boolean> {
    const j = await authFetch(`signup?redirect_to=${redirectTo()}`, { email, password });
    if (j.access_token) { save(sessionFrom(j)); return true; }
    if (j.identities && j.identities.length === 0) throw new ApiError('An account with that email already exists. Sign in instead.', 400);
    return false;
  },
  async resetPassword(email: string) { await authFetch(`recover?redirect_to=${redirectTo()}`, { email }); },
  async setPassword(password: string) { await authFetch('user', { password }, true); },
  async signOut() {
    try { if (session) await fetch(`${base}/auth/v1/logout`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${session.access_token}` }, signal: timeoutSignal(5000) }); } catch { /* offline */ }
    save(null);
  },
  /** Picks up tokens Supabase puts in the URL after email confirmation or a password reset. */
  async fromUrl(stillWanted: () => boolean = () => true): Promise<{ type?: string; error?: string } | null> {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const q = new URLSearchParams(location.search);
    const err = h.get('error_description') || q.get('error_description');
    if (err) { history.replaceState(null, '', location.pathname); return { error: err.replace(/\+/g, ' ') }; }
    const at = h.get('access_token'), rt = h.get('refresh_token');
    if (!at || !rt) return null;
    const type = h.get('type') || undefined;
    history.replaceState(null, '', location.pathname);
    let r: Response;
    let user: any;
    try {
      r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${at}` }, signal: timeoutSignal(5000) });
      if (!r.ok) return { error: 'That link has expired. Request a new one.' };
      user = await r.json();
    } catch (e) { return { error: netError(e).message }; }
    if (!stillWanted()) return null; // the page already gave up waiting and told the user
    save({ access_token: at, refresh_token: rt, expires_at: parseInt(h.get('expires_at') || '0', 10) || Math.floor(Date.now() / 1000) + parseInt(h.get('expires_in') || '3600', 10), user });
    return { type };
  },
  /** Sends the browser to Google (or another provider); it comes back signed in. */
  oauth(provider: 'google', next = '/') {
    try { sessionStorage.setItem('bm-next', next); } catch { /* ignore */ }
    location.href = `${base}/auth/v1/authorize?provider=${provider}&redirect_to=${redirectTo()}`;
  },
  /** One email for both new and returning people: clicking the link signs them in. */
  async emailLink(email: string) { await authFetch(`otp?redirect_to=${redirectTo()}`, { email, create_user: true }); },
  passkeysSupported: () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials,
  async passkeySignIn() {
    const o = await authFetch('passkeys/authentication/options', {});
    const cred = await navigator.credentials.get({ publicKey: requestOptions(o.options) }) as PublicKeyCredential | null;
    if (!cred) throw new ApiError('Passkey sign-in was cancelled.', 400);
    const j = await authFetch('passkeys/authentication/verify', { challenge_id: o.challenge_id, credential: credentialJSON(cred) });
    save(sessionFrom(j));
    return session!;
  },
  async passkeyRegister() {
    const o = await authFetch('passkeys/registration/options', {}, true);
    const cred = await navigator.credentials.create({ publicKey: creationOptions(o.options) }) as PublicKeyCredential | null;
    if (!cred) throw new ApiError('Passkey setup was cancelled.', 400);
    const done = await authFetch('passkeys/registration/verify', { challenge_id: o.challenge_id, credential: credentialJSON(cred) }, true);
    passkeyShare = null;
    return done;
  },
  // The sign-in nudge (App) and the Settings page both list passkeys on load; share one request
  // for a few seconds. Registering or removing a passkey clears the share.
  passkeys(): Promise<{ id: string; friendly_name?: string; created_at: string; last_used_at?: string }[]> {
    if (passkeyShare && Date.now() - passkeyShare.at < 3000) return passkeyShare.p;
    const p = (async () => {
      const r = await fetch(`${base}/auth/v1/passkeys/`, { headers: { apikey: anon, Authorization: `Bearer ${await token()}` }, signal: timeoutSignal() }).catch(e => { throw netError(e); });
      if (!r.ok) throw await readError(r);
      return withDeadline(r.json());
    })();
    const share = { at: Date.now(), p };
    passkeyShare = share;
    p.catch(() => { if (passkeyShare === share) passkeyShare = null; });
    return p;
  },
  async deletePasskey(id: string) {
    const r = await fetch(`${base}/auth/v1/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { apikey: anon, Authorization: `Bearer ${await token()}` }, signal: timeoutSignal() }).catch(e => { throw netError(e); });
    if (!r.ok) throw await readError(r);
    passkeyShare = null;
  },
  refresh,
};

/* ---------------- WebAuthn JSON helpers ---------------- */
const b64uToBuf = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u.buffer;
};
const bufToB64u = (b: ArrayBuffer | null | undefined) => {
  if (!b) return undefined;
  const u = new Uint8Array(b); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const descs = (list?: any[]) => list?.map(d => ({ ...d, id: b64uToBuf(d.id) }));
function requestOptions(raw: any): PublicKeyCredentialRequestOptions {
  const o = raw?.publicKey || raw;
  return { ...o, challenge: b64uToBuf(o.challenge), allowCredentials: descs(o.allowCredentials) };
}
function creationOptions(raw: any): PublicKeyCredentialCreationOptions {
  const o = raw?.publicKey || raw;
  return { ...o, challenge: b64uToBuf(o.challenge), user: { ...o.user, id: b64uToBuf(o.user.id) }, excludeCredentials: descs(o.excludeCredentials) };
}
function credentialJSON(c: PublicKeyCredential): object {
  try { if (typeof (c as any).toJSON === 'function') return (c as any).toJSON(); } catch { /* fall back */ }
  const r: any = c.response;
  const response: any = { clientDataJSON: bufToB64u(r.clientDataJSON) };
  if (r.attestationObject) {
    response.attestationObject = bufToB64u(r.attestationObject);
    if (typeof r.getTransports === 'function') response.transports = r.getTransports();
  } else {
    response.authenticatorData = bufToB64u(r.authenticatorData);
    response.signature = bufToB64u(r.signature);
    response.userHandle = bufToB64u(r.userHandle);
  }
  return { id: c.id, rawId: bufToB64u(c.rawId), type: c.type, response, clientExtensionResults: c.getClientExtensionResults?.() || {}, authenticatorAttachment: (c as any).authenticatorAttachment || undefined };
}

export const configured = !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
