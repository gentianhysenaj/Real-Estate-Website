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
  if (!["email", "file", "chase"].includes(lead.kind)) {
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

/* ---------- paperwork chase-ups (the Apps Script turns these into Gmail drafts; nothing is sent) ---------- */
const emailIn = t => (String(t || "").match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || [""])[0];
const ASK_LINE = {
  agr: "A fully signed copy of the agreement, with any amendments",
  coop: "The signed Confirmation of Cooperation",
  dep: "The deposit receipt",
  blaw: "Your lawyer's name, phone number and email",
  slaw: "Your lawyer's name, phone number and email",
  fin: "A few minutes to confirm your ID, which the government's FINTRAC rules require. When works for a quick call or meeting this week?",
};
// st remembers when each deal was last chased so the same request isn't drafted again for 4 days.
export function buildChase(db, st, daily, now = new Date()) {
  const out = [], today = isoToday();
  for (const d of (db && db.deals) || []) {
    const miss = (d.docs || []).filter(x => x.req && !x.done && x.ask);
    if (!miss.length) continue;
    const asked = !!d.chaseNow && d.chaseNow > (st[d.id + ":now"] || "");
    if (!asked && !(daily && ["Conditional", "Firm"].includes(d.status))) continue;
    if (asked) st[d.id + ":now"] = d.chaseNow;
    const c = (db.contacts || []).find(x => x.id === d.client);
    for (const who of ["agent", "client"]) {
      const docs = miss.filter(x => x.ask === who);
      if (!docs.length) continue;
      const key = d.id + ":" + who;
      if (!asked && st[key] && daysBetween(st[key].slice(0, 10), today) < 4) continue;
      const to = who === "agent" ? emailIn(d.otherAgent) : (c && emailIn(c.email)) || "";
      if (!to) continue;
      let first = who === "agent" ? String(d.otherAgent || "").split(/[,(<|\/]/)[0].trim().split(/\s+/)[0] : String((c && c.first) || "").replace(/^Sample:\s*/, "").split(/\s+/)[0];
      if (!/^[A-Za-zÀ-ÿ'-]+$/.test(first || "")) first = "there";
      const lines = [...new Set(docs.map(x => ASK_LINE[x.k.startsWith("fin-") ? "fin" : x.k]).filter(Boolean))];
      if (!lines.length) continue;
      const addr = d.addr || "the property";
      const body = who === "agent"
        ? `Hi ${first},\n\nHope you're well. For our file on ${addr}, could you please send over:\n\n${lines.map(l => "- " + l).join("\n")}\n\nThank you,\nGentian`
        : `Hi ${first},\n\nA couple of quick things I need for your file on ${addr}:\n\n${lines.map(l => "- " + l).join("\n")}\n\nThanks so much,\nGentian`;
      st[key] = now.toISOString();
      out.push({ deal: d.id, to, who: who === "agent" ? "the other agent" : "your client", docs: docs.map(x => x.k),
        subject: who === "agent" ? `${addr}: paperwork for our file` : `${addr}: a couple of quick things`, body });
    }
  }
  return out;
}

export function buildSummary(db, base, drafted = 0) {
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
  const paper = (db.deals || []).filter(d => ["Conditional", "Firm"].includes(d.status) || (d.status === "Closed" && (d.close || "") >= addDays(today, -60)))
    .map(d => ({ d, miss: (d.docs || []).filter(x => x.req && !x.done) })).filter(x => x.miss.length);
  const noEmail = paper.filter(({ d, miss }) => miss.some(x => x.ask === "agent") && !emailIn(d.otherAgent));
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
    ${sec("Paperwork to finish", paper.map(({ d, miss }) => `<b>${escH(d.addr || "Deal")}</b>: ${miss.length} missing (${escH(miss.slice(0, 4).map(x => x.d).join(", "))}${miss.length > 4 ? " and " + (miss.length - 4) + " more" : ""})`))}
    ${drafted ? `<p style="margin:10px 0 0">I wrote ${drafted} chase-up email${drafted === 1 ? "" : "s"} for missing paperwork. ${drafted === 1 ? "It's" : "They're"} in your Gmail Drafts for you to check and send.</p>` : ""}
    ${noEmail.length ? `<p style="margin:10px 0 0;color:#6e665d">Add the other agent's email on ${escH(noEmail.map(x => x.d.addr).join(", "))} and I'll write those chase-ups for you.</p>` : ""}
    <p style="margin:24px 0 0"><a href="${escH(base)}/crm/" style="color:#6f5236;font-weight:600">Open your client book</a></p></div>`;
  const text = [`Follow-ups due: ${due.length}`, ...due.slice(0, 12).map(c => `- ${nm(c)}: ${c.followNote || "Follow up"}`),
    `Call these first: ${callFirst.length}`, ...callFirst.map(({ c }) => `- ${nm(c)} ${c.phone || ""}`),
    ...dates.map(x => `- ${nm(x.c)}: ${x.label} ${when(x.n)}`), ...dl.map(x => `- ${x.d.addr}: ${x.label} ${when(x.n)}`),
    ...paper.map(({ d, miss }) => `- ${d.addr}: ${miss.length} paperwork item${miss.length === 1 ? "" : "s"} missing`),
    ...(drafted ? [`${drafted} chase-up email${drafted === 1 ? "" : "s"} waiting in your Gmail Drafts`] : []), `${base}/crm/`].join("\n");
  const subject = `Your day: ${due.length} follow-up${due.length === 1 ? "" : "s"}${dates.length ? ", " + dates.length + " birthday/anniversary" : ""}${dl.length ? ", " + dl.length + " deal deadline" + (dl.length === 1 ? "" : "s") : ""}${paper.length ? ", paperwork on " + paper.length + " deal" + (paper.length === 1 ? "" : "s") : ""}`;
  return { subject, html, text };
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
