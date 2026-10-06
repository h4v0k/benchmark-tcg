import { Link } from '../router';
import { Avatar, Icon } from './ui';
import { ago, FORMAT_LABEL, img, money } from '../lib/cards';
import type { DeckRow } from '../lib/types';

export const coverUrl = (c: string | undefined) => (c && /^https:\/\/assets\.tcgdex\.net\/[A-Za-z0-9/._-]+$/.test(c) ? img(c, 'high') : '');

export function DeckTile({ d, showAuthor = true }: { d: DeckRow; showAuthor?: boolean }) {
  const cover = coverUrl(d.cover);
  return (
    <Link to={`/decks/${d.id}`} className="deck-tile">
      <div className="deck-tile-art" style={cover ? { backgroundImage: `url("${cover}")` } : undefined}>
        <span className={`fmt-badge ${d.format}`}>{FORMAT_LABEL[d.format]}</span>
        {!d.is_public && <span className="fmt-badge private" title="Only you can see this deck">Private</span>}
        {d.featured && <span className="fmt-badge featured"><Icon name="star" size={11} /> Featured</span>}
      </div>
      <div className="deck-tile-body">
        <div className="deck-tile-name">{d.name}</div>
        <div className="deck-tile-meta">
          {showAuthor && d.owner_profile && <span className="author"><Avatar card={d.owner_profile.avatar_card} name={d.owner_profile.username} size={18} />{d.owner_profile.username}</span>}
          <span className="muted">{ago(d.updated_at)}</span>
        </div>
        <div className="deck-tile-stats">
          <span title="Likes"><Icon name="heart" size={13} />{d.like_count}</span>
          <span title="Views"><Icon name="eye" size={13} />{d.view_count}</span>
          <span title="Comments"><Icon name="chat" size={13} />{d.comment_count}</span>
          <span className="price" title="TCGplayer market price">{money(d.price)}</span>
        </div>
      </div>
    </Link>
  );
}

export function DeckGrid({ decks, showAuthor = true }: { decks: DeckRow[]; showAuthor?: boolean }) {
  return <div className="deck-grid">{decks.map(d => <DeckTile key={d.id} d={d} showAuthor={showAuthor} />)}</div>;
}
