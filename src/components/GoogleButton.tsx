// "Continue with Google" that stays on Benchmark. Google Identity Services opens Google's own window,
// which names the app and benchmarktcg.us; the ID token it returns is exchanged with Supabase directly,
// so people never see the Supabase project address. If the script can't load (blocked, offline) or the
// site isn't an allowed origin, the old redirect button is shown instead.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CONFIG } from '../config';

declare global { interface Window { google?: any } }

let loading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!loading) loading = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? ok() : fail(new Error('no gis')));
    s.onerror = () => { loading = null; fail(new Error('gis blocked')); };
    document.head.appendChild(s);
    setTimeout(() => fail(new Error('gis timeout')), 6000);
  });
  return loading;
}

async function sha256Hex(v: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const googleInPage = () =>
  !!CONFIG.googleClientId && CONFIG.googleOrigins.includes(location.origin) && !!window.crypto?.subtle;

export function GoogleButton({ onToken, fallback, onRedirect, text = 'continue_with' }: {
  onToken: (idToken: string, nonce: string) => void; fallback: ReactNode; onRedirect: () => void; text?: 'continue_with' | 'signin_with' | 'signup_with';
}) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>(googleInPage() ? 'loading' : 'fallback');
  useEffect(() => {
    if (state === 'fallback') return;
    let alive = true;
    (async () => {
      try {
        await loadGis();
        const raw = crypto.randomUUID() + crypto.randomUUID();
        const hashed = await sha256Hex(raw);
        if (!alive || !box.current) return;
        const g = window.google.accounts.id;
        g.initialize({
          client_id: CONFIG.googleClientId, nonce: hashed, ux_mode: 'popup', use_fedcm_for_button: true,
          callback: (r: { credential?: string }) => { if (r.credential) onToken(r.credential, raw); },
        });
        const dark = document.documentElement.dataset.theme !== 'light';
        g.renderButton(box.current, {
          type: 'standard', theme: dark ? 'filled_black' : 'outline', size: 'large', text, shape: 'rectangular',
          logo_alignment: 'center', width: Math.min(400, Math.max(200, Math.floor(box.current.clientWidth || 320))),
        });
        setState('ready');
      } catch { if (alive) setState('fallback'); }
    })();
    return () => { alive = false; };
  }, []);
  if (state === 'fallback') return <>{fallback}</>;
  return (
    <>
      <div className={`gis-box ${state}`} ref={box} aria-busy={state === 'loading'} />
      {state === 'ready' && <button type="button" className="link-btn gis-alt" onClick={onRedirect}>Google window didn’t open? Try the other way</button>}
    </>
  );
}
