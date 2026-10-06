import { useEffect, useState } from 'react';
import { CardImg, Icon, Modal, Segmented, Spinner, Tag, useDebounced } from '../ui';
import * as api from '../../lib/api';
import { looksLikeList, parseDeckText, type ParsedLine } from '../../lib/decklist';
import { FORMAT_LABEL, img, legalIn, printLabel, sum } from '../../lib/cards';
import type { Card, DeckEntry, Format, SearchHit } from '../../lib/types';

type Resolved = ParsedLine & { card?: Card; how?: string | null };
type Props = {
  format: Format;
  title?: string;
  initialText?: string;
  defaultMode?: 'add' | 'replace';
  allowLink?: boolean;
  onClose: () => void;
  onApply: (entries: DeckEntry[], mode: 'add' | 'replace', meta: { title?: string; source?: string }) => void;
};

export function ImportModal({ format, title = 'Import cards', initialText = '', defaultMode = 'add', allowLink = true, onClose, onApply }: Props) {
  const [tab, setTab] = useState<'text' | 'link'>('text');
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<'add' | 'replace'>(defaultMode);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [source, setSource] = useState<{ title: string; author: string; from: string; description?: string } | null>(null);
  const [rows, setRows] = useState<Resolved[] | null>(null);
  const [busy, setBusy] = useState(false);

  const resolve = async (t: string) => {
    const parsed = parseDeckText(t);
    if (!parsed.length) { setRows(null); setError('No card lines found. Lines look like “4 Iono” or “4 Iono PAL 185”.'); return; }
    setBusy(true); setError(''); setStatus('Matching cards…');
    try {
      const res = await api.resolveLines(parsed, format);
      const ids = [...res.values()].map(r => r.id).filter(Boolean) as string[];
      const cards = await api.cardsById(ids);
      setRows(parsed.map(p => { const r = res.get(p.i); return { ...p, card: r?.id ? cards.get(r.id) : undefined, how: r?.how }; }));
    } catch (e: any) { setError(e.message); } finally { setBusy(false); setStatus(''); }
  };

  const fetchLink = async () => {
    setBusy(true); setError(''); setRows(null); setSource(null);
    try {
      const r = await api.importFromUrl(url, setStatus);
      if (r.error) { setError(r.error); return; }
      const listText = r.linked_list || r.text || '';
      const shape = looksLikeList(listText);
      setSource({ title: r.title, author: r.author, from: r.linked_from || url, description: r.kind === 'youtube' ? r.text : undefined });
      if (shape.parsed < 3 || shape.cards < 8) {
        setError(r.kind === 'youtube'
          ? 'This video’s description doesn’t include a deck list. If the creator posted the list somewhere else (a pinned comment, their site or Limitless), copy it and paste it under “Paste list”.'
          : 'Couldn’t find a deck list on that page.');
        return;
      }
      setText(listText);
      setBusy(false);
      await resolve(listText);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); setStatus(''); }
  };

  const setRowCard = (i: number, card: Card) => setRows(rs => rs && rs.map(r => r.i === i ? { ...r, card, how: 'manual' } : r));
  const dropRow = (i: number) => setRows(rs => rs && rs.filter(r => r.i !== i));
  const matched = rows?.filter(r => r.card) || [];
  const missing = rows?.filter(r => !r.card) || [];
  const counts = { main: sum(matched.filter(r => r.board === 'main'), r => r.qty), maybe: sum(matched.filter(r => r.board === 'maybe'), r => r.qty) };

  const apply = () => {
    const merged = new Map<string, DeckEntry>();
    for (const r of matched) {
      const k = `${r.card!.id}|${r.board}`;
      const e = merged.get(k);
      if (e) e.qty += r.qty;
      else merged.set(k, { cid: r.card!.id, qty: r.qty, board: r.board, name: r.card!.name, cat: r.card!.category });
    }
    onApply([...merged.values()].map(e => ({ ...e, qty: Math.min(e.qty, 60) })), mode, { title: source?.title, source: source?.from });
  };

  return (
    <Modal title={title} onClose={onClose} wide="xl"
      footer={rows && (
        <>
          <span className="muted">{counts.main} cards{counts.maybe ? ` + ${counts.maybe} considering` : ''}{missing.length ? ` · ${missing.length} line${missing.length > 1 ? 's' : ''} not matched` : ''}</span>
          <div className="row-gap">
            <Segmented label="Import mode" value={mode} onChange={setMode} options={[{ value: 'add', label: 'Add to deck' }, { value: 'replace', label: 'Replace deck' }]} />
            <button className="btn primary" onClick={apply} disabled={!matched.length}>{mode === 'replace' ? 'Replace deck' : 'Add cards'}</button>
          </div>
        </>
      )}>
      {allowLink && (
        <Segmented label="Import from" value={tab} onChange={v => { setTab(v); setError(''); }} options={[{ value: 'text', label: <><Icon name="list" size={14} />Paste list</> }, { value: 'link', label: <><Icon name="youtube" size={14} />YouTube or Limitless link</> }]} />
      )}
      {tab === 'text' ? (
        <div className="import-text">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={rows ? 6 : 14} spellCheck={false}
            placeholder={'Paste a deck list. Pokémon TCG Live, Limitless and plain lists all work:\n\nPokémon: 12\n4 Dreepy TWM 128\n4 Drakloak TWM 129\n3 Dragapult ex TWM 130\nTrainer: 36\n4 Iono PAL 185\n…'} aria-label="Deck list" />
          <div className="row-end"><button className="btn primary" onClick={() => resolve(text)} disabled={busy || !text.trim()}>{busy ? 'Matching…' : 'Match cards'}</button></div>
        </div>
      ) : (
        <form className="import-link" onSubmit={e => { e.preventDefault(); fetchLink(); }}>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…  or  https://limitlesstcg.com/decks/list/…" aria-label="Link" inputMode="url" />
          <button className="btn primary" disabled={busy || !url.trim()}>{busy ? 'Reading…' : 'Get list'}</button>
          <p className="muted small">Benchmark reads the video’s description (and any Limitless list it links to) and pulls out the cards.</p>
        </form>
      )}
      {status && <Spinner label={status} />}
      {error && <p className="notice bad"><Icon name="warn" size={15} />{error}</p>}
      {source && (source.title || source.author) && <p className="source-line"><Icon name={source.from.includes('youtu') ? 'youtube' : 'link'} size={15} />{source.title}{source.author ? <span className="muted"> · {source.author}</span> : null}</p>}
      {source?.description && error && <details className="desc"><summary>Show the description</summary><pre>{source.description}</pre></details>}
      {rows && (
        <div className="resolve-table">
          {missing.length > 0 && <p className="notice warn"><Icon name="warn" size={15} />Pick a card for the lines below that didn’t match, or remove them.</p>}
          <table>
            <thead><tr><th className="num">Qty</th><th>From your list</th><th>Matched card</th><th>{FORMAT_LABEL[format]}</th><th aria-label="Remove" /></tr></thead>
            <tbody>
              {[...missing, ...matched].map(r => (
                <tr key={r.i} className={r.card ? '' : 'unmatched'}>
                  <td className="num">{r.qty}</td>
                  <td><span className="raw">{r.raw.replace(/^[*\-•]\s*/, '')}</span>{r.board === 'maybe' && <Tag tone="info">Considering</Tag>}</td>
                  <td>{r.card ? (
                    <span className="matched" data-preview={r.card.image || undefined}><CardImg src={r.card.image} alt="" /><span>{r.card.name}<small className="muted"> {printLabel(r.card)}{r.how === 'name' && r.code ? ' (closest match)' : ''}</small></span></span>
                  ) : <PickCard name={r.name} format={format} onPick={c => setRowCard(r.i, c)} />}</td>
                  <td>{r.card ? (legalIn(r.card, format) ? <Tag tone="ok">Legal</Tag> : <Tag tone="bad">Not legal</Tag>) : '—'}</td>
                  <td><button className="icon-btn" aria-label="Remove line" onClick={() => dropRow(r.i)}><Icon name="x" size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function PickCard({ name, format, onPick }: { name: string; format: Format; onPick: (c: Card) => void }) {
  const [q, setQ] = useState(name);
  const dq = useDebounced(q, 200);
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => { let alive = true; if (dq.length >= 2) api.searchCards(dq, 'unlimited', '', 6).then(h => alive && setHits(h)).catch(() => {}); return () => { alive = false; }; }, [dq]);
  return (
    <div className="pick-card">
      <input value={q} onChange={e => setQ(e.target.value)} aria-label={`Find a card for ${name}`} />
      <div className="pick-hits">
        {hits.map(h => (
          <button key={h.card_id} onClick={async () => { const m = await api.cardsById([h.card_id]); const c = m.get(h.card_id); if (c) onPick(c); }} data-preview={h.image || undefined}>
            {h.image ? <img src={img(h.image)} alt="" /> : null}{h.name}{!h.legal && format !== 'unlimited' ? ' (not legal)' : ''}
          </button>
        ))}
        {dq.length >= 2 && !hits.length && <span className="muted small">No cards named that.</span>}
      </div>
    </div>
  );
}
