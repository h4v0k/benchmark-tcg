import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { auth } from './lib/supabase';
import { toast } from './state';

// Old links used hash routes (#/deck/<id>, #/u/<name>); send them to the new paths.
function legacyRedirect() {
  const h = location.hash;
  if (!h.startsWith('#/')) return;
  const p = h.slice(1);
  let to = '';
  const m = p.match(/^\/deck\/([0-9a-f-]{36})/i);
  if (m) to = `/decks/${m[1]}`;
  else if (/^\/u\//.test(p)) to = p.replace(/^\/u\//, '/users/');
  else if (p === '/mine') to = '/my/decks';
  else if (p === '/' || p === '') to = '/';
  else if (p.startsWith('/login')) to = '/login';
  if (to) history.replaceState(null, '', to);
}

(async () => {
  // Never leave a blank page: if the link check hangs or fails, render anyway.
  let gaveUp = false;
  const slow = new Promise<{ error: string }>(res => setTimeout(() => { gaveUp = true; res({ error: 'That took too long. Try the link again, or sign in.' }); }, 6000));
  const fromLink = await Promise.race([auth.fromUrl(() => !gaveUp), slow]).catch(() => ({ error: 'Something went wrong with that link. Try again.' }));
  // Back from Google: return to the page they signed in from.
  try {
    const next = sessionStorage.getItem('bm-next');
    if (next) {
      sessionStorage.removeItem('bm-next');
      if (fromLink && !fromLink.error) {
        // Same-origin paths only: resolve against our origin and refuse anything that lands elsewhere.
        const u = new URL(next, location.origin);
        if (u.origin === location.origin && u.pathname.startsWith('/')) history.replaceState(null, '', u.pathname + u.search + u.hash);
      }
    }
  } catch { /* storage blocked */ }
  legacyRedirect();
  // A link that signs you in names the account, so a crafted link can't quietly sign you in as someone else.
  // Every link type is named (the type comes from the link itself, so it can't decide whether we say who you are).
  const named = !!fromLink && !fromLink.error && !!fromLink.email;
  const quiet = named && (!fromLink!.type || fromLink!.type === 'magiclink'); // App shows its own message for signup/recovery
  const root = createRoot(document.getElementById('root')!);
  flushSync(() => root.render(<App authLink={quiet ? { ...fromLink, type: undefined } : fromLink} />));
  if (named) toast(quiet ? `Signed in as ${fromLink!.email}` : `Signed in as ${fromLink!.email}.`, 'ok');
})();
