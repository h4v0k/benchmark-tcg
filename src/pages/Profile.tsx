import { useEffect, useState } from 'react';
import { DeckGrid } from '../components/DeckTile';
import { Avatar, Empty, ErrorBox, Modal, Spinner, useAsync } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { Link, navigate } from '../router';
import { useAuth, toast } from '../state';
import * as api from '../lib/api';
import { fmtDate, sum } from '../lib/cards';

export function ProfilePage({ username }: { username: string }) {
  const { session, profile: me } = useAuth();
  const p = useAsync(() => api.profileByName(username), [username]);
  const user = p.data;
  const decks = useAsync(async () => (user ? (await api.listDecks({ owner: user.id, sort: 'updated', per: 100, mine: !!session && session.user.id === user.id })).rows : []), [user?.id, session?.user?.id]);
  const [following, setFollowing] = useState(false);
  const [followers, setFollowers] = useState(0);
  const [list, setList] = useState<null | 'followers' | 'following'>(null);
  const isMe = !!session && !!user && session.user.id === user.id;
  useEffect(() => { if (user) { setFollowers(user.follower_count); if (session && !isMe) api.isFollowing(session.user.id, user.id).then(setFollowing).catch(() => {}); } }, [user?.id]);
  const toggle = async () => {
    if (!session || !me) { navigate('/login'); return; }
    const on = !following;
    setFollowing(on); setFollowers(n => n + (on ? 1 : -1));
    try { await api.setFollow(session.user.id, user!.id, on); } catch (e: any) { setFollowing(!on); setFollowers(n => n + (on ? -1 : 1)); toast(e.message, 'bad'); }
  };
  if (p.loading) return <Spinner />;
  if (p.error) return <div className="wrap page"><ErrorBox error={p.error} onRetry={p.reload} /></div>;
  if (!user) return <div className="wrap page"><Empty title="User not found" icon="user" /></div>;
  const ds = decks.data || [];
  return (
    <div className="wrap page">
      <header className="profile-head">
        <Avatar card={user.avatar_card} name={user.username} size={72} />
        <div className="profile-info">
          <h1>{user.username}</h1>
          <div className="profile-stats">
            <span><b>{ds.filter(d => d.is_public).length}</b> public decks</span>
            <button className="link-btn" onClick={() => setList('followers')}><b>{followers}</b> followers</button>
            <button className="link-btn" onClick={() => setList('following')}><b>{user.following_count}</b> following</button>
            <span><b>{sum(ds, d => d.like_count)}</b> likes</span>
            <span className="muted">Joined {fmtDate(user.created_at, { month: 'short', year: 'numeric' })}</span>
          </div>
          {user.bio && <Markdown text={user.bio} compact />}
        </div>
        <div className="profile-actions">
          {isMe ? <Link to="/settings" className="btn">Edit profile</Link> : <button className={`btn ${following ? '' : 'primary'}`} onClick={toggle}>{following ? 'Following' : 'Follow'}</button>}
        </div>
      </header>
      {decks.loading ? <Spinner /> : ds.length ? <DeckGrid decks={ds} showAuthor={false} /> : <Empty title="No decks yet" icon="grid" />}
      {list && <FollowList uid={user.id} dir={list} onClose={() => setList(null)} />}
    </div>
  );
}

function FollowList({ uid, dir, onClose }: { uid: string; dir: 'followers' | 'following'; onClose: () => void }) {
  const r = useAsync(() => api.followList(uid, dir), [uid, dir]);
  return (
    <Modal title={dir === 'followers' ? 'Followers' : 'Following'} onClose={onClose}>
      {r.loading ? <Spinner /> : !(r.data || []).length ? <p className="muted">Nobody yet.</p> : (
        <ul className="user-list">{r.data!.map(u => <li key={u.username}><Link to={`/users/${u.username}`} onClick={onClose}><Avatar card={u.avatar_card} name={u.username} />{u.username}</Link></li>)}</ul>
      )}
    </Modal>
  );
}
