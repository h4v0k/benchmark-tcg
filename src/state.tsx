// App-wide state: signed-in user and profile, toasts, modals.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as sb from './lib/supabase';
import * as api from './lib/api';
import type { Profile } from './lib/types';

type AuthState = {
  ready: boolean;
  session: sb.Session | null;
  profile: Profile | null;
  needsUsername: boolean;
  refreshProfile: () => Promise<void>;
  setProfile: (p: Profile | null) => void;
};
const AuthCtx = createContext<AuthState>(null as any);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(sb.getSession());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const refreshProfile = useCallback(async () => {
    const s = sb.getSession();
    if (!s) { setProfile(null); return; }
    try { setProfile(await api.myProfile(s.user.id)); } catch { /* offline: keep what we have */ }
  }, []);
  useEffect(() => sb.onAuthChange(s => { setSession(s); if (!s) setProfile(null); }), []);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (session) {
        try { const p = await api.myProfile(session.user.id); if (alive) setProfile(p); } catch { /* ignore */ }
      }
      if (alive) setReady(true);
    })();
    return () => { alive = false; };
  }, [session?.user?.id]);
  const value = useMemo(() => ({ ready, session, profile, needsUsername: ready && !!session && !profile, refreshProfile, setProfile }), [ready, session, profile, refreshProfile]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

/* ---------------- toasts ---------------- */
type Toast = { id: number; msg: string; kind: '' | 'ok' | 'bad' };
let pushToast: (msg: string, kind?: Toast['kind']) => void = () => {};
export const toast = (msg: string, kind: Toast['kind'] = '') => pushToast(msg, kind);
export function Toasts() {
  const [list, setList] = useState<Toast[]>([]);
  const n = useRef(0);
  pushToast = (msg, kind = '') => {
    const id = ++n.current;
    setList(l => [...l.slice(-3), { id, msg, kind }]);
    setTimeout(() => setList(l => l.filter(t => t.id !== id)), kind === 'bad' ? 6000 : 3200);
  };
  return <div className="toasts" role="status" aria-live="polite">{list.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>;
}

/* ---------------- theme ---------------- */
export function useTheme(): [string, (t: string) => void] {
  const [t, set] = useState(() => document.documentElement.dataset.theme || 'dark');
  const apply = (v: string) => { document.documentElement.dataset.theme = v; try { localStorage.setItem('bm:theme', v); } catch {} set(v); };
  return [t, apply];
}
