// Shared helpers for the client book (/crm/) functions: storage, sign-in tokens and adding leads.
import { getStore } from "@netlify/blobs";
import { createHmac, pbkdf2Sync, timingSafeEqual, randomBytes } from "node:crypto";

export const store = () => getStore({ name: "crm", consistency: "strong" });

const env = k => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]);

// The PIN itself is never stored: CRM_PIN_HASH is "pbkdf2$<iterations>$<salt hex>$<hash hex>".
export function pinMatches(pin) {
  const spec = env("CRM_PIN_HASH") || "";
  const [kind, iters, salt, hash] = spec.split("$");
  if (kind !== "pbkdf2" || !hash || typeof pin !== "string" || pin.length > 200) return false;
  const got = pbkdf2Sync(pin, Buffer.from(salt, "hex"), Number(iters), 32, "sha256");
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

const b64 = b => Buffer.from(b).toString("base64url");
export function makeToken(days = 30) {
  const body = b64(JSON.stringify({ exp: Date.now() + days * 864e5, n: randomBytes(6).toString("hex") }));
  return body + "." + createHmac("sha256", env("CRM_SECRET")).update(body).digest("base64url");
}
export function tokenOk(tok) {
  if (!tok || !env("CRM_SECRET")) return false;
  const [body, sig] = String(tok).split(".");
  if (!body || !sig) return false;
  const want = createHmac("sha256", env("CRM_SECRET")).update(body).digest("base64url");
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
  try { return JSON.parse(Buffer.from(body, "base64url").toString()).exp > Date.now(); } catch { return false; }
}

// New leads are written to their own key under inbox/ so they never collide with an edit in the app.
// The app folds them into the client book the next time it loads.
export async function addLead(lead) {
  const id = Date.now() + "-" + randomBytes(4).toString("hex");
  const received = new Date().toISOString();
  await store().setJSON("inbox/" + id, { ...lead, id, received });
  // A copy for the new-lead email alert (the Apps Script picks these up every few minutes). Kept apart from
  // inbox/ because the app clears inbox/ as soon as it folds a lead in, which can be before the alert goes out.
  if (lead.kind !== "email") {
    await store().setJSON("alerts/" + id, { id, received, kind: lead.kind, first: lead.first || "", last: lead.last || "",
      email: lead.email || "", phone: lead.phone || "", ad: lead.ad || "", campaign: lead.campaign || "", reason: lead.reason || "",
      message: String(lead.message || "").slice(0, 400), answers: lead.answers || {} });
  }
  return id;
}

/* ---------- morning summary (built on the server so the Apps Script only has to send it) ---------- */
const TZ = "America/Toronto";
const isoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 864e5);
const nm = c => ((c.first || "") + " " + (c.last || "")).trim() || "No name";
const escH = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

// Same rules as the app's "Call these first" list (assets/crm.js, intent()).
export function intentScore(c) {
  const cr = c.crit || {};
  let s = 0;
  if (cr.pre === "Yes") s += 40; else if (cr.pre === "In progress") s += 15;
  const w = String(cr.when || "").toLowerCase();
  if (/0\s*-\s*3|asap|right away|immediately|this month/.test(w)) s += 40;
  else if (/3\s*-\s*6/.test(w)) s += 30;
  else if (/6\s*-\s*12/.test(w)) s += 12;
  else if (/right (one|property)/.test(w)) s += 8;
  if ((c.tags || []).includes("Has home to sell")) s += 10;
  const reached = (c.log || []).some(l => ["call", "text", "email", "showing"].includes(l.k));
  if (!reached) s += 10;
  return s;
}

export function nextOccurrence(dateIso, today) {
  if (!dateIso) return null;
  const [, m, d] = dateIso.split("-");
  let y = Number(today.slice(0, 4));
  let next = `${y}-${m}-${d}`;
  if (next < today) next = `${y + 1}-${m}-${d}`;
  return next;
}

export function upcomingDates(db, today, days) {
  const out = [];
  for (const c of db.contacts || []) {
    if (c.bday) out.push({ c, label: "Birthday", date: nextOccurrence(c.bday, today) });
    if (c.anniv) out.push({ c, label: c.annivLabel || "Anniversary", date: nextOccurrence(c.anniv, today) });
  }
  for (const d of db.deals || []) {
    const c = (db.contacts || []).find(x => x.id === d.client);
    if (!c || d.status !== "Closed" || !d.close) continue;
    const date = nextOccurrence(d.close, today);
    const years = Number(date.slice(0, 4)) - Number(d.close.slice(0, 4));
    if (years >= 1) out.push({ c, label: years + (years === 1 ? " year" : " years") + " in " + (d.addr || "their home"), date, home: true });
  }
  return out.map(x => ({ ...x, n: daysBetween(today, x.date) })).filter(x => x.n >= 0 && x.n <= days).sort((a, b) => a.n - b.n);
}

export function buildSummary(db, base) {
  db = db || { contacts: [], deals: [] };
  const today = isoToday();
  const contacts = db.contacts || [];
  const due = contacts.filter(c => c.follow && c.follow <= today).sort((a, b) => a.follow.localeCompare(b.follow));
  const callFirst = contacts.filter(c => ["New lead", "Contacted"].includes(c.stage)).map(c => ({ c, s: intentScore(c) }))
    .filter(x => x.s >= 60).sort((a, b) => b.s - a.s).slice(0, 5);
  const dates = upcomingDates(db, today, 7);
  const dl = [];
  for (const d of db.deals || []) {
    if (d.status === "Closed") continue;
    for (const [label, v] of [["Irrevocable", d.offer], ["Conditions due", d.cond], ["Closing", d.close]]) {
      if (v && v >= today && v <= addDays(today, 7)) dl.push({ d, label, v, n: daysBetween(today, v) });
    }
  }
  dl.sort((a, b) => a.v.localeCompare(b.v));
  const since = addDays(today, -1);
  const newLeads = contacts.filter(c => c.stage === "New lead" && c.created && c.created.slice(0, 10) >= since).length
    + (db.meta || []).filter(m => !m.moved && (m.t || "").slice(0, 10) >= since).length;
  const when = n => (n === 0 ? "today" : n === 1 ? "tomorrow" : "in " + n + " days");
  const sec = (title, items) => items.length ? `<h3 style="margin:22px 0 6px;font:600 15px system-ui">${escH(title)}</h3><ul style="margin:0;padding-left:18px">${items.map(i => `<li style="margin:4px 0">${i}</li>`).join("")}</ul>` : "";
  const html = `<div style="font:14px/1.5 system-ui,-apple-system,sans-serif;color:#1f1b17;max-width:560px">
    <p style="margin:0 0 4px">Good morning, here's your day.</p>
    <p style="margin:0;color:#6e665d">${due.length} follow-up${due.length === 1 ? "" : "s"} due · ${callFirst.length} high-intent lead${callFirst.length === 1 ? "" : "s"} to call · ${newLeads} new lead${newLeads === 1 ? "" : "s"} since yesterday</p>
    ${sec("Follow up today", due.slice(0, 12).map(c => `<b>${escH(nm(c))}</b>: ${escH(c.followNote || "Follow up")}${c.follow < today ? " (late)" : ""}${c.phone ? ` · <a href="tel:${escH(c.phone)}">${escH(c.phone)}</a>` : ""}`))}
    ${sec("Call these first", callFirst.map(({ c }) => `<b>${escH(nm(c))}</b>: ${escH([c.crit && c.crit.pre === "Yes" ? "pre-approved" : "", c.crit && c.crit.when].filter(Boolean).join(", "))}${c.phone ? ` · <a href="tel:${escH(c.phone)}">${escH(c.phone)}</a>` : ""}`))}
    ${sec("Birthdays and anniversaries this week", dates.map(x => `<b>${escH(nm(x.c))}</b>: ${escH(x.label)} ${when(x.n)}`))}
    ${sec("Deal deadlines this week", dl.map(x => `<b>${escH(x.d.addr || "Deal")}</b>: ${escH(x.label)} ${when(x.n)}`))}
    <p style="margin:24px 0 0"><a href="${escH(base)}/crm/" style="color:#6f5236;font-weight:600">Open your client book</a></p></div>`;
  const text = [`Follow-ups due: ${due.length}`, ...due.slice(0, 12).map(c => `- ${nm(c)}: ${c.followNote || "Follow up"}`),
    `Call these first: ${callFirst.length}`, ...callFirst.map(({ c }) => `- ${nm(c)} ${c.phone || ""}`),
    ...dates.map(x => `- ${nm(x.c)}: ${x.label} ${when(x.n)}`), ...dl.map(x => `- ${x.d.addr}: ${x.label} ${when(x.n)}`), `${base}/crm/`].join("\n");
  const subject = `Your day: ${due.length} follow-up${due.length === 1 ? "" : "s"}${dates.length ? ", " + dates.length + " birthday/anniversary" : ""}${dl.length ? ", " + dl.length + " deal deadline" + (dl.length === 1 ? "" : "s") : ""}`;
  return { subject, html, text };
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
