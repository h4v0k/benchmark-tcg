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

const ALLOWED_HOSTS = /^(www\.|m\.)?(youtube\.com|limitlesstcg\.com|play\.limitlesstcg\.com)$/;

// Fetches a page from an allowed host only, follows redirects only within those hosts,
// and stops reading after MAX_BYTES.
async function fetchText(url: string, headers = {}) {
  let target = url;
  for (let hop = 0; hop < 3; hop++) {
    const host = new URL(target).hostname;
    if (!ALLOWED_HOSTS.test(host)) throw new Error("That link points somewhere Benchmark doesn't read.");
    const r = await fetch(target, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...headers }, redirect: "manual" });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { target = new URL(r.headers.get("location"), target).toString(); continue; }
    if (!r.ok) throw new Error(`${host} returned ${r.status}`);
    const reader = r.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { reader.cancel(); break; }
      chunks.push(value);
    }
    const buf = new Uint8Array(size > MAX_BYTES ? MAX_BYTES : size);
    let off = 0;
    for (const c of chunks) { const n = Math.min(c.byteLength, buf.length - off); buf.set(c.subarray(0, n), off); off += n; if (off >= buf.length) break; }
    return new TextDecoder().decode(buf);
  }
  throw new Error("Too many redirects.");
}

// Signed-in Benchmark users only.
async function signedIn(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), Authorization: `Bearer ${token}` } });
    if (!r.ok) return false;
    const u = await r.json();
    return !!u?.id;
  } catch { return false; }
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
  if (!(await signedIn(req))) return json({ error: "Sign in to import from a link." }, 401);
  const body = await req.json().catch(() => ({}));
  const url = String(body?.url || "").slice(0, 500);
  try {
    const yt = youtubeId(url);
    if (yt) return json(await youtube(yt));
    const lim = limitlessUrl(url);
    if (lim) return json(await limitless(lim));
    return json({ error: "Paste a YouTube video link or a Limitless deck list link." }, 400);
  } catch (e) {
    console.warn(String(e?.message || e));
    return json({ error: "Couldn't read that page. Paste the list instead." }, 502);
  }
});
