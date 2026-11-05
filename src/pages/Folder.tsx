// A shared folder: /folders/<id>. Public folders show to anyone with the link; your own folders show to you either way.
import { useEffect, useState } from 'react';
import { DeckGrid } from '../components/DeckTile';
import { Avatar, Empty, ErrorBox, Icon, Spinner, Tag, copyText } from '../components/ui';
import { useTitle } from '../components/seo';
import { Link } from '../router';
import { toast, useAuth } from '../state';
import * as api from '../lib/api';
import type { DeckRow, Folder } from '../lib/types';

export function FolderPage({ id }: { id: string }) {
  const { session } = useAuth();
  const [folder, setFolder] = useState<Folder | null | undefined>(undefined);
  const [decks, setDecks] = useState<DeckRow[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useTitle(folder?.name);

  const load = () => {
    setError(null); setFolder(undefined); setDecks(null);
    api.getFolder(id).then(async f => {
      setFolder(f);
      if (!f) return;
      const r = await api.listDecks({ folder: f.id, sharedFolder: true, owner: f.owner, per: 500, sort: 'updated' });
      setDecks(r.rows);
    }).catch(setError);
  };
  useEffect(load, [id, session?.user?.id]);

  if (error) return <div className="wrap page"><ErrorBox error={error} onRetry={load} /></div>;
  if (folder === undefined) return <div className="wrap page"><Spinner /></div>;
  if (!folder) return <div className="wrap page"><Empty title="This folder isn’t shared" icon="folder"><p className="muted">It may be private, or the link may be wrong.</p><Link to="/decks" className="btn">Browse decks</Link></Empty></div>;

  const mine = session?.user?.id === folder.owner;
  const owner = folder.owner_profile?.username;
  const share = async () => { (await copyText(api.folderUrl(folder.id))) ? toast('Link copied', 'ok') : toast('Couldn’t copy the link', 'bad'); };

  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <h1><Icon name="folder" size={22} /> {folder.name}</h1>
          <p className="muted folder-meta">
            {owner && <Link to={`/users/${encodeURIComponent(owner)}`} className="folder-owner"><Avatar card={folder.owner_profile?.avatar_card} name={owner} size={22} />{owner}</Link>}
            {decks && <span>{decks.length} deck{decks.length === 1 ? '' : 's'}</span>}
            {mine && !folder.is_public && <Tag tone="info">Private: only you can see this</Tag>}
          </p>
        </div>
        {folder.is_public && <button className="btn primary" onClick={share}><Icon name="share" size={16} />Share folder</button>}
        {mine && !folder.is_public && <Link to="/my/decks" className="btn">Make it public in My decks</Link>}
      </div>
      {!decks ? <Spinner /> : decks.length ? <DeckGrid decks={decks} showAuthor={false} /> : <Empty title="No decks in this folder yet" icon="grid" />}
    </div>
  );
}
