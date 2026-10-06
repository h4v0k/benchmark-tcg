import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { img } from '../lib/cards';

/* ---------------- icons (inline, 16px, stroke) ---------------- */
const P: Record<string, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  heart: 'M12 20s-7-4.4-9.3-9C1.2 7.9 3 4.5 6.4 4.5c2 0 3.4 1.1 4.1 2.3h3c.7-1.2 2.1-2.3 4.1-2.3C21 4.5 22.8 7.9 21.3 11 19 15.6 12 20 12 20z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  chat: 'M4 5h16v11H8l-4 4z',
  cart: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm9 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13',
  download: 'M12 3v12m0 0-4-4m4 4 4-4M4 19h16',
  upload: 'M12 15V3m0 0L8 7m4-4 4 4M4 19h16',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  check: 'M5 12l5 5L20 7',
  warn: 'M12 3 2 20h20zM12 10v4m0 3v.01',
  info: 'M12 8v.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  stack: 'M7 3h10v4H7zM7 9h10v4H7zM7 15h10v6H7z',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0',
  folder: 'M3 6h6l2 2h10v11H3z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1L3.2 9.5l6.1-.9z',
  shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  youtube: 'M3 7.5C3 6 4 5 5.5 5h13C20 5 21 6 21 7.5v9c0 1.5-1 2.5-2.5 2.5h-13C4 19 3 18 3 16.5zM10 9v6l5-3z',
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2-1.4-1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z',
  shield: 'M12 3 4 6v6c0 5 3.4 8.5 8 9 4.6-.5 8-4 8-9V6z',
  refresh: 'M20 11a8 8 0 0 0-14.5-4.5L4 8m0-4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16m0 4v-4h-4',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  chevron: 'M6 9l6 6 6-6',
  back: 'M15 18l-6-6 6-6',
  external: 'M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5',
};
export function Icon({ name, size = 16, className = '' }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] || ''} />
    </svg>
  );
}

export const Spinner = ({ label = 'Loading…' }: { label?: string }) => <div className="spinner-wrap" role="status"><span className="spinner" aria-hidden="true" />{label}</div>;

export function Empty({ title, children, icon = 'info' }: { title: string; children?: ReactNode; icon?: string }) {
  return <div className="empty"><Icon name={icon} size={28} /><h3>{title}</h3>{children}</div>;
}

/* ---------------- modal ---------------- */
export function Modal({ title, onClose, children, wide = false, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean | 'xl'; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    document.body.classList.add('modal-open');
    setTimeout(() => (ref.current?.querySelector('input,textarea,select,button.primary') as HTMLElement | null)?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey, true); document.body.classList.remove('modal-open'); prev?.focus?.(); };
  }, []);
  // Rendered at the page root: a parent with a blur or transform (like the top bar) would
  // otherwise trap the popup inside its own box.
  return createPortal(
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide === 'xl' ? 'xl' : wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- menus ---------------- */
export function Menu({ label, children, align = 'right', className = 'btn', title }: { label: ReactNode; children: ReactNode; align?: 'left' | 'right'; className?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; sheet: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const sheet = innerWidth <= 640;
    setPos(align === 'left' ? { top: r.bottom + 6, left: Math.max(8, r.left), sheet } : { top: r.bottom + 6, right: Math.max(8, innerWidth - r.right), sheet });
  };
  useEffect(() => {
    if (!open) return;
    place();
    const close = (e: Event) => { const t = e.target as Node; if (!ref.current?.contains(t) && !pop.current?.contains(t)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const away = (e: Event) => { if (!pop.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    window.addEventListener('resize', place); window.addEventListener('scroll', away, true);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); window.removeEventListener('resize', place); window.removeEventListener('scroll', away, true); };
  }, [open]);
  // The menu is drawn at the page root so a parent that clips its contents (like the deck header) can't hide it.
  // On phones it opens as a sheet along the bottom of the screen.
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={className} aria-haspopup="menu" aria-expanded={open} title={title} aria-label={typeof title === 'string' ? title : undefined} onClick={() => setOpen(o => !o)}>{label}</button>
      {open && pos && createPortal(
        <>
          {pos.sheet && <div className="menu-scrim" onClick={() => setOpen(false)} />}
          <div ref={pop} className={`menu ${pos.sheet ? 'sheet' : ''}`} role="menu"
            style={pos.sheet ? undefined : { position: 'fixed', top: pos.top, left: pos.left, right: pos.right }}
            onClick={e => { if ((e.target as HTMLElement).closest('[data-close]')) setOpen(false); }}>{children}</div>
        </>, document.body)}
    </div>
  );
}
export const MenuItem = ({ children, onClick, href, danger, icon }: { children: ReactNode; onClick?: () => void; href?: string; danger?: boolean; icon?: string }) =>
  href
    ? <a className={`menu-item ${danger ? 'danger' : ''}`} role="menuitem" href={href} target="_blank" rel="noopener noreferrer" data-close>{icon && <Icon name={icon} />}{children}</a>
    : <button className={`menu-item ${danger ? 'danger' : ''}`} role="menuitem" onClick={onClick} data-close>{icon && <Icon name={icon} />}{children}</button>;

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(o => <button key={o.value} role="radio" aria-checked={value === o.value} title={o.title} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

/* ---------------- card art ---------------- */
export function CardImg({ src, alt, q = 'low', className = '' }: { src: string; alt: string; q?: 'low' | 'high'; className?: string }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <div className={`card-img placeholder ${className}`} role="img" aria-label={alt}><span>{alt}</span></div>;
  return <img className={`card-img ${className}`} src={img(src, q)} alt={alt} loading="lazy" decoding="async" onError={() => setBad(true)} />;
}
/** `card` is a card image base URL (profiles.avatar_card). Shows the top of the art, cropped round. */
export function Avatar({ card, name, size = 28 }: { card?: string; name: string; size?: number }) {
  const letters = (name || '?').slice(0, 1).toUpperCase();
  const ok = !!card && /^https:\/\/assets\.tcgdex\.net\//.test(card);
  if (!ok) return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">{letters}</span>;
  return <span className="avatar art" style={{ width: size, height: size, backgroundImage: `url("${card}/low.webp")` }} aria-hidden="true" />;
}

/* ---------------- hover preview (desktop) ---------------- */
const canHover = typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches;
export function HoverPreview() {
  const [state, setState] = useState<{ src: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!canHover) return;
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('[data-preview]') as HTMLElement | null;
      if (!el) { setState(null); return; }
      const src = el.dataset.preview!;
      if (!src) return;
      setState({ src, x: e.clientX, y: e.clientY });
    };
    const leave = () => setState(null);
    document.addEventListener('mousemove', over);
    document.addEventListener('scroll', leave, true);
    document.addEventListener('mousedown', leave);
    return () => { document.removeEventListener('mousemove', over); document.removeEventListener('scroll', leave, true); document.removeEventListener('mousedown', leave); };
  }, []);
  if (!state) return null;
  const w = 250, h = 349;
  let left = state.x + 24, top = state.y - h / 2;
  if (left + w > innerWidth - 8) left = state.x - w - 24;
  top = Math.max(8, Math.min(innerHeight - h - 8, top));
  return <div className="hover-preview" style={{ left, top }}><img src={img(state.src, 'high')} alt="" /></div>;
}

export function Tag({ children, tone = '' }: { children: ReactNode; tone?: '' | 'ok' | 'bad' | 'warn' | 'info' | 'accent' }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, set] = useState(value);
  useEffect(() => { const t = setTimeout(() => set(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: Error | null; loading: boolean; reload: () => void } {
  const [state, set] = useState<{ data: T | undefined; error: Error | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    set(s => ({ ...s, loading: true, error: null }));
    fn().then(d => alive && set({ data: d, error: null, loading: false }), e => alive && set({ data: undefined, error: e, loading: false }));
    return () => { alive = false; };
  }, [...deps, n]);
  return { ...state, reload: () => setN(x => x + 1) };
}

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return <div className="empty error"><Icon name="warn" size={28} /><h3>Couldn't load this</h3><p>{error.message}</p>{onRetry && <button className="btn" onClick={onRetry}>Try again</button>}</div>;
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    // Fallback (older iOS): an off-screen, read-only box selected in full, so nothing scrolls or zooms.
    const t = document.createElement('textarea'); t.value = text; t.readOnly = true;
    t.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px';
    document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length);
    let ok = false; try { ok = document.execCommand('copy'); } catch {} t.remove(); return ok;
  }
}
