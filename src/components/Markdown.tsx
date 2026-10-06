// A small, safe Markdown renderer for primers and comments. Supports headings, bold, italic,
// links, lists, quotes, code, line breaks, and [[Card Name]] links with a hover preview.
// Everything is built as React elements, so no HTML from the text is ever injected.
import { Fragment, type ReactNode } from 'react';
import { Link } from '../router';

type CardRef = { name: string; image?: string };

function inline(text: string, cards: Map<string, CardRef>, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[\[([^\]|]{1,60})(?:\|[^\]]*)?\]\]|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`|\[([^\]]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)|(https?:\/\/[^\s<]{3,500})/g;
  let last = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) {
      const name = m[1].trim();
      const c = cards.get(name.toLowerCase());
      out.push(<Link key={k} to={`/decks?card=${encodeURIComponent(c?.name || name)}`} className="card-ref" data-preview={c?.image || undefined}>{name}</Link>);
    } else if (m[2]) out.push(<strong key={k}>{inline(m[2], cards, k)}</strong>);
    else if (m[3] || m[4]) out.push(<em key={k}>{inline(m[3] || m[4], cards, k)}</em>);
    else if (m[5]) out.push(<code key={k}>{m[5]}</code>);
    else if (m[6]) out.push(<a key={k} href={m[7]} target="_blank" rel="noopener noreferrer nofollow ugc">{m[6]}</a>);
    else if (m[8]) out.push(<a key={k} href={m[8]} target="_blank" rel="noopener noreferrer nofollow ugc">{m[8]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, cards = new Map(), compact = false }: { text: string; cards?: Map<string, CardRef>; compact?: boolean }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0, b = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h && !compact) { const L = Math.min(4, h[1].length + 1); const Tag = `h${L}` as 'h2'; blocks.push(<Tag key={b++}>{inline(h[2], cards)}</Tag>); i++; continue; }
    if (/^```/.test(line)) {
      const body: string[] = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++; blocks.push(<pre key={b++}><code>{body.join('\n')}</code></pre>); continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      const L = ordered ? 'ol' : 'ul';
      blocks.push(L === 'ol' ? <ol key={b++}>{items.map((t, j) => <li key={j}>{inline(t, cards)}</li>)}</ol> : <ul key={b++}>{items.map((t, j) => <li key={j}>{inline(t, cards)}</li>)}</ul>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={b++}>{inline(q.join(' '), cards)}</blockquote>); continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { blocks.push(<hr key={b++} />); i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*+]|\d+[.)])\s|>)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={b++}>{para.map((t, j) => <Fragment key={j}>{j > 0 && <br />}{inline(t, cards, `p${j}`)}</Fragment>)}</p>);
  }
  return <div className={`md ${compact ? 'compact' : ''}`}>{blocks}</div>;
}
