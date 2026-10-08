import { createRoot } from 'react-dom/client';
import { App } from './App';
import { auth } from './lib/supabase';

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
    if (next) { sessionStorage.removeItem('bm-next'); if (fromLink && !fromLink.error && next.startsWith('/') && !next.startsWith('//')) history.replaceState(null, '', next); }
  } catch { /* storage blocked */ }
  legacyRedirect();
  createRoot(document.getElementById('root')!).render(<App authLink={fromLink} />);
})();
