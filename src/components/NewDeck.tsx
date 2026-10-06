import { useState } from 'react';
import { useAuth, toast } from '../state';
import { navigate } from '../router';
import { Icon, Modal } from './ui';
import * as api from '../lib/api';
import type { Format } from '../lib/types';

export function NewDeckButton({ className = 'btn primary', label = 'New deck' }: { className?: string; label?: string }) {
  const { session, profile } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => (session && profile ? setOpen(true) : navigate('/signup?next=new'))}><Icon name="plus" /><span className="hide-sm">{label}</span></button>
      {open && <NewDeckModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function NewDeckModal({ onClose, startWith = 'empty' }: { onClose: () => void; startWith?: 'empty' | 'import' }) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState<Format>('standard');
  const [mode, setMode] = useState(startWith);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const d = await api.createDeck({ name: name.trim() || 'Untitled deck', format, cards: [], is_public: false });
      onClose();
      navigate(`/decks/${d.id}${mode === 'import' ? '?import=1' : '?edit=1'}`);
    } catch (e: any) { toast(e.message, 'bad'); setBusy(false); }
  };
  return (
    <Modal title="New deck" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); create(); }}>
        <label className="field"><span>Name</span><input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="e.g. Dragapult ex" /></label>
        <label className="field"><span>Format</span>
          <select value={format} onChange={e => setFormat(e.target.value as Format)}>
            <option value="standard">Standard</option><option value="expanded">Expanded</option><option value="unlimited">Unlimited</option>
          </select>
        </label>
        <fieldset className="field choice">
          <legend>Start with</legend>
          <label><input type="radio" checked={mode === 'empty'} onChange={() => setMode('empty')} /> An empty deck</label>
          <label><input type="radio" checked={mode === 'import'} onChange={() => setMode('import')} /> A pasted list or a YouTube / Limitless link</label>
        </fieldset>
        <div className="row-end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create deck'}</button></div>
      </form>
    </Modal>
  );
}
