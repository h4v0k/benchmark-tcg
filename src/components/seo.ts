import { useEffect } from 'react';

const DEFAULT_TITLE = 'Benchmark · Pokémon TCG Decks, Meta & Matchups';

/** Sets the tab title ("X · Benchmark") and meta description for the current page; restores the defaults on leave. */
export function useTitle(title?: string | null, description?: string) {
  useEffect(() => {
    if (!title) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc = meta?.content;
    document.title = `${title} · Benchmark`;
    if (meta && description) meta.content = description;
    return () => {
      document.title = DEFAULT_TITLE;
      if (meta && prevDesc !== undefined) meta.content = prevDesc;
    };
  }, [title, description]);
}
