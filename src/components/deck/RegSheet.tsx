// Play! Pokémon deck list, filled in: your details from Settings (date of birth from this device), the deck's
// cards with set, collector number and regulation mark. You check or change it on screen, then get the official
// sheet as a real PDF to print or save (lib/regsheet.ts). The preview paints the same text over an image of the
// blank official sheet, so what you see is what prints.
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Icon, Modal, Segmented, copyText } from '../ui';
import { Link } from '../../router';
import { toast, useAuth } from '../../state';
import * as api from '../../lib/api';
import { exportPTCGL } from '../../lib/decklist';
import { validateDeck } from '../../lib/legality';
import type { Line } from '../../lib/cards';
import type { Format } from '../../lib/types';
import { MAX_SHEETS, PREVIEW_URL, ROWS, divisionFor, drawOps, fillTemplate, loadTemplate, sheetCards, sheetPages, sheetsNeeded, type Division, type Op, type SheetInfo } from '../../lib/regsheet';

const local = {
  get: (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k: string, v: string) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* storage blocked */ } },
};
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const LABEL = { pokemon: 'Pokémon', trainer: 'Trainer', energy: 'Energy' } as const;

export function RegSheetModal({ lines, deckName, format, onClose }: { lines: Line[]; deckName: string; format: Format; onClose: () => void }) {
  const { session } = useAuth();
  const [saved, setSaved] = useState<api.PlayerInfo | null>(null);
  const [info, setInfo] = useState<SheetInfo>(() => {
    const dob = local.get('bm:reg:dob');
    return { playerName: '', playerId: '', dob, division: divisionFor(dob), format: format === 'expanded' ? 'expanded' : 'standard' };
  });
  const [remember, setRemember] = useState(true);
  const [template, setTemplate] = useState<Uint8Array | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    // Fetched up front so the buttons can open the PDF right inside the tap (Safari blocks it otherwise).
    loadTemplate().then(setTemplate, e => setLoadError(e.message || 'Couldn’t load the sheet.'));
    if (!session) return;
    api.getPlayerInfo().then(p => {
      if (!p) return;
      setSaved(p);
      setInfo(i => ({ ...i, playerName: i.playerName || p.player_name, playerId: i.playerId || p.player_id, division: i.dob ? i.division : i.division || p.division }));
    }).catch(() => { /* fill in by hand */ });
  }, [session]);

  const set = (k: 'playerName' | 'playerId' | 'dob') => (e: ChangeEvent<HTMLInputElement>) => {
    const v = k === 'playerId' ? e.target.value.replace(/\D+/g, '').slice(0, 12) : e.target.value;
    // A birth date picks the division printed on this season's sheet.
    setInfo(i => ({ ...i, [k]: v, ...(k === 'dob' && divisionFor(v) ? { division: divisionFor(v) } : {}) }));
  };

  const cards = useMemo(() => sheetCards(lines), [lines]);
  const pages = useMemo(() => sheetPages(info, cards), [info, cards]);
  const total = lines.filter(l => l.board === 'main').reduce((a, l) => a + l.qty, 0);

  const warnings: string[] = [];
  if (!info.playerName.trim() || !info.playerId) warnings.push('Add your name and Player ID as they are on your Play! Pokémon account.');
  if (!info.dob) warnings.push('Add your date of birth.');
  if (!info.division) warnings.push('Pick your age division.');
  if (total !== 60) warnings.push(`This deck has ${total} cards. A tournament deck has exactly 60.`);
  if (format !== 'unlimited') {
    for (const c of validateDeck(lines, format).filter(c => c.level === 'bad' && !/^\d+ cards$/.test(c.msg))) warnings.push(`${c.msg}${c.detail ? `: ${c.detail}` : ''}`);
  }
  const over = (['pokemon', 'trainer', 'energy'] as const).filter(k => cards[k].length > ROWS[k] * MAX_SHEETS);
  for (const k of over) warnings.push(`${cards[k].length} ${LABEL[k]} lines won’t fit on two sheets (${ROWS[k] * MAX_SHEETS} max); the rest won’t print.`);
  const sheets = sheetsNeeded(cards);

  const changed = !!session && (saved
    ? info.playerName.trim() !== saved.player_name || info.playerId !== saved.player_id || info.division !== saved.division
    : !!(info.playerName.trim() || info.playerId || info.division));
  const fileName = ['Deck list', info.playerName.trim(), deckName.trim()].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, '').slice(0, 120);

  const keep = () => {
    local.set('bm:reg:dob', info.dob);
    if (session && changed && remember) {
      const p: api.PlayerInfo = { player_name: info.playerName.trim().slice(0, 60), player_id: info.playerId, division: info.division };
      api.savePlayerInfo(p).then(() => setSaved(p)).catch((e: any) => toast(`Couldn’t save your details: ${e.message}`, 'bad'));
    }
  };
  const pdf = () => new File([fillTemplate(template!, pages, fileName)], `${fileName}.pdf`, { type: 'application/pdf' });
  // Opens the PDF in its own tab, where the browser's PDF viewer prints it at true size.
  const open = () => {
    if (!template) return;
    const url = URL.createObjectURL(pdf());
    if (!window.open(url, '_blank')) location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
    keep();
  };
  const download = () => {
    if (!template) return;
    const f = pdf(), a = document.createElement('a');
    a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    keep();
  };
  const rk9 = async () => toast((await copyText(exportPTCGL(lines))) ? 'Copied. In RK9: Deck List Creator → Import from Pokémon TCG Live → paste.' : 'Couldn’t copy', 'ok');

  return (
    <Modal title="Deck registration sheet" onClose={onClose} wide="xl" footer={<>
      <button className="btn" onClick={rk9} title="Copy the list in Pokémon TCG Live format, which RK9 imports"><Icon name="copy" />Copy for RK9</button>
      <button className="btn" onClick={download} disabled={!template}><Icon name="download" />Download PDF</button>
      <button className="btn primary" onClick={open} disabled={!template}><Icon name="list" />{template ? 'Open PDF to print' : 'Loading sheet…'}</button>
    </>}>
      <div className="reg-layout">
        <form className="reg-form" onSubmit={e => { e.preventDefault(); open(); }}>
          <p className="muted small">The official Play! Pokémon deck list, filled in from this deck. Check it against your cards before you hand it in.</p>
          <label className="field"><span>Player name</span><input value={info.playerName} onChange={set('playerName')} maxLength={60} autoComplete="name" /></label>
          <div className="field-row">
            <label className="field"><span>Player ID</span><input value={info.playerId} onChange={set('playerId')} inputMode="numeric" autoComplete="off" /></label>
            <label className="field"><span>Date of birth</span><input type="date" value={info.dob} onChange={set('dob')} max={today()} /></label>
          </div>
          <div className="field"><span>Age division</span>
            <Segmented label="Age division" value={info.division || 'none'} onChange={v => setInfo(i => ({ ...i, division: v === 'none' ? '' : v as Division }))}
              options={[{ value: 'junior', label: 'Junior' }, { value: 'senior', label: 'Senior' }, { value: 'masters', label: 'Masters' }]} />
          </div>
          <div className="field"><span>Format</span>
            <Segmented label="Format" value={info.format || 'standard'} onChange={v => setInfo(i => ({ ...i, format: v }))}
              options={[{ value: 'standard', label: 'Standard' }, { value: 'expanded', label: 'Expanded' }]} />
          </div>
          {session
            ? changed
              ? <label className="check-row"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Save name, Player ID and division to my settings</label>
              : saved && <p className="muted small">From your <Link to="/settings#registration">settings</Link>. Only you can see them.</p>
            : <p className="muted small"><Link to="/login">Sign in</Link> to have your details filled in every time.</p>}
          <p className="muted small">Your date of birth stays on this device.</p>
          {sheets > 1 && <p className="notice info"><Icon name="info" size={15} />This deck needs {sheets} sheets: the Pokémon, Trainer or Energy lines don’t all fit on one. Hand in both.</p>}
          {loadError && <p className="notice warn"><Icon name="warn" size={15} />{loadError}</p>}
          {warnings.length > 0 && <ul className="reg-warn" role="status">{warnings.map(w => <li key={w}>{w}</li>)}</ul>}
          <button type="submit" hidden />
        </form>
        <div className="reg-sheets">{pages.map((ops, i) => <SheetPreview key={i} ops={ops} label={`Sheet ${i + 1} of ${pages.length}`} />)}</div>
      </div>
    </Modal>
  );
}

let bg: Promise<HTMLImageElement> | null = null;
const blank = () => bg || (bg = new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => { bg = null; fail(new Error('preview')); }; im.src = PREVIEW_URL; }));

/** One sheet: the blank official form with the filled-in text on top, at the container's width. */
function SheetPreview({ ops, label }: { ops: Op[]; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = cv.current; if (!c || !w) return;
    let alive = true;
    const dpr = Math.min(3, window.devicePixelRatio || 1), ppi = (w / 8.5) * dpr;
    c.width = Math.round(8.5 * ppi); c.height = Math.round(11 * ppi);
    c.style.width = `${w}px`; c.style.height = `${(w * 11) / 8.5}px`;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const paint = (im?: HTMLImageElement) => {
      if (!alive) return;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      if (im) ctx.drawImage(im, 0, 0, c.width, c.height);
      drawOps(ctx, ops, ppi);
    };
    paint();
    blank().then(paint, () => {});
    return () => { alive = false; };
  }, [ops, w]);
  return <div className="reg-preview" ref={box}><canvas ref={cv} role="img" aria-label={`Preview of the filled-in deck list, ${label.toLowerCase()}`} /></div>;
}
