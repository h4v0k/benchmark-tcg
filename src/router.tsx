// A small path router: <Link>, navigate(), useRoute().
import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach(f => f());
window.addEventListener('popstate', emit);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname + location.search) return;
  opts.replace ? history.replaceState(null, '', to) : history.pushState(null, '', to);
  emit();
  if (!opts.replace) window.scrollTo(0, 0);
}
export const setQuery = (patch: Record<string, string | number | null | undefined>) => {
  const p = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) v === null || v === undefined || v === '' ? p.delete(k) : p.set(k, String(v));
  const s = p.toString();
  navigate(location.pathname + (s ? '?' + s : ''), { replace: true });
};

export function useRoute() {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set(x => x + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return { path: location.pathname, query: new URLSearchParams(location.search) };
}

export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean), b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) { try { out[a[i].slice(1)] = decodeURIComponent(b[i]); } catch { out[a[i].slice(1)] = b[i]; } }
    else if (a[i] !== b[i]) return null;
  }
  return out;
}

export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    rest.onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === '_blank') return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} {...rest} onClick={onClick}>{children}</a>;
}
