// @ts-nocheck
// Supabase Edge Function: report-issue
// Saves a "Report an issue" submission from the site footer, then emails it.
// The row is saved first, so a report is never lost if email isn't set up or fails.
//
// Email secrets (Supabase → Edge Functions → Secrets):
//   SMTP_USER  the Google Workspace address that sends (e.g. mike@skillcapturemedia.com)
//   SMTP_PASS  a Google app password for that account
//   REPORT_TO  where reports go (defaults to mike@skillcapturemedia.com)
// Sent through smtp.gmail.com on port 465 (Edge Functions block 25 and 587).
import nodemailer from "npm:nodemailer@6.9.16";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const URL_ = Deno.env.get("SUPABASE_URL");
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PER_HOUR = 5; // per visitor

const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "") || null;
const isEmail = (v) => !!v && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
const db = (path, init = {}) => fetch(`${URL_}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers || {}) },
});

async function signedInUser(req) {
  const auth = req.headers.get("authorization") || "";
  const tok = auth.replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  try {
    const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: req.headers.get("apikey") || SERVICE, Authorization: `Bearer ${tok}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? { id: u.id, email: u.email || null } : null;
  } catch { return null; }
}

async function sendEmail(row, user) {
  const userName = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");
  if (!userName || !pass) return "email not set up yet";
  const to = Deno.env.get("REPORT_TO") || "mike@skillcapturemedia.com";
  const replyTo = row.contact_email || user?.email || undefined;
  const firstLine = row.message.split("\n")[0].slice(0, 70);
  const lines = [
    ["From", replyTo || "anonymous"],
    ["Signed in", user ? "yes" : "no"],
    ["Page", row.page_url || "—"],
    ["Browser", row.user_agent || "—"],
    ["Report #", String(row.id)],
  ];
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: userName, pass } });
  await t.sendMail({
    from: `"Benchmark reports" <${userName}>`,
    to,
    replyTo,
    subject: `Benchmark issue: ${firstLine}`,
    text: `${row.message}\n\n---\n${lines.map(([k, v]) => `${k}: ${v}`).join("\n")}`,
    html: `<div style="font:15px/1.5 system-ui,sans-serif"><p style="white-space:pre-wrap">${esc(row.message)}</p><hr><table style="font-size:13px;color:#555">${lines.map(([k, v]) => `<tr><td style="padding-right:12px"><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join("")}</table></div>`,
  });
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Bad request" }, 400); }

  // Bots fill the hidden field; pretend it worked.
  if (body.website) return json({ ok: true });

  const message = clip(body.message, 4000);
  if (!message || message.length < 5) return json({ ok: false, error: "Please describe the problem." }, 400);
  let contact = clip(body.email, 254);
  if (contact && !isEmail(contact)) return json({ ok: false, error: "That email address doesn't look right." }, 400);

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
  const ip_hash = await sha(`benchmark-report:${ip}`);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = await db(`issue_reports?select=id&ip_hash=eq.${ip_hash}&created_at=gte.${since}`, { headers: { Prefer: "count=exact", Range: "0-0" } });
  const count = Number((recent.headers.get("content-range") || "*/0").split("/")[1] || 0);
  if (count >= PER_HOUR) return json({ ok: false, error: "You've sent several reports in the last hour. Please try again later." }, 429);

  const user = await signedInUser(req);
  if (!contact && user?.email) contact = user.email;
  const ins = await db("issue_reports", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      message, contact_email: contact, page_url: clip(body.page, 1000),
      user_agent: clip(req.headers.get("user-agent"), 500), user_id: user?.id || null, ip_hash,
    }),
  });
  if (!ins.ok) { console.error("insert failed", await ins.text()); return json({ ok: false, error: "Couldn't save your report. Please try again." }, 500); }
  const [row] = await ins.json();

  let emailError = null;
  try { emailError = await sendEmail(row, user); } catch (e) { emailError = String(e?.message || e).slice(0, 300); console.error("email failed", emailError); }
  await db(`issue_reports?id=eq.${row.id}`, {
    method: "PATCH",
    body: JSON.stringify(emailError ? { email_error: emailError } : { emailed_at: new Date().toISOString(), email_error: null }),
  });
  return json({ ok: true, id: row.id });
});
