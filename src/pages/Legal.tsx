// Privacy, terms, copyright, accessibility and data credits. Written to match what the site actually does;
// update UPDATED and the text together whenever data handling or data sources change.
import type { ReactNode } from 'react';
import { Link } from '../router';

const UPDATED = 'October 20, 2026';
const Ext = ({ href, children }: { href: string; children: ReactNode }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
const Contact = () => <>the <b>Report an issue</b> link at the bottom of any page (add your email so we can reply)</>;

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="wrap page narrow legal">
      <h1>{title}</h1>
      <p className="muted">Last updated: {UPDATED}</p>
      <nav className="legal-nav" aria-label="Legal pages"><Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> · <Link to="/copyright">Copyright</Link> · <Link to="/accessibility">Accessibility</Link> · <Link to="/credits">Data credits</Link></nav>
      {children}
    </div>
  );
}

export function PrivacyPage() {
  return (
    <Doc title="Privacy">
      <p>Benchmark (benchmarktcg.us) is a free site for building and sharing Pokémon TCG decks. This page says what we collect, why, who else sees it, how long we keep it and what you can do about it, in plain words. We don’t sell your data, show ads, or use advertising trackers.</p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Account:</b> your email address and username. If you sign in with Google, we get your email and basic profile details (name and picture) from Google. If you add a passkey, we store its public key (never your fingerprint or face).</li>
        <li><b>What you make:</b> your decks (including earlier saved versions of each list), folders, collection, likes, follows, profile bio and picture, default printings, tournament registration details (player name and Player ID) if you enter them, and the Championship Points finishes you log in the Toolbox. Registration details are only used to fill in your registration sheet and are never shown to anyone else. Your date of birth and age division stay on your device and are never sent to us.</li>
        <li><b>Imports:</b> if you import a deck from a YouTube video or Limitless link, our server fetches that public page to read the list.</li>
        <li><b>Deck views:</b> we count views on each deck using an anonymous viewer ID kept in your browser, so one person isn’t counted twice. It isn’t linked to your name.</li>
        <li><b>Issue reports:</b> what you type in the Report an issue form, plus an optional contact email, the page you were on and your browser type. We also keep a scrambled (hashed) version of your IP address to stop spam.</li>
        <li><b>Site errors:</b> if a page breaks in your browser, we log the error message, the page address and your browser type so we can fix it. It isn’t linked to your name; we keep it for 14 days.</li>
        <li><b>Visits:</b> Cloudflare Web Analytics gives us simple page-view counts. It doesn’t use cookies or track you across sites.</li>
        <li><b>Server logs</b> kept by our hosts (Cloudflare and Supabase) under their own retention policies, for security and debugging. They include IP address, page requested and browser type.</li>
      </ul>

      <h2>Cookies and browser storage</h2>
      <p>Benchmark doesn’t set cookies. Your sign-in, theme, view choices and the anonymous viewer ID are kept in your browser’s local storage, which you can clear at any time. If you use Google sign-in, Google’s own sign-in button may use Google cookies under <Ext href="https://policies.google.com/privacy">Google’s privacy policy</Ext>.</p>

      <h2>Why, and on what basis</h2>
      <p>We use your information to run your account and show your public decks (to provide the service you signed up for), to keep the site safe from abuse and fix problems (our legitimate interest in a working, secure site), and for optional details like registration info only because you chose to add them (consent, which you can withdraw by deleting them).</p>

      <h2>Who else sees data</h2>
      <ul>
        <li><b>Supabase</b> stores account and deck data (United States).</li>
        <li><b>Cloudflare</b> hosts the site and counts page views (United States and worldwide data centers).</li>
        <li><b>Google</b> sends our sign-in emails (your email address and the message), runs Google sign-in if you choose it, and serves the site’s font, so your browser asks Google Fonts for it.</li>
        <li><b>Card images</b> load from TCGdex and TCGplayer’s image servers, partly through our own server. Sites your browser loads from see your IP address like any website you visit.</li>
        <li><b>TCGplayer</b> and <b>PayPal</b> only when you click a buy or donate link. They have their own privacy policies.</li>
      </ul>
      <p>We don’t sell or rent personal information, and we don’t share it for advertising. We don’t “sell” or “share” personal information as California law defines those terms. We may disclose information if the law requires it, to protect the site or its users from fraud or abuse, or as part of a transfer of the site to a new owner (who would be bound by this policy).</p>

      <h2>Where your data goes</h2>
      <p>Benchmark is run from the United States, and our providers store and process data in the United States and other countries. If you use the site from the EU, the UK or elsewhere, your information is transferred to the US so we can provide the service; our providers use safeguards such as the EU Standard Contractual Clauses for those transfers.</p>

      <h2>How long we keep it</h2>
      <p>Account data and your decks stay until you delete them or your account. Error logs are kept for 14 days. Copies in our hosts’ backups are removed as those backups expire.</p>

      <h2>Your choices and rights</h2>
      <p>Open <Link to="/settings">Settings</Link> to download a copy of your data, change your username or email, or delete your account. Deleting removes your profile, decks and their history, collection, Championship Points finishes, folders, likes and follows. Issue reports you sent stay, but without your contact email or any link to you. Decks you set to private are visible only to you.</p>
      <p>Depending on where you live (for example the EU, UK or California), you may also have the right to access, correct, delete or move your data, to object to or restrict how we use it, and to complain to your local data-protection authority. To make any privacy request, use <Contact />, and we’ll answer within 30 days.</p>

      <h2>Children</h2>
      <p>You must be at least 13 to make an account (or older if your country requires it). Players under 13 can browse decks and results without an account. If you believe a child under 13 has an account, tell us through <Contact /> and we’ll delete it.</p>

      <h2>Public game data</h2>
      <p>Card, price and tournament data comes from public sources listed on the <Link to="/credits">Data credits</Link> page. Player names and placings shown with tournament results are published by the event organizers and those sources.</p>

      <h2>Changes</h2>
      <p>If we change this policy, we’ll update the date above, and for significant changes we’ll tell account holders on the site before they take effect.</p>

      <h2>Contact</h2>
      <p>Use <Contact />.</p>
    </Doc>
  );
}

export function TermsPage() {
  return (
    <Doc title="Terms">
      <p>By using Benchmark (benchmarktcg.us) you agree to these terms and to our <Link to="/privacy">privacy policy</Link>. If you don’t agree, please don’t use the site.</p>
      <h2>Accounts</h2>
      <p>You must be at least 13 to make an account (or older if your country requires it). Keep your sign-in details safe; you’re responsible for what happens under your account. Pick a username that isn’t offensive and doesn’t impersonate someone else.</p>
      <h2>Use at your own risk</h2>
      <p>Benchmark is free and provided as is, without warranties of any kind. Prices, card data, legality and tournament information can be wrong or out of date. Check official sources before you register a deck or buy cards. Matchup numbers and other statistics are estimates, not guarantees. We don’t promise the site will always be available or that your data will never be lost, so keep your own copy of anything important (Settings has a download).</p>
      <h2>Your content</h2>
      <p>Your decks and text are yours. If you make a deck public, you let us display it on the site, including in lists, search and share images. You can make it private or delete it any time. Deck lists are lists of card names and anyone may copy a public one into their own account. Don’t post anything unlawful, hateful or that isn’t yours to share (see the <Link to="/copyright">copyright policy</Link>).</p>
      <h2>Don’t abuse the site</h2>
      <p>Don’t scrape the site in bulk, overload it, try to break into it, or create accounts to spam or manipulate likes, follows or views. We may limit access, remove content or remove accounts that do.</p>
      <h2>Trademarks</h2>
      <p>Benchmark is an unofficial fan project. It is not affiliated with, endorsed by or sponsored by Nintendo, The Pokémon Company, Creatures or GAME FREAK. Pokémon, Pokémon card names, text and images are © and ™ The Pokémon Company, Nintendo, Creatures and GAME FREAK, and are used here only to identify cards.</p>
      <h2>Limitation of liability</h2>
      <p>To the fullest extent the law allows, Benchmark and the people who run it aren’t liable for indirect, incidental, special or consequential damages, or for lost data, purchases or tournament results, arising from your use of the site. Some places don’t allow these limits, so they may not apply to you.</p>
      <h2>Changes and law</h2>
      <p>We may update these terms. The date at the top shows the latest version, and for significant changes we’ll tell account holders before they take effect. Using the site after a change means you accept it. These terms are governed by the laws of the State of Florida, USA, except where your local consumer law gives you rights that can’t be waived.</p>
    </Doc>
  );
}

export function CopyrightPage() {
  return (
    <Doc title="Copyright">
      <p>We respect copyright and respond to notices of infringement under the US Digital Millennium Copyright Act (DMCA). Pokémon card names, text and images belong to The Pokémon Company, Nintendo, Creatures and GAME FREAK and are shown to identify cards. If you think something on Benchmark infringes your copyright, send us a notice through <Contact /> with “Copyright notice” at the start, including:</p>
      <ol>
        <li>your physical or electronic signature;</li>
        <li>the copyrighted work you believe is infringed;</li>
        <li>the link to the material on Benchmark you want removed;</li>
        <li>your name, address, phone number and email;</li>
        <li>a statement that you believe in good faith the use isn’t authorized by the owner, its agent or the law;</li>
        <li>a statement, under penalty of perjury, that your notice is accurate and that you are the owner or authorized to act for the owner.</li>
      </ol>
      <h2>Counter-notices</h2>
      <p>If your content was removed and you believe that was a mistake, send a counter-notice the same way with your signature, what was removed and where it was, a statement under penalty of perjury that it was removed by mistake or misidentification, your name, address and phone number, and consent to the jurisdiction of the federal court for your district (or, outside the US, any district where we may be found). We may restore the material after 10–14 business days unless the complainant tells us they’ve filed a court action.</p>
      <h2>Repeat infringers</h2>
      <p>We disable the accounts of people who repeatedly infringe others’ copyrights.</p>
    </Doc>
  );
}

export function AccessibilityPage() {
  return (
    <Doc title="Accessibility">
      <p>We want everyone to be able to build, read and share decks on Benchmark, including people who use a screen reader, a keyboard instead of a mouse, enlarged text or high zoom, or reduced motion. Our target is the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA, the standard referenced by the Americans with Disabilities Act guidance, the European Accessibility Act (EN 301 549) and similar laws.</p>
      <h2>What we do</h2>
      <ul>
        <li>Every page works with a keyboard: a “Skip to content” link comes first, focus is always visible, and pop-up windows keep focus inside them until you close them with Escape or the Close button.</li>
        <li>Buttons, links, form fields and pop-ups have names a screen reader can read out, and pages use headings and landmarks (header, main, footer) so you can jump around.</li>
        <li>Text and controls meet AA color contrast in both the dark and light themes, and nothing relies on color alone.</li>
        <li>The site reflows to a single column on narrow screens and still works with text enlarged to 200% or more, without sideways scrolling.</li>
        <li>If your device asks for reduced motion, animations stop.</li>
        <li>Card images have their card names as text, and every deck is also available as a text list and a printable registration sheet.</li>
      </ul>
      <h2>Known limitations</h2>
      <ul>
        <li>Card images show a card’s attacks and abilities as a picture. The same text is on each card’s page.</li>
        <li>Pages and data from other sites we link to (stores, Limitless, YouTube) are outside our control.</li>
      </ul>
      <p>We check pages with automated accessibility tests and keyboard testing whenever we change them. We haven’t had a formal third-party audit.</p>
      <h2>Tell us about a problem</h2>
      <p>If something is hard or impossible to use, tell us through <Contact /> and we’ll fix it or get you the information another way.</p>
    </Doc>
  );
}

export function CreditsPage() {
  return (
    <Doc title="Data credits">
      <p>Benchmark is built on data and services from other people. Thank you to all of them. None of them endorse Benchmark.</p>
      <h2>Pokémon</h2>
      <p>Pokémon, Pokémon card names, text and images are © The Pokémon Company, Nintendo, Creatures and GAME FREAK. Benchmark is an unofficial fan project and is not affiliated with, endorsed by or sponsored by any of them.</p>
      <h2>Cards and prices</h2>
      <ul>
        <li><Ext href="https://tcgdex.dev">TCGdex</Ext>: card data and card images.</li>
        <li><Ext href="https://www.tcgplayer.com">TCGplayer</Ext>: prices and product images, via <Ext href="https://tcgcsv.com">TCGCSV</Ext>. Buy links go to TCGplayer.</li>
      </ul>
      <h2>Tournaments, meta and matchups</h2>
      <ul>
        <li>Tournament results, decklists, live standings and matchup data from <Ext href="https://limitlesstcg.com">Limitless TCG</Ext>, including <Ext href="https://play.limitlesstcg.com">Limitless Play</Ext> online events and <Ext href="https://labs.limitlesstcg.com">Limitless Labs</Ext>. Most official-event data is published by <Ext href="https://rk9.gg">RK9 Labs</Ext> with the tournament organizers.</li>
        <li>Japanese event results from Limitless TCG’s coverage of Pokémon Japan events.</li>
      </ul>
      <h2>Formats and bans</h2>
      <ul>
        <li>Banned cards from the official <Ext href="https://www.pokemon.com/us/play-pokemon/about/pokemon-tcg-banned-card-list">Play! Pokémon banned card list</Ext>.</li>
        <li>Format details partly from <Ext href="https://bulbapedia.bulbagarden.net">Bulbapedia</Ext>, licensed under <Ext href="https://creativecommons.org/licenses/by-nc-sa/2.5/">CC BY-NC-SA 2.5</Ext>.</li>
      </ul>
      <h2>Other</h2>
      <ul>
        <li>Font: Inter, from <Ext href="https://fonts.google.com">Google Fonts</Ext> under the SIL Open Font License.</li>
      </ul>
      <p>If you run one of these services and want the credit worded differently, tell us through <Contact />.</p>
    </Doc>
  );
}
