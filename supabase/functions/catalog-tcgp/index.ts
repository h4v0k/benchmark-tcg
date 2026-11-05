// @ts-nocheck
// Supabase Edge Function: catalog-tcgp
// Fills the gap between a set going live (Pokémon TCG Live, TCGplayer presale listings) and TCGdex publishing it.
// For a recent main set TCGdex doesn't list yet, it builds the set and its cards from TCGplayer's product data
// (via TCGCSV), then recomputes legality. catalog-sync's TCGdex data replaces these rows once it exists.
// Called on a schedule (see migration 049) and by admins on demand: POST {}.
import { db, upsert, rpc, logRun, isAuthorized, json, CORS, normName } from "./db.ts";

const TCGDEX = "https://api.tcgdex.net/v2/en";
const TCGCSV = "https://tcgcsv.com/tcgplayer/3";
const UA = "Benchmark-DeckBuilder/2.0 (+https://benchmarktcg.us)";
const DAY = 864e5;
const BUDGET_MS = 100_000;
const getJSON = async (url: string) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (r.status === 404) return null;
    if (r.ok) return r.json();
    if (attempt === 1) throw new Error(`${r.status} from ${url}`);
    await new Promise((res) => setTimeout(res, 800));
  }
};
const numKey = (n: string) => {
  const left = String(n || "").split("/")[0].trim().toUpperCase().replace(/\s+/g, "");
  const m = left.match(/^([A-Z]*)0*(\d+)([A-Z]?)$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : left;
};
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

/* ---------------- 1b. sets TCGdex doesn't have yet (from TCGplayer's catalog) ----------------
   New sets go live on Pokémon TCG Live (and on TCGplayer as presale listings) days before TCGdex publishes them.
   For a recent main set TCGdex doesn't list yet, build the set and its cards from TCGplayer's product data so decks
   can use them right away. Card ids follow TCGdex's scheme (me06-069), so once TCGdex adds the set its data simply
   replaces these rows. Rows that came from here are the ones whose image is a TCGplayer product photo. */
const TCGP_IMG = "https://tcgplayer-cdn.tcgplayer.com/product/";
const SYM = { G: "Grass", R: "Fire", W: "Water", L: "Lightning", P: "Psychic", F: "Fighting", D: "Darkness", M: "Metal", Y: "Fairy", N: "Dragon", C: "Colorless" };
const SERIES = { ME: "Mega Evolution", SV: "Scarlet & Violet" };
const stripHtml = (t: string) => String(t || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
export const tcgpSetId = (g: any) => {
  const m = String(g?.name || "").match(/^(ME|SV)\s?0?(\d{1,2}(?:\.\d)?)\s*:/i);
  return m ? `${m[1].toLowerCase()}${m[2].padStart(2, "0")}` : null;
};
export function tcgpCardRow(p: any, setId: string) {
  const ex: Record<string, string> = {};
  for (const e of p.extendedData || []) ex[e.name] = e.value;
  const num = String(ex.Number || "").split("/")[0].trim();
  if (!num) return null;
  // "Mega Malamar ex - 069/103", and split Legendary Stadiums "Legendary Summit - 096/103 (Left)": both halves share
  // one name (and one 4-copy limit), so the number and side come off.
  const name = String(p.name || "").replace(/\s+-\s+[A-Z]*\d+\/\d+(?:\s*\((?:left|right)\))?\s*$/i, "").replace(/\s+/g, " ").trim();
  const ctype = String(ex["Card Type"] || "");
  const isTrainer = /^trainer/i.test(ctype), isEnergy = !isTrainer && /energy/i.test(ctype);
  const category = isTrainer ? "Trainer" : isEnergy ? "Energy" : "Pokemon";
  const attacks = ["Attack 1", "Attack 2", "Attack 3"].map((k) => ex[k]).filter(Boolean).map((a) => {
    const m = String(a).match(/^\s*\[([A-Z0-9]*)\]\s*([^(<]+?)\s*(?:\(([^)]*)\))?\s*(?:<br\s*\/?>\s*([\s\S]*))?$/i);
    if (!m) return { name: stripHtml(a), cost: [], damage: "", effect: "" };
    return { name: m[2].trim(), cost: [...m[1]].filter((c) => SYM[c]).map((c) => SYM[c]), damage: String(m[3] || "").replace(/x$/i, "×"), effect: stripHtml(m[4] || "") };
  });
  const text = String(ex.CardText || "");
  const abilities = [...text.matchAll(/<strong>\s*(Ability|Poké-Power|Poké-Body)\s*:\s*([^<]+)<\/strong>\s*([\s\S]*?)(?=<strong>|$)/gi)]
    .map((m) => ({ name: m[2].trim(), type: m[1] === "Ability" ? "Ability" : m[1], effect: stripHtml(m[3]) }));
  const wk = String(ex.Weakness || "").match(/^([A-Z])\s*[x×]\s*(\d+)/i);
  const rs = String(ex.Resistance || "").match(/^([A-Z])\s*-\s*(\d+)/i);
  const rarity = ex.Rarity || "";
  const finish = /^(common|uncommon)$/i.test(rarity) ? "normal" : "holo";
  const sig = category === "Pokemon"
    ? ["P", normName(name), ex.HP || "", abilities.map((a) => normName(a.name)).join(","), attacks.map((a) => `${normName(a.name)}:${a.damage}`).join(",")].join("|")
    : `${category === "Energy" ? "E" : "T"}|${normName(name)}`;
  return {
    id: `${setId}-${num}`, set_id: setId, local_id: num, num_key: numKey(num), name, name_norm: normName(name), category,
    stage: category === "Pokemon" ? String(ex.Stage || "").replace(/\s+/g, "") : "",
    trainer_type: isTrainer ? ctype.replace(/^trainer\s*-\s*/i, "").replace(/^pok[eé]mon tool$/i, "Tool") : "",
    energy_type: isEnergy ? "Special" : "",
    suffix: / ex$/.test(name) ? "EX" : "",
    evolves_from: "",
    types: category === "Pokemon" && ctype ? [ctype] : [],
    hp: ex.HP ? parseInt(ex.HP, 10) || null : null,
    retreat: ex.RetreatCost != null && ex.RetreatCost !== "" ? parseInt(ex.RetreatCost, 10) : null,
    rarity, reg_mark: "", illustrator: "",
    effect: category === "Pokemon" ? stripHtml(text.replace(/<strong>\s*(Ability|Poké-Power|Poké-Body)[\s\S]*?(?=<strong>|$)/gi, "")) : stripHtml(text),
    abilities, attacks,
    weaknesses: wk && SYM[wk[1].toUpperCase()] ? [{ type: SYM[wk[1].toUpperCase()], value: `×${wk[2]}` }] : [],
    resistances: rs && SYM[rs[1].toUpperCase()] ? [{ type: SYM[rs[1].toUpperCase()], value: `-${rs[2]}` }] : [],
    variants: finish === "normal" ? ["normal", "reverse"] : ["holo"],
    image: `${TCGP_IMG}${p.productId}`,
    sig, is_ace: /ace spec/i.test(rarity + " " + text), is_radiant: /^radiant /i.test(name), is_prism: false, is_basic_energy: false,
    tcgp_product_id: p.productId, tcgp: { [finish]: p.productId },
    detail_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

async function run(deadline: number) {
  const [groups, list] = await Promise.all([
    getJSON(`${TCGCSV}/groups`).then((j) => j?.results || []),
    getJSON(`${TCGDEX}/sets`).then((l) => l || []).catch(() => null),
  ]);
  // If TCGdex is unreachable, don't guess which sets it has.
  if (!list) return { skipped: "tcgdex unreachable" };
  const known = await db("sets?select=id,tcgp_group_id&limit=2000");
  const knownIds = new Set(known.map((s) => s.id)), knownGroups = new Map(known.map((s) => [s.tcgp_group_id, s.id]));
  const tcgdexIds = new Set(list.map((s) => s.id));
  const now = Date.now();
  const todo = groups.filter((g) => {
    const id = tcgpSetId(g), pub = Date.parse(g.publishedOn || "");
    if (!id || g.isSupplemental || tcgdexIds.has(id) || !pub) return false;
    if (now - pub > 60 * DAY || pub - now > 3 * DAY) return false; // on TCG Live ~a day before paper; keep 60 days
    const owner = knownGroups.get(g.groupId);
    return !owner || owner === id; // a TCGdex set already claimed this group
  });
  const sets = [];
  for (const g of todo) {
    if (Date.now() > deadline) break;
    const id = tcgpSetId(g)!;
    const products = (await getJSON(`${TCGCSV}/${g.groupId}/products`))?.results || [];
    const byId = new Map();
    for (const p of products) { const r = tcgpCardRow(p, id); if (r && !byId.has(r.id)) byId.set(r.id, r); }
    if (!byId.size) continue;
    const release = String(g.publishedOn).slice(0, 10);
    const official = Math.max(0, ...products.map((p) => parseInt(String((p.extendedData || []).find((e) => e.name === "Number")?.value || "").split("/")[1], 10) || 0));
    const name = String(g.name).replace(/^[^:]+:\s*/, "");
    const isNew = !knownIds.has(id);
    await upsert("sets", [{
      id, name, series: SERIES[id.slice(0, 2).toUpperCase()] || "", code: String(g.abbreviation || "").toUpperCase(),
      release_date: release, legal_date: addDays(release, 14), official_count: official || null, total_count: byId.size,
      logo: "", symbol: "", is_promo: false, is_classic: false, hidden: false, tcgp_group_id: g.groupId,
    }], "id");
    // Only write cards that are new or still TCGplayer-sourced; never overwrite TCGdex data.
    const have = await db(`cards?set_id=eq.${encodeURIComponent(id)}&select=id,image&limit=2000`);
    const fromTcgdex = new Set(have.filter((c) => c.image && !String(c.image).startsWith(TCGP_IMG)).map((c) => c.id));
    const write = [...byId.values()].filter((r) => !fromTcgdex.has(r.id));
    await upsert("cards", write, "id", 200);
    if (isNew) await db("rule_changes", { method: "POST", body: JSON.stringify([{ kind: "set_added", title: `${name} added to the card database`, detail: "Card details come from TCGplayer's listings until the full data is published. Its cards become tournament legal two weeks after release." }]) });
    sets.push({ id, cards: write.length, new: isNew });
  }
  if (sets.length) { await rpc("refresh_set_marks"); await rpc("recompute_legality"); }
  return { checked: todo.length, sets };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await isAuthorized(req))) return json({ error: "Not allowed" }, 401);
  const result = await logRun("tcgp_sets", () => run(Date.now() + BUDGET_MS));
  return json(result, result.ok ? 200 : 500);
});
