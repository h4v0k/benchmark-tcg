import { useState } from 'react';
import { Avatar, Icon, Spinner, useAsync, useDebounced } from '../components/ui';
import { Link } from '../router';
import * as api from '../lib/api';

export function UsersPage() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const r = useAsync(() => api.searchUsers(dq), [dq]);
  return (
    <div className="wrap page narrow">
      <div className="page-head"><h1>Players</h1></div>
      <div className="search-field"><Icon name="search" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search usernames" aria-label="Search usernames" autoFocus /></div>
      {r.loading ? <Spinner /> : (
        <ul className="user-list big">
          {(r.data || []).map(u => <li key={u.id}><Link to={`/users/${u.username}`}><Avatar card={u.avatar_card} name={u.username} size={36} /><span><b>{u.username}</b><small className="muted">{u.follower_count} followers</small></span></Link></li>)}
          {r.data && !r.data.length && <li className="muted">No players found.</li>}
        </ul>
      )}
    </div>
  );
}
