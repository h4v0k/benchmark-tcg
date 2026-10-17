// Text-only Pokémon proxies: black and white, 85% of a real card (2.125 × 2.975 in), nine to a US Letter page with
// thin cut lines. Name, HP and type, stage, ability, attacks (cost in [brackets]), weakness/resistance/retreat,
// rule box text, then set, number and regulation mark. Text shrinks until it fits. Same no-library PDF approach as
// the deck list sheet: the PDF's built-in Helvetica fonts, so nothing is embedded.
import type { Card } from './types';

export type ProxyBlock = { text: string; bold?: boolean; right?: string; gap?: number; italic?: boolean };
export type ProxyCard = { name: string; hp: string; head: ProxyBlock[]; body: ProxyBlock[]; foot: ProxyBlock[]; tag: string };

const CW = 2.5 * 0.85, CH = 3.5 * 0.85; // inches
const X0 = (8.5 - 3 * CW) / 2, Y0 = (11 - 3 * CH) / 2;
const PAD = 0.07;
const pt = (inch: number) => +(inch * 72).toFixed(2);
const py = (inch: number) => +((11 - inch) * 72).toFixed(2); // inches from the top → PDF y

// Helvetica and Helvetica-Bold advance widths (per 1000 em) for printable ASCII, from the standard font metrics.
const HV = '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584'.split(' ').map(Number);
const HB = '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 556 556 778 556 556 500 389 280 389 584'.split(' ').map(Number);
const EXTRA: Record<string, number> = { '’': 222, '‘': 222, '“': 333, '”': 333, '—': 1000, '–': 556, '•': 350, '…': 1000, '×': 584, 'é': 556, 'É': 667 };
/** Width in em of a string in Helvetica (bold = Helvetica-Bold). */
export function hw(s: string, bold = false): number {
  const t = bold ? HB : HV;
  let w = 0;
  for (const ch of s) { const c = ch.charCodeAt(0); w += (c >= 32 && c <= 126 ? t[c - 32] : EXTRA[ch] ?? 556) / 1000; }
  return w;
}

// Windows-1252 bytes for the characters outside Latin-1 that card text uses.
const CP1252: Record<string, number> = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
export function winAnsi(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    const b = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : CP1252[ch] ?? 0x3f;
    const k = String.fromCharCode(b);
    out += k === '(' || k === ')' || k === '\\' ? '\\' + k : k;
  }
  return out;
}
/** Characters the PDF fonts don't have, swapped for ones they do. */
const plain = (s: string) => s.replace(/[−‐‑]/g, '-').replace(/☆/g, '*').replace(/δ/g, '(d)').replace(/[″]/g, '"').replace(/[′]/g, "'").replace(/ /g, ' ');

/* ---------- card data → proxy text ---------- */
const LETTER: Record<string, string> = { Fire: 'R', Water: 'W', Grass: 'G', Lightning: 'L', Psychic: 'P', Fighting: 'F', Darkness: 'D', Metal: 'M', Dragon: 'N', Fairy: 'Y', Colorless: 'C' };
export const energyLetter = (t: string) => LETTER[t] || (t ? t[0].toUpperCase() : '?');
const sym = (t: string) => `[${energyLetter(t)}]`;
const syms = (ts: string[]) => ts.map(sym).join('');
/** Energy written as {R} in card text becomes [R]. */
const bracket = (s: string) => s.replace(/\{([A-Za-z])\}/g, '[$1]');

const PRIZES: Record<string, string> = {
  ex: 'Pokémon ex rule: When your Pokémon ex is Knocked Out, your opponent takes 2 Prize cards.',
  v: 'Pokémon V rule: When your Pokémon V is Knocked Out, your opponent takes 2 Prize cards.',
  vstar: 'Pokémon V rule: When your Pokémon V is Knocked Out, your opponent takes 2 Prize cards.',
  vmax: 'Pokémon VMAX rule: When your Pokémon VMAX is Knocked Out, your opponent takes 3 Prize cards.',
  gx: 'Pokémon-GX rule: When your Pokémon-GX is Knocked Out, your opponent takes 2 Prize cards.',
  'tag team-gx': 'TAG TEAM rule: When your TAG TEAM is Knocked Out, your opponent takes 3 Prize cards.',
};
const STAGE: Record<string, string> = { Basic: 'Basic', Stage1: 'Stage 1', Stage2: 'Stage 2', VSTAR: 'VSTAR', VMAX: 'VMAX', MEGA: 'Mega Evolution', Baby: 'Baby', BREAK: 'BREAK', RESTORED: 'Restored', 'V-UNION': 'V-UNION', 'LEVEL-UP': 'Level-Up' };

type Src = Pick<Card, 'name' | 'category' | 'stage' | 'trainer_type' | 'energy_type' | 'suffix' | 'evolves_from' | 'types' | 'hp' | 'retreat' | 'reg_mark' | 'effect' | 'abilities' | 'attacks' | 'weaknesses' | 'resistances' | 'is_ace' | 'is_radiant' | 'is_basic_energy' | 'local_id'> & { set?: { code?: string; name?: string } | null };

/** The text that goes on a proxy for one card. */
export function proxyOf(c: Src): ProxyCard {
  const head: ProxyBlock[] = [], body: ProxyBlock[] = [], foot: ProxyBlock[] = [];
  const types = c.types || [];
  const num = /^\d+$/.test(c.local_id || '') ? String(parseInt(c.local_id, 10)) : c.local_id || '';
  const tag = [c.set?.code || '', num, c.reg_mark && c.reg_mark !== 'NONE' ? `Mark ${c.reg_mark}` : ''].filter(Boolean).join(' · ');
  const effect = bracket((c.effect || '').trim());
  if (c.category === 'Pokemon') {
    const stage = STAGE[c.stage] || c.stage;
    const sub = [stage, c.evolves_from ? `Evolves from ${c.evolves_from}` : ''].filter(Boolean).join(' · ');
    if (sub) head.push({ text: sub, italic: true });
    for (const a of c.abilities || []) body.push({ text: `${a.type || 'Ability'}: ${a.name}`, bold: true, gap: 0.5 }, ...(a.effect ? [{ text: bracket(a.effect) }] : []));
    for (const a of c.attacks || []) {
      body.push({ text: `${a.cost?.length ? syms(a.cost) + ' ' : ''}${a.name}`, bold: true, right: a.damage || '', gap: 0.5 });
      if (a.effect) body.push({ text: bracket(a.effect) });
    }
    if (effect) body.push({ text: effect, gap: 0.5 });
    const suffix = (c.suffix || '').toLowerCase();
    const rule = c.stage === 'VMAX' ? PRIZES.vmax : c.stage === 'MEGA' && suffix === 'ex' ? 'Mega Evolution Pokémon ex rule: When your Pokémon ex is Knocked Out, your opponent takes 3 Prize cards.' : PRIZES[suffix];
    if (rule) body.push({ text: rule, italic: true, gap: 0.6 });
    if (c.is_radiant) body.push({ text: 'Radiant Pokémon rule: You can’t have more than 1 Radiant Pokémon in your deck.', italic: true, gap: 0.6 });
    const w = (c.weaknesses || []).map(x => `${sym(x.type)}${x.value || ''}`).join(' ') || 'none';
    const r = (c.resistances || []).map(x => `${sym(x.type)}${x.value || ''}`).join(' ') || 'none';
    foot.push({ text: `Weakness ${w}   Resist. ${r}   Retreat ${c.retreat ?? 0}` });
    return { name: c.name, hp: c.hp ? `HP ${c.hp} ${syms(types)}`.trim() : syms(types), head, body, foot, tag };
  }
  if (c.category === 'Energy') {
    head.push({ text: c.is_basic_energy || c.energy_type === 'Normal' ? 'Basic Energy' : 'Special Energy', italic: true });
    if (effect) body.push({ text: effect });
    else if (types.length) body.push({ text: `Provides ${syms(types)} Energy.` });
    return { name: c.name, hp: '', head, body, foot, tag };
  }
  head.push({ text: c.trainer_type === 'Tool' ? 'Pokémon Tool' : c.trainer_type || 'Trainer', italic: true });
  if (effect) body.push({ text: effect });
  if (c.is_ace) body.push({ text: 'ACE SPEC rule: You can have only 1 ACE SPEC card in your deck.', italic: true, gap: 0.6 });
  if (c.trainer_type === 'Supporter') body.push({ text: 'You may play only 1 Supporter card during your turn.', italic: true, gap: 0.6 });
  if (c.trainer_type === 'Stadium') body.push({ text: 'You may play only 1 Stadium card during your turn. Put it next to the Active Spot, and discard it if another Stadium comes into play.', italic: true, gap: 0.6 });
  return { name: c.name, hp: '', head, body, foot, tag };
}

/* ---------- layout ---------- */
/** Greedy word wrap into lines no wider than w inches. */
export function wrapText(s: string, w: number, size: number, bold = false): string[] {
  const out: string[] = [];
  for (const para of plain(s).split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? cur + ' ' + word : word;
      if (cur && hw(next, bold) * size / 72 > w) { out.push(cur); cur = word; } else cur = next;
    }
    out.push(cur);
  }
  return out;
}
const LH = 1.17;
type Placed = { line: string; bold: boolean; italic: boolean; right?: string; y: number };
/** Lines of blocks stacked from y0 (inches), and the y below the last line. */
function stack(blocks: ProxyBlock[], w: number, size: number, y0: number): { placed: Placed[]; end: number } {
  const placed: Placed[] = [];
  let y = y0;
  for (const b of blocks) {
    y += (b.gap ?? 0) * size / 72 * 0.6;
    const rw = b.right ? hw(plain(b.right), true) * size / 72 + 0.05 : 0;
    wrapText(b.text, w - rw, size, !!b.bold).forEach((line, i) => {
      y += size * LH / 72;
      placed.push({ line, bold: !!b.bold, italic: !!b.italic, right: i === 0 ? b.right : undefined, y });
    });
  }
  return { placed, end: y };
}

class Ops {
  o: string[] = [];
  text(x: number, y: number, size: number, f: string, s: string) { if (s) this.o.push(`BT /${f} ${size.toFixed(2)} Tf ${pt(x)} ${py(y)} Td (${winAnsi(plain(s))}) Tj ET`); }
  line(x1: number, y1: number, x2: number, y2: number, w = 0.5) { this.o.push(`${w} w ${pt(x1)} ${py(y1)} m ${pt(x2)} ${py(y2)} l S`); }
}

/** Draws one card in its cell; text size is the largest (9 down to 4 pt) at which everything fits. */
function drawCard(o: Ops, c: ProxyCard, x0: number, y0: number) {
  const x = x0 + PAD, w = CW - 2 * PAD, top = y0 + PAD, bottom = y0 + CH - PAD;
  const tagSize = 5;
  let size = 9;
  const layout = (s: number) => {
    // name row: name left, HP + type right
    const ns = s * 1.25;
    const hpW = c.hp ? hw(plain(c.hp), true) * s / 72 + 0.06 : 0;
    let nsz = ns;
    while (nsz > 4 && hw(plain(c.name), true) * nsz / 72 > w - hpW) nsz -= 0.25;
    let y = top + ns * 1.0 / 72;
    const rowEnd = y + 0.04;
    const head = stack(c.head, w, s, rowEnd);
    const rule = head.end + 0.03;
    const body = stack(c.body, w, s, rule + 0.02);
    // footer: weakness line and tag, anchored to the bottom
    const foot = stack(c.foot, w, Math.min(s, 7), 0);
    const footH = foot.end + 0.03;
    const tagY = bottom;
    const footTop = tagY - tagSize * 1.1 / 72 - footH;
    return { nsz, hpW, nameY: y, head, rule, body, foot, footTop, tagY, fits: body.end <= footTop - 0.02 };
  };
  let L = layout(size);
  while (!L.fits && size > 4) { size -= 0.25; L = layout(size); }
  o.text(x, L.nameY, L.nsz, 'HB', c.name);
  if (c.hp) o.text(x + w - L.hpW + 0.06, L.nameY, size, 'HB', c.hp);
  for (const p of L.head.placed) o.text(x, p.y, size, 'HO', p.line);
  o.line(x, L.rule, x + w, L.rule, 0.4);
  for (const p of L.body.placed) {
    o.text(x, p.y, size, p.bold ? 'HB' : p.italic ? 'HO' : 'H', p.line);
    if (p.right) o.text(x + w - hw(plain(p.right), true) * size / 72, p.y, size, 'HB', p.right);
  }
  o.line(x, L.footTop, x + w, L.footTop, 0.4);
  const fs = Math.min(size, 7);
  for (const p of L.foot.placed) o.text(x, L.footTop + p.y, fs, 'H', p.line);
  o.text(x, L.tagY, tagSize, 'H', c.tag);
}

/** One entry per printed card, nine to a page. */
export function pokeProxyPdf(cards: ProxyCard[], title = 'Proxies'): Uint8Array<ArrayBuffer> {
  const pages: string[] = [];
  for (let p = 0; p < Math.max(1, Math.ceil(cards.length / 9)); p++) {
    const o = new Ops();
    o.o.push('0 g 0 G');
    const slice = cards.slice(p * 9, p * 9 + 9);
    slice.forEach((c, k) => drawCard(o, c, X0 + (k % 3) * CW, Y0 + Math.floor(k / 3) * CH));
    // Thin cut lines around the grid of cards on this page, with a little overshoot past the corners.
    o.o.push('0.5 G');
    const rows = Math.ceil(slice.length / 3), cols = slice.length >= 3 ? 3 : slice.length;
    for (let r = 0; r <= rows; r++) o.line(X0 - 0.15, Y0 + r * CH, X0 + cols * CW + 0.15, Y0 + r * CH, 0.4);
    for (let c = 0; c <= cols; c++) o.line(X0 + c * CW, Y0 - 0.15, X0 + c * CW, Y0 + rows * CH + 0.15, 0.4);
    pages.push(o.o.join('\n'));
  }
  return writePdfPages(pages, title);
}

/* ---------- minimal PDF writer ---------- */
const FONTS: Record<string, string> = { H: 'Helvetica', HB: 'Helvetica-Bold', HO: 'Helvetica-Oblique' };
export function writePdfPages(contents: string[], title: string): Uint8Array<ArrayBuffer> {
  const keys = Object.keys(FONTS);
  const first = 4 + keys.length;
  const objs: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${contents.map((_, i) => `${first + 2 * i} 0 R`).join(' ')}] /Count ${contents.length} >>`,
    `<< /Title (${winAnsi(title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, ''))}) /Producer (Benchmark - benchmarktcg.us) >>`,
    ...keys.map(k => `<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[k]} /Encoding /WinAnsiEncoding >>`),
  ];
  contents.forEach((c, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${first + 2 * i + 1} 0 R /Resources << /Font << ${keys.map((k, j) => `/${k} ${4 + j} 0 R`).join(' ')} >> >> >>`);
    objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
  });
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
