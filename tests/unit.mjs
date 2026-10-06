// Unit tests for deck list parsing, legality checks and TCGplayer links.
import { build } from 'esbuild';
import assert from 'node:assert/strict';

const bundle = async (entry) => {
  const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'error' });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
const D = await bundle('src/lib/decklist.ts');
const L = await bundle('src/lib/legality.ts');
const T = await bundle('src/lib/tcgplayer.ts');
let n = 0; const t = (name, fn) => { fn(); n++; };

t('PTCGL export', () => {
  const p = D.parseDeckText(`Pokémon: 12
4 Dreepy TWM 128
3 Dragapult ex TWM 130

Trainer: 36
4 Iono PAL 185
1 Prime Catcher TEF 157

Energy: 12
8 Basic {P} Energy SVE 5
Total Cards: 60`);
  assert.deepEqual(p.map(x => [x.qty, x.name, x.code, x.num]), [[4, 'Dreepy', 'TWM', '128'], [3, 'Dragapult ex', 'TWM', '130'], [4, 'Iono', 'PAL', '185'], [1, 'Prime Catcher', 'TEF', '157'], [8, 'Basic Psychic Energy', 'SVE', '5']]);
});
t('PTCGO and Limitless styles', () => {
  const p = D.parseDeckText(`##Pokémon - 4
* 4 Darkrai-EX BKP 74
4x Iono (PAL 185)
2 Ultra Ball [SVI]
15 Darkness Energy SUM D
4 Basic Fire Energy Energy 2
Rare Candy x3`);
  assert.deepEqual(p.map(x => [x.qty, x.name, x.code, x.num]), [
    [4, 'Darkrai-EX', 'BKP', '74'], [4, 'Iono', 'PAL', '185'], [2, 'Ultra Ball', 'SVI', ''],
    [15, 'Darkness Energy', 'SUM', 'D'], [4, 'Basic Fire Energy', '', ''], [3, 'Rare Candy', '', '']]);
});
t('junk after names', () => {
  const p = D.parseDeckText(`3 Iono 185\n2 Iono x\n1 Porygon2`);
  assert.deepEqual(p.map(x => x.name), ['Iono', 'Iono', 'Porygon2']);
});
t('promo codes', () => {
  const p = D.parseDeckText(`1 Pecharunt ex PR-SV 149\n2 Mew ex MEW 151`);
  assert.deepEqual(p.map(x => [x.code, x.num]), [['PR-SV', '149'], ['MEW', '151']]);
});
t('YouTube description noise is skipped', () => {
  const p = D.parseDeckText(`🔥 Deck list below!
0:00 Intro
3:12 Matchups
Follow me https://twitter.com/x
1 thing to know about this deck?
Pokémon (12)
4 Dreepy
4 Drakloak
Considering:
1 Lillie's Clefairy ex`);
  assert.deepEqual(p.map(x => [x.qty, x.name, x.board]), [[4, 'Dreepy', 'main'], [4, 'Drakloak', 'main'], [1, "Lillie's Clefairy ex", 'maybe']]);
});
t('looksLikeList', () => {
  assert.ok(D.looksLikeList('4 Iono\n4 Ultra Ball\n2 Boss\n').cards >= 8 === true);
  assert.equal(D.looksLikeList('Thanks for watching!\nSubscribe').parsed, 0);
});

const card = (o) => ({ id: o.id, name: o.name, category: o.category || 'Trainer', stage: o.stage || '', trainer_type: o.trainer_type || 'Item', variants: ['normal'], prices: { normal: 1 }, legal_standard: o.std ?? true, legal_expanded: true, banned_in: o.banned || [], rotating: !!o.rotating, rotating_on: null, standard_from: o.from || null, is_ace: !!o.ace, is_radiant: false, is_prism: false, is_basic_energy: !!o.energy, reg_mark: o.mark || 'H', set: { is_classic: false }, tcgp: {}, tcgp_product_id: o.pid || null, image: '', local_id: '1' });
const line = (qty, c, board = 'main') => ({ cid: c.id, qty, board, name: c.name, card: c });
t('deck rules', () => {
  const basic = card({ id: 'a', name: 'Dreepy', category: 'Pokemon', stage: 'Basic' });
  const nrg = card({ id: 'e', name: 'Basic Psychic Energy', category: 'Energy', energy: true });
  const ace1 = card({ id: 'x1', name: 'Prime Catcher', ace: true });
  const ace2 = card({ id: 'x2', name: 'Hero\'s Cape', ace: true });
  const iono = card({ id: 'i', name: 'Iono', std: false, mark: 'G', trainer_type: 'Supporter' });
  const deck = [line(4, basic), line(5, card({ id: 'u', name: 'Ultra Ball' })), line(40, nrg), line(1, ace1), line(1, ace2), line(1, iono), line(8, card({ id: 'b', name: 'Boss' }))];
  const checks = L.validateDeck(deck, 'standard', null);
  const msg = checks.map(c => `${c.level}:${c.msg}`);
  assert.ok(msg.includes('ok:60 cards'), msg.join('|'));
  assert.ok(msg.some(m => m.startsWith('bad:More than 4')), 'over 4');
  assert.ok(msg.some(m => m === 'bad:2 ACE SPEC cards'));
  assert.ok(msg.some(m => m.startsWith('bad:1 card not Standard legal')));
  assert.ok(!msg.some(m => /Basic Psychic Energy/.test(m)), '40 basic energy is fine');
  assert.ok(L.validateDeck(deck, 'unlimited', null).every(c => !/legal/i.test(c.msg)));
  assert.equal(L.cardProblem(line(1, card({ id: 'n', name: 'New', std: false, from: '2026-11-20' })), 'standard').label.startsWith('Legal'), true);
  assert.equal(L.cardProblem(line(1, card({ id: 'z', name: 'Banned', banned: ['expanded'] })), 'expanded').label, 'Banned');
});
t('TCGplayer links', () => {
  const a = card({ id: 'a', name: 'Iono', pid: 497557 });
  const b = card({ id: 'b', name: 'Mystery' });
  const me = T.massEntry([line(4, a), line(2, b)]);
  assert.equal(me.url, 'https://www.tcgplayer.com/massentry?productline=Pokemon&c=4-497557');
  assert.deepEqual(me.missing, ['Mystery']);
  assert.match(T.buyUrl(a, 'reverse'), /^https:\/\/www\.tcgplayer\.com\/product\/497557\?Language=English&Printing=Reverse%20Holofoil$/);
  assert.match(T.buyUrl(b), /tcgplayer\.com\/search\/pokemon\/product\?.*q=Mystery/);
  assert.match(T.massEntry([line(2, b)]).url, /c=2%20Mystery$/);
});
console.log(`unit: ${n} groups ok`);
await import('./rules-parse.test.mjs');
