// Draws a shareable PNG of a deck in one of three layouts (grid, stacks, featured + list).
// Card art is loaded through our own /img/* route (see worker/index.js) so the canvas stays exportable.
import { CONFIG } from '../config';
import { category, groupOf, img, sortLines, sum, TCGP_IMG, type Line } from './cards';

export type ImageLayout = 'grid' | 'stacks' | 'featured';
export type ImageMeta = { name: string; format: string; author?: string; updated: string; url?: string };

export const LAYOUTS: { value: ImageLayout; label: string; size: [number, number]; hint: string }[] = [
  { value: 'grid', label: 'Grid', size: [1600, 900], hint: '1600 × 900 · best for X and Discord' },
  { value: 'stacks', label: 'Stacks', size: [1080, 1350], hint: '1080 × 1350 · best for Instagram' },
  { value: 'featured', label: 'Featured + list', size: [1600, 900], hint: '1600 × 900 · easiest to read in a feed' },
];

const C = {
  bg: '#15171c', bg2: '#1f2633', panel: '#20242c', line: '#313845', text: '#e7e9ee', muted: '#9aa3b2', faint: '#6e7787',
  p: '#e06a4b', t: '#4b8cf7', e: '#e8b931', pSoft: '#f09a80', tSoft: '#8db6ff', eSoft: '#f0cc63', ace: '#e2468f',
};
const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const RATIO = 88 / 63;

/* ---------- loading ---------- */

/** Same-origin URL for a card's art, or '' when the card has none we can proxy. */
export function proxied(base: string | undefined, q: 'low' | 'high' = 'high') {
  const u = img(base, q);
  if (u.startsWith(CONFIG.imageBase + '/')) return '/img' + u.slice(CONFIG.imageBase.length);
  if (u.startsWith(TCGP_IMG)) return '/img/tcgp/' + u.slice(TCGP_IMG.length);
  return '';
}

function loadImage(src: string, ms = 12000): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise(resolve => {
    const im = new Image();
    const t = setTimeout(() => resolve(null), ms);
    im.onload = () => { clearTimeout(t); resolve(im); };
    im.onerror = () => { clearTimeout(t); resolve(null); };
    im.decoding = 'async';
    im.src = src;
  });
}

async function fonts() {
  try { await Promise.all(['500 20px Inter', '700 20px Inter', '800 20px Inter', '900 40px Inter'].map(f => document.fonts.load(f))); } catch { /* fall back to system fonts */ }
}

/* ---------- drawing helpers ---------- */

type Ctx = CanvasRenderingContext2D;
const font = (ctx: Ctx, weight: number, size: number) => { ctx.font = `${weight} ${size}px ${FONT}`; };

function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Shortens text with an ellipsis so it fits in maxW at the current font. */
function fit(ctx: Ctx, s: string, maxW: number) {
  if (ctx.measureText(s).width <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ctx.measureText(s.slice(0, m) + '…').width <= maxW) lo = m; else hi = m - 1; }
  return s.slice(0, lo).trimEnd() + '…';
}

/** Largest font size (down to min) at which s fits maxW. */
function sizeToFit(ctx: Ctx, s: string, weight: number, max: number, min: number, maxW: number) {
  for (let z = max; z > min; z -= 2) { font(ctx, weight, z); if (ctx.measureText(s).width <= maxW) return z; }
  return min;
}

const secColor = (l: Line) => (category(l) === 'Pokemon' ? C.p : category(l) === 'Energy' ? C.e : C.t);

function drawCard(ctx: Ctx, l: Line, im: HTMLImageElement | null | undefined, x: number, y: number, w: number, h: number, shadow = 14) {
  const r = Math.max(4, w * 0.045);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = shadow; ctx.shadowOffsetY = shadow * 0.4;
  rrect(ctx, x, y, w, h, r); ctx.fillStyle = C.panel; ctx.fill();
  ctx.restore();
  ctx.save();
  rrect(ctx, x, y, w, h, r); ctx.clip();
  if (im) ctx.drawImage(im, x, y, w, h);
  else {
    // No art available: a plain tile with the card name, tinted by section.
    ctx.fillStyle = secColor(l); ctx.globalAlpha = 0.25; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
    ctx.fillStyle = C.text; font(ctx, 800, Math.max(10, w * 0.1)); ctx.textBaseline = 'top';
    const words = l.name.split(' '); let line = '', yy = y + w * 0.1;
    for (const wd of words) {
      const t = line ? line + ' ' + wd : wd;
      if (ctx.measureText(t).width > w * 0.84 && line) { ctx.fillText(line, x + w * 0.08, yy); yy += w * 0.13; line = wd; } else line = t;
    }
    ctx.fillText(line, x + w * 0.08, yy);
  }
  ctx.restore();
}

function badge(ctx: Ctx, n: number, cx: number, cy: number, size: number) {
  const s = String(n);
  font(ctx, 900, size * 0.62);
  const w = Math.max(size, ctx.measureText(s).width + size * 0.5);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = size * 0.3; ctx.shadowOffsetY = size * 0.08;
  rrect(ctx, cx - w / 2, cy - size / 2, w, size, size * 0.26); ctx.fillStyle = C.bg; ctx.fill();
  ctx.restore();
  const b = size * 0.08;
  rrect(ctx, cx - w / 2 + b, cy - size / 2 + b, w - 2 * b, size - 2 * b, size * 0.2); ctx.fillStyle = C.text; ctx.fill();
  ctx.fillStyle = C.bg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(s, cx, cy + size * 0.03);
  ctx.textAlign = 'left';
}

function background(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h) * 0.9);
  g.addColorStop(0, C.bg2); g.addColorStop(1, 'rgba(21,23,28,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

/** Brand, deck name and meta line. Returns the y just below it. */
function header(ctx: Ctx, meta: ImageMeta, mark: HTMLImageElement | null, x: number, y: number, maxW: number, nameMax = 48) {
  ctx.textBaseline = 'alphabetic';
  if (mark) ctx.drawImage(mark, x, y, 28, 28);
  ctx.fillStyle = C.text; font(ctx, 800, 18);
  ctx.fillText('BENCHMARK', x + (mark ? 38 : 0), y + 21);
  const z = sizeToFit(ctx, meta.name, 900, nameMax, 28, maxW);
  font(ctx, 900, z); ctx.fillStyle = C.text;
  ctx.fillText(fit(ctx, meta.name, maxW), x, y + 40 + z * 0.9);
  font(ctx, 500, 18); ctx.fillStyle = C.muted;
  const line = [meta.format, meta.author ? `by ${meta.author}` : '', meta.updated].filter(Boolean).join('  ·  ');
  ctx.fillText(fit(ctx, line, maxW), x, y + 40 + z + 30);
  return y + 40 + z + 40;
}

type Counts = { p: number; t: number; e: number };
const counts = (lines: Line[]): Counts => ({
  p: sum(lines.filter(l => category(l) === 'Pokemon'), l => l.qty),
  e: sum(lines.filter(l => category(l) === 'Energy'), l => l.qty),
  t: sum(lines.filter(l => category(l) !== 'Pokemon' && category(l) !== 'Energy'), l => l.qty),
});

function pillsWidth(ctx: Ctx, n: Counts) {
  font(ctx, 700, 17);
  return sum([`${n.p} Pokémon`, `${n.t} Trainers`, `${n.e} Energy`], t => ctx.measureText(t).width + 28) + 20;
}

/** The three count pills. align 'right' draws them ending at x. Returns total width. */
function pills(ctx: Ctx, n: Counts, x: number, y: number, align: 'left' | 'right' = 'left') {
  const items: [string, string, string][] = [[`${n.p} Pokémon`, C.p, C.pSoft], [`${n.t} Trainers`, C.t, C.tSoft], [`${n.e} Energy`, C.e, C.eSoft]];
  font(ctx, 700, 17);
  const ws = items.map(([s]) => ctx.measureText(s).width + 28);
  const total = sum(ws, w => w) + 10 * (items.length - 1);
  let xx = align === 'right' ? x - total : x;
  items.forEach(([s, base, soft], i) => {
    rrect(ctx, xx, y, ws[i], 36, 18);
    ctx.fillStyle = base; ctx.globalAlpha = 0.17; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = soft; ctx.textBaseline = 'middle'; ctx.fillText(s, xx + 14, y + 19);
    xx += ws[i] + 10;
  });
  ctx.textBaseline = 'alphabetic';
  return total;
}

function urlText(ctx: Ctx, meta: ImageMeta, x: number, y: number, align: CanvasTextAlign = 'right') {
  font(ctx, 600, 16); ctx.fillStyle = C.faint; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillText(meta.url || 'benchmarktcg.us', x, y);
  ctx.textAlign = 'left';
}

/** Count pills with the deck link beside them, or stacked above them when the row is too narrow.
 *  Returns the y of the footer's top edge. */
function footer(ctx: Ctx, n: Counts, meta: ImageMeta, x: number, right: number, bottomY: number) {
  font(ctx, 600, 16);
  const urlW = ctx.measureText(meta.url || 'benchmarktcg.us').width;
  const pw = pillsWidth(ctx, n);
  if (x + pw + 24 + urlW <= right) {
    pills(ctx, n, x, bottomY - 36);
    urlText(ctx, meta, right, bottomY - 12);
    return bottomY - 36;
  }
  urlText(ctx, meta, x, bottomY - 54, 'left');
  pills(ctx, n, x, bottomY - 36);
  return bottomY - 76;
}

/* ---------- ordering ---------- */

const ORDER = ['Pokémon', 'Supporter', 'Item', 'Pokémon Tool', 'Stadium', 'Trainer', 'Special Energy', 'Basic Energy', 'Other'];
function ordered(lines: Line[]): Line[] {
  const by = new Map<string, Line[]>();
  for (const l of lines) { const g = groupOf(l); by.set(g, [...(by.get(g) || []), l]); }
  return ORDER.flatMap(g => sortLines(by.get(g) || [], 'default'));
}

/* ---------- layouts ---------- */

type Art = Map<string, HTMLImageElement | null>;

function drawGrid(ctx: Ctx, W: number, H: number, lines: Line[], art: Art, meta: ImageMeta, mark: HTMLImageElement | null) {
  const pad = 48;
  const below = header(ctx, meta, mark, pad, pad, W - pad * 2 - 520);
  const n = counts(lines);
  pills(ctx, n, W - pad, pad + 40, 'right');
  urlText(ctx, meta, W - pad, pad + 106);
  const top = below + 30, areaW = W - pad * 2, areaH = H - top - pad;
  const gx = 14, gy = 24;
  let best = { cols: 10, w: 0 };
  for (let cols = 5; cols <= 16; cols++) {
    const rows = Math.ceil(lines.length / cols);
    const w = Math.min((areaW - gx * (cols - 1)) / cols, (areaH - gy * (rows - 1)) / rows / RATIO);
    if (w > best.w) best = { cols, w };
  }
  const { cols, w } = best, h = w * RATIO;
  const rows = Math.ceil(lines.length / cols);
  const used = cols * w + (cols - 1) * gx;
  const x0 = pad + (areaW - used) / 2, y0 = top + Math.max(0, (areaH - (rows * h + (rows - 1) * gy)) / 2);
  lines.forEach((l, i) => {
    const x = x0 + (i % cols) * (w + gx), y = y0 + Math.floor(i / cols) * (h + gy);
    ctx.fillStyle = secColor(l); rrect(ctx, x, y - 12, w, 4, 2); ctx.fill();
    drawCard(ctx, l, art.get(l.cid), x, y, w, h);
    badge(ctx, l.qty, x + w - w * 0.16, y + h - w * 0.16, Math.max(26, w * 0.3));
  });
}

type Group = { label: string; lines: Line[] };
function stackGroups(lines: Line[]): Group[] {
  const pick = (gs: string[]) => lines.filter(l => gs.includes(groupOf(l)));
  return [
    { label: 'Pokémon', lines: pick(['Pokémon']) },
    { label: 'Supporters', lines: pick(['Supporter']) },
    { label: 'Items', lines: pick(['Item', 'Trainer', 'Other']) },
    { label: 'Tools', lines: pick(['Pokémon Tool']) },
    { label: 'Stadiums', lines: pick(['Stadium']) },
    { label: 'Energy', lines: pick(['Special Energy', 'Basic Energy']) },
  ].filter(g => g.lines.length);
}

const MAX_SHOWN = 6; // copies drawn per stack; the badge always shows the real count

function drawStacks(ctx: Ctx, W: number, H: number, lines: Line[], art: Art, meta: ImageMeta, mark: HTMLImageElement | null) {
  const pad = 40;
  const below = header(ctx, meta, mark, pad, pad, W - pad * 2, 46);
  const top = below + 24, footH = 40, bottom = H - pad - footH - 24;
  const areaW = W - pad * 2;
  const groups = stackGroups(lines);
  const cg = 10, gg = 26, labelH = 30, rowGap = 22;

  // Lays groups out left to right, wrapping (and splitting long groups) at areaW. Returns rows + total height.
  const layout = (w: number) => {
    const off = w * 0.2, h = w * RATIO;
    type Seg = { label: string; lines: Line[] };
    const rows: Seg[][] = [[]];
    let x = 0;
    for (const g of groups) {
      let rest = g.lines.slice(), first = true;
      while (rest.length) {
        const room = Math.floor((areaW - x + cg) / (w + cg));
        if (room < 1 || (first && room < Math.min(2, rest.length) && x > 0)) { rows.push([]); x = 0; continue; }
        const take = rest.slice(0, room); rest = rest.slice(room);
        rows[rows.length - 1].push({ label: first ? g.label : '', lines: take });
        x += take.length * (w + cg) - cg + gg;
        first = false;
        if (rest.length) { rows.push([]); x = 0; }
      }
    }
    const rowH = (r: Seg[]) => labelH + h + off * (Math.min(MAX_SHOWN, Math.max(...r.flatMap(s => s.lines.map(l => l.qty)))) - 1);
    const live = rows.filter(r => r.length);
    return { rows: live, rowH, h, off, total: sum(live, r => rowH(r)) + rowGap * (live.length - 1) };
  };
  let w = 150, L = layout(w);
  while (w > 44 && L.total > bottom - top) { w -= 2; L = layout(w); }

  let y = top + Math.max(0, (bottom - top - L.total) / 2);
  for (const r of L.rows) {
    let x = pad;
    for (const seg of r) {
      if (seg.label) {
        font(ctx, 800, 15); ctx.fillStyle = C.muted; ctx.textBaseline = 'alphabetic';
        const label = seg.label.toUpperCase();
        ctx.fillText(label, x, y + 18);
        const g = groups.find(gr => gr.label === seg.label)!;
        ctx.fillStyle = C.text; ctx.fillText(String(sum(g.lines, l => l.qty)), x + ctx.measureText(label).width + 10, y + 18);
      }
      for (const l of seg.lines) {
        const shown = Math.min(MAX_SHOWN, l.qty);
        for (let i = 0; i < shown; i++) drawCard(ctx, l, art.get(l.cid), x, y + labelH + i * L.off, w, L.h, 8);
        badge(ctx, l.qty, x + w - w * 0.12, y + labelH + (shown - 1) * L.off + L.h - w * 0.18, Math.max(24, w * 0.3));
        x += w + cg;
      }
      x += gg - cg;
    }
    y += L.rowH(r) + rowGap;
  }
  footer(ctx, counts(lines), meta, pad, W - pad, H - pad);
}

/** Up to three cards to show big: the deck cover first, then the strongest-looking Pokémon. */
function featuredLines(lines: Line[], cover: string): Line[] {
  const score = (l: Line) => (l.card?.image === cover ? 1000 : 0) + (category(l) === 'Pokemon' ? 100 : 0) + (/( ex| V| VSTAR| VMAX| GX| EX)$/i.test(l.name) ? 50 : 0) + (/stage ?2|vstar|vmax|mega/i.test(l.card?.stage || '') ? 10 : 0) + l.qty;
  return lines.filter(l => l.card?.image).sort((a, b) => score(b) - score(a)).slice(0, 3);
}

function drawFeatured(ctx: Ctx, W: number, H: number, lines: Line[], art: Art, meta: ImageMeta, mark: HTMLImageElement | null, cover: string) {
  const pad = 52, leftW = 560;
  // left: fanned key cards
  const feat = featuredLines(lines, cover);
  const cw = 300, ch = cw * RATIO;
  // [x, y, rotation] per featured card; index 0 is the main card.
  const spots = feat.length === 1 ? [[130, 210, 0]] : feat.length === 2 ? [[220, 190, 5], [30, 110, -7]] : [[215, 80, 0], [10, 150, -9], [130, 380, 8]];
  // Draw back to front so the main card sits on top.
  for (let i = feat.length - 1; i >= 0; i--) {
    const l = feat[i];
    const [sx, sy, rot] = spots[i];
    ctx.save();
    ctx.translate(pad + sx + cw / 2, sy + ch / 2); ctx.rotate(rot * Math.PI / 180);
    drawCard(ctx, l, art.get(l.cid), -cw / 2, -ch / 2, cw, ch, 30);
    badge(ctx, l.qty, cw / 2 - 30, ch / 2 - 30, 54);
    ctx.restore();
  }

  // right: header + list in three columns
  const rx = pad + leftW + 56, rw = W - rx - pad;
  const below = header(ctx, meta, mark, rx, pad, rw, 58);
  const n = counts(lines);
  const top = below + 28, bottom = footer(ctx, n, meta, rx, W - pad, H - pad) - 24;
  type Item = { kind: 'head'; label: string; qty: number; color: string; soft: string } | { kind: 'sub'; label: string } | { kind: 'line'; l: Line };
  const items: Item[] = [];
  const of = (gs: string[]) => sortLines(lines.filter(l => gs.includes(groupOf(l))), 'default');
  const pk = of(['Pokémon']);
  if (pk.length) { items.push({ kind: 'head', label: 'Pokémon', qty: n.p, color: C.p, soft: C.pSoft }); pk.forEach(l => items.push({ kind: 'line', l })); }
  const tg: [string, string[]][] = [['Supporters', ['Supporter']], ['Items', ['Item', 'Trainer', 'Other']], ['Tools', ['Pokémon Tool']], ['Stadiums', ['Stadium']]];
  if (n.t) {
    items.push({ kind: 'head', label: 'Trainers', qty: n.t, color: C.t, soft: C.tSoft });
    for (const [label, gs] of tg) { const ls = of(gs); if (ls.length) { items.push({ kind: 'sub', label }); ls.forEach(l => items.push({ kind: 'line', l })); } }
  }
  const en = of(['Special Energy', 'Basic Energy']);
  if (en.length) { items.push({ kind: 'head', label: 'Energy', qty: n.e, color: C.e, soft: C.eSoft }); en.forEach(l => items.push({ kind: 'line', l })); }

  const cols = 3, gap = 30, colW = (rw - gap * (cols - 1)) / cols;
  const heightOf = (it: Item, z: number) => (it.kind === 'head' ? z * 2.4 : it.kind === 'sub' ? z * 1.55 : z * 1.4);
  // Flow items into columns; a section header never sits alone at the bottom of a column.
  const flow = (z: number, limit = bottom - top) => {
    const colsOut: Item[][] = [[]]; let y = 0;
    items.forEach((it, i) => {
      const hNext = it.kind === 'line' ? heightOf(it, z) : heightOf(it, z) + heightOf(items[i + 1] || it, z);
      const isTop = !colsOut[colsOut.length - 1].length;
      if (y + hNext > limit && !isTop) { colsOut.push([]); y = 0; }
      colsOut[colsOut.length - 1].push(it); y += heightOf(it, z);
    });
    return colsOut;
  };
  // Shrink the text until the list fits in three columns and (down to a readable floor) no name is cut off.
  const widest = (z: number) => { font(ctx, 500, z); return Math.max(0, ...items.map(it => (it.kind === 'line' ? ctx.measureText(it.l.name).width + z * 1.7 : 0))); };
  let z = 22, out = flow(z);
  while (z > 11 && (out.length > cols || (z > 16 && widest(z) > colW))) { z -= 1; out = flow(z); }
  // Spread the list evenly over the three columns instead of filling the first ones to the bottom.
  const totalH = sum(items, it => heightOf(it, z));
  for (let limit = totalH / cols; limit < bottom - top; limit += z) { const even = flow(z, limit); if (even.length <= cols) { out = even; break; } }

  out.slice(0, cols).forEach((col, ci) => {
    const x = rx + ci * (colW + gap); let y = top;
    for (const it of col) {
      if (it.kind === 'head') {
        font(ctx, 800, z * 0.85); ctx.fillStyle = it.soft; ctx.textBaseline = 'alphabetic';
        ctx.fillText(it.label.toUpperCase(), x, y + z * 1.1);
        ctx.textAlign = 'right'; ctx.fillText(String(it.qty), x + colW, y + z * 1.1); ctx.textAlign = 'left';
        ctx.fillStyle = it.color; ctx.fillRect(x, y + z * 1.5, colW, 3);
      } else if (it.kind === 'sub') {
        font(ctx, 700, z * 0.62); ctx.fillStyle = C.faint;
        ctx.fillText(it.label.toUpperCase(), x, y + z * 1.15);
      } else {
        font(ctx, 800, z); ctx.fillStyle = '#ffffff';
        ctx.fillText(String(it.l.qty), x, y + z * 1.05);
        font(ctx, 500, z); ctx.fillStyle = '#d6dae2';
        ctx.fillText(fit(ctx, it.l.name, colW - z * 1.7), x + z * 1.7, y + z * 1.05);
      }
      y += heightOf(it, z);
    }
  });
}

/* ---------- entry point ---------- */

export async function renderDeckImage(layout: ImageLayout, allLines: Line[], meta: ImageMeta, cover = ''): Promise<Blob> {
  const lines = ordered(allLines.filter(l => l.board === 'main' && l.qty > 0));
  const [W, H] = LAYOUTS.find(x => x.value === layout)!.size;
  const want = layout === 'featured' ? new Set(featuredLines(lines, cover).map(l => l.cid)) : null;
  const [, mark, ...ims] = await Promise.all([
    fonts(),
    loadImage('/brand/mark.png'),
    ...lines.map(l => (want && !want.has(l.cid) ? Promise.resolve(null) : loadImage(proxied(l.card?.image, 'high')))),
  ]);
  const art: Art = new Map(lines.map((l, i) => [l.cid, ims[i] as HTMLImageElement | null]));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  background(ctx, W, H);
  if (layout === 'grid') drawGrid(ctx, W, H, lines, art, meta, mark as HTMLImageElement | null);
  else if (layout === 'stacks') drawStacks(ctx, W, H, lines, art, meta, mark as HTMLImageElement | null);
  else drawFeatured(ctx, W, H, lines, art, meta, mark as HTMLImageElement | null, cover);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Couldn’t create the image'))), 'image/png'));
}
