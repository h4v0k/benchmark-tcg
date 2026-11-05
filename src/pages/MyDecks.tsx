import { useEffect, useState } from 'react';
import { DeckGrid } from '../components/DeckTile';
import { NewDeckButton } from '../components/NewDeck';
import { Empty, ErrorBox, Icon, Modal, Spinner, copyText } from '../components/ui';
import { Link } from '../router';
import { useAuth, toast } from '../state';
import * as api from '../lib/api';
import type { DeckRow, Folder } from '../lib/types';

export function MyDecks() {
  const { session } = useAuth();
  const [decks, setDecks] = useState<DeckRow[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [folder, setFolder] = useState<string>('all');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<null | { id?: string; name: string }>(null);
  const load = () => {
    if (!session) return;
    setError(null);
    api.listDecks({ owner: session.user.id, mine: true, per: 500, sort: 'updated' }).then(r => setDecks(r.rows)).catch(setError);
    api.folders().then(setFolders).catch(() => {});
  };
  useEffect(load, [session?.user?.id]);
  if (!session) return <div className="wrap page"><Empty title="Sign in to see your decks" icon="user"><Link to="/login" className="btn primary">Sign in</Link></Empty></div>;
  const saveFolder = async () => {
    if (!edit) return;
    const name = edit.name.trim().slice(0, 60);
    if (!name) return;
    try { if (edit.id) await api.renameFolder(edit.id, name); else await api.createFolder(name); setEdit(null); load(); } catch (e: any) { toast(e.message, 'bad'); }
  };
  const removeFolder = async (id: string) => {
    try { await api.deleteFolder(id); if (folder === id) setFolder('all'); load(); toast('Folder deleted. Its decks are still in All decks.'); } catch (e: any) { toast(e.message, 'bad'); }
  };
  const togglePublic = async (f: Folder) => {
    try {
      await api.setFolderPublic(f.id, !f.is_public);
      setFolders(fs => fs.map(x => x.id === f.id ? { ...x, is_public: !f.is_public } : x));
      toast(f.is_public ? `${f.name} is private again` : `${f.name} is public. Anyone with the link can see its decks.`, 'ok');
    } catch (e: any) { toast(e.message, 'bad'); }
  };
  const copyFolderLink = async (f: Folder) => { (await copyText(api.folderUrl(f.id))) ? toast('Link copied', 'ok') : toast('Couldn’t copy the link', 'bad'); };
  const current = folders.find(f => f.id === folder);
  const shown = (decks || []).filter(d => (folder === 'all' || (folder === 'none' ? !d.folder_id : d.folder_id === folder)) && (!q || d.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="wrap page">
      <div className="page-head"><h1>My decks</h1><NewDeckButton /></div>
      <div className="mydecks">
        <aside className="folder-list" aria-label="Folders">
          <button className={folder === 'all' ? 'on' : ''} onClick={() => setFolder('all')}><Icon name="grid" />All decks <span className="count">{decks?.length ?? ''}</span></button>
          <button className={folder === 'none' ? 'on' : ''} onClick={() => setFolder('none')}><Icon name="folder" />Not in a folder <span className="count">{decks?.filter(d => !d.folder_id).length ?? ''}</span></button>
          {folders.map(f => (
            <div key={f.id} className={`folder-row ${folder === f.id ? 'on' : ''}`}>
              <button onClick={() => setFolder(f.id)}><Icon name="folder" />{f.name}{f.is_public && <span className="public-dot" title="Public folder" aria-label="(public)"><Icon name="share" size={12} /></span>} <span className="count">{decks?.filter(d => d.folder_id === f.id).length ?? ''}</span></button>
              <button className="icon-btn" aria-label={`Rename ${f.name}`} onClick={() => setEdit({ id: f.id, name: f.name })}><Icon name="edit" size={13} /></button>
              <button className="icon-btn" aria-label={`Delete ${f.name}`} onClick={() => removeFolder(f.id)}><Icon name="trash" size={13} /></button>
            </div>
          ))}
          <button className="new-folder" onClick={() => setEdit({ name: '' })}><Icon name="plus" />New folder</button>
          <p className="muted small">Folders are private unless you make one public. Put a deck in a folder from its Deck settings.</p>
        </aside>
        <div>
          {current && (
            <div className="folder-share">
              <div className="grow">
                <b>{current.name}</b>
                <span className="muted small">{current.is_public ? 'Public: anyone with the link can see this folder and every deck in it.' : 'Private: only you can see this folder.'}</span>
              </div>
              <button className={`btn ${current.is_public ? '' : 'primary'}`} onClick={() => togglePublic(current)} aria-pressed={current.is_public}>
                <Icon name={current.is_public ? 'shield' : 'share'} size={16} />{current.is_public ? 'Make private' : 'Make public'}
              </button>
              {current.is_public && <>
                <button className="btn primary" onClick={() => copyFolderLink(current)}><Icon name="copy" size={16} />Copy link</button>
                <Link to={`/folders/${current.id}`} className="btn">View</Link>
              </>}
            </div>
          )}
          <div className="filters"><div className="search-field"><Icon name="search" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by name" aria-label="Filter decks" /></div></div>
          {error ? <ErrorBox error={error} onRetry={load} /> : !decks ? <Spinner /> : shown.length ? <DeckGrid decks={shown} showAuthor={false} /> : (
            <Empty title={decks.length ? 'No decks here' : 'You haven’t made a deck yet'} icon="grid">{!decks.length && <NewDeckButton label="Make your first deck" />}</Empty>
          )}
        </div>
      </div>
      {edit && (
        <Modal title={edit.id ? 'Rename folder' : 'New folder'} onClose={() => setEdit(null)}>
          <form onSubmit={e => { e.preventDefault(); saveFolder(); }}>
            <label className="field"><span>Name</span><input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} maxLength={60} /></label>
            <div className="row-end"><button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary">Save</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
