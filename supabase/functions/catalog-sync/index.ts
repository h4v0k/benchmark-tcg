// @ts-nocheck
// Supabase Edge Function: catalog-sync
// Keeps the card catalog current. Each run does a bounded slice of work, so a cron job
// calling it every few minutes keeps everything fresh:
//   1. set list from TCGdex (twice a day): new sets, release dates, set codes
//   2. card details from TCGdex: new cards first, then recent sets, then a slow refresh of the rest
//   3. TCGplayer prices from TCGCSV, one set at a time, daily
//   4. recompute Standard / Expanded legality and log what changed
import { db, upsert, rpc, logRun, isAuthorized, json, CORS, normName } from "./db.ts";

const TCGDEX = "https://api.tcgdex.net/v2/en";
const TCGCSV = "https://tcgcsv.com/tcgplayer/3";
const UA = "Benchmark-DeckBuilder/2.0 (+https://benchmark-tcg.netlify.app)";
const BUDGET_MS = 100_000;
const DAY = 864e5;

const getJSON = async (url: string) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (r.status === 404) return null;
    if (r.ok) return r.json();
    if (attempt === 1) throw new Error(`${r.status} from ${url}`);
    await new Promise((res) => setTimeout(res, 800));
  }
};

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>, deadline: number): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length && Date.now() < deadline) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch (e) { console.warn(String(e?.message || e)); }
    }
  }));
  return out;
}

/* ---------------- card facts ---------------- */
const BASIC_ENERGY_RE = /^(basic )?(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy) energy$/i;
export const numKey = (n: string) => {
  const left = String(n || "").split("/")[0].trim().toUpperCase().replace(/\s+/g, "");
  const m = left.match(/^([A-Z]*)0*(\d+)([A-Z]?)$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : left;
};
const VARIANT_KEY = { normal: "normal", holo: "holo", reverse: "reverse", firstEdition: "firstEdition" };
// TCGplayer price sub types → our finish keys
const SUBTYPE = { "Normal": "normal", "Holofoil": "holo", "Reverse Holofoil": "reverse", "1st Edition": "firstEdition", "1st Edition Normal": "firstEdition", "1st Edition Holofoil": "firstEditionHolo", "Unlimited": "normal", "Unlimited Holofoil": "unlimitedHolo" };
const TCGDEX_PRICE_KEY = { "normal": "normal", "holofoil": "holo", "reverse-holofoil": "reverse", "1st-edition": "firstEdition", "1st-edition-holofoil": "firstEditionHolo", "unlimited-holofoil": "unlimitedHolo" };

export function cardRow(c: any) {
  const name = String(c.name || "");
  const category = c.category || "";
  const isBasicEnergy = category === "Energy" && BASIC_ENERGY_RE.test(name.trim());
  const attacks = (c.attacks || []).map((a: any) => ({ name: a.name || "", cost: a.cost || [], damage: a.damage == null ? "" : String(a.damage), effect: a.effect || "" }));
  const abilities = (c.abilities || []).map((a: any) => ({ name: a.name || "", type: a.type || "", effect: a.effect || "" }));
  // Gameplay identity. Trainers and Special Energy go by name (the reprint rule);
  // Pokémon by name, HP, Abilities and attacks.
  const sig = category === "Pokemon"
    ? ["P", normName(name), c.hp || "", abilities.map((a) => normName(a.name)).join(","), attacks.map((a) => `${normName(a.name)}:${a.damage}`).join(",")].join("|")
    : `${category === "Energy" ? "E" : "T"}|${normName(name)}`;
  const variants = Object.entries(c.variants || {}).filter(([k, v]) => v && VARIANT_KEY[k]).map(([k]) => VARIANT_KEY[k]);
  // exact TCGplayer products per finish, from TCGdex's variant details
  const tcgp: Record<string, number> = {};
  for (const v of c.variants_detailed || []) {
    const id = v?.thirdParty?.tcgplayer;
    if (id && VARIANT_KEY[v.type] && !tcgp[VARIANT_KEY[v.type]]) tcgp[VARIANT_KEY[v.type]] = id;
  }
  const prices: Record<string, number> = {};
  for (const [k, v] of Object.entries(c.pricing?.tcgplayer || {})) {
    const key = TCGDEX_PRICE_KEY[k];
    if (key && v && typeof v === "object") {
      const p = (v as any).marketPrice ?? (v as any).midPrice ?? (v as any).lowPrice;
      if (p != null) prices[key] = Number(p);
    }
  }
  const productId = tcgp.normal || tcgp.holo || tcgp.reverse || Object.values(tcgp)[0] ||
    Object.values(c.pricing?.tcgplayer || {}).find((v: any) => v?.productId)?.productId || null;
  return {
    id: c.id,
    set_id: c.set?.id || c.id.slice(0, c.id.lastIndexOf("-")),
    local_id: String(c.localId ?? ""),
    num_key: numKey(String(c.localId ?? "")),
    name,
    name_norm: normName(name),
    category,
    stage: c.stage || "",
    trainer_type: c.trainerType || "",
    energy_type: c.energyType || "",
    suffix: c.suffix || "",
    evolves_from: c.evolveFrom || "",
    types: c.types || [],
    hp: c.hp ? parseInt(c.hp, 10) || null : null,
    retreat: c.retreat ?? null,
    rarity: c.rarity || "",
    reg_mark: (c.regulationMark || "").toUpperCase(),
    illustrator: c.illustrator || "",
    effect: c.effect || c.description || "",
    abilities,
    attacks,
    weaknesses: c.weaknesses || [],
    resistances: c.resistances || [],
    variants: variants.length ? variants : ["normal"],
    image: c.image || "",
    sig,
    is_ace: /ace ?spec|rare ace/i.test(c.rarity || "") || /ace spec/i.test(c.trainerType || ""),
    is_radiant: /^radiant /i.test(name),
    is_prism: /◇|prism star/i.test(name),
    is_basic_energy: isBasicEnergy,
    tcgp_product_id: productId,
    tcgp: tcgp,
    ...(Object.keys(prices).length ? { prices, prices_at: c.pricing?.tcgplayer?.updated || new Date().toISOString() } : {}),
    tcgdex_legal: c.legal || null,
    detail_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/* ---------------- 1. sets ---------------- */
const isPromoSet = (s: any) => /promo/i.test(s.name || "");
// Never tournament legal: Classic Collection reprints, jumbo cards, and Pokémon TCG Pocket (digital only).
const isPocket = (s: any) => /pocket/i.test(s.serie?.name || "");
const isClassic = (s: any) => s.id === "cel25c" || s.id === "jumbo" || /classic collection/i.test(s.name || "") || isPocket(s);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

async function syncSets(deadline: number, force = false) {
  const known = await db("sets?select=id,name,release_date,briefs_at,code&limit=2000");
  const byId = new Map(known.map((s) => [s.id, s]));
  const lastRun = await db("sync_runs?job=eq.sets&ok=is.true&order=started_at.desc&limit=1&select=started_at");
  if (!force && lastRun[0] && Date.now() - Date.parse(lastRun[0].started_at) < 12 * 36e5 && known.length) return { skipped: true };
  const list = await getJSON(`${TCGDEX}/sets`);
  const groups = await getJSON(`${TCGCSV}/groups`).then((j) => j?.results || []).catch(() => []);
  // Fetch details for sets we don't have, sets missing a release date, and sets released in the last 90 days.
  const todo = list.filter((s) => {
    const k = byId.get(s.id);
    if (!k || !k.briefs_at || !k.release_date) return true;
    return Date.now() - Date.parse(k.release_date) < 90 * DAY && Date.now() - Date.parse(k.briefs_at) > 20 * 36e5;
  });
  const added: string[] = [];
  const setRows = [], cardRows = [], codeRows = [];
  await pool(todo, 6, async (brief) => {
    const s = await getJSON(`${TCGDEX}/sets/${encodeURIComponent(brief.id)}`);
    if (!s) return;
    const grp = matchGroup(groups, s);
    const release = s.releaseDate || (grp?.publishedOn ? grp.publishedOn.slice(0, 10) : null);
    const code = (s.abbreviation?.official || s.tcgOnline || grp?.abbreviation || "").toUpperCase();
    setRows.push({
      id: s.id, name: s.name, series: s.serie?.name || "", code,
      release_date: release, legal_date: release ? addDays(release, 14) : null,
      official_count: s.cardCount?.official ?? null, total_count: s.cardCount?.total ?? null,
      logo: s.logo || "", symbol: s.symbol || "", is_promo: isPromoSet(s), is_classic: isClassic(s), hidden: isPocket(s),
      tcgp_group_id: grp?.groupId ?? null, briefs_at: new Date().toISOString(),
    });
    for (const c of [s.tcgOnline, grp?.abbreviation]) if (c && c.toUpperCase() !== code) codeRows.push({ code: c.toUpperCase(), set_id: s.id });
    for (const c of s.cards || []) cardRows.push({ id: c.id, set_id: s.id, local_id: String(c.localId ?? ""), num_key: numKey(String(c.localId ?? "")), name: c.name, name_norm: normName(c.name), image: c.image || "" });
    if (!byId.has(s.id) && !isPocket(s)) added.push(s.name);
  }, deadline);
  await upsert("sets", setRows, "id");
  // Insert new cards only; never overwrite details already fetched.
  const existing = new Set((await db(`cards?select=id&set_id=in.(${[...new Set(cardRows.map((c) => c.set_id))].map(encodeURIComponent).join(",") || "x"})&limit=20000`)).map((c) => c.id));
  const fresh = cardRows.filter((c) => !existing.has(c.id));
  for (let i = 0; i < fresh.length; i += 300) {
    await db("cards?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(fresh.slice(i, i + 300)) });
  }
  // de-duplicate alias codes; the main code wins
  const mainCodes = new Set(setRows.map((s) => s.code));
  const aliases = [...new Map(codeRows.filter((c) => !mainCodes.has(c.code)).map((c) => [c.code, c])).values()];
  if (aliases.length) await upsert("set_codes", aliases, "code");
  if (added.length && known.length) {
    await db("rule_changes", { method: "POST", body: JSON.stringify(added.map((n) => ({ kind: "set_added", title: `${n} added to the card database`, detail: "Its cards become tournament legal two weeks after release." }))) });
  }
  return { sets_checked: todo.length, sets_added: added.length, cards_added: fresh.length };
}

function matchGroup(groups: any[], s: any) {
  const want = normName(s.name);
  const code = String(s.abbreviation?.official || s.tcgOnline || "").toUpperCase();
  const base = (n: string) => normName(String(n || "").replace(/^[A-Za-z0-9.\- ]{1,10}:\s*/, ""));
  let best = null, bestScore = 0;
  for (const g of groups) {
    let sc = 0;
    const b = base(g.name);
    if (want && b === want) sc = 100;
    else if (code && String(g.abbreviation || "").toUpperCase() === code) sc = 90;
    else if (want && normName(g.name) === want) sc = 85;
    else if (want && b.endsWith(" " + want)) sc = 70;
    if (sc > bestScore) { best = g; bestScore = sc; }
  }
  return best;
}

/* ---------------- 2. card details ---------------- */
async function syncCards(deadline: number, limit = 160) {
  const now = Date.now();
  const recent = new Date(now - 60 * DAY).toISOString().slice(0, 10);
  // never fetched first (newest sets first), then recent sets, then a slow refresh of everything
  const ids = (await db(`rpc/cards_needing_detail`, { method: "POST", body: JSON.stringify({ lim: limit, recent_from: recent }) })).map((r) => r.id);
  if (!ids.length) return { cards: 0 };
  const rows = await pool(ids, 12, async (id) => {
    const c = await getJSON(`${TCGDEX}/cards/${encodeURIComponent(id)}`);
    return c ? cardRow(c) : { id, detail_at: new Date().toISOString(), missing: true };
  }, deadline);
  const good = rows.filter((r) => r && !r.missing);
  const missing = rows.filter((r) => r && r.missing).map((r) => r.id);
  // TCGdex may list a card before its details exist; try again later.
  if (missing.length) await db(`cards?id=in.(${missing.map(encodeURIComponent).join(",")})`, { method: "PATCH", body: JSON.stringify({ detail_at: new Date().toISOString() }) });
  // PostgREST bulk upserts need the same keys in every row: rows with prices and rows without go separately.
  const withPrices = good.filter((r) => "prices" in r), without = good.filter((r) => !("prices" in r));
  await upsert("cards", withPrices, "id", 200);
  await upsert("cards", without, "id", 200);
  return { cards: good.length, missing: missing.length };
}

/* ---------------- 3. prices ---------------- */
async function syncPrices(deadline: number, maxSets = 8) {
  const sets = await db(`rpc/sets_needing_prices`, { method: "POST", body: JSON.stringify({ lim: maxSets }) });
  let updated = 0, done = 0;
  for (const s of sets) {
    if (Date.now() > deadline) break;
    if (!s.tcgp_group_id) { await db(`sets?id=eq.${encodeURIComponent(s.id)}`, { method: "PATCH", body: JSON.stringify({ prices_at: new Date().toISOString() }) }); continue; }
    const prices = (await getJSON(`${TCGCSV}/${s.tcgp_group_id}/prices`))?.results || [];
    const byProduct = new Map();
    for (const p of prices) {
      const key = SUBTYPE[p.subTypeName] || "normal";
      const v = p.marketPrice ?? p.midPrice ?? p.lowPrice;
      if (v == null) continue;
      if (!byProduct.has(p.productId)) byProduct.set(p.productId, {});
      byProduct.get(p.productId)[key] = Number(v);
    }
    const cards = await db(`cards?set_id=eq.${encodeURIComponent(s.id)}&select=id,local_id,name,tcgp,tcgp_product_id,variants&limit=2000`);
    // cards without a product from TCGdex: match by collector number in TCGplayer's catalog
    let products = null;
    if (cards.some((c) => !c.tcgp_product_id)) {
      products = ((await getJSON(`${TCGCSV}/${s.tcgp_group_id}/products`))?.results || []).map((p) => ({
        id: p.productId, name: p.name, num: (p.extendedData || []).find((e) => e.name === "Number")?.value || "",
      })).filter((p) => p.num);
    }
    const out = [];
    for (const c of cards) {
      let pid = c.tcgp_product_id;
      if (!pid && products) {
        const k = numKey(c.local_id), nm = normName(c.name);
        const hit = products.find((p) => numKey(p.num) === k && normName(p.name.replace(/\s+-\s+\S+$/, "").replace(/\([^)]*\)/g, " ")).startsWith(nm.split(" ")[0]))
          || products.find((p) => numKey(p.num) === k);
        if (hit) pid = hit.id;
      }
      const merged = {};
      const ids = new Set([pid, ...Object.values(c.tcgp || {})].filter(Boolean));
      for (const id of ids) Object.assign(merged, byProduct.get(id) || {});
      // a separate product for one finish (e.g. a stamped reverse holo) wins for that finish
      for (const [fin, id] of Object.entries(c.tcgp || {})) { const p = byProduct.get(id); if (p && p[fin] != null) merged[fin] = p[fin]; }
      if (pid || Object.keys(merged).length) out.push({ id: c.id, tcgp_product_id: pid || null, ...(Object.keys(merged).length ? { prices: merged, prices_at: new Date().toISOString() } : {}) });
    }
    for (let i = 0; i < out.length; i += 400) await rpc("apply_prices", { rows: out.slice(i, i + 400) });
    updated += out.length; done++;
    await db(`sets?id=eq.${encodeURIComponent(s.id)}`, { method: "PATCH", body: JSON.stringify({ prices_at: new Date().toISOString() }) });
  }
  return { price_sets: done, priced_cards: updated };
}

/* ---------------- 4. legality ---------------- */
async function legality() {
  await rpc("refresh_set_marks");
  const r = await rpc("recompute_legality");
  // While the catalog is still filling up, "became legal" is just the backfill, not news.
  const pending = await db("cards?select=id&detail_at=is.null&limit=1");
  r.first_run = pending.length > 0;
  const logs = [];
  const nl = r.became_legal || [], ni = r.became_illegal || [];
  if (nl.length && nl.length < 2000) logs.push({ format: "standard", kind: "set_legal", title: `${nl.length} card${nl.length > 1 ? "s" : ""} became Standard legal`, detail: nl.slice(0, 60).join(", ") + (nl.length > 60 ? "…" : "") });
  if (ni.length && ni.length < 5000) logs.push({ format: "standard", kind: "rules", title: `${ni.length} card${ni.length > 1 ? "s" : ""} left Standard`, detail: ni.slice(0, 60).join(", ") + (ni.length > 60 ? "…" : "") });
  if (logs.length && !r.first_run) await db("rule_changes", { method: "POST", body: JSON.stringify(logs) });
  return { legality_updated: r.updated, standard_legal: r.standard_legal, min_mark: r.standard_min_mark };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await isAuthorized(req))) return json({ error: "Not allowed" }, 401);
  const body = await req.json().catch(() => ({}));
  const job = body.job || "auto";
  const deadline = Date.now() + BUDGET_MS;
  const result = await logRun("catalog", async () => {
    const out: any = { job };
    if (job === "auto" || job === "sets") {
      const s = await logRun("sets", () => syncSets(deadline, job === "sets"));
      Object.assign(out, { sets: s });
    }
    if ((job === "auto" || job === "cards") && Date.now() < deadline - 20_000) Object.assign(out, await syncCards(deadline - 15_000, body.limit || 160));
    if ((job === "auto" || job === "prices") && Date.now() < deadline - 15_000) Object.assign(out, await syncPrices(deadline - 8_000));
    if (job !== "prices" || body.legality) Object.assign(out, await legality());
    return out;
  });
  return json(result, result.ok ? 200 : 500);
});
