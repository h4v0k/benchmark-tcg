// @ts-nocheck
// Supabase Edge Function: deck-import
// Turns a link into deck list text the site can parse:
//   - YouTube video (watch, youtu.be, shorts, live, embed): the video's description, plus any
//     Limitless deck list linked from it
//   - Limitless deck list pages (limitlesstcg.com/decks/list/…, play.limitlesstcg.com/…/decklist)
// Only these hosts are fetched.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const MAX_BYTES = 3_000_000;

export function youtubeId(raw: string) {
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  let id = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else { const m = u.pathname.match(/^\/(shorts|live|embed|v)\/([^/?#]+)/); if (m) id = m[2]; }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}
export function limitlessUrl(raw: string) {
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\./, "");
  if (host === "limitlesstcg.com" && /^\/decks\/list\/\d+/.test(u.pathname)) return `https://limitlesstcg.com${u.pathname.match(/^\/decks\/list\/\d+/)[0]}`;
  if (host === "play.limitlesstcg.com" && /\/decklist\/?$/.test(u.pathname)) return `https://play.limitlesstcg.com${u.pathname}`;
  if (host === "my.limitlesstcg.com" && /^\/builder/.test(u.pathname)) return null; // builder links carry the list in the browser only
  return null;
}

async function fetchText(url: string, headers = {}) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...headers }, redirect: "follow" });
  if (!r.ok) throw new Error(`${new URL(url).hostname} returned ${r.status}`);
  const buf = await r.arrayBuffer();
  if (buf.byteLength > MAX_BYTES * 2) throw new Error("That page is too large to read.");
  return new TextDecoder().decode(buf);
}

const decode = (s: string) => String(s || "").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&eacute;/g, "é").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

// Pulls the JSON object assigned to `ytInitialPlayerResponse` out of a watch page.
export function extractPlayerResponse(html: string) {
  const i = html.indexOf("ytInitialPlayerResponse");
  if (i < 0) return null;
  const start = html.indexOf("{", i);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length && j < start + MAX_BYTES; j++) {
    const ch = html[j];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, j + 1)); } catch { return null; } } }
  }
  return null;
}

async function youtube(id: string) {
  let details = null, reason = "";
  try {
    const html = await fetchText(`https://www.youtube.com/watch?v=${id}&hl=en`, { Cookie: "SOCS=CAI; CONSENT=YES+1" });
    const pr = extractPlayerResponse(html);
    details = pr?.videoDetails || null;
    if (!details) reason = pr?.playabilityStatus?.reason || "YouTube didn't return the video's details.";
  } catch (e) { reason = String(e?.message || e); }
  if (!details) {
    // Fallback: the player API.
    try {
      const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: JSON.stringify({ videoId: id, context: { client: { clientName: "WEB", clientVersion: "2.20250101.00.00", hl: "en" } } }),
      });
      if (r.ok) details = (await r.json())?.videoDetails || null;
    } catch { /* keep the first reason */ }
  }
  if (!details) {
    let title = "";
    try { const o = await (await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`)).json(); title = o?.title || ""; } catch {}
    return { kind: "youtube", title, author: "", text: "", error: reason || "Couldn't read that video's description." };
  }
  const description = String(details.shortDescription || "");
  const links = [...description.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]);
  const lim = [...new Set(links.map(limitlessUrl).filter(Boolean))].slice(0, 2);
  let linked = "";
  for (const u of lim) { try { const l = await limitless(u); if (l.text) { linked = l.text; break; } } catch {} }
  return { kind: "youtube", title: details.title || "", author: details.author || "", text: description, linked_list: linked, linked_from: linked ? lim[0] : "" };
}

async function limitless(url: string) {
  const html = await fetchText(url);
  const title = decode((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "").replace(/\s+–\s+Limitless.*$/, "");
  const lines = [];
  // <div class="decklist-card" data-set="BKP" data-number="74"> … card-count 4 … card-name Darkrai-EX
  const re = /class="decklist-card"[^>]*data-set="([^"]*)"[^>]*data-number="([^"]*)"[\s\S]*?class="card-count">\s*(\d+)\s*<[\s\S]*?class="card-name">([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html))) lines.push(`${m[3]} ${decode(m[4]).trim()} ${m[1]} ${m[2]}`.trim());
  if (!lines.length) {
    // play.limitlesstcg.com lists: "<div class="pokemon"><a ...>4 Charizard ex (OBF 125)</a>"
    for (const mm of html.matchAll(/>\s*(\d{1,2})\s+([^<>()]{2,60}?)\s*\(([A-Z0-9-]{2,6})\s+([A-Za-z]*\d+[a-z]?)\)\s*</g)) lines.push(`${mm[1]} ${decode(mm[2]).trim()} ${mm[3]} ${mm[4]}`);
  }
  return { kind: "limitless", title, author: "", text: lines.join("\n") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const body = await req.json().catch(() => ({}));
  const url = String(body?.url || "").slice(0, 500);
  try {
    const yt = youtubeId(url);
    if (yt) return json(await youtube(yt));
    const lim = limitlessUrl(url);
    if (lim) return json(await limitless(lim));
    return json({ error: "Paste a YouTube video link or a Limitless deck list link." }, 400);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502);
  }
});
