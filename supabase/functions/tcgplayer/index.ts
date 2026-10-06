// @ts-nocheck
// Supabase Edge Function: tcgplayer
// Maps card printings (set + collector number) to exact TCGplayer product IDs,
// using TCGCSV's daily copy of the TCGplayer catalog. Results are cached in the
// tcgp_* tables so each set is downloaded at most once a week.
//
// Already deployed to your Supabase project as the "tcgplayer" Edge Function.

const TCGCSV = "https://tcgcsv.com/tcgplayer/3"; // 3 = Pokémon (English)
const UA = "Benchmark-DeckBuilder/1.0 (Pokemon TCG deck site)";
const GROUPS_MAX_AGE = 2 * 864e5;   // refresh the set list every 2 days
const PRODUCTS_MAX_AGE = 7 * 864e5; // refresh a set's products weekly
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL");
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

async function db(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`database ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const upsert = (table, rows) => rows.length
  ? db(table, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) })
  : null;

async function tcgcsv(path) {
  const r = await fetch(`${TCGCSV}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`tcgcsv ${r.status} for ${path}`);
  const j = await r.json();
  return j.results || [];
}

export const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/&/g, " and ").replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// "SV02: Paldea Evolved" → "paldea evolved"
export const groupBase = (name) => norm(String(name || "").replace(/^[A-Za-z0-9.\- ]{1,10}:\s*/, ""));
// "185/193" → "185", "TG01/TG30" → "TG1", "SWSH001" → "SWSH1"
export function numKey(n) {
  const left = String(n || "").split("/")[0].trim().toUpperCase().replace(/\s+/g, "");
  const m = left.match(/^([A-Z]*)0*(\d+)([A-Z]?)$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : left;
}
export const digitsKey = (n) => { const d = String(n || "").split("/")[0].replace(/\D/g, ""); return d ? String(parseInt(d, 10)) : ""; };
// "Iono - 185/193" → "iono", "Pikachu ex (Special Illustration Rare)" → "pikachu ex"
export const productBase = (name) => norm(String(name || "").replace(/\s+-\s+[A-Za-z]*\d+[A-Za-z]?(\/[A-Za-z]*\d+)?\s*$/, "").replace(/\([^)]*\)/g, " "));

export function rankGroups(groups, setName, setCode) {
  const want = norm(setName);
  const code = String(setCode || "").toUpperCase();
  const scored = [];
  for (const g of groups) {
    const base = groupBase(g.name);
    let s = 0;
    if (want && base === want) s = 100;
    else if (code && String(g.abbreviation || "").toUpperCase() === code) s = 90;
    else if (want && (base.endsWith(" " + want) || norm(g.name) === want)) s = 80;
    else if (want && want.length > 3 && base.startsWith(want + " ")) s = 60; // e.g. "Brilliant Stars Trainer Gallery"
    if (s) scored.push({ g, s });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, 4).map((x) => x.g);
}
const namesAgree = (a, b) => a === b || a.startsWith(b + " ") || b.startsWith(a + " ") || a.endsWith(" " + b) || b.endsWith(" " + a);
// pass 1: exact collector number (e.g. "TG05" = "TG05/TG30"); pass 2: digits only, and only for plain-number cards
export function pickProduct(products, card, pass = 1) {
  const k = numKey(card.num), d = digitsKey(card.num), nm = norm(card.name);
  let hits;
  if (pass === 1) hits = products.filter((p) => p.number_key === k);
  else {
    if (!/^\d+$/.test(k) || !d) return null;
    hits = products.filter((p) => digitsKey(p.number_raw) === d);
  }
  if (!hits.length) return null;
  return hits.find((p) => productBase(p.name) === nm) || hits.find((p) => namesAgree(productBase(p.name), nm)) || null;
}

async function loadGroups() {
  const rows = await db("tcgp_groups?select=group_id,name,abbreviation,fetched_at&limit=5000");
  const fresh = rows.length && rows.every((r) => Date.now() - Date.parse(r.fetched_at) < GROUPS_MAX_AGE);
  if (fresh) return rows;
  const now = new Date().toISOString();
  const list = (await tcgcsv("/groups")).map((g) => ({ group_id: g.groupId, name: g.name, abbreviation: g.abbreviation || "", fetched_at: now }));
  await upsert("tcgp_groups", list);
  return list;
}
async function loadProducts(groupId) {
  const sync = await db(`tcgp_group_sync?group_id=eq.${groupId}&select=synced_at`);
  if (!(sync[0] && Date.now() - Date.parse(sync[0].synced_at) < PRODUCTS_MAX_AGE)) {
    const items = await tcgcsv(`/${groupId}/products`);
    const rows = items.map((p) => {
      const num = (p.extendedData || []).find((e) => e.name === "Number")?.value || "";
      return { product_id: p.productId, group_id: groupId, name: p.name, number_raw: num, number_key: num ? numKey(num) : "", url: p.url || "" };
    }).filter((r) => r.number_key);
    for (let i = 0; i < rows.length; i += 500) await upsert("tcgp_products", rows.slice(i, i + 500));
    await upsert("tcgp_group_sync", [{ group_id: groupId, synced_at: new Date().toISOString() }]);
    return rows;
  }
  return db(`tcgp_products?group_id=eq.${groupId}&select=product_id,name,number_raw,number_key,url&limit=5000`);
}

export async function lookup(cards) {
  const groups = await loadGroups();
  const bySet = new Map();
  for (const c of cards) {
    const key = `${c.setName}|${c.setCode}`;
    if (!bySet.has(key)) bySet.set(key, { setName: c.setName, setCode: c.setCode, cards: [] });
    bySet.get(key).cards.push(c);
  }
  const results = {};
  const productCache = new Map();
  for (const { setName, setCode, cards: list } of bySet.values()) {
    const cands = rankGroups(groups, setName, setCode);
    for (const c of list) {
      search: for (const pass of [1, 2]) {
        for (const g of cands) {
          if (!productCache.has(g.group_id)) productCache.set(g.group_id, await loadProducts(g.group_id));
          const p = pickProduct(productCache.get(g.group_id), c, pass);
          if (p) {
            results[c.cid] = { productId: p.product_id, url: `https://www.tcgplayer.com/product/${p.product_id}`, abbr: g.abbreviation || "", number: p.number_raw };
            break search;
          }
        }
      }
      if (!results[c.cid]) results[c.cid] = null;
    }
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const cards = (Array.isArray(body?.cards) ? body.cards : []).slice(0, 80)
      .filter((c) => c && c.cid && c.num && (c.setName || c.setCode))
      .map((c) => ({ cid: String(c.cid), name: String(c.name || ""), setName: String(c.setName || ""), setCode: String(c.setCode || ""), num: String(c.num) }));
    const results = cards.length ? await lookup(cards) : {};
    return new Response(JSON.stringify({ results }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
