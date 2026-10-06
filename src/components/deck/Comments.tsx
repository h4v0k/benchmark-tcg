import { useState } from 'react';
import { Avatar, ErrorBox, Icon, Spinner, useAsync } from '../ui';
import { Markdown } from '../Markdown';
import { Link } from '../../router';
import { useAuth, toast } from '../../state';
import * as api from '../../lib/api';
import { ago } from '../../lib/cards';
import type { Comment } from '../../lib/types';

export function Comments({ deckId, deckOwner, onCount }: { deckId: string; deckOwner: string; onCount: (n: number) => void }) {
  const { session, profile } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.comments(deckId), [deckId]);
  const [extra, setExtra] = useState<Comment[]>([]);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const list = [...(data || []), ...extra].filter(c => !gone.has(c.id));
  const post = async () => {
    const t = body.trim();
    if (!t) return;
    setBusy(true);
    try { const c = await api.addComment(deckId, t); setExtra(x => [...x, c]); setBody(''); onCount(list.length + 1); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const del = async (id: string) => {
    try { await api.deleteComment(id); setGone(g => new Set(g).add(id)); onCount(list.length - 1); } catch (e: any) { toast(e.message, 'bad'); }
  };
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="comments">
      {!list.length && <p className="muted">No comments yet.</p>}
      {list.map(c => (
        <article key={c.id} className="comment">
          <Avatar card={c.author?.avatar_card} name={c.author?.username || '?'} size={32} />
          <div className="comment-body">
            <div className="comment-head">
              {c.author ? <Link to={`/users/${c.author.username}`}><b>{c.author.username}</b></Link> : <b>Deleted user</b>}
              {c.user_id === deckOwner && <span className="tag accent">Author</span>}
              <span className="muted">{ago(c.created_at)}</span>
              {session && (c.user_id === session.user.id || deckOwner === session.user.id || profile?.is_admin) && (
                <button className="link-btn danger" onClick={() => del(c.id)}><Icon name="trash" size={12} />Delete</button>
              )}
            </div>
            <Markdown text={c.body} compact />
          </div>
        </article>
      ))}
      {session && profile ? (
        <form className="comment-form" onSubmit={e => { e.preventDefault(); post(); }}>
          <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={2000} rows={3} placeholder="Add a comment. **bold**, *italic*, [[Card Name]] and links work." aria-label="Comment" />
          <div className="row-end"><span className="muted small">{body.length}/2000</span><button className="btn primary" disabled={busy || !body.trim()}>Post</button></div>
        </form>
      ) : <p className="muted"><Link to="/login">Sign in</Link> to comment.</p>}
    </div>
  );
}
