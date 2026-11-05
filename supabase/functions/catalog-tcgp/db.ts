// Tiny PostgREST client for Edge Functions, using the service role key.
// @ts-nocheck
export const SB_URL = Deno.env.get("SUPABASE_URL");
export const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

export async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`database ${r.status} on ${path.split("?")[0]}: ${(await r.text()).slice(0, 300)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

export async function upsert(table: string, rows: object[], onConflict = "", chunk = 300) {
  for (let i = 0; i < rows.length; i += chunk) {
    await db(`${table}${onConflict ? `?on_conflict=${onConflict}` : ""}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(i, i + chunk)),
    });
  }
}

export const rpc = (fn: string, args: object = {}) => db(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

export async function logRun(job: string, fn: () => Promise<object>) {
  const [run] = await db("sync_runs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ job }) });
  try {
    const detail = await fn();
    await db(`sync_runs?id=eq.${run.id}`, { method: "PATCH", body: JSON.stringify({ finished_at: new Date().toISOString(), ok: true, detail }) });
    return { ok: true, ...detail };
  } catch (e) {
    const msg = String(e?.message || e);
    await db(`sync_runs?id=eq.${run.id}`, { method: "PATCH", body: JSON.stringify({ finished_at: new Date().toISOString(), ok: false, detail: { error: msg } }) }).catch(() => {});
    return { ok: false, error: msg };
  }
}

const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};
let cronSecret: string | null = null;

// Only the service role (cron jobs) or a Benchmark admin may run sync jobs.
export async function isAuthorized(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (SB_KEY && same(token, SB_KEY)) return true;
  const given = req.headers.get("x-cron-secret");
  if (given) {
    // The cron jobs send a secret kept in app_settings (readable only with the service role).
    if (cronSecret === null) {
      const rows = await db("app_settings?key=eq.cron_secret&select=value").catch(() => []);
      cronSecret = rows?.[0]?.value || "";
    }
    return cronSecret.length >= 32 && same(cronSecret, given);
  }
  try {
    const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
    if (!u.ok) return false;
    const user = await u.json();
    const rows = await db(`profiles?id=eq.${user.id}&select=is_admin`);
    return !!rows?.[0]?.is_admin;
  } catch { return false; }
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Same as public.norm_name() in the database: lowercase, é → e, curly quotes → straight.
export const normName = (s: string) => String(s || "").replace(/[éÉ]/g, "e").replace(/[’‘]/g, "'").toLowerCase()
  .replace(/[^a-z0-9'&.◇★ -]+/g, " ").replace(/\s+/g, " ").trim();
