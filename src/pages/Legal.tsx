import { Link } from '../router';

const UPDATED = 'October 17, 2026';

export function PrivacyPage() {
  return (
    <div className="wrap page narrow legal">
      <h1>Privacy</h1>
      <p className="muted">Last updated: {UPDATED}</p>
      <p>Benchmark (benchmarktcg.us) is a free site for building and sharing Pokémon TCG decks. This page says what we collect and why, in plain words.</p>
      <h2>What we collect</h2>
      <ul>
        <li><b>Account:</b> your email address and username. If you sign in with Google, we get your email and basic profile details from Google. If you add a passkey, we store its public key (never your fingerprint or face).</li>
        <li><b>What you make:</b> your decks, folders, likes, follows, profile bio and picture, default printings, and tournament registration details if you enter them.</li>
        <li><b>Deck views:</b> we count views on each deck using an anonymous viewer ID, so one person isn’t counted twice. It isn’t linked to your name.</li>
        <li><b>Issue reports:</b> what you type in the Report an issue form, plus an optional contact email, the page you were on and your browser type. We also keep a scrambled (hashed) version of your IP address to stop spam.</li>
        <li><b>Visits:</b> Cloudflare Web Analytics gives us simple page-view counts. It doesn’t use cookies.</li>
      </ul>
      <h2>Why</h2>
      <p>To run your account, show your public decks, keep the site safe from abuse, and fix problems. That’s all.</p>
      <h2>Where it lives</h2>
      <p>Account and deck data is stored with Supabase in the United States. The site is hosted on Cloudflare. Price links go to TCGplayer, which has its own privacy policy.</p>
      <h2>What we don’t do</h2>
      <p>We don’t sell your data. We don’t show ads. We don’t share your data with anyone except the services above that run the site.</p>
      <h2>Public game data</h2>
      <p>Card, price and tournament data comes from Limitless, TCGdex and TCGplayer. It is public game data, not personal data.</p>
      <h2>Your choices</h2>
      <p>Open <Link to="/settings">Settings</Link> to download a copy of your data, change your username or email, or delete your account. Deleting removes your profile, decks, folders, likes and follows. Issue reports you sent stay, but are no longer linked to you. Decks you set to private are visible only to you.</p>
      <h2>Contact</h2>
      <p>Use the Report an issue link at the bottom of any page.</p>
    </div>
  );
}

export function TermsPage() {
  return (
    <div className="wrap page narrow legal">
      <h1>Terms</h1>
      <p className="muted">Last updated: {UPDATED}</p>
      <p>By using Benchmark (benchmarktcg.us) you agree to these terms.</p>
      <h2>Use at your own risk</h2>
      <p>Benchmark is free and provided as is. Prices, card data, legality and tournament information can be wrong or out of date. Check official sources before you register a deck or buy cards. We don’t promise the site will always be available or that your data will never be lost.</p>
      <h2>Your content</h2>
      <p>Your decks and text are yours. If you make a deck public, you let us display it on the site, including in lists, search and share images. You can make it private or delete it any time. Don’t post anything unlawful, hateful or that isn’t yours to share.</p>
      <h2>Don’t abuse the site</h2>
      <p>Don’t scrape the site in bulk, overload it, try to break into it, or create accounts to spam or manipulate likes, follows or views. We may limit access, remove content or remove accounts that do.</p>
      <h2>Trademarks</h2>
      <p>Benchmark is a fan project. It is not affiliated with, endorsed by or sponsored by Nintendo, The Pokémon Company, Creatures or GAME FREAK. Pokémon and Pokémon card names and images are trademarks of their owners.</p>
      <h2>Changes</h2>
      <p>We may update these terms. The date at the top shows the latest version. Using the site after a change means you accept it.</p>
      <p>See also the <Link to="/privacy">Privacy page</Link>.</p>
    </div>
  );
}
