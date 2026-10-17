// Sends uncaught browser errors to the database (log_client_error) so they show on the Admin page.
// Quiet by design: at most 5 reports per page load, each distinct error once, never throws.
import { rpc } from './supabase';

const seen = new Set<string>();
let sent = 0;
// The built JS file name changes with every release, so it tells us which build an error came from.
const release = (() => {
  try { return (document.querySelector('script[src*="/assets/main-"]') as HTMLScriptElement | null)?.src.split('/assets/')[1]?.slice(0, 40) || ''; }
  catch { return ''; }
})();

// Noise we can't act on: browser extensions, cancelled loads, ResizeObserver chatter.
const IGNORE = /ResizeObserver loop|Script error\.?$|chrome-extension:|moz-extension:|safari-(web-)?extension:|AbortError|The user aborted|Load failed|NetworkError|Failed to fetch/i;

export function reportError(err: unknown, where = '') {
  try {
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
    const message = `${where ? where + ': ' : ''}${e.name && e.name !== 'Error' ? e.name + ': ' : ''}${e.message || String(err)}`.slice(0, 300);
    const stack = String(e.stack || '');
    if (IGNORE.test(message) || IGNORE.test(stack.split('\n').slice(0, 3).join('\n'))) return;
    if (seen.has(message) || sent >= 5) return;
    seen.add(message); sent++;
    rpc('log_client_error', {
      p_message: message, p_stack: stack.slice(0, 1000), p_page: location.pathname, // never the query string: sign-in links can carry codes there
      p_agent: navigator.userAgent.slice(0, 300), p_release: release,
    }).catch(() => { /* reporting must never cause more errors */ });
  } catch { /* ignore */ }
}

export function installErrorReporting() {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return; // dev and tests
  addEventListener('error', ev => reportError(ev.error || ev.message));
  addEventListener('unhandledrejection', ev => reportError(ev.reason, 'Unhandled promise'));
}
