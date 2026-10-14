# Benchmark: Pokémon TCG deck builder

Build, price and share Pokémon TCG decks. Pick the exact printing and finish of every card, buy that exact printing on TCGplayer, send a whole deck to TCGplayer Mass Entry, and import or export Pokémon TCG Live lists.

## Status

Your Supabase project **benchmark** is already set up:
- Database tables and security rules are applied (see `supabase/schema.sql`).
- The `tcgplayer` Edge Function is deployed. It matches each printing to its exact TCGplayer product using TCGCSV's daily copy of the TCGplayer catalog.
- `config.js` already points at the project.

## Go live

The site runs on Cloudflare Workers at **https://benchmarktcg.us** (also `www.benchmarktcg.us`), deployed from this repo.

In Supabase, **Authentication → URL Configuration** should have **Site URL** set to `https://benchmarktcg.us`, with `https://benchmarktcg.us/**` and `https://www.benchmarktcg.us/**` in **Redirect URLs**. Confirmation and password-reset emails link back there.

## Files

| File | What it is |
|---|---|
| `index.html`, `app.js`, `styles.css` | The site |
| `config.js` | Supabase address and public key |
| `supabase/schema.sql` | The database setup, already applied |
| `supabase/tcgplayer-function.ts` | The TCGplayer lookup, already deployed |

## Notes

- Card data and images come from TCGdex (https://tcgdex.dev). Prices are TCGplayer market prices from TCGdex.
- A card that can't be matched to a TCGplayer product falls back to a TCGplayer search, and the deck page lists it by name so you know it's missing from the Mass Entry link. It retries weekly, which picks up brand-new sets once TCGplayer lists them.
- Standard and Expanded legality comes from TCGdex. If an old printing shows as not legal, open the card and pick a newer reprint.
