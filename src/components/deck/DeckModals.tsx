import { useEffect, useRef, useState } from 'react';
import { Icon, Modal, Segmented, Spinner, copyText } from '../ui';
import { LAYOUTS, renderDeckImage, type ImageLayout, type ImageMeta } from '../../lib/deckImage';
import { exportGrouped, exportPlain, exportPTCGL } from '../../lib/decklist';
import { massEntry } from '../../lib/tcgplayer';
import type { Line } from '../../lib/cards';
import type { DeckRow, Folder, Format } from '../../lib/types';
import * as api from '../../lib/api';
import { toast, useAuth } from '../../state';

export function ExportModal({ lines, name, meta, cover = '', onClose }: { lines: Line[]; name: string; meta?: ImageMeta; cover?: string; onClose: () => void }) {
  const [kind, setKind] = useState<'ptcgl' | 'plain' | 'grouped' | 'tcgplayer' | 'image'>('ptcgl');
  const hasMaybe = lines.some(l => l.board === 'maybe');
  const [board, setBoard] = useState<'main' | 'maybe'>('main');
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [kind, board]);
  const text = kind === 'ptcgl' ? exportPTCGL(lines, board)
    : kind === 'plain' ? exportPlain(lines, board)
    : kind === 'grouped' ? exportGrouped(lines, board)
    : lines.filter(l => l.board === board).map(l => `${l.qty} ${l.name}`).join('\n');
  const me = massEntry(lines.filter(l => l.board === board));
  const download = () => {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name.replace(/[^\w\- ]+/g, '').trim() || 'deck'}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <Modal title="Export" onClose={onClose} wide>
      <div className="row-gap wrap-row">
        <Segmented label="Format" value={kind} onChange={setKind} options={[
          { value: 'ptcgl', label: 'Pokémon TCG Live', title: 'Paste into Pokémon TCG Live or Limitless' },
          { value: 'plain', label: 'Plain list' },
          { value: 'grouped', label: 'Grouped' },
          { value: 'tcgplayer', label: 'TCGplayer' },
          ...(meta ? [{ value: 'image' as const, label: <><Icon name="image" />Image</>, title: 'A picture of the deck to post' }] : []),
        ]} />
        {hasMaybe && kind !== 'image' && <Segmented label="Board" value={board} onChange={setBoard} options={[{ value: 'main', label: 'Deck' }, { value: 'maybe', label: 'Considering' }]} />}
      </div>
      {kind === 'image' && meta ? <ImageExport lines={lines} meta={meta} cover={cover} name={name} /> : <>
      <div className="export-actions">
        <button className="btn primary" onClick={async () => { const ok = await copyText(text); setCopied(ok); if (!ok) toast('Couldn’t copy. Select the text below instead.', 'bad'); }}>
          <Icon name={copied ? 'check' : 'copy'} />{copied ? 'Copied all cards' : 'Copy all'}
        </button>
        <button className="btn" onClick={download}><Icon name="download" />Download .txt</button>
        {kind === 'tcgplayer' && <a className="btn" href={me.url} target="_blank" rel="noopener noreferrer"><Icon name="cart" />Open in TCGplayer Mass Entry</a>}
      </div>
      <textarea className="export-text" readOnly value={text} rows={12} onFocus={e => e.currentTarget.select()} aria-label="Exported list" />
      </>}
    </Modal>
  );
}

const BASIC_ENERGY = /^(basic )?(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy) energy$/i;
/** Art from other printings of a card, newest first. Basic Energy is filed under two spellings. */
const findArt = async (name: string) => {
  const m = name.match(BASIC_ENERGY);
  const names = m ? [`Basic ${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()} Energy`, `${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()} Energy`] : [name];
  const lists = await Promise.all(names.map(n => api.printingsOf(n).catch(() => [])));
  return lists.flat().map(c => c.image).filter(Boolean);
};

const fileBase = (name: string) => name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'deck';
const prefLayout = (): ImageLayout => { try { const v = localStorage.getItem('bm:imageLayout'); return LAYOUTS.some(l => l.value === v) ? (v as ImageLayout) : 'grid'; } catch { return 'grid'; } };

/** Deck picture in three layouts, with download, copy and (on phones) share. */
function ImageExport({ lines, meta, cover, name }: { lines: Line[]; meta: ImageMeta; cover: string; name: string }) {
  const [layout, setLayout] = useState<ImageLayout>(prefLayout);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    setBlob(null); setError('');
    renderDeckImage(layout, lines, meta, cover, findArt)
      .then(b => { if (n === seq.current) { setBlob(b); setUrl(u => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(b); }); } })
      .catch(e => { if (n === seq.current) setError(e?.message || 'Couldn’t create the image'); });
  }, [layout]);
  useEffect(() => () => { setUrl(u => { if (u) URL.revokeObjectURL(u); return ''; }); }, []);
  const pick = (v: ImageLayout) => { setLayout(v); try { localStorage.setItem('bm:imageLayout', v); } catch {} };
  const file = `${fileBase(name)}-${layout}.png`;
  const info = LAYOUTS.find(l => l.value === layout)!;
  const download = () => { if (!url) return; const a = document.createElement('a'); a.href = url; a.download = file; a.click(); };
  const canCopy = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
  const copy = async () => {
    if (!blob) return;
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Image copied', 'ok'); }
    catch { toast('Couldn’t copy the image. Use Download instead.', 'bad'); }
  };
  const shareFile = blob ? new File([blob], file, { type: 'image/png' }) : null;
  const canShare = !!shareFile && typeof navigator.canShare === 'function' && navigator.canShare({ files: [shareFile] });
  const share = async () => {
    if (!shareFile) return;
    try { await navigator.share({ files: [shareFile], title: meta.name, ...(meta.url ? { text: `${meta.name} on Benchmark https://${meta.url}` } : {}) }); }
    catch (e: any) { if (e?.name !== 'AbortError') toast('Couldn’t open sharing. Use Download instead.', 'bad'); }
  };
  return (
    <div className="image-export">
      <div className="row-gap wrap-row">
        <Segmented label="Layout" value={layout} onChange={pick} options={LAYOUTS.map(l => ({ value: l.value, label: l.label, title: l.hint }))} />
        <span className="muted small">{info.hint}</span>
      </div>
      <div className="export-actions">
        {canShare && <button className="btn primary" onClick={share} disabled={!blob}><Icon name="share" />Share</button>}
        <button className={`btn ${canShare ? '' : 'primary'}`} onClick={download} disabled={!blob}><Icon name="download" />Download PNG</button>
        {canCopy && <button className="btn" onClick={copy} disabled={!blob}><Icon name="copy" />Copy image</button>}
      </div>
      <div className="image-preview" style={{ aspectRatio: `${info.size[0]} / ${info.size[1]}` }}>
        {error ? <p className="muted">{error}</p> : blob && url ? <img src={url} alt={`${meta.name} deck image, ${info.label.toLowerCase()} layout`} /> : <Spinner label="Drawing your deck…" />}
      </div>
      {!meta.url && <p className="muted small">This deck is private, so the image doesn’t include a link to it.</p>}
    </div>
  );
}

export function SettingsModal({ deck, onClose, onSave }: { deck: DeckRow; onClose: () => void; onSave: (patch: Partial<DeckRow>) => void }) {
  const { session } = useAuth();
  const [name, setName] = useState(deck.name);
  const [format, setFormat] = useState<Format>(deck.format);
  const [isPublic, setPublic] = useState(deck.is_public);
  const [archetype, setArchetype] = useState(deck.archetype || '');
  const [description, setDescription] = useState(deck.description || '');
  const [tags, setTags] = useState((deck.tags || []).join(', '));
  const [folder, setFolder] = useState(deck.folder_id || '');
  const [folders, setFolders] = useState<Folder[]>([]);
  useEffect(() => { if (session) api.folders().then(setFolders).catch(() => {}); }, []);
  const save = () => {
    const t = tags.split(',').map(s => s.trim().toLowerCase().replace(/[<>]/g, '')).filter(Boolean).slice(0, 10).map(s => s.slice(0, 24));
    onSave({ name: name.trim() || 'Untitled deck', format, is_public: isPublic, archetype: archetype.trim().slice(0, 60), description: description.slice(0, 4000), tags: t, folder_id: folder || null });
    onClose();
  };
  return (
    <Modal title="Deck settings" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); save(); }}>
        <label className="field"><span>Name</span><input value={name} onChange={e => setName(e.target.value)} maxLength={80} /></label>
        <div className="field-row">
          <label className="field"><span>Format</span>
            <select value={format} onChange={e => setFormat(e.target.value as Format)}><option value="standard">Standard</option><option value="expanded">Expanded</option><option value="unlimited">Unlimited</option></select>
          </label>
          <label className="field"><span>Archetype</span><input value={archetype} onChange={e => setArchetype(e.target.value)} maxLength={60} placeholder="e.g. Dragapult" /></label>
        </div>
        <label className="field"><span>Short description</span><textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} rows={3} placeholder="One or two lines about the deck. Use the Primer tab for a full write-up." /></label>
        <label className="field"><span>Tags <small className="muted">(comma separated, up to 10)</small></span><input value={tags} onChange={e => setTags(e.target.value)} placeholder="budget, tournament, fun" /></label>
        {folders.length > 0 && (
          <label className="field"><span>Folder</span>
            <select value={folder} onChange={e => setFolder(e.target.value)}><option value="">No folder</option>{folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          </label>
        )}
        <label className="check-field"><input type="checkbox" checked={isPublic} onChange={e => setPublic(e.target.checked)} /> Public: anyone can find and view this deck</label>
        <div className="row-end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  );
}
