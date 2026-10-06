export type Format = 'standard' | 'expanded' | 'unlimited';
export type Board = 'main' | 'maybe';
export type Finish = 'normal' | 'holo' | 'reverse' | 'firstEdition' | 'firstEditionHolo' | 'unlimitedHolo';

export type SetInfo = {
  id: string; name: string; code: string; series: string;
  release_date: string | null; legal_date: string | null;
  symbol: string; logo: string; is_promo: boolean; is_classic: boolean;
};

export type Attack = { name: string; cost: string[]; damage: string; effect: string };
export type Ability = { name: string; type: string; effect: string };

export type Card = {
  id: string; set_id: string; local_id: string; name: string;
  category: '' | 'Pokemon' | 'Trainer' | 'Energy';
  stage: string; trainer_type: string; energy_type: string; suffix: string; evolves_from: string;
  types: string[]; hp: number | null; retreat: number | null; rarity: string; reg_mark: string;
  illustrator: string; effect: string; abilities: Ability[]; attacks: Attack[];
  weaknesses: { type: string; value: string }[]; resistances: { type: string; value: string }[];
  variants: string[]; image: string;
  is_ace: boolean; is_radiant: boolean; is_prism: boolean; is_basic_energy: boolean;
  tcgp_product_id: number | null; tcgp: Partial<Record<Finish, number>>;
  prices: Partial<Record<Finish, number>>; prices_at: string | null;
  legal_standard: boolean; legal_expanded: boolean; standard_from: string | null;
  rotating: boolean; rotating_on: string | null; banned_in: string[];
  detail_at: string | null;
  set?: SetInfo;
};

/** What a deck stores per card (in decks.cards). Names are kept so lists still read if a card goes missing. */
export type DeckEntry = {
  cid: string; qty: number; board: Board; variant?: Finish | string;
  name: string; cat?: string;
  [legacy: string]: unknown;
};

export type Profile = {
  id: string; username: string; bio: string; avatar_card: string; is_admin: boolean;
  follower_count: number; following_count: number; created_at: string;
};

export type DeckRow = {
  id: string; owner: string; name: string; format: Format; description: string; primer: string;
  is_public: boolean; cards: DeckEntry[]; cover: string; price: number; card_count: number;
  like_count: number; view_count: number; comment_count: number; featured: boolean;
  tags: string[]; folder_id: string | null; archetype: string; card_names?: string[];
  created_at: string; updated_at: string;
  owner_profile?: { username: string; avatar_card?: string } | null;
};

export type Folder = { id: string; owner: string; name: string; created_at: string };
export type Comment = { id: string; deck_id: string; user_id: string; body: string; created_at: string; author?: { username: string; avatar_card?: string } | null };

export type Rotation = { id: number; new_min_mark: string; season: string; effective_date: string | null; online_date: string | null; source: string };
export type Ban = { format: 'standard' | 'expanded'; card_name: string; printings: { set: string; num: string }[]; card_ids: string[]; effective_date: string | null; source: string };
export type Rules = {
  standard_min_mark: string;
  formats: { format: string; min_mark: string | null; min_release: string | null; season: string; notes: string; source: string; checked_at: string | null; updated_at: string }[];
  next_rotation: Rotation | null;
  bans: Ban[];
  upcoming_sets: { id: string; name: string; code: string; release_date: string; legal_date: string }[];
  last_checked: string | null;
  last_catalog_sync: string | null;
  card_count: number;
};
export type RuleChange = { id: number; happened_at: string; format: string; kind: string; title: string; detail: string; card_ids: string[] };

export type SearchHit = { name: string; card_id: string; image: string; set_id: string; set_name: string; category: string; sub: string; printings: number; legal: boolean };
