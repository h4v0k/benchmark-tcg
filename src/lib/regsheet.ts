// The official Play! Pokémon deck list (public/regsheet/template.pdf, made from Pokémon's own PDF by
// tools/build_regsheet_template.py), filled in. We don't redraw the form: we append one small incremental
// update to the official file that writes text onto it, so the result is the real sheet, as a real PDF that
// prints at true size (no browser margins or scaling). The same drawing list paints the on-screen preview
// over an image of the blank sheet, so the preview and the printout can't disagree.
//
// Positions are inches from the page's top-left corner, measured from the official sheet; text sits on its
// baseline at y. A deck that doesn't fit one sheet continues on a second copy of the sheet.
import { category, numLabel, setCode, sortLines, type Line } from './cards';
import TPL from './regsheet-template.json';

export type Division = '' | 'junior' | 'senior' | 'masters';
export type SheetInfo = { playerName: string; playerId: string; dob: string; division: Division; format: 'standard' | 'expanded' | '' }; // dob: YYYY-MM-DD
export type PokemonRow = { qty: number; name: string; set: string; num: string; reg: string };
export type NameRow = { qty: number; name: string };
export type SheetCards = { pokemon: PokemonRow[]; trainer: NameRow[]; energy: NameRow[] };

/** Card lines on one sheet, per section, measured from the official form (row tops in inches). */
const TOPS = {
  pokemon: [2.715, 2.905, 3.085, 3.265, 3.445, 3.625, 3.805, 3.99, 4.18, 4.36],
  trainer: [5.16, 5.35, 5.53, 5.715, 5.89, 6.07, 6.255, 6.435, 6.625, 6.805, 6.99, 7.17, 7.345, 7.53, 7.71, 7.895, 8.085, 8.265],
  energy: [9.075, 9.265, 9.45, 9.63],
};
export const ROWS = { pokemon: TOPS.pokemon.length, trainer: TOPS.trainer.length, energy: TOPS.energy.length };
export const MAX_SHEETS = 2;
/** Age divisions as printed on this season's sheet (update with the template each season). */
export const DIVISION_BORN = { junior: 2014, senior: 2010 }; // Junior: born 2014 or later; Senior: 2010–2013; Masters: 2009 or earlier
export function divisionFor(dob: string): Division {
  const y = +(dob.match(/^(\d{4})-\d{2}-\d{2}$/)?.[1] || 0);
  if (!y) return '';
  return y >= DIVISION_BORN.junior ? 'junior' : y >= DIVISION_BORN.senior ? 'senior' : 'masters';
}
export const TEMPLATE_URL = `/regsheet/template.pdf?v=${TPL.startxref}`;
export const PREVIEW_URL = `/regsheet/preview.webp?v=${TPL.startxref}`;

type Font = 'H' | 'HB';
export type Op =
  | { t: 'text'; x: number; y: number; size: number; font: Font; s: string }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; w: number };

/* ---------------- text: encoding and widths ---------------- */

// Card names use a few characters the PDF standard fonts don't have.
const SUBST: Record<string, string> = { '♀': ' F', '♂': ' M', '◇': ' Prism Star', '☆': ' Star', '★': ' Star', 'δ': ' Delta' };
export function sheetText(s: string): string {
  return [...s.normalize('NFC')].map(ch => SUBST[ch] ?? ch).join('').replace(/\s+/g, ' ').trim();
}
const CP1252: Record<string, number> = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
function winAnsi(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    const b = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : CP1252[ch] ?? 0x3f;
    const k = String.fromCharCode(b);
    out += k === '(' || k === ')' || k === '\\' ? '\\' + k : k;
  }
  return out;
}

// Helvetica advance widths (1/1000 em) for ASCII 32–126, from the standard font metrics.
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HBW = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
/** Width in inches of s at `size` points. Accented letters use their base letter's width. */
export function textWidth(s: string, size: number, font: Font = 'H'): number {
  const tbl = font === 'HB' ? HBW : HW;
  let w = 0;
  for (const ch of s.normalize('NFD')) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x300 && c < 0x370) continue;
    w += c >= 32 && c <= 126 ? tbl[c - 32] : 556;
  }
  return (w / 1000) * size / 72;
}

/* ---------------- drawing ---------------- */

class Page {
  ops: Op[] = [];
  text(x: number, y: number, size: number, font: Font, s: string) { if (s) this.ops.push({ t: 'text', x, y, size, font, s }); }
  /** Shrinks text (down to `min` pt), then cuts it with an ellipsis, so it fits `w` inches. */
  fit(x: number, y: number, size: number, font: Font, s: string, w: number, min = 6) {
    let t = s.trim(); if (!t) return;
    let sz = size;
    const tw = textWidth(t, sz, font);
    if (tw > w) sz = Math.max(min, sz * w / tw);
    while (t.length > 1 && textWidth(t, sz, font) > w) t = t.slice(0, -2) + '…';
    this.text(x, y, sz, font, t);
  }
  /** Centered on cx, shrunk to fit w. */
  center(cx: number, y: number, size: number, font: Font, s: string, w = 9) {
    if (!s) return;
    let sz = size; const tw = textWidth(s, sz, font);
    if (tw > w) sz = Math.max(5, sz * w / tw);
    this.text(cx - textWidth(s, sz, font) / 2, y, sz, font, s);
  }
  /** An X in the check box whose corners are (x0, y0)–(x1, y1). */
  check(x0: number, y0: number, x1: number, y1: number) {
    const i = 0.022;
    this.ops.push({ t: 'line', x1: x0 + i, y1: y0 + i, x2: x1 - i, y2: y1 - i, w: 1.3 });
    this.ops.push({ t: 'line', x1: x1 - i, y1: y0 + i, x2: x0 + i, y2: y1 - i, w: 1.3 });
  }
}

const BASE = 0.127; // baseline below a row's top
/** How many sheets the cards need (capped at MAX_SHEETS). */
export function sheetsNeeded(cards: SheetCards): number {
  return Math.min(MAX_SHEETS, Math.max(1, ...(['pokemon', 'trainer', 'energy'] as const).map(k => Math.ceil(cards[k].length / ROWS[k]))));
}
/** The filled-in text for each sheet (one, or two when the cards don't fit on one). */
export function sheetPages(info: SheetInfo, cards: SheetCards): Op[][] {
  const n = sheetsNeeded(cards);
  const pages: Op[][] = [];
  const [yy, mm, dd] = info.dob.match(/^(\d{4})-(\d{2})-(\d{2})$/)?.slice(1) || ['', '', ''];
  for (let p = 0; p < n; p++) {
    const g = new Page();
    if (info.format === 'standard') g.check(2.164, 0.633, 2.268, 0.764);
    if (info.format === 'expanded') g.check(2.856, 0.633, 2.959, 0.764);
    g.fit(1.45, 1.1, 11, 'HB', sheetText(info.playerName), 1.82);
    g.fit(3.96, 1.1, 11, 'HB', info.playerId, 1.2);
    g.center(6.998, 1.1, 10.5, 'HB', mm, 0.3);
    g.center(7.34, 1.1, 10.5, 'HB', dd, 0.3);
    g.center(7.875, 1.1, 10.5, 'HB', yy, 0.45);
    const div: Record<string, number> = { junior: 1.512, senior: 1.699, masters: 1.887 };
    if (div[info.division]) g.check(5.211, div[info.division], 5.306, div[info.division] + 0.119);
    if (n > 1) g.text(6.55, 0.56, 8, 'HB', `Sheet ${p + 1} of ${n}`);

    cards.pokemon.slice(p * ROWS.pokemon, (p + 1) * ROWS.pokemon).forEach((r, i) => {
      const y = TOPS.pokemon[i] + BASE;
      g.center(3.83, y, 9.5, 'HB', String(r.qty), 0.45);
      g.fit(4.14, y, 9.5, 'H', sheetText(r.name), 2.27);
      g.center(6.72, y, 8.5, 'H', r.set, 0.46);
      g.center(7.235, y, 8.5, 'H', r.num, 0.46);
      g.center(7.75, y, 8.5, 'H', r.reg, 0.46);
    });
    for (const k of ['trainer', 'energy'] as const) {
      cards[k].slice(p * ROWS[k], (p + 1) * ROWS[k]).forEach((r, i) => {
        const y = TOPS[k][i] + BASE;
        g.center(3.83, y, 9.5, 'HB', String(r.qty), 0.45);
        g.fit(4.14, y, 9.5, 'H', sheetText(r.name), 3.8);
      });
    }
    pages.push(g.ops);
  }
  return pages;
}

/* ---------------- PDF: an incremental update on the official template ---------------- */

const pt = (inch: number) => +(inch * 72).toFixed(2);
const py = (inch: number) => +((11 - inch) * 72).toFixed(2);
function overlay(ops: Op[]): string {
  const out = ['q 0 g 0 G'];
  for (const o of ops) {
    if (o.t === 'text') out.push(`BT /${o.font === 'HB' ? 'BMHB' : 'BMH'} ${o.size.toFixed(2)} Tf ${pt(o.x)} ${py(o.y)} Td (${winAnsi(o.s)}) Tj ET`);
    else out.push(`${o.w} w 1 J ${pt(o.x1)} ${py(o.y1)} m ${pt(o.x2)} ${py(o.y2)} l S`);
  }
  out.push('Q');
  return out.join('\n');
}

/** The template with the filled-in sheets appended as one incremental update (PDF 1.7 §7.5.6). */
export function fillTemplate(template: Uint8Array, pages: Op[][], title: string): Uint8Array<ArrayBuffer> {
  if (!pages.length || pages.length > MAX_SHEETS) throw new Error('A registration sheet has one or two pages.');
  const objs: [number, string][] = [];
  pages.forEach((ops, i) => {
    const c = overlay(ops);
    objs.push([TPL.overlay[i], `<< /Length ${c.length} >>\nstream\n${c}\nendstream`]);
  });
  const kids = TPL.page.slice(0, pages.length).map(n => `${n} 0 R`).join(' ');
  objs.push([TPL.pages, `<< ${TPL.pagesDict} /Kids [${kids}] /Count ${pages.length} >>`]);
  objs.push([TPL.info, `<< /Title (${winAnsi(title)}) /Producer (Benchmark - benchmarktcg.us) >>`]);
  objs.sort((a, b) => a[0] - b[0]);

  let body = '\n';
  const at: number[] = [];
  for (const [n, o] of objs) { at.push(template.length + body.length); body += `${n} 0 obj\n${o}\nendobj\n`; }
  const xref = template.length + body.length;
  body += 'xref\n' + objs.map(([n], i) => `${n} 1\n${String(at[i]).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${TPL.size} /Root ${TPL.root} 0 R /Info ${TPL.info} 0 R /Prev ${TPL.startxref} /ID [<${TPL.id[0]}> <${TPL.id[1]}>] >>\nstartxref\n${xref}\n%%EOF\n`;

  const out = new Uint8Array(template.length + body.length);
  out.set(template, 0);
  for (let i = 0; i < body.length; i++) out[template.length + i] = body.charCodeAt(i) & 0xff;
  return out;
}

let cached: Promise<Uint8Array> | null = null;
/** The official template, fetched once. */
export function loadTemplate(): Promise<Uint8Array> {
  if (!cached) cached = fetch(TEMPLATE_URL).then(r => { if (!r.ok) throw new Error('Couldn’t load the registration sheet.'); return r.arrayBuffer(); })
    .then(b => new Uint8Array(b)).catch(e => { cached = null; throw e; });
  return cached;
}

/** Paints one sheet's text on a canvas already showing the blank form, `ppi` pixels per inch. */
export function drawOps(ctx: CanvasRenderingContext2D, ops: Op[], ppi: number) {
  ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineCap = 'round';
  for (const o of ops) {
    if (o.t === 'text') {
      ctx.font = `${o.font === 'HB' ? '700 ' : ''}${(o.size / 72) * ppi}px Helvetica, Arial, sans-serif`;
      ctx.fillText(o.s, o.x * ppi, o.y * ppi);
    } else {
      ctx.lineWidth = Math.max(1, (o.w / 72) * ppi);
      ctx.beginPath(); ctx.moveTo(o.x1 * ppi, o.y1 * ppi); ctx.lineTo(o.x2 * ppi, o.y2 * ppi); ctx.stroke();
    }
  }
}

/* ---------------- deck → sheet rows ---------------- */

/** Main-deck cards in sheet order. Pokémon keep one line per printing, with set, collector number and
 *  regulation mark (the sheet asks for them); Trainer and Energy only need name and quantity, so printings
 *  of the same card share a line. */
export function sheetCards(lines: Line[]): SheetCards {
  const main = sortLines(lines.filter(l => l.board === 'main' && l.qty > 0));
  const cat = (l: Line) => category(l) || 'Trainer';
  const named = (list: Line[]): NameRow[] => {
    const by = new Map<string, NameRow>();
    for (const l of list) {
      const name = sheetText(l.name), key = name.toLowerCase(), had = by.get(key);
      if (had) had.qty += l.qty; else by.set(key, { qty: l.qty, name });
    }
    return [...by.values()];
  };
  return {
    pokemon: main.filter(l => cat(l) === 'Pokemon').map(l => ({
      qty: l.qty, name: sheetText(l.name), set: l.card ? setCode(l.card) : '', num: l.card ? numLabel(l.card) : '', reg: l.card?.reg_mark || '',
    })),
    trainer: named(main.filter(l => cat(l) === 'Trainer')),
    energy: named(main.filter(l => cat(l) === 'Energy')),
  };
}
