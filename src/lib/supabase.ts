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
        const r = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) });
        if (r.ok) { const s = sessionFrom(await r.json()); save(s); return s; }
        if (r.status === 400 || r.status === 401 || r.status === 403) save(null); // token revoked or expired
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

async function call(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('apikey', anon);
  headers.set('Authorization', `Bearer ${await token()}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let r: Response;
  try { r = await fetch(base + path, { ...init, headers }); }
  catch { throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0); }
  if (r.status === 401 && retry && session) { await refresh(); return call(path, init, false); }
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
  const rows = r.status === 416 ? [] : await r.json();
  const cr = r.headers.get('content-range');
  const count = cr && cr.includes('/') && cr.split('/')[1] !== '*' ? parseInt(cr.split('/')[1], 10) : null;
  return { rows, count };
}
export async function insert<T = any>(table: string, row: object | object[], q: Query = {}): Promise<T[]> {
  const r = await call(`/rest/v1/${table}${qs(q)}`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!r.ok) throw await readError(r);
  return r.json();
}
export async function update<T = any>(table: string, q: Query, patch: object): Promise<T[]> {
  const r = await call(`/rest/v1/${table}${qs(q)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!r.ok) throw await readError(r);
  return r.json();
}
export async function remove(table: string, q: Query): Promise<void> {
  const r = await call(`/rest/v1/${table}${qs(q)}`, { method: 'DELETE' });
  if (!r.ok) throw await readError(r);
}
export async function rpc<T = any>(fn: string, args: object = {}): Promise<T> {
  const r = await call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) throw await readError(r);
  const t = await r.text();
  return (t ? JSON.parse(t) : null) as T;
}
export async function invoke<T = any>(fn: string, body: object): Promise<T> {
  const r = await call(`/functions/v1/${fn}`, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw await readError(r);
  return r.json();
}

/* ---------------- Auth ---------------- */
const authFetch = async (path: string, body: object, withToken = false) => {
  const headers: Record<string, string> = { apikey: anon, 'Content-Type': 'application/json' };
  if (withToken) headers.Authorization = `Bearer ${await token()}`;
  let r: Response;
  try { r = await fetch(`${base}/auth/v1/${path}`, { method: path === 'user' ? 'PUT' : 'POST', headers, body: JSON.stringify(body) }); }
  catch { throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0); }
  if (!r.ok) throw await readError(r);
  const t = await r.text();
  return t ? JSON.parse(t) : {};
};
const redirectTo = () => encodeURIComponent(location.origin + '/');

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
    try { if (session) await fetch(`${base}/auth/v1/logout`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${session.access_token}` } }); } catch { /* offline */ }
    save(null);
  },
  /** Picks up tokens Supabase puts in the URL after email confirmation or a password reset. */
  async fromUrl(): Promise<{ type?: string; error?: string } | null> {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const q = new URLSearchParams(location.search);
    const err = h.get('error_description') || q.get('error_description');
    if (err) { history.replaceState(null, '', location.pathname); return { error: err.replace(/\+/g, ' ') }; }
    const at = h.get('access_token'), rt = h.get('refresh_token');
    if (!at || !rt) return null;
    const type = h.get('type') || undefined;
    history.replaceState(null, '', location.pathname);
    const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${at}` } });
    if (!r.ok) return { error: 'That link has expired. Request a new one.' };
    const user = await r.json();
    save({ access_token: at, refresh_token: rt, expires_at: parseInt(h.get('expires_at') || '0', 10) || Math.floor(Date.now() / 1000) + parseInt(h.get('expires_in') || '3600', 10), user });
    return { type };
  },
  refresh,
};

export const configured = !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
