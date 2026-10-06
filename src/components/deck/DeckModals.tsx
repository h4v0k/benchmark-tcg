import { useEffect, useState } from 'react';
import { Icon, Modal, Segmented, copyText } from '../ui';
import { exportGrouped, exportPlain, exportPTCGL } from '../../lib/decklist';
import { massEntry } from '../../lib/tcgplayer';
import type { Line } from '../../lib/cards';
import type { DeckRow, Folder, Format } from '../../lib/types';
import * as api from '../../lib/api';
import { toast, useAuth } from '../../state';

export function ExportModal({ lines, name, onClose }: { lines: Line[]; name: string; onClose: () => void }) {
  const [kind, setKind] = useState<'ptcgl' | 'plain' | 'grouped' | 'tcgplayer'>('ptcgl');
  const hasMaybe = lines.some(l => l.board === 'maybe');
  const [board, setBoard] = useState<'main' | 'maybe'>('main');
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
        ]} />
        {hasMaybe && <Segmented label="Board" value={board} onChange={setBoard} options={[{ value: 'main', label: 'Deck' }, { value: 'maybe', label: 'Considering' }]} />}
      </div>
      <textarea className="export-text" readOnly value={text} rows={16} onFocus={e => e.currentTarget.select()} aria-label="Exported list" />
      <div className="row-end">
        {kind === 'tcgplayer' && <a className="btn" href={me.url} target="_blank" rel="noopener noreferrer"><Icon name="cart" />Open in TCGplayer Mass Entry</a>}
        <button className="btn" onClick={download}><Icon name="download" />Download .txt</button>
        <button className="btn primary" onClick={async () => toast((await copyText(text)) ? 'Copied' : 'Couldn’t copy', 'ok')}><Icon name="copy" />Copy</button>
      </div>
    </Modal>
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
