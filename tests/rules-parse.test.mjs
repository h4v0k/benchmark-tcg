// Runs the rules-sync parsers against a saved copy of the official ban list markup.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import assert from 'node:assert/strict';

const out = await build({ entryPoints: ['supabase/functions/rules-sync/index.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral',
  banner: { js: 'globalThis.Deno = { env: { get: () => "" }, serve: () => {} };' } });
const mod = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const html = readFileSync('tests/fixtures/banlist.html', 'utf8');
const r = mod.parseBanPage(html);
assert.equal(r.standard.list.length, 0); assert.equal(r.standard.empty, true);
const names = r.expanded.list.map(b => b.name);
assert.deepEqual(names, ['Archeops', 'Delinquent', 'Flabébé', 'Flapple', 'Lt. Surge’s Strategy', 'Marshadow', 'Shaymin-EX']);
const flapple = r.expanded.list.find(b => b.name === 'Flapple').printings;
assert.deepEqual(flapple.map(p => p.num), ['022/192', 'SV013/SV122', 'TG02/TG30', 'SWSH022']);
assert.equal(flapple[3].set, 'Sword & Shield Promo');
assert.deepEqual(r.expanded.list.find(b => b.name === 'Delinquent').printings.map(p => p.num), ['98/122', '98a/122', '98b/122']);
assert.deepEqual(r.expanded.list.find(b => b.name === 'Marshadow').printings, [{ set: 'Shining Legends', num: '45/73' }, { set: 'Black Star Promo', num: 'SM85' }]);
assert.equal(r.expanded.list.find(b => b.name === 'Shaymin-EX').printings.length, 3);

const seasons = mod.parseSeasons(`* '''{{TCG|2025-26 Standard format|2025-26}}''' — Cards with a regulation mark {{Reg|G}} or later, through {{TCG|Ascended Heroes}}
* '''{{TCG|2026-27 Standard format|2026-27}}''' — Cards with a regulation mark {{Reg|H}} or later`);
assert.deepEqual(seasons.map(s => s.mark), ['G', 'H']);
const when = mod.findRotationDate("The format takes effect on April 10, 2026, for in-person events.<ref>x</ref> On [[Pokémon TCG Live]], it starts March 26, 2026.");
assert.equal(when.date, '2026-04-10'); assert.equal(when.online, '2026-03-26');
console.log('rules parsing: ok');
