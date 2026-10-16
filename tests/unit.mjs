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
const RS = await bundle('src/lib/regsheet.ts');
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

t('registration sheet: rows from a deck', () => {
  const card = (id, name, category, code, local_id, reg_mark = 'H') => ({ id, name, category, local_id, reg_mark, set: { code }, set_id: code.toLowerCase(), stage: 'Basic' });
  const lines = [
    { cid: 'a', qty: 4, board: 'main', name: 'Dreepy', card: card('a', 'Dreepy', 'Pokemon', 'TWM', '128') },
    { cid: 'b', qty: 1, board: 'main', name: 'Dreepy', card: card('b', 'Dreepy', 'Pokemon', 'PRE', '071') },
    { cid: 'c', qty: 2, board: 'main', name: 'Iono', card: card('c', 'Iono', 'Trainer', 'PAL', '185') },
    { cid: 'd', qty: 2, board: 'main', name: 'Iono', card: card('d', 'Iono', 'Trainer', 'PAL', '254') },
    { cid: 'e', qty: 4, board: 'main', name: 'Ultra Ball', card: card('e', 'Ultra Ball', 'Trainer', 'MEG', '131') },
    { cid: 'f', qty: 3, board: 'main', name: 'Nidoran♀', card: card('f', 'Nidoran♀', 'Pokemon', 'MEW', '029', 'G') },
    { cid: 'g', qty: 1, board: 'maybe', name: 'Switch', card: card('g', 'Switch', 'Trainer', 'MEG', '130') },
  ];
  const c = RS.sheetCards(lines);
  // Pokémon: one line per printing, with set, collector number (no leading zeros) and regulation mark
  assert.deepEqual(c.pokemon.map(r => [r.qty, r.name, r.set, r.num, r.reg]).sort(), [[1, 'Dreepy', 'PRE', '71', 'H'], [3, 'Nidoran F', 'MEW', '29', 'G'], [4, 'Dreepy', 'TWM', '128', 'H']]);
  // Trainer: name and quantity only, printings merged; Considering is left out
  assert.deepEqual(c.trainer.map(r => [r.qty, r.name]).sort(), [[4, 'Iono'], [4, 'Ultra Ball']]);
  assert.equal(c.energy.length, 0);
});
t('registration sheet: division from birth date (this season’s sheet)', () => {
  assert.equal(RS.divisionFor('2015-06-01'), 'junior');
  assert.equal(RS.divisionFor('2014-01-01'), 'junior');
  assert.equal(RS.divisionFor('2013-12-31'), 'senior');
  assert.equal(RS.divisionFor('2010-01-01'), 'senior');
  assert.equal(RS.divisionFor('2009-12-31'), 'masters');
  assert.equal(RS.divisionFor(''), '');
});
const fs = await import('node:fs');
const TPLJ = JSON.parse(fs.readFileSync('src/lib/regsheet-template.json', 'utf8'));
const tpl = new Uint8Array(fs.readFileSync('public/regsheet/template.pdf'));
const checkPdf = (bytes, pagesWanted) => {
  const s = Buffer.from(bytes).toString('latin1');
  assert.equal(Buffer.from(bytes.slice(0, tpl.length)).compare(Buffer.from(tpl)), 0, 'the official sheet is kept byte for byte');
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const xref = +s.match(/startxref\n(\d+)\n%%EOF\n$/)[1];
  assert.ok(xref > tpl.length && s.slice(xref).startsWith('xref\n'));
  const sec = s.slice(xref, s.indexOf('trailer', xref)).split('\n').slice(1, -1);
  for (let i = 0; i < sec.length; i += 2) {
    const n = +sec[i].split(' ')[0], off = +sec[i + 1].slice(0, 10);
    assert.equal(sec[i + 1].length, 19, 'xref entries are 20 bytes with the newline');
    assert.ok(s.slice(off).startsWith(`${n} 0 obj\n`), `object ${n} at its offset`);
  }
  assert.ok(s.slice(xref).includes(`/Prev ${TPLJ.startxref}`));
  assert.ok(s.includes(`/Count ${pagesWanted} >>`));
  // stream lengths match
  for (const m of s.slice(tpl.length).matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = tpl.length + m.index + m[0].length;
    assert.equal(s.slice(start + +m[1], start + +m[1] + 10), '\nendstream');
  }
  return s;
};
{
  const info = { playerName: 'Mike (Havok) O’Neil', playerId: '1234567', dob: '1990-01-02', division: 'masters', format: 'standard' };
  const cards = { pokemon: [{ qty: 4, name: 'Pokémon Catcher', set: 'SVI', num: '187', reg: 'G' }], trainer: [{ qty: 4, name: 'Professor\\Test' }], energy: [] };
  const s = checkPdf(RS.fillTemplate(tpl, RS.sheetPages(info, cards), 'Deck list - test'), 1);
  assert.ok(s.includes('Mike \\(Havok\\) O\x92Neil'), 'parentheses escaped, curly apostrophe in WinAnsi');
  assert.ok(s.includes('Pok\xe9mon Catcher') && s.includes('Professor\\\\Test'));
  assert.ok(s.includes('(01)') && s.includes('(02)') && s.includes('(1990)'));
  // two sheets when Pokémon lines don't fit on one
  const many = Array.from({ length: RS.ROWS.pokemon + 3 }, (_, i) => ({ qty: 1, name: `Mon ${i}`, set: 'TWM', num: String(i), reg: 'H' }));
  const pages = RS.sheetPages(info, { pokemon: many, trainer: [], energy: [] });
  assert.equal(pages.length, 2);
  const s2 = checkPdf(RS.fillTemplate(tpl, pages, 'two'), 2);
  assert.ok(s2.includes('(Mon 12)') && s2.includes('(Sheet 2 of 2)'));
  n++;
}
t('registration sheet: long names shrink, then get cut, inside their column', () => {
  const long = 'Radiant Greninja Radiant Greninja Radiant Greninja Radiant Greninja';
  const [ops] = RS.sheetPages({ playerName: '', playerId: '', dob: '', division: '', format: '' }, { pokemon: [{ qty: 1, name: long, set: 'ASR', num: '46', reg: 'F' }], trainer: [], energy: [] });
  const t1 = ops.find(o => o.t === 'text' && o.s.startsWith('Radiant'));
  assert.ok(t1.s.endsWith('…') && t1.size >= 6);
  assert.ok(RS.textWidth(t1.s, t1.size) <= 2.27 + 1e-6);
});
console.log(`unit: ${n} groups ok`);
await import('./rules-parse.test.mjs');
