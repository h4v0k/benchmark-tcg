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
  const fromLink = await auth.fromUrl().catch(() => null);
  legacyRedirect();
  createRoot(document.getElementById('root')!).render(<App authLink={fromLink} />);
})();
