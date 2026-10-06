import { DeckGrid } from '../components/DeckTile';
import { Empty, ErrorBox, Spinner, useAsync } from '../components/ui';
import { Link } from '../router';
import { useAuth } from '../state';
import * as api from '../lib/api';

export function Feed() {
  const { session } = useAuth();
  const r = useAsync(async () => {
    if (!session) return null;
    const ids = await api.followingIds(session.user.id);
    if (!ids.length) return { ids, decks: [] };
    return { ids, decks: (await api.listDecks({ owners: ids, sort: 'updated', per: 48 })).rows };
  }, [session?.user?.id]);
  if (!session) return <div className="wrap page"><Empty title="Sign in to follow players" icon="user"><Link to="/login" className="btn primary">Sign in</Link></Empty></div>;
  return (
    <div className="wrap page">
      <div className="page-head"><h1>Following</h1><Link to="/users" className="btn">Find players</Link></div>
      {r.loading ? <Spinner /> : r.error ? <ErrorBox error={r.error} onRetry={r.reload} /> : !r.data?.ids.length ? (
        <Empty title="You’re not following anyone yet" icon="user"><p>Follow players from their profile to see their new and updated decks here.</p><Link to="/users" className="btn primary">Find players</Link></Empty>
      ) : r.data.decks.length ? <DeckGrid decks={r.data.decks} /> : <Empty title="Nothing new" icon="grid"><p>The players you follow haven’t shared any public decks yet.</p></Empty>}
    </div>
  );
}
