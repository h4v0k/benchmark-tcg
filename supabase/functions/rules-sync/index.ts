// @ts-nocheck
// Supabase Edge Function: rules-sync (runs daily)
//   1. Ban lists: read the official Pokémon TCG Banned Card List on pokemon.com, match each
//      listed printing to the catalog, and log bans and unbans.
//   2. Rotation: read Bulbapedia's Standard format page for the newest announced season and its
//      regulation mark; record an upcoming rotation (and its date once published).
//   3. Recompute legality.
import { db, upsert, rpc, logRun, isAuthorized, json, CORS, normName } from "./db.ts";

const UA = "Mozilla/5.0 (compatible; Benchmark-DeckBuilder/2.0; +https://benchmark-tcg.netlify.app)";
const BAN_URL = "https://www.pokemon.com/us/play-pokemon/about/pokemon-tcg-banned-card-list";
const WIKI = "https://bulbapedia.bulbagarden.net/w/api.php?action=parse&prop=wikitext&format=json&redirects=1&page=";

const decode = (s: string) => String(s || "")
  .replace(/&amp;/g, "&").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&rsquo;|&#8217;/g, "’").replace(/&lsquo;/g, "‘")
  .replace(/&eacute;/g, "é").replace(/&Eacute;/g, "É").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const numKey = (n: string) => {
  const left = String(n || "").split("/")[0].trim().toUpperCase().replace(/\s+/g, "");
  const m = left.match(/^([A-Z]*)0*(\d+)([A-Z]?)$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : left;
};

/* ---------------- 1. ban lists ---------------- */
// "<em>Black &amp; White&mdash;Noble Victories</em>, 67/101; <em>Hidden Fates</em>, 58/68 and 68/68"
export function parsePrintings(paren: string) {
  const out = [];
  // Decode entities first: "&amp;" and "&mdash;" contain semicolons, which separate printings.
  for (const part of decode(paren).split(/;/)) {
    const em = part.match(/<em>(.*?)<\/em>\s*,?\s*(.*)$/s);
    let setName = "", nums = "";
    if (em) { setName = strip(em[1]); nums = strip(em[2]); }
    else { const t = strip(part); const m = t.match(/^(.*?),\s*(.+)$/); if (!m) continue; setName = m[1]; nums = m[2]; }
    for (const n of nums.split(/,|\band\b/).map((x) => x.trim()).filter(Boolean)) {
      if (/^[A-Za-z]*\d+[a-z]?(\/[A-Za-z]*\d+)?$/i.test(n)) out.push({ set: setName, num: n });
    }
  }
  return out;
}

export function parseBanPage(html: string) {
  const sections = {};
  for (const fmt of ["Standard", "Expanded", "Unlimited"]) {
    const start = html.search(new RegExp(`>\\s*${fmt}\\s*</h1>`));
    if (start < 0) continue;
    const rest = html.slice(start + 10);
    const end = rest.search(/>\s*(Standard|Expanded|Unlimited)\s*<\/h1>/);
    sections[fmt.toLowerCase()] = end < 0 ? rest.slice(0, 60000) : rest.slice(0, end);
  }
  const result = {};
  for (const [fmt, chunk] of Object.entries(sections)) {
    const list = [];
    for (const raw of chunk.match(/<li[^>]*>[\s\S]*?<\/li>/g) || []) {
      // Drop attributes first: alt="Shaymin-<em>EX</em>" has markup inside the quotes.
      const li = raw.replace(/\s[\w-]+="[^"]*"/g, "");
      const text = strip(li);
      if (/no cards are currently banned/i.test(text)) continue;
      // The card name is the text before the first "(", e.g. "Shaymin-EX (XY—Roaring Skies, 77/108)".
      const name = text.replace(/\s*\(.*$/, "").replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim();
      const open = li.indexOf("(", li.search(/<\/a>/) > 0 ? li.search(/<\/a>/) : 0);
      const close = li.lastIndexOf(")");
      if (!name) continue;
      list.push({ name, printings: open >= 0 && close > open ? parsePrintings(li.slice(open + 1, close)) : [] });
    }
    result[fmt] = { list, empty: /no cards are currently banned/i.test(strip(chunk)) };
  }
  return result;
}

function setMatcher(sets) {
  const byName = new Map();
  for (const s of sets) byName.set(normName(s.name), s);
  const promoBy = (prefix) => sets.find((s) => s.is_promo && s.id.toLowerCase() === prefix);
  return (setName: string, num: string) => {
    const nm = normName(setName.replace(/^.*?[—–]\s*/, "")); // "Black & White—Noble Victories" → "noble victories"
    if (/promo/i.test(setName)) {
      const pre = (num.match(/^[A-Za-z]+/) || [""])[0].toLowerCase();
      const map = { sm: "smp", swsh: "swshp", xy: "xyp", bw: "bwp", svp: "svp", sv: "svp", mep: "mep", me: "mep" };
      return promoBy(map[pre] || "") || null;
    }
    return byName.get(nm) || byName.get(normName(setName)) || [...byName.entries()].find(([k]) => k.endsWith(nm) || nm.endsWith(k))?.[1] || null;
  };
}

async function syncBans() {
  const r = await fetch(BAN_URL, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" } });
  if (!r.ok) throw new Error(`pokemon.com returned ${r.status}`);
  const html = await r.text();
  const parsed = parseBanPage(html);
  if (!parsed.standard || !parsed.expanded) throw new Error("Couldn't find the Standard and Expanded sections on the banned list page; the page layout may have changed.");
  const sets = await db("sets?select=id,name,is_promo&limit=2000");
  const match = setMatcher(sets);
  const current = await db("bans?select=id,format,card_name,printings_key,card_ids,active,source&limit=2000");
  const now = new Date().toISOString();
  const changes = [], rows = [], seen = new Set();
  const unresolved = [];
  for (const fmt of ["standard", "expanded"]) {
    const { list, empty } = parsed[fmt];
    // Bans an admin added by hand aren't on the official page yet; the sync leaves them alone.
    const prior = current.filter((b) => b.format === fmt && b.active && b.source !== "admin");
    // A sudden empty list after many bans is more likely a page change than a mass unban.
    if (!list.length && !empty && prior.length > 3) throw new Error(`The ${fmt} ban list came back empty without the "no cards are banned" notice; not changing it.`);
    for (const ban of list) {
      const ids = [];
      for (const p of ban.printings) {
        const s = match(p.set, p.num);
        if (!s) { unresolved.push(`${ban.name} (${p.set} ${p.num})`); continue; }
        // Trainer Gallery (TG01), Shiny Vault (SV013) and Galarian Gallery (GG01) cards sit in sub-sets on TCGdex.
        const sub = /^TG/i.test(p.num) ? "tg" : /^SV/i.test(p.num) ? "sv" : /^GG/i.test(p.num) ? "gg" : "";
        const setIds = [s.id, ...(sub ? sets.filter((x) => x.id.toLowerCase() === (s.id + sub).toLowerCase()).map((x) => x.id) : [])];
        const rowsFor = await db(`cards?set_id=in.(${setIds.map(encodeURIComponent).join(",")})&num_key=eq.${encodeURIComponent(numKey(p.num))}&select=id`);
        if (rowsFor.length) ids.push(...rowsFor.map((x) => x.id)); else unresolved.push(`${ban.name} (${p.set} ${p.num})`);
      }
      const key = ban.printings.map((p) => `${normName(p.set)}:${numKey(p.num)}`).sort().join("|");
      seen.add(`${fmt}|${ban.name}|${key}`);
      const existing = current.find((b) => b.format === fmt && b.card_name === ban.name && b.printings_key === key);
      rows.push({ format: fmt, card_name: ban.name, printings: ban.printings, printings_key: key, card_ids: [...new Set(ids)], source: BAN_URL, active: true, removed_at: null });
      // News only when the card itself is newly banned (not when its list of printings is reworded).
      const wasBanned = current.some((b) => b.format === fmt && b.card_name === ban.name && b.active);
      if ((!existing || !existing.active) && !wasBanned) changes.push({ format: fmt, kind: "ban", title: `${ban.name} banned in ${fmt[0].toUpperCase() + fmt.slice(1)}`, detail: ban.printings.map((p) => `${p.set} ${p.num}`).join(", "), card_ids: [...new Set(ids)] });
    }
    for (const b of prior) {
      if (!seen.has(`${fmt}|${b.card_name}|${b.printings_key}`)) {
        await db(`bans?id=eq.${b.id}`, { method: "PATCH", body: JSON.stringify({ active: false, removed_at: now }) });
        if (!list.some((x) => x.name === b.card_name)) changes.push({ format: fmt, kind: "unban", title: `${b.card_name} is no longer banned in ${fmt[0].toUpperCase() + fmt.slice(1)}`, card_ids: b.card_ids || [] });
      }
    }
  }
  await upsert("bans", rows, "format,card_name,printings_key");
  // The first sync just loads the list; only later differences are news.
  if (current.length && changes.length) await db("rule_changes", { method: "POST", body: JSON.stringify(changes) });
  return { standard_bans: parsed.standard.list.length, expanded_bans: parsed.expanded.list.length, changes: changes.length, unresolved };
}

/* ---------------- 2. rotation ---------------- */
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const toISO = (s: string) => { const d = new Date(s + " UTC"); return isNaN(+d) ? null : d.toISOString().slice(0, 10); };

export function parseSeasons(wikitext: string) {
  // * '''{{TCG|2026-27 Standard format|2026-27}}''' — Cards with a regulation mark {{Reg|H}} or later
  const out = [];
  const re = /\{\{TCG\|(\d{4})-(\d{2}) Standard format[^}]*\}\}'*\s*[—–-]\s*Cards with a regulation mark \{\{[Rr]eg\|([A-Z])\}\} or later/g;
  let m;
  while ((m = re.exec(wikitext))) out.push({ season: `${m[1]}-${m[2]}`, start: +m[1], mark: m[3] });
  return out.sort((a, b) => a.start - b.start);
}

export function findRotationDate(wikitext: string) {
  const text = wikitext.replace(/<ref[\s\S]*?<\/ref>|<ref[^>]*\/>/g, " ").replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1");
  const sentences = text.split(/(?<=[.!?])\s+/);
  const pick = (re: RegExp, not?: RegExp) => {
    for (const s of sentences) {
      if (!re.test(s) || (not && not.test(s))) continue;
      const d = s.match(new RegExp(`(${MONTHS}) (\\d{1,2}), (\\d{4})`));
      if (d) return toISO(d[0]);
    }
    return null;
  };
  const inPerson = pick(/(effective|takes? effect|took effect|begins?|began|starting|starts?|in effect|legal)/i, /TCG Live/i);
  const online = pick(/Pok[ée]mon TCG Live|TCG Live/i);
  return { date: inPerson, online };
}

async function wiki(page: string) {
  const r = await fetch(WIKI + encodeURIComponent(page), { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.parse?.wikitext?.["*"] || null;
}

async function syncRotation() {
  const page = await wiki("Standard format (TCG)");
  if (!page) throw new Error("Couldn't read Bulbapedia's Standard format page.");
  const seasons = parseSeasons(page);
  if (!seasons.length) throw new Error("Couldn't find the season list on Bulbapedia's Standard format page.");
  const latest = seasons[seasons.length - 1];
  const [rules] = await db("format_rules?format=eq.standard&select=min_mark,season");
  const rotations = await db("rotations?select=id,new_min_mark,effective_date,season");
  const out: any = { latest_season: latest.season, latest_mark: latest.mark };
  // Seasons are listed when announced; a mark above the current minimum is an upcoming (or new) rotation.
  for (const s of seasons.filter((x) => x.mark > (rules?.min_mark || "A"))) {
    const existing = rotations.find((r) => r.new_min_mark === s.mark);
    if (existing && existing.effective_date) continue;
    const sp = await wiki(`${s.season} Standard format (TCG)`);
    const when = sp ? findRotationDate(sp) : { date: null, online: null };
    // A date before the season's start year is from some other sentence.
    const date = when.date && +when.date.slice(0, 4) >= s.start ? when.date : null;
    const online = when.online && +when.online.slice(0, 4) >= s.start ? when.online : null;
    const src = `https://bulbapedia.bulbagarden.net/wiki/${encodeURIComponent(`${s.season}_Standard_format_(TCG)`)}`;
    if (!existing) {
      await db("rotations", { method: "POST", body: JSON.stringify({ new_min_mark: s.mark, season: s.season, effective_date: date, online_date: online, source: src }) });
      await db("rule_changes", { method: "POST", body: JSON.stringify([{ format: "standard", kind: "rotation_announced", title: `Rotation announced: the ${s.season} Standard format starts at regulation mark ${s.mark}`, detail: date ? `Takes effect ${date}.` : "Date to be confirmed." }]) });
      out.rotation_added = s.mark;
    } else if (date) {
      await db(`rotations?id=eq.${existing.id}`, { method: "PATCH", body: JSON.stringify({ effective_date: date, online_date: online, source: src }) });
      await db("rule_changes", { method: "POST", body: JSON.stringify([{ format: "standard", kind: "rotation_announced", title: `Rotation date confirmed: regulation mark ${String.fromCharCode(s.mark.charCodeAt(0) - 1)} leaves Standard on ${date}` }]) });
      out.rotation_dated = date;
    }
  }
  // Once a rotation's date has passed, make it the format's baseline.
  const applied = (await db(`rotations?effective_date=lte.${new Date().toISOString().slice(0, 10)}&order=new_min_mark.desc&limit=1&select=new_min_mark,season`))[0];
  const patch: any = { checked_at: new Date().toISOString() };
  if (applied && applied.new_min_mark > (rules?.min_mark || "A")) {
    Object.assign(patch, { min_mark: applied.new_min_mark, season: applied.season, notes: `Regulation marks ${applied.new_min_mark} and later.`, updated_at: new Date().toISOString() });
    await db("rule_changes", { method: "POST", body: JSON.stringify([{ format: "standard", kind: "rotation", title: `Rotation: Standard is now regulation mark ${applied.new_min_mark} and later` }]) });
    out.rotated_to = applied.new_min_mark;
  }
  await db("format_rules?format=eq.standard", { method: "PATCH", body: JSON.stringify(patch) });
  await db("format_rules?format=eq.expanded", { method: "PATCH", body: JSON.stringify({ checked_at: new Date().toISOString() }) });
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await isAuthorized(req))) return json({ error: "Not allowed" }, 401);
  const result = await logRun("rules", async () => {
    const out: any = {};
    try { out.bans = await syncBans(); } catch (e) { out.bans_error = String(e?.message || e); }
    try { out.rotation = await syncRotation(); } catch (e) { out.rotation_error = String(e?.message || e); }
    out.legality = await rpc("recompute_legality").then((r) => ({ updated: r.updated, standard_legal: r.standard_legal, min_mark: r.standard_min_mark }));
    if (out.bans_error && out.rotation_error) throw new Error(`${out.bans_error} / ${out.rotation_error}`);
    return out;
  });
  return json(result, result.ok ? 200 : 500);
});
