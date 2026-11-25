/* Client book (/crm/): contacts, pipeline, deal desk, Meta leads.
   Data lives in Netlify Blobs behind /api/crm (netlify/functions/crm.mjs). The PIN is checked on the server.
   The whole book is one JSON document; every change saves it a moment later. New website and Meta leads arrive
   in a separate inbox on the server and are folded in here when the book loads. */
(function () {
"use strict";
const STAGES = ["New lead", "Contacted", "Showing homes", "Offer out", "Firm deal", "Closed"];
const SOURCES = ["Home search", "Contact form", "Meta ad", "Referral", "Open house", "Instagram", "Past client", "Sphere", "Sign call", "Import", "Other"];
const KINDS = { call: "Call", text: "Text", email: "Email", showing: "Showing", note: "Note" };
const KI = { call: "C", text: "T", email: "E", showing: "S", note: "N" };
const BUY_DOCS = ["Buyer representation agreement", "FINTRAC ID check", "Agreement of purchase and sale", "Deposit delivered", "Financing condition waived", "Inspection condition waived", "Notice of fulfillment signed", "Lawyer details sent", "Closing and commission paid"];
const SELL_DOCS = ["Listing agreement", "FINTRAC ID check", "Property info and photos", "Listed on MLS", "Offer accepted", "Deposit received", "Conditions waived by buyer", "Lawyer details sent", "Closing and commission paid"];
const DSTAT = ["Listing", "Offer in", "Conditional", "Firm", "Closed"];
const DAY = 864e5;
const VIEWS = ["today", "pipeline", "deals", "meta", "contacts", "import"];

const $id = id => document.getElementById(id);
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const iso = d => { const x = new Date(d); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); };
const rel = n => iso(today().getTime() + n * DAY);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => n ? "$" + Number(n).toLocaleString("en-CA") : "";
const num = v => +String(v || "").replace(/[^\d]/g, "") || 0;
const nowISO = () => new Date().toISOString();
const store = (k, v) => { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
const load = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };

let db = null, etag = null, pendingAck = [], view = "today";

/* ---------- server ---------- */
async function api(path, opts = {}) {
  const r = await fetch("/api/crm/" + path, { credentials: "same-origin", headers: { "content-type": "application/json" }, ...opts });
  let body = {};
  try { body = await r.json(); } catch (e) {}
  return { status: r.status, body };
}
function setState(t, bad) { const s = $id("saveState"); s.textContent = t; s.classList.toggle("bad", !!bad); }

async function fetchBook() {
  const r = await api("data");
  if (r.status === 401) { showSignin(); return false; }
  if (r.status !== 200) { setState("Can't reach the server", true); return false; }
  const fresh = !r.body.db;
  db = r.body.db || { contacts: [], deals: [], meta: [], v: 1 };
  db.contacts = db.contacts || []; db.deals = db.deals || []; db.meta = db.meta || [];
  etag = r.body.etag;
  const n = foldInbox(r.body.inbox || []);
  if (fresh || (r.body.inbox || []).length) queueSave(0);
  if (n) toast(n === 1 ? "1 new lead came in" : n + " new leads came in");
  return true;
}

function foldInbox(items) {
  let n = 0;
  for (const it of items) {
    if (pendingAck.includes(it.id)) continue;
    pendingAck.push(it.id); n++;
    if (it.kind === "email") {
      db.mail = db.mail || { last: null, recent: [] };
      if (!db.mail.last || it.checkedAt > db.mail.last) db.mail.last = it.checkedAt;
      for (const m of it.items || []) {
        const d = db.deals.find(x => x.id === m.deal); if (!d) continue;
        d.mailIds = d.mailIds || []; if (m.id && d.mailIds.includes(m.id)) continue;
        if (m.id) d.mailIds.push(m.id);
        d.ups = d.ups || [];
        d.ups.unshift({ t: m.date || it.checkedAt, src: "email", x: m.subject + " (from " + shortFrom(m.from) + ")" + (m.snippet ? ": " + m.snippet.slice(0, 180) : "") });
        db.mail.recent.unshift({ deal: d.id, subject: m.subject, from: shortFrom(m.from), t: m.date || it.checkedAt });
      }
      db.mail.recent = db.mail.recent.slice(0, 12);
      n--; continue;
    }
    if (it.kind === "meta") {
      db.meta.push({ id: uid(), first: it.first || "", last: it.last || "", phone: it.phone || "", email: it.email || "", ad: it.ad || "", campaign: it.campaign || "", t: it.received || nowISO(), a: it.answers || {}, isNew: true, auto: true });
      continue;
    }
    const source = it.kind === "search" ? "Home search" : "Contact form";
    const em = (it.email || "").toLowerCase(), ph = digits(it.phone);
    const note = it.kind === "search" ? "Signed up on home search" + (it.consent ? " (agreed to be contacted)" : "") + "."
      : "Sent the contact form" + (it.reason ? " about " + it.reason.toLowerCase() : "") + "." + (it.message ? " Message: " + it.message : "");
    const found = db.contacts.find(c => (em && (c.email || "").toLowerCase() === em) || (ph && digits(c.phone) === ph));
    if (found) { addLog(found, "note", note, it.received); found.follow = found.follow && found.follow < rel(0) ? found.follow : rel(0); found.followNote = found.followNote || "Reply to new " + source.toLowerCase() + " request"; continue; }
    const type = it.reason === "Buying" ? "Buyer" : it.reason === "Both" ? "Both" : it.kind === "search" ? "Buyer" : "Seller";
    db.contacts.push({ id: uid(), first: it.first || "", last: it.last || "", phone: it.phone || "", email: it.email || "", type, source, stage: "New lead",
      tags: it.reason === "Home value" ? ["Home evaluation"] : [], follow: rel(0), followNote: "Call new lead", crit: {}, log: [{ t: it.received || nowISO(), k: "note", x: note }], created: it.received || nowISO() });
  }
  return n;
}

let saveTimer = null, saving = false, again = false;
function queueSave(ms = 700) { setState("Saving…"); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, ms); }
async function saveNow() {
  if (saving) { again = true; return; }
  saving = true;
  try {
    db.updated = nowISO();
    let r = await api("data", { method: "PUT", body: JSON.stringify({ db, etag, ack: pendingAck }) });
    if (r.status === 409) {
      // another device saved first: keep this device's book (last change wins) but pick up any new leads
      const latest = await api("data");
      if (latest.status === 200) { etag = latest.body.etag; foldInbox(latest.body.inbox || []); }
      r = await api("data", { method: "PUT", body: JSON.stringify({ db, etag, ack: pendingAck }) });
    }
    if (r.status === 401) { showSignin(); return; }
    if (r.status !== 200) throw new Error("save " + r.status);
    etag = r.body.etag; pendingAck = [];
    setState("Saved");
  } catch (e) {
    setState("Not saved. Check your connection.", true);
    clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 5000);
  } finally {
    saving = false;
    if (again) { again = false; saveNow(); }
  }
}
window.addEventListener("beforeunload", e => { if (saving || $id("saveState").textContent === "Saving…") { e.preventDefault(); e.returnValue = ""; } });
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && db && !saving && $id("saveState").textContent !== "Saving…" && !openId) { if (await fetchBook()) render(); }
});
const save = () => { queueSave(); };

/* ---------- sign in ---------- */
function showSignin() { $id("app").hidden = true; $id("signin").hidden = false; closeSheet(true); setTimeout(() => $id("pin").focus(), 50); }
$id("pinForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $id("pinBtn"), err = $id("pinErr");
  btn.disabled = true; btn.textContent = "Checking…"; err.textContent = "";
  try {
    const r = await api("login", { method: "POST", body: JSON.stringify({ pin: $id("pin").value }) });
    if (r.status === 200) { $id("pin").value = ""; await start(); }
    else if (r.status === 429) err.textContent = "Too many tries. Try again in " + r.body.minutes + " minutes.";
    else if (r.status === 401) err.textContent = "That PIN isn't right." + (r.body.left && r.body.left <= 3 ? " " + r.body.left + " tries left before a short lock." : "");
    else err.textContent = "Couldn't reach the server. Check your connection and try again.";
  } catch (e2) { err.textContent = "Couldn't reach the server. Check your connection and try again."; }
  btn.disabled = false; btn.textContent = "Open";
});

async function start() {
  if (!(await fetchBook())) return;
  $id("signin").hidden = true; $id("app").hidden = false;
  const t = load("crm-tab");
  show(VIEWS.includes(t) ? t : "today");
  setState("Saved");
}

/* ---------- helpers ---------- */
const byId = id => db.contacts.find(c => c.id === id);
const name = c => ((c.first || "") + " " + (c.last || "")).trim() || "No name";
const initials = c => (((c.first || "?")[0] || "") + ((c.last || "")[0] || "")).toUpperCase();
const isDue = c => c.follow && c.follow <= iso(today());
const daysTo = d => d ? Math.round((new Date(d + "T00:00") - today()) / DAY) : null;
const dueLabel = c => { if (!c.follow) return ""; const d = daysTo(c.follow);
  return d < 0 ? (d === -1 ? "Yesterday" : (-d) + " days late") : d === 0 ? "Today" : d === 1 ? "Tomorrow" : new Date(c.follow + "T00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" }); };
const typePill = c => `<span class="pill ${c.type === "Seller" ? "seller" : c.type === "Buyer" ? "buyer" : ""}">${esc(c.type)}</span>`;
const webSrc = s => s === "Home search" || s === "Contact form" || s === "Meta ad";
function shortFrom(f) { const m = String(f || "").match(/^\s*"?([^"<]+?)"?\s*</); return (m ? m[1] : String(f || "")).trim(); }
function digits(p) { let d = String(p || "").replace(/\D/g, ""); if (d.length === 10) d = "1" + d; return d; }
function timeAgo(t) { const h = Math.round((Date.now() - new Date(t)) / 36e5); if (h < 1) return "just now"; if (h < 24) return h + "h ago"; const d = Math.round(h / 24); return d === 1 ? "yesterday" : d + " days ago"; }
function addLog(c, k, x, t) { (c.log = c.log || []).unshift({ id: uid(), t: t || nowISO(), k, x }); }
function toast(m) { const t = $id("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 2200); }
const opt = (list, cur) => list.map(s => `<option${s === cur ? " selected" : ""}>${esc(s)}</option>`).join("");

/* ---------- views ---------- */
function show(v) {
  view = v;
  document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", t.dataset.v === (v === "import" ? "contacts" : v)));
  VIEWS.forEach(k => $id("v-" + k).hidden = k !== v);
  render(); store("crm-tab", v === "import" ? "contacts" : v); window.scrollTo(0, 0);
}
document.querySelectorAll(".tab").forEach(t => t.onclick = () => show(t.dataset.v));

function render() {
  if (!db) return;
  const due = db.contacts.filter(isDue).length;
  const n = $id("dueCount"); n.textContent = due || ""; n.hidden = !due;
  const mn = db.meta.filter(m => m.isNew).length, m = $id("metaCount"); m.textContent = mn || ""; m.hidden = !mn;
  ({ today: renderToday, pipeline: renderPipeline, deals: renderDeals, meta: renderMeta, contacts: renderContacts, import: renderImport })[view]();
}

function row(c, extra) {
  return `<div class="row" data-open="${c.id}" tabindex="0"><div class="av">${esc(initials(c))}</div>
  <div class="who"><b>${esc(name(c))}</b><small>${esc(extra)}</small></div><div class="side">${typePill(c)}</div></div>`;
}

function renderToday() {
  const el = $id("v-today");
  const due = db.contacts.filter(isDue).sort((a, b) => a.follow.localeCompare(b.follow));
  const fresh = db.contacts.filter(c => c.stage === "New lead").sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  const active = db.contacts.filter(c => !["New lead", "Closed"].includes(c.stage)).length;
  const week = db.contacts.filter(c => c.follow && c.follow > iso(today()) && c.follow <= rel(7)).sort((a, b) => a.follow.localeCompare(b.follow));
  const firm = db.deals.filter(d => d.status === "Firm").length;
  const empty = !db.contacts.length && !db.deals.length;
  el.innerHTML = `
  <div class="sec-h"><h2>${new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}</h2></div>
  ${empty ? `<div class="card welcome"><h3>Welcome to your client book</h3>
    <p class="muted">Sign-ups from your home search and your contact form will show up here on their own. To get started, add a client, bring in your contacts from a spreadsheet, or add a deal you're working on.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-act="new-contact">+ New contact</button><button class="btn" data-act="import">Import contacts</button><button class="btn" data-act="new-deal">+ New deal</button></div></div>` : ""}
  <div class="stats">
    <div class="card stat hot"><b>${due.length}</b><span>Follow-ups due</span></div>
    <div class="card stat"><b>${fresh.length}</b><span>New leads</span></div>
    <div class="card stat"><b>${active}</b><span>Active clients</span></div>
    <div class="card stat"><b>${firm}</b><span>Firm deals</span></div>
  </div>
  <div class="today-grid">
    <div style="display:grid;gap:12px;min-width:0">
      <div class="sec-h"><h2>Follow up today</h2><span class="meta">Tick to mark done</span></div>
      <div class="card list">${due.length ? due.map(c => `<div class="row" data-open="${c.id}" tabindex="0">
        <button class="check" data-done="${c.id}" aria-label="Mark ${esc(name(c))} done"></button>
        <div class="who"><b>${esc(name(c))}</b><small>${esc(c.followNote || "Follow up")}</small></div>
        <div class="side"><span class="pill due">${dueLabel(c)}</span></div></div>`).join("") : `<p class="empty">You're all caught up.</p>`}</div>
      <div class="sec-h"><h2>Coming up this week</h2></div>
      <div class="card list">${week.length ? week.map(c => row(c, dueLabel(c) + " · " + (c.followNote || "Follow up"))).join("") : `<p class="empty">Nothing booked in the next 7 days.</p>`}</div>
    </div>
    <div style="display:grid;gap:12px;min-width:0">
      <div class="sec-h"><h2>New leads</h2><span class="meta">From your website and ads</span></div>
      <div class="card list">${fresh.length ? fresh.map(c => `<div class="row" data-open="${c.id}" tabindex="0">
        <div class="av">${esc(initials(c))}</div>
        <div class="who"><b>${esc(name(c))}</b><small>${esc(c.phone || c.email)} · ${timeAgo(c.created)}</small></div>
        <div class="side"><span class="pill ${webSrc(c.source) ? "web" : ""}">${esc(c.source)}</span></div></div>`).join("") : `<p class="empty">No new leads right now.</p>`}</div>
      <div class="sec-h"><h2>Deals to watch</h2></div>
      <div class="card list">${dealsToWatch()}</div>
      <div class="sec-h"><h2>From your inbox</h2></div>
      ${inboxCard()}
    </div>
  </div>`;
}

function dealsToWatch() {
  const ds = db.deals.filter(d => d.status !== "Closed").map(d => ({ d, k: keyDate(d) })).filter(x => x.k[1] && daysTo(x.k[1]) >= 0 && daysTo(x.k[1]) <= 14).sort((a, b) => a.k[1].localeCompare(b.k[1]));
  return ds.length ? ds.map(({ d, k }) => `<div class="row" data-deal="${d.id}" tabindex="0"><div class="av">${d.side === "Seller" ? "S" : "B"}</div>
    <div class="who"><b>${esc(d.addr)}</b><small>${k[0]} ${inDays(daysTo(k[1])).toLowerCase()}</small></div><div class="side"><span class="pill ${stCls(d.status)}">${d.status}</span></div></div>`).join("")
    : `<p class="empty">No deadlines in the next two weeks.</p>`;
}

function inboxCard() {
  const m = db.mail;
  if (!m || !m.last) return `<div class="card inbox"><div class="inbox-h"><span class="dot" style="background:var(--muted);box-shadow:0 0 0 4px var(--surface-2)"></span><h3>Email check not connected yet</h3></div>
  <p class="muted" style="font-size:14px">Once your Gmail is connected, your inbox is read at 8 AM and 2 PM and anything about one of your deals (offers, deposits, lawyers, lenders) is added to that deal and listed here.</p>
  <div><button class="btn" data-act="connections">Connect Gmail</button></div></div>`;
  const last = new Date(m.last);
  const when = last.toLocaleString("en-CA", { weekday: "short", hour: "numeric", minute: "2-digit" });
  const recent = (m.recent || []).slice(0, 5);
  return `<div class="card inbox"><div class="inbox-h"><span class="dot"></span><h3>Email check, ${esc(when)}</h3><span class="meta">Runs at 8 AM and 2 PM</span></div>
  ${recent.length ? recent.map(r => { const d = db.deals.find(x => x.id === r.deal); return `<div class="inbox-item" ${d ? `data-deal="${d.id}"` : ""}><span class="ic">@</span><div>${esc(r.subject || "(no subject)")}<small>${esc(r.from)}${d ? " · added to " + esc(d.addr) : ""}</small></div></div>`; }).join("")
    : `<p class="muted" style="font-size:14px">No emails about your open deals yet.</p>`}</div>`;
}

/* ---------- connections ---------- */
async function openConnections() {
  openId = "__conn";
  sheet.innerHTML = `<div class="sheet-h"><h2>Connections</h2><button class="x" aria-label="Close">×</button></div><p class="muted">Loading…</p>`;
  openPanel(); sheet.querySelector(".x").onclick = () => closeSheet();
  const r = await api("setup");
  if (r.status !== 200) { sheet.querySelector("p").textContent = "Couldn't load your connection details. Try again in a moment."; return; }
  const { key, base } = r.body;
  const script = gmailScript(base, key);
  const m = db.mail, autoMeta = db.meta.filter(x => x.auto).length;
  sheet.innerHTML = `<div class="sheet-h"><h2>Connections</h2><button class="x" aria-label="Close">×</button></div>
  <div class="card box"><div class="inbox-h"><span class="dot" ${m && m.last ? "" : 'style="background:var(--muted);box-shadow:0 0 0 4px var(--surface-2)"'}></span><h3>Gmail check</h3>
    <span class="meta">${m && m.last ? "Last ran " + esc(new Date(m.last).toLocaleString("en-CA", { weekday: "short", hour: "numeric", minute: "2-digit" })) : "Not connected"}</span></div>
    <p class="muted" style="font-size:14px">A small script runs inside your own Google account at 8 AM and 2 PM. It looks for emails about your open deals (the street address, the MLS number or your client's email) and sends only the sender, subject and first lines here. Nobody else gets access to your Gmail.</p>
    <ol class="steps">
      <li>On a computer, signed in to the Gmail you use for work, open <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com</a>. A new project opens.</li>
      <li>Delete what's in the editor, then tap <b>Copy script</b> below and paste it in.</li>
      <li>Click the save icon. Name it <b>Client book email check</b>.</li>
      <li>In the menu next to <b>Run</b>, pick <b>setup</b>, then click <b>Run</b>.</li>
      <li>Google asks for permission. Click <b>Review permissions</b>, pick your account, then <b>Advanced</b> and <b>Go to Client book email check</b>, then <b>Allow</b>. (Google shows this warning for any script you write yourself.)</li>
      <li>That's it. Come back here: the dot turns green after the first check.</li>
    </ol>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="cpScript">Copy script</button><button class="btn ghost" id="showScript">Show script</button></div>
    <textarea class="paste" id="scriptBox" readonly hidden style="min-height:220px">${esc(script)}</textarea>
  </div>
  <div class="card box"><div class="inbox-h"><span class="dot" ${autoMeta ? "" : 'style="background:var(--muted);box-shadow:0 0 0 4px var(--surface-2)"'}></span><h3>Meta lead ads</h3><span class="meta">${autoMeta ? autoMeta + " leads received" : "Not connected"}</span></div>
    <p class="muted" style="font-size:14px">Uses a free Make.com account to pass each new Facebook or Instagram lead form straight to your Meta leads tab.</p>
    <ol class="steps">
      <li>Sign up at <a href="https://www.make.com/en/register" target="_blank" rel="noopener">make.com</a> (the free plan is enough) and click <b>Create a new scenario</b>.</li>
      <li>Add <b>Facebook Lead Ads</b>, choose <b>Watch New Leads</b>, connect your Facebook account, then pick your business page and lead form.</li>
      <li>Click the + after it and add <b>HTTP</b>, choose <b>Make a request</b>.</li>
      <li>URL: paste the address below. Method: <b>POST</b>.</li>
      <li>Under Headers, add one: Name <b>x-crm-key</b>, Value: paste your key below.</li>
      <li>Body type: <b>Raw</b>, Content type: <b>JSON</b>. Paste the body below, then click into each <b>{{ }}</b> spot and swap it for the matching field from the Facebook step.</li>
      <li>Turn the scenario <b>On</b>. New leads show up here within a minute.</li>
    </ol>
    <div class="field"><label>Address (URL)</label><div class="inline-add"><input readonly value="${esc(base)}/lead" id="cpUrlV"><button class="btn" data-copy="cpUrlV">Copy</button></div></div>
    <div class="field"><label>Your key (keep it private)</label><div class="inline-add"><input readonly value="${esc(key)}" id="cpKeyV"><button class="btn" data-copy="cpKeyV">Copy</button></div></div>
    <div class="field"><label>Body</label><textarea class="paste" id="cpBodyV" readonly style="min-height:150px">${esc(META_BODY)}</textarea><div><button class="btn" data-copy="cpBodyV">Copy body</button></div></div>
  </div>`;
  sheet.querySelector(".x").onclick = () => closeSheet();
  const copy = async (text, label) => { try { await navigator.clipboard.writeText(text); toast(label === "Copied" ? "Copied" : label + " copied"); } catch (e) { toast("Select it and copy by hand"); } };
  sheet.querySelector("#cpScript").onclick = () => copy(script, "Script");
  sheet.querySelector("#showScript").onclick = () => { const b = sheet.querySelector("#scriptBox"); b.hidden = !b.hidden; };
  sheet.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => copy(sheet.querySelector("#" + b.dataset.copy).value, "Copied"));
}
const META_BODY = `{
  "full_name": "{{full_name}}",
  "email": "{{email}}",
  "phone_number": "{{phone_number}}",
  "ad_name": "{{ad_name}}",
  "campaign_name": "{{campaign_name}}",
  "answers": {
    "Question 1": "{{answer 1}}",
    "Question 2": "{{answer 2}}"
  }
}`;
function gmailScript(base, key) {
  return `// Client book email check for gentianhysenaj.com/crm
// Runs at about 8 AM and 2 PM (Toronto time). Looks for emails about your open deals
// and sends the sender, subject and first lines to your client book. Nothing else leaves Gmail.
const CRM = "${base}/hook";
const KEY = "${key}";

function checkInbox() {
  const res = UrlFetchApp.fetch(CRM + "/deals", { headers: { "x-crm-key": KEY } });
  const deals = JSON.parse(res.getContentText()).deals || [];
  const props = PropertiesService.getScriptProperties();
  const since = Number(props.getProperty("since")) || (Date.now() - 3 * 86400000);
  const started = Date.now();
  const seen = {};
  const items = [];
  deals.forEach(function (d) {
    const terms = [];
    const street = String(d.addr).split(",")[0].trim();
    if (street) terms.push('"' + street.replace(/"/g, "") + '"');
    if (d.mls) terms.push('"' + d.mls + '"');
    if (d.email) terms.push("from:" + d.email, "to:" + d.email);
    if (!terms.length) return;
    const q = "(" + terms.join(" OR ") + ") after:" + Math.floor(since / 1000) + " -in:chats";
    GmailApp.search(q, 0, 25).forEach(function (thread) {
      thread.getMessages().forEach(function (m) {
        if (m.getDate().getTime() < since) return;
        const id = m.getId();
        if (seen[d.id + id]) return;
        seen[d.id + id] = true;
        items.push({ deal: d.id, id: id, from: m.getFrom(), subject: m.getSubject(),
          snippet: m.getPlainBody().replace(/\\s+/g, " ").slice(0, 300), date: m.getDate().toISOString() });
      });
    });
  });
  UrlFetchApp.fetch(CRM + "/email", { method: "post", contentType: "application/json", headers: { "x-crm-key": KEY },
    payload: JSON.stringify({ items: items.slice(0, 150), checkedAt: new Date(started).toISOString() }) });
  props.setProperty("since", String(started));
}

// Run this once. It sets up the 8 AM and 2 PM checks and does a first check right away.
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("checkInbox").timeBased().atHour(8).everyDays(1).inTimezone("America/Toronto").create();
  ScriptApp.newTrigger("checkInbox").timeBased().atHour(14).everyDays(1).inTimezone("America/Toronto").create();
  checkInbox();
}
`;
}

/* ---------- pipeline ---------- */
function renderPipeline() {
  const el = $id("v-pipeline");
  el.innerHTML = `<div class="sec-h"><h2>Pipeline</h2><span class="board-hint">Drag a client to move them, or open them and change the stage.</span></div>
  <div class="board">${STAGES.map(s => { const cs = db.contacts.filter(c => c.stage === s); return `<div class="col" data-stage="${s}">
    <h3><b>${s}</b><span>${cs.length}</span></h3>
    ${cs.map(c => `<div class="deal" draggable="true" data-id="${c.id}" data-open="${c.id}" tabindex="0">
      <b>${esc(name(c))}</b>
      <div class="l">${typePill(c)}${c.follow ? `<span class="pill ${isDue(c) ? "due" : ""}">${dueLabel(c)}</span>` : ""}</div>
      ${c.crit && c.crit.max ? `<small>${money(c.crit.min)} to ${money(c.crit.max)}${c.crit.areas ? " · " + esc(c.crit.areas) : ""}</small>` : `<small>${esc(c.source)}</small>`}
    </div>`).join("")}</div>`; }).join("")}</div>`;
  el.querySelectorAll(".deal").forEach(d => {
    d.addEventListener("dragstart", e => { d.classList.add("dragging"); e.dataTransfer.setData("text/plain", d.dataset.id); });
    d.addEventListener("dragend", () => d.classList.remove("dragging"));
  });
  el.querySelectorAll(".col").forEach(col => {
    col.addEventListener("dragover", e => { e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave", () => col.classList.remove("over"));
    col.addEventListener("drop", e => { e.preventDefault(); col.classList.remove("over"); const c = byId(e.dataTransfer.getData("text/plain"));
      if (c && c.stage !== col.dataset.stage) { addLog(c, "note", "Moved from " + c.stage + " to " + col.dataset.stage); c.stage = col.dataset.stage; save(); render(); toast(c.first + " moved to " + c.stage); } });
  });
}

/* ---------- contacts ---------- */
let q = "", filt = "All";
function renderContacts() {
  const el = $id("v-contacts");
  if (!el.firstChild) {
    el.innerHTML = `<div class="sec-h"><h2>Contacts</h2><span style="display:flex;gap:10px;align-items:center"><span class="meta" id="cCount"></span><button class="btn" data-act="import">Import</button></span></div>
    <div class="filters"><input class="search" id="q" type="search" placeholder="Search name, phone, email, area or tag" aria-label="Search contacts">
    ${["All", "Buyer", "Seller", "Website leads", "Active", "Past clients"].map(f => `<button class="chip" data-f="${f}">${f}</button>`).join("")}</div>
    <div class="card list" id="cList"></div>`;
    el.querySelector("#q").oninput = e => { q = e.target.value.toLowerCase(); renderContacts(); };
    el.querySelectorAll(".chip").forEach(b => b.onclick = () => { filt = b.dataset.f; renderContacts(); });
  }
  el.querySelectorAll(".chip").forEach(b => b.setAttribute("aria-pressed", b.dataset.f === filt));
  const cs = db.contacts.filter(c => {
    if (filt === "Buyer" && c.type === "Seller") return false;
    if (filt === "Seller" && c.type === "Buyer") return false;
    if (filt === "Website leads" && !webSrc(c.source)) return false;
    if (filt === "Active" && ["New lead", "Closed"].includes(c.stage)) return false;
    if (filt === "Past clients" && !(c.stage === "Closed" || c.source === "Past client")) return false;
    if (!q) return true;
    return [name(c), c.phone, c.email, c.source, (c.tags || []).join(" "), c.crit && c.crit.areas].join(" ").toLowerCase().includes(q);
  }).sort((a, b) => name(a).localeCompare(name(b)));
  el.querySelector("#cCount").textContent = cs.length + " of " + db.contacts.length;
  el.querySelector("#cList").innerHTML = cs.length ? cs.map(c => row(c, c.stage + (c.phone ? " · " + c.phone : ""))).join("")
    : `<p class="empty">${db.contacts.length ? "No one matches. Try another search." : "No contacts yet. Add one with + New contact, or import a spreadsheet."}</p>`;
}

/* ---------- import ---------- */
let staged = [];
function renderImport() {
  const el = $id("v-import");
  el.innerHTML = `<div><button class="btn ghost" data-go="contacts" style="padding-left:0">← Contacts</button></div><div class="sec-h"><h2>Import contacts</h2><span class="meta">From Excel, Google Sheets or your phone's contacts export</span></div>
  <div class="import">
    <div class="card box">
      <div class="drop" id="drop"><b>Drop a CSV file here</b><span class="muted">Columns like Name, First name, Last name, Email and Phone are picked up on their own.</span>
        <label class="btn" for="file">Choose file</label><input id="file" type="file" accept=".csv,text/csv,.txt" hidden></div>
      <div class="field"><label for="paste">Or paste rows from a spreadsheet</label>
      <textarea class="paste" id="paste" placeholder="First name, Last name, Email, Phone&#10;Lina, Haddad, lina@example.com, 416-555-0101"></textarea></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end"><button class="btn" id="readPaste">Read pasted rows</button>
        <div class="field"><label for="impStage">Add at stage</label><select id="impStage">${opt(STAGES, "Contacted")}</select></div>
        <div class="field"><label for="impSrc">How you know them</label><select id="impSrc">${opt(SOURCES, "Sphere")}</select></div></div>
    </div>
    <div class="card box"><h3>${staged.length ? staged.length + " contacts read" : "Nothing read yet"}</h3>
      ${staged.length ? `<div class="tbl-wrap"><table><tr><th>Name</th><th>Email</th><th>Phone</th><th></th></tr>
      ${staged.map(s => `<tr><td>${esc(s.first + " " + s.last)}</td><td>${esc(s.email)}</td><td>${esc(s.phone)}</td><td>${s.dup ? `<span class="pill due">Already in book</span>` : ""}</td></tr>`).join("")}</table></div>
      <div><button class="btn primary" id="doImport">Add ${staged.filter(s => !s.dup).length} to client book</button> <button class="btn ghost" id="clearImp">Clear</button></div>`
      : `<p class="muted">Pick a file or paste rows and you'll see them here before anything is added. People already in your book are skipped.</p>`}
    </div></div>`;
  const drop = el.querySelector("#drop");
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) readFile(f); };
  el.querySelector("#file").onchange = e => { const f = e.target.files[0]; if (f) readFile(f); };
  el.querySelector("#readPaste").onclick = () => parse(el.querySelector("#paste").value);
  const d = el.querySelector("#doImport");
  if (d) d.onclick = () => { const st = el.querySelector("#impStage").value, src = el.querySelector("#impSrc").value; let n = 0;
    staged.filter(s => !s.dup).forEach(s => { db.contacts.push({ id: uid(), first: s.first, last: s.last, email: s.email, phone: s.phone, type: "Buyer", source: src, stage: st, tags: [], follow: null, followNote: "", crit: {}, log: [{ id: uid(), t: nowISO(), k: "note", x: "Imported." }], created: nowISO() }); n++; });
    staged = []; save(); toast(n + " contacts added"); show("contacts"); };
  const c = el.querySelector("#clearImp"); if (c) c.onclick = () => { staged = []; render(); };
}
function readFile(f) { const r = new FileReader(); r.onload = () => parse(r.result); r.readAsText(f); }
function splitLine(l, sep) { const out = []; let cur = "", inq = false; for (const ch of l) { if (ch === '"') inq = !inq; else if (ch === sep && !inq) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map(s => s.trim()); }
function parse(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim()); if (!lines.length) { toast("Nothing to read"); return; }
  const sep = lines[0].includes("\t") ? "\t" : ",";
  let head = splitLine(lines[0], sep).map(h => h.toLowerCase());
  const has = head.some(h => /name|mail|phone|mobile/.test(h));
  const rows = (has ? lines.slice(1) : lines).map(l => splitLine(l, sep));
  if (!has) head = ["first name", "last name", "email", "phone"];
  const find = re => head.findIndex(h => re.test(h));
  const iF = find(/first|given/), iL = find(/last|family|surname/), iN = find(/^name$|full name|display name/), iE = find(/mail/), iP = find(/phone|mobile|cell/);
  const known = new Set(db.contacts.flatMap(c => [(c.email || "").toLowerCase(), digits(c.phone)]).filter(Boolean));
  staged = rows.map(r => { let first = iF >= 0 ? r[iF] || "" : "", last = iL >= 0 ? r[iL] || "" : "";
    if (!first && iN >= 0) { const p = (r[iN] || "").split(/\s+/); first = p.shift() || ""; last = p.join(" "); }
    const email = iE >= 0 ? r[iE] || "" : "", phone = iP >= 0 ? r[iP] || "" : "";
    const dup = (email && known.has(email.toLowerCase())) || (phone && known.has(digits(phone)));
    return { first, last, email, phone, dup }; }).filter(s => s.first || s.email || s.phone);
  render();
}
function exportCSV() {
  const cols = ["First name", "Last name", "Phone", "Email", "Type", "Source", "Stage", "Tags", "Next follow-up", "Follow-up note", "Added"];
  const q2 = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const lines = [cols.map(q2).join(",")].concat(db.contacts.map(c => [c.first, c.last, c.phone, c.email, c.type, c.source, c.stage, (c.tags || []).join("; "), c.follow || "", c.followNote || "", (c.created || "").slice(0, 10)].map(q2).join(",")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  a.download = "client-book-" + iso(new Date()) + ".csv"; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- sheet (side panel) ---------- */
const sheet = $id("sheet"), scrim = $id("scrim");
let openId = null, logKind = "call";
function openPanel() { sheet.classList.add("on"); scrim.classList.add("on"); sheet.setAttribute("aria-hidden", "false"); sheet.scrollTop = 0; setTimeout(() => { const x = sheet.querySelector(".x"); if (x) x.focus(); }, 60); }
function closeSheet(quiet) { sheet.classList.remove("on"); scrim.classList.remove("on"); sheet.setAttribute("aria-hidden", "true"); openId = null; if (!quiet) render(); }
scrim.onclick = () => closeSheet();
document.addEventListener("keydown", e => { if (e.key === "Escape" && openId) closeSheet(); });
const I = {
  call: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/></svg>',
  wa: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21l1.6-4.6A9 9 0 1 1 8 19.6z"/><path d="M9 9c0 3 3 6 6 6l1-1.5-2-1-1 .8a4 4 0 0 1-2.3-2.3l.8-1-1-2z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>' };
function calLink(title, date, details) { if (!date) return ""; const d = date.replace(/-/g, ""); const n = new Date(date + "T00:00"); n.setDate(n.getDate() + 1);
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(title) + "&dates=" + d + "/" + iso(n).replace(/-/g, "") + "&details=" + encodeURIComponent(details || ""); }
function confirmRow(label, onYes) {
  return { html: `<div><button class="btn ghost" data-del style="color:var(--due);padding-left:0">${label}</button><span data-delconf hidden> Sure? <button class="btn" data-delyes>Yes, remove</button> <button class="btn ghost" data-delno>Keep</button></span></div>`,
    wire: () => { const c = sheet.querySelector("[data-delconf]"); sheet.querySelector("[data-del]").onclick = () => c.hidden = false; sheet.querySelector("[data-delno]").onclick = () => c.hidden = true; sheet.querySelector("[data-delyes]").onclick = onYes; } };
}

function openContact(id) { openId = id; drawContact(); openPanel(); }
function drawContact() {
  const c = byId(openId); if (!c) return closeSheet(); const cr = c.crit || (c.crit = {});
  const showCrit = c.type !== "Seller", ph = digits(c.phone);
  const deals = db.deals.filter(d => d.client === c.id);
  const del = confirmRow("Remove this contact", () => { db.contacts = db.contacts.filter(x => x.id !== c.id); db.deals.forEach(d => { if (d.client === c.id) d.client = null; }); save(); closeSheet(); toast("Removed"); });
  sheet.innerHTML = `
  <div class="sheet-h"><div class="av">${esc(initials(c))}</div>
    <div style="min-width:0"><h2>${esc(name(c))}</h2><div class="tags" style="margin-top:4px">${typePill(c)}<span class="pill ${webSrc(c.source) ? "web" : ""}">${esc(c.source)}</span></div></div>
    <button class="x" aria-label="Close">×</button></div>
  <div class="quick">
    <a href="${ph ? "tel:+" + ph : "#"}" data-act-log="call">${I.call}Call</a>
    <a href="${ph ? "sms:+" + ph : "#"}" data-act-log="text">${I.text}Text</a>
    <a href="${ph ? "https://wa.me/" + ph : "#"}" target="_blank" rel="noopener" data-act-log="text">${I.wa}WhatsApp</a>
    <a href="${c.email ? "mailto:" + esc(c.email) : "#"}" data-act-log="email">${I.mail}Email</a></div>

  <div class="card box"><h3>Details</h3>
    <div class="grid2"><div class="field"><label for="e-first">First name</label><input id="e-first" value="${esc(c.first)}"></div>
    <div class="field"><label for="e-last">Last name</label><input id="e-last" value="${esc(c.last)}"></div></div>
    <div class="grid2"><div class="field"><label for="e-phone">Phone</label><input id="e-phone" type="tel" value="${esc(c.phone)}"></div>
    <div class="field"><label for="e-email">Email</label><input id="e-email" type="email" value="${esc(c.email)}"></div></div>
    <div class="grid2"><div class="field"><label for="e-src">How you met</label><select id="e-src">${opt(SOURCES.includes(c.source) ? SOURCES : SOURCES.concat(c.source), c.source)}</select></div>
    <div class="field"><label for="e-type">Client type</label><select id="e-type">${opt(["Buyer", "Seller", "Both"], c.type)}</select></div></div>
    <div class="field"><label for="e-addr">Home address</label><input id="e-addr" value="${esc(c.addr)}" placeholder="Where they live now"></div>
    <div class="grid2"><div class="field"><label for="e-bday">Birthday</label><input id="e-bday" type="date" value="${esc(c.bday)}"></div>
    <div class="field"><label>Added</label><input value="${c.created ? new Date(c.created).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : ""}" disabled></div></div>
  </div>

  <div class="card box"><h3>Where they are</h3>
    <div class="field"><label for="s-stage">Stage</label><select id="s-stage">${opt(STAGES, c.stage)}</select></div>
    <div class="field"><label>Tags</label><div class="tags">${(c.tags || []).map((t, i) => `<span class="pill">${esc(t)}<button data-rmtag="${i}" aria-label="Remove ${esc(t)}">×</button></span>`).join("")}<input id="s-newtag" placeholder="+ add tag, then Enter" aria-label="Add tag"></div></div>
  </div>

  <div class="card box"><h3>Next follow-up</h3>
    <div class="grid2"><div class="field"><label for="s-follow">Date</label><input type="date" id="s-follow" value="${c.follow || ""}"></div>
    <div class="field"><label for="s-fnote">What for</label><input id="s-fnote" value="${esc(c.followNote)}" placeholder="Call about showings"></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${[["Today", 0], ["Tomorrow", 1], ["In 3 days", 3], ["Next week", 7], ["In a month", 30]].map(([l, n]) => `<button class="btn" data-snooze="${n}">${l}</button>`).join("")}
    ${c.follow ? `<button class="btn ghost" data-clearfollow>Clear</button><a class="btn ghost" href="${calLink("Follow up: " + name(c), c.follow, (c.followNote || "") + "\n" + (c.phone || "") + "\n" + (c.email || ""))}" target="_blank" rel="noopener">Add to Google Calendar</a>` : ""}</div>
  </div>

  ${showCrit ? `<div class="card box"><h3>What they're looking for</h3>
    <div class="grid2"><div class="field"><label for="k-min">Min price</label><input id="k-min" inputmode="numeric" value="${cr.min ? money(cr.min) : ""}" placeholder="$700,000"></div>
    <div class="field"><label for="k-max">Max price</label><input id="k-max" inputmode="numeric" value="${cr.max ? money(cr.max) : ""}" placeholder="$850,000"></div>
    <div class="field"><label for="k-beds">Beds</label><input id="k-beds" value="${esc(cr.beds)}"></div>
    <div class="field"><label for="k-baths">Baths</label><input id="k-baths" value="${esc(cr.baths)}"></div></div>
    <div class="field"><label for="k-areas">Areas</label><input id="k-areas" value="${esc(cr.areas)}" placeholder="Leslieville, Riverdale"></div>
    <div class="field"><label for="k-notes">Must-haves</label><input id="k-notes" value="${esc(cr.notes)}" placeholder="Parking, close to the GO"></div>
    <div class="grid2"><div class="field"><label for="k-pre">Pre-approved</label><select id="k-pre">${opt(["Not yet", "Yes", "In progress"], cr.pre || "Not yet")}</select></div>
    <div class="field"><label for="k-when">Timeline</label><input id="k-when" value="${esc(cr.when)}" placeholder="By spring"></div></div></div>` : ""}

  <div class="card box"><h3>Deals</h3>
    ${deals.length ? deals.map(d => `<div class="row" data-deal="${d.id}" tabindex="0" style="padding:10px 0"><div class="av">${d.side === "Seller" ? "S" : "B"}</div><div class="who"><b>${esc(d.addr)}</b><small>${d.status}${d.price ? " · " + money(d.price) : ""}</small></div><div class="side"><span class="pill ${stCls(d.status)}">${d.status}</span></div></div>`).join("") : `<p class="muted">No deals yet.</p>`}
    <div><button class="btn" data-newdeal>+ New deal for ${esc(c.first || "this client")}</button></div></div>

  <div class="card box"><h3>Notes and activity</h3>
    <div class="composer"><div class="kinds">${Object.entries(KINDS).map(([k, l]) => `<button class="chip" data-kind="${k}" aria-pressed="${k === logKind}">${l}</button>`).join("")}</div>
    <textarea id="s-log" rows="2" placeholder="What happened?" style="width:100%;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface)"></textarea>
    <div><button class="btn primary" id="s-addlog">Save to log</button></div></div>
    <div class="log">${(c.log || []).length ? c.log.map((l, i) => `<div class="log-item"><i>${KI[l.k] || "N"}</i><div><button class="x-sm" data-rmlog="${i}" aria-label="Delete entry">×</button><small>${KINDS[l.k] || "Note"} · ${new Date(l.t).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>${esc(l.x)}</div></div>`).join("") : `<p class="muted">No activity yet.</p>`}</div>
  </div>
  ${del.html}`;

  const $ = s => sheet.querySelector(s);
  $(".x").onclick = () => closeSheet();
  const bind = (sel, key, fn) => { const el = $(sel); if (el) el.onchange = e => { c[key] = fn ? fn(e.target.value) : e.target.value.trim(); save(); if (["first", "last", "type", "source"].includes(key)) drawContact(); }; };
  bind("#e-first", "first"); bind("#e-last", "last"); bind("#e-phone", "phone"); bind("#e-email", "email"); bind("#e-src", "source"); bind("#e-type", "type"); bind("#e-addr", "addr"); bind("#e-bday", "bday");
  $("#s-stage").onchange = e => { addLog(c, "note", "Moved from " + c.stage + " to " + e.target.value); c.stage = e.target.value; save(); drawContact(); toast("Moved to " + c.stage); };
  $("#s-newtag").onkeydown = e => { if (e.key === "Enter" && e.target.value.trim()) { e.preventDefault(); (c.tags = c.tags || []).push(e.target.value.trim()); save(); drawContact(); $("#s-newtag").focus(); } };
  sheet.querySelectorAll("[data-rmtag]").forEach(b => b.onclick = () => { c.tags.splice(+b.dataset.rmtag, 1); save(); drawContact(); });
  $("#s-follow").onchange = e => { c.follow = e.target.value || null; save(); drawContact(); };
  $("#s-fnote").onchange = e => { c.followNote = e.target.value; save(); };
  sheet.querySelectorAll("[data-snooze]").forEach(b => b.onclick = () => { c.follow = rel(+b.dataset.snooze); save(); drawContact(); toast("Follow-up set for " + dueLabel(c).toLowerCase()); });
  const cf = $("[data-clearfollow]"); if (cf) cf.onclick = () => { c.follow = null; c.followNote = ""; save(); drawContact(); };
  if (showCrit) ["min", "max", "beds", "baths", "areas", "notes", "pre", "when"].forEach(k => $("#k-" + k).onchange = e => { cr[k] = (k === "min" || k === "max") ? num(e.target.value) : e.target.value; if (k === "min" || k === "max") e.target.value = cr[k] ? money(cr[k]) : ""; save(); });
  sheet.querySelectorAll("[data-kind]").forEach(b => b.onclick = () => { logKind = b.dataset.kind; sheet.querySelectorAll("[data-kind]").forEach(x => x.setAttribute("aria-pressed", x.dataset.kind === logKind)); });
  $("#s-addlog").onclick = () => { const v = $("#s-log").value.trim(); if (!v) return; addLog(c, logKind, v); if (c.stage === "New lead" && logKind !== "note") c.stage = "Contacted"; save(); drawContact(); toast("Saved"); };
  sheet.querySelectorAll("[data-rmlog]").forEach(b => b.onclick = () => { c.log.splice(+b.dataset.rmlog, 1); save(); drawContact(); });
  sheet.querySelectorAll("[data-act-log]").forEach(a => a.addEventListener("click", e => { if (a.getAttribute("href") === "#") { e.preventDefault(); toast("Add a " + (a.dataset.actLog === "email" ? "email address" : "phone number") + " first"); return; }
    addLog(c, a.dataset.actLog, a.textContent.trim() + " from the client book"); if (c.stage === "New lead") c.stage = "Contacted"; save(); setTimeout(drawContact, 300); }));
  $("[data-newdeal]").onclick = () => newDeal(c.id);
  del.wire();
}

function newContact() {
  openId = "__new";
  sheet.innerHTML = `<div class="sheet-h"><h2>New contact</h2><button class="x" aria-label="Close">×</button></div>
  <form class="card box" id="newF">
    <div class="grid2"><div class="field"><label for="n-first">First name</label><input id="n-first" required></div>
    <div class="field"><label for="n-last">Last name</label><input id="n-last"></div></div>
    <div class="field"><label for="n-phone">Phone</label><input id="n-phone" type="tel"></div>
    <div class="field"><label for="n-email">Email</label><input id="n-email" type="email"></div>
    <div class="grid2"><div class="field"><label for="n-type">Client type</label><select id="n-type">${opt(["Buyer", "Seller", "Both"], "Buyer")}</select></div>
    <div class="field"><label for="n-src">How you met</label><select id="n-src">${opt(SOURCES, "Referral")}</select></div></div>
    <div class="field"><label for="n-stage">Stage</label><select id="n-stage">${opt(STAGES, "New lead")}</select></div>
    <div><button class="btn primary" type="submit">Add to client book</button></div></form>`;
  openPanel();
  sheet.querySelector(".x").onclick = () => closeSheet();
  setTimeout(() => sheet.querySelector("#n-first").focus(), 80);
  sheet.querySelector("#newF").onsubmit = e => { e.preventDefault(); const v = id => sheet.querySelector(id).value.trim();
    const c = { id: uid(), first: v("#n-first"), last: v("#n-last"), phone: v("#n-phone"), email: v("#n-email"), type: v("#n-type"), source: v("#n-src"), stage: v("#n-stage"), tags: [], follow: rel(1), followNote: "First follow-up", crit: {}, log: [], created: nowISO() };
    db.contacts.push(c); save(); toast(c.first + " added"); openContact(c.id); };
}

/* ---------- deal desk ---------- */
let dfilt = "Active";
const dLabel = d => d ? new Date(d + "T00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric", year: new Date(d + "T00:00").getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }) : "—";
const inDays = n => n === null ? "" : n === 0 ? "Today" : n === 1 ? "Tomorrow" : n > 0 ? "In " + n + " days" : n === -1 ? "Yesterday" : (-n) + " days ago";
const stCls = s => "st-" + String(s).split(" ")[0];
const keyDate = d => d.status === "Offer in" ? ["Irrevocable", d.offer] : d.status === "Conditional" ? ["Conditions due", d.cond] : d.status === "Closed" ? ["Closed", d.close] : d.status === "Listing" ? ["Goes live", d.live] : ["Closing", d.close];
const nextStep = d => { const nd = (d.docs || []).find(x => !x.done); return nd ? nd.d : "All paperwork done"; };
function renderDeals() {
  const el = $id("v-deals");
  const groups = { Active: d => d.status !== "Closed", "Offers in": d => d.status === "Offer in" || d.status === "Conditional", Listings: d => d.side === "Seller" && d.status !== "Closed", Buyers: d => d.side === "Buyer" && d.status !== "Closed", "Past deals": d => d.status === "Closed" };
  const ds = db.deals.filter(groups[dfilt]).sort((a, b) => (keyDate(a)[1] || "9").localeCompare(keyDate(b)[1] || "9"));
  const yr = String(new Date().getFullYear());
  const vol = db.deals.filter(d => d.status === "Closed" && (d.close || "").startsWith(yr)).reduce((s, d) => s + (d.price || 0), 0);
  el.innerHTML = `<div class="sec-h"><h2>Deal desk</h2><span class="meta">Every property you're working on, its paperwork and what's next</span></div>
  <div class="stats">
    <div class="card stat hot"><b>${db.deals.filter(d => d.status === "Offer in").length}</b><span>Offers in</span></div>
    <div class="card stat"><b>${db.deals.filter(d => d.status === "Conditional").length}</b><span>Conditional</span></div>
    <div class="card stat"><b>${db.deals.filter(d => d.status === "Firm").length}</b><span>Firm, waiting to close</span></div>
    <div class="card stat"><b>${vol ? "$" + (vol / 1e6).toFixed(2) + "M" : "$0"}</b><span>Closed in ${yr}</span></div>
  </div>
  <div class="filters">${Object.keys(groups).map(f => `<button class="chip" data-df="${f}" aria-pressed="${f === dfilt}">${f}</button>`).join("")}
    <button class="btn primary" data-act="new-deal" style="margin-left:auto">+ New deal</button></div>
  <div class="deals">${ds.length ? ds.map(d => { const c = byId(d.client); const docs = d.docs || []; const done = docs.filter(x => x.done).length; const k = keyDate(d); const n = daysTo(k[1]);
    return `<button class="dcard" data-deal="${d.id}">
      <div class="top-l"><span class="pill ${stCls(d.status)}">${d.status}</span><span class="pill ${d.side === "Seller" ? "seller" : "buyer"}">${d.side === "Seller" ? "Selling" : "Buying"}</span></div>
      <div><div class="addr">${esc(d.addr || "Untitled property")}</div><div class="sub">${esc([d.area, c ? name(c) : ""].filter(Boolean).join(" · "))}</div></div>
      <div class="price">${d.price ? money(d.price) : d.list ? "List " + money(d.list) : "No price yet"}</div>
      <div><div class="bar-l"><span>Paperwork</span><span>${done} of ${docs.length}</span></div><div class="bar"><i style="width:${docs.length ? done / docs.length * 100 : 0}%"></i></div></div>
      <div class="next">${k[1] ? `<span class="pill ${n !== null && n >= 0 && n <= 3 && d.status !== "Closed" ? "due" : ""}">${k[0]}: ${inDays(n)}</span>` : ""}<span class="muted">Next: ${esc(nextStep(d))}</span></div>
    </button>`; }).join("") : `<p class="empty">${db.deals.length ? "No deals in this list." : "No deals yet. Add the first property you're working on with + New deal."}</p>`}</div>
  ${inboxCard()}`;
  el.querySelectorAll("[data-df]").forEach(b => b.onclick = () => { dfilt = b.dataset.df; renderDeals(); });
}
function openDeal(id) { openId = "deal:" + id; drawDeal(id); openPanel(); }
function drawDeal(id) {
  const d = db.deals.find(x => x.id === id); if (!d) return closeSheet();
  d.docs = d.docs || []; d.ups = d.ups || [];
  const done = d.docs.filter(x => x.done).length, pct = d.docs.length ? Math.round(done / d.docs.length * 100) : 0;
  const dt = (l, v) => { const n = daysTo(v); return `<div class="${n !== null && n >= 0 && n <= 3 && d.status !== "Closed" ? "soon" : ""}"><small>${l}</small><b>${dLabel(v)}</b><em>${inDays(n)}</em></div>`; };
  const clients = db.contacts.slice().sort((a, b) => name(a).localeCompare(name(b)));
  const del = confirmRow("Remove this deal", () => { db.deals = db.deals.filter(x => x.id !== d.id); save(); closeSheet(); toast("Deal removed"); });
  const k = keyDate(d);
  sheet.innerHTML = `<div class="sheet-h"><div style="min-width:0"><div class="tags"><span class="pill ${stCls(d.status)}">${d.status}</span><span class="pill ${d.side === "Seller" ? "seller" : "buyer"}">${d.side === "Seller" ? "Selling" : "Buying"}</span></div>
    <h2 style="margin-top:6px">${esc(d.addr || "Untitled property")}</h2><div class="muted">${esc(d.area || "")}</div></div><button class="x" aria-label="Close">×</button></div>
  <div class="dates">${dt("Offer date", d.offer)}${dt("Conditions due", d.cond)}${dt("Closing", d.close)}</div>
  <div class="card box"><h3>Property and client</h3>
    <div class="field"><label for="d-addr">Address</label><input id="d-addr" value="${esc(d.addr)}"></div>
    <div class="grid2"><div class="field"><label for="d-area">Neighbourhood</label><input id="d-area" value="${esc(d.area)}"></div>
    <div class="field"><label for="d-mls">MLS number</label><input id="d-mls" value="${esc(d.mls)}"></div></div>
    <div class="grid2"><div class="field"><label for="d-client">Client</label><select id="d-client"><option value="">No client</option>${clients.map(c => `<option value="${c.id}"${c.id === d.client ? " selected" : ""}>${esc(name(c))}</option>`).join("")}</select></div>
    <div class="field"><label for="d-side">You're</label><select id="d-side"><option value="Buyer"${d.side === "Buyer" ? " selected" : ""}>Buying for them</option><option value="Seller"${d.side === "Seller" ? " selected" : ""}>Selling for them</option></select></div></div>
    ${d.client && byId(d.client) ? `<div><button class="btn ghost" style="padding-left:0" data-open="${d.client}">Open ${esc(name(byId(d.client)))} →</button></div>` : ""}
  </div>
  <div class="card box"><h3>Status, price and dates</h3>
    <div class="grid2"><div class="field"><label for="d-st">Status</label><select id="d-st">${opt(DSTAT, d.status)}</select></div>
    <div class="field"><label for="d-list">List price</label><input id="d-list" inputmode="numeric" value="${d.list ? money(d.list) : ""}"></div>
    <div class="field"><label for="d-pr">${d.status === "Closed" ? "Sold for" : "Offer price"}</label><input id="d-pr" inputmode="numeric" value="${d.price ? money(d.price) : ""}"></div>
    <div class="field"><label for="d-dep">Deposit</label><input id="d-dep" inputmode="numeric" value="${d.dep ? money(d.dep) : ""}"></div>
    <div class="field"><label for="d-offer">Offer date</label><input type="date" id="d-offer" value="${d.offer || ""}"></div>
    <div class="field"><label for="d-cond">Conditions due</label><input type="date" id="d-cond" value="${d.cond || ""}"></div>
    <div class="field"><label for="d-close">Closing</label><input type="date" id="d-close" value="${d.close || ""}"></div>
    <div class="field"><label for="d-live">${d.side === "Seller" ? "Listing goes live" : "Possession"}</label><input type="date" id="d-live" value="${d.live || ""}"></div></div>
    <div class="grid2"><div class="field"><label for="d-otherag">Other agent</label><input id="d-otherag" value="${esc(d.otherAgent)}" placeholder="Name, brokerage, phone"></div>
    <div class="field"><label for="d-lawyer">Client's lawyer</label><input id="d-lawyer" value="${esc(d.lawyer)}" placeholder="Name, phone, email"></div></div>
    ${k[1] && d.status !== "Closed" ? `<div><a class="btn ghost" style="padding-left:0" target="_blank" rel="noopener" href="${calLink(k[0] + ": " + (d.addr || ""), k[1], (d.area || ""))}">Add ${k[0].toLowerCase()} to Google Calendar</a></div>` : ""}
  </div>
  <div class="card box"><h3>Paperwork</h3><div class="bar-l"><span>${done} of ${d.docs.length} done</span><span>${pct}%</span></div><div class="bar"><i style="width:${pct}%"></i></div>
    <div class="docs">${d.docs.map((x, i) => `<label class="doc ${x.done ? "done" : ""}"><input type="checkbox" data-doc="${i}" ${x.done ? "checked" : ""}><span>${esc(x.d)}</span><button type="button" class="x-sm" data-rmdoc="${i}" aria-label="Remove ${esc(x.d)}">×</button></label>`).join("")}</div>
    <div class="inline-add"><input id="d-newdoc" placeholder="Add a document or step" aria-label="Add a document or step"><button class="btn" id="d-adddoc">Add</button></div></div>
  <div class="card box"><h3>Updates and notes</h3>
    <div class="inline-add"><input id="d-newup" placeholder="What's new on this deal?" aria-label="Add an update"><button class="btn" id="d-addup">Add</button></div>
    <div class="log">${d.ups.length ? d.ups.map((u, i) => `<div class="log-item"><i>${u.src === "email" ? "@" : "N"}</i><div><button class="x-sm" data-rmup="${i}" aria-label="Delete update">×</button><small>${u.src === "email" ? "From your email" : "Note"} · ${new Date(u.t).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>${esc(u.x)}</div></div>`).join("") : `<p class="muted">No updates yet.</p>`}</div></div>
  ${del.html}`;
  const $ = s => sheet.querySelector(s);
  $(".x").onclick = () => closeSheet();
  const redraw = new Set(["addr", "area", "status", "side", "client", "offer", "cond", "close", "live"]);
  const bind = (sel, key, fn) => { $(sel).onchange = e => { const old = d[key]; d[key] = fn ? fn(e.target.value) : e.target.value.trim();
    if (key === "status" && old !== d[key]) d.ups.unshift({ t: nowISO(), src: "note", x: "Status changed from " + old + " to " + d[key] });
    save(); if (redraw.has(key)) drawDeal(id); else if (fn === num) e.target.value = d[key] ? money(d[key]) : ""; }; };
  bind("#d-addr", "addr"); bind("#d-area", "area"); bind("#d-mls", "mls"); bind("#d-client", "client", v => v || null); bind("#d-side", "side");
  bind("#d-st", "status"); bind("#d-list", "list", num); bind("#d-pr", "price", num); bind("#d-dep", "dep", num);
  bind("#d-offer", "offer", v => v || null); bind("#d-cond", "cond", v => v || null); bind("#d-close", "close", v => v || null); bind("#d-live", "live", v => v || null);
  bind("#d-otherag", "otherAgent"); bind("#d-lawyer", "lawyer");
  sheet.querySelectorAll("[data-doc]").forEach(b => b.onchange = () => { d.docs[+b.dataset.doc].done = b.checked; save(); drawDeal(id); });
  sheet.querySelectorAll("[data-rmdoc]").forEach(b => b.onclick = e => { e.preventDefault(); d.docs.splice(+b.dataset.rmdoc, 1); save(); drawDeal(id); });
  const addDoc = () => { const v = $("#d-newdoc").value.trim(); if (!v) return; d.docs.push({ d: v, done: false }); save(); drawDeal(id); $("#d-newdoc").focus(); };
  $("#d-adddoc").onclick = addDoc; $("#d-newdoc").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addDoc(); } };
  const addUp = () => { const v = $("#d-newup").value.trim(); if (!v) return; d.ups.unshift({ t: nowISO(), src: "note", x: v }); save(); drawDeal(id); };
  $("#d-addup").onclick = addUp; $("#d-newup").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addUp(); } };
  sheet.querySelectorAll("[data-rmup]").forEach(b => b.onclick = () => { d.ups.splice(+b.dataset.rmup, 1); save(); drawDeal(id); });
  del.wire();
}
function newDeal(clientId) {
  openId = "__newdeal";
  const clients = db.contacts.slice().sort((a, b) => name(a).localeCompare(name(b)));
  const pre = clientId ? byId(clientId) : null;
  sheet.innerHTML = `<div class="sheet-h"><h2>New deal</h2><button class="x" aria-label="Close">×</button></div>
  <form class="card box" id="ndF"><div class="field"><label for="nd-addr">Property address</label><input id="nd-addr" required placeholder="45 Example St"></div>
  <div class="field"><label for="nd-area">Neighbourhood</label><input id="nd-area"></div>
  <div class="grid2"><div class="field"><label for="nd-client">Client</label><select id="nd-client"><option value="">No client yet</option>${clients.map(c => `<option value="${c.id}"${c.id === clientId ? " selected" : ""}>${esc(name(c))}</option>`).join("")}</select></div>
  <div class="field"><label for="nd-side">You're</label><select id="nd-side"><option value="Buyer"${pre && pre.type === "Seller" ? "" : " selected"}>Buying for them</option><option value="Seller"${pre && pre.type === "Seller" ? " selected" : ""}>Selling for them</option></select></div>
  <div class="field"><label for="nd-st">Status</label><select id="nd-st">${opt(DSTAT, "Offer in")}</select></div>
  <div class="field"><label for="nd-list">List price</label><input id="nd-list" inputmode="numeric"></div></div>
  <p class="muted" style="font-size:13px">A paperwork checklist for ${"buyers or sellers"} is added for you. You can add or remove steps any time.</p>
  <div><button class="btn primary" type="submit">Add deal</button></div></form>`;
  openPanel();
  sheet.querySelector(".x").onclick = () => closeSheet();
  sheet.querySelector("#ndF").onsubmit = e => { e.preventDefault(); const v = s => sheet.querySelector(s).value.trim(); const side = v("#nd-side");
    const d = { id: uid(), client: v("#nd-client") || null, side, addr: v("#nd-addr"), area: v("#nd-area"), status: v("#nd-st"), price: 0, list: num(v("#nd-list")), offer: v("#nd-st") === "Offer in" ? rel(0) : null, cond: null, close: null,
      docs: (side === "Buyer" ? BUY_DOCS : SELL_DOCS).map(x => ({ d: x, done: false })), ups: [], created: nowISO() };
    db.deals.unshift(d); save(); toast("Deal added"); openDeal(d.id); };
}

/* ---------- meta leads ---------- */
function renderMeta() {
  const el = $id("v-meta");
  const month = iso(new Date()).slice(0, 7);
  const camps = [...new Set(db.meta.map(m => m.campaign).filter(Boolean))];
  el.innerHTML = `<div class="sec-h"><h2>Meta leads</h2><span style="display:flex;gap:10px;align-items:center"><span class="meta">From your Facebook and Instagram lead ads</span><button class="btn" id="mAdd">+ Add lead</button></span></div>
  <div class="stats">
    <div class="card stat hot"><b>${db.meta.filter(m => m.isNew).length}</b><span>Not contacted yet</span></div>
    <div class="card stat"><b>${db.meta.filter(m => (m.t || "").startsWith(month)).length}</b><span>This month</span></div>
    <div class="card stat"><b>${db.meta.filter(m => m.moved).length}</b><span>Added to client book</span></div>
    <div class="card stat"><b>${camps.length}</b><span>Campaigns</span></div>
  </div>
  <div class="card list">${db.meta.length ? db.meta.slice().sort((a, b) => (b.t || "").localeCompare(a.t || "")).map(m => `<div class="mlead">
    <div class="av">${esc(((m.first || "?")[0] + (m.last || "")[0] || "").toUpperCase())}</div>
    <div class="who" style="min-width:0"><b>${m.isNew ? '<span class="new-dot" aria-label="New"></span>' : ""}${esc((m.first + " " + m.last).trim() || "No name")}</b>
      <small>${esc([m.phone, m.email].filter(Boolean).join(" · "))}</small><small>${m.ad ? "Ad: " + esc(m.ad) + " · " : ""}${m.campaign ? esc(m.campaign) + " · " : ""}${timeAgo(m.t)}</small>
      ${Object.keys(m.a || {}).length ? `<div class="answers">${Object.entries(m.a).map(([k, v]) => `<span>${esc(k)}: <b>${esc(v)}</b></span>`).join("")}</div>` : ""}</div>
    <div class="acts">${m.moved ? `<span class="pill">In client book</span>` : `<button class="btn primary" data-mmove="${m.id}">Add to client book</button>`}
      ${m.isNew ? `<button class="btn ghost" data-mseen="${m.id}">Mark contacted</button>` : ""}<button class="x-sm" data-mdel="${m.id}">Remove</button></div></div>`).join("")
    : `<p class="empty">No Meta leads yet. Once your lead ads are connected, people who fill in your ad forms show up here within a minute. You can also add one by hand.</p>`}</div>
  <p class="how"><b>Connecting your ads:</b> your Facebook and Instagram lead forms can send new leads here automatically. <button class="linkbtn" data-act="connections">Set it up</button></p>`;
  el.querySelector("#mAdd").onclick = addMetaLead;
  el.querySelectorAll("[data-mseen]").forEach(b => b.onclick = () => { const m = db.meta.find(x => x.id === b.dataset.mseen); m.isNew = false; save(); render(); });
  el.querySelectorAll("[data-mdel]").forEach(b => b.onclick = () => { if (b.dataset.sure) { db.meta = db.meta.filter(x => x.id !== b.dataset.mdel); save(); render(); toast("Removed"); } else { b.dataset.sure = "1"; b.textContent = "Tap again to remove"; } });
  el.querySelectorAll("[data-mmove]").forEach(b => b.onclick = () => { const m = db.meta.find(x => x.id === b.dataset.mmove);
    const ans = Object.entries(m.a || {}).map(([k, v]) => k + ": " + v).join(", ");
    const sell = /sell/i.test(JSON.stringify(m.a || {})) && !/buy/i.test(JSON.stringify(m.a || {}));
    const c = { id: uid(), first: m.first, last: m.last, phone: m.phone, email: m.email, type: sell ? "Seller" : "Buyer", source: "Meta ad", stage: "New lead", tags: m.campaign ? [m.campaign] : [], follow: rel(0), followNote: "Call Meta lead", crit: {},
      log: [{ id: uid(), t: m.t || nowISO(), k: "note", x: "Came in from a Meta ad" + (m.ad ? " (" + m.ad + ")" : "") + "." + (ans ? " " + ans : "") }], created: m.t || nowISO() };
    db.contacts.push(c); m.moved = true; m.isNew = false; save(); render(); toast(m.first + " added to your client book"); });
}
function addMetaLead() {
  openId = "__meta";
  sheet.innerHTML = `<div class="sheet-h"><h2>Add a Meta lead</h2><button class="x" aria-label="Close">×</button></div>
  <form class="card box" id="mF">
    <div class="grid2"><div class="field"><label for="m-first">First name</label><input id="m-first" required></div><div class="field"><label for="m-last">Last name</label><input id="m-last"></div></div>
    <div class="grid2"><div class="field"><label for="m-phone">Phone</label><input id="m-phone" type="tel"></div><div class="field"><label for="m-email">Email</label><input id="m-email" type="email"></div></div>
    <div class="grid2"><div class="field"><label for="m-ad">Ad</label><input id="m-ad" placeholder="Free home evaluation"></div><div class="field"><label for="m-camp">Campaign</label><input id="m-camp"></div></div>
    <div class="field"><label for="m-ans">Their answers</label><textarea id="m-ans" rows="3" style="width:100%;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface)" placeholder="Looking to: Sell&#10;Timeline: 3 to 6 months"></textarea></div>
    <div><button class="btn primary" type="submit">Add lead</button></div></form>`;
  openPanel();
  sheet.querySelector(".x").onclick = () => closeSheet();
  sheet.querySelector("#mF").onsubmit = e => { e.preventDefault(); const v = s => sheet.querySelector(s).value.trim(); const a = {};
    v("#m-ans").split(/\n/).forEach(l => { const i = l.indexOf(":"); if (i > 0) a[l.slice(0, i).trim()] = l.slice(i + 1).trim(); else if (l.trim()) a["Note"] = l.trim(); });
    db.meta.push({ id: uid(), first: v("#m-first"), last: v("#m-last"), phone: v("#m-phone"), email: v("#m-email"), ad: v("#m-ad"), campaign: v("#m-camp"), t: nowISO(), a, isNew: true });
    save(); closeSheet(); toast("Lead added"); };
}

/* ---------- global clicks ---------- */
document.addEventListener("click", e => {
  const d = e.target.closest("[data-done]");
  if (d) { e.stopPropagation(); const c = byId(d.dataset.done); d.classList.add("done"); d.textContent = "✓";
    addLog(c, "note", "Done: " + (c.followNote || "follow-up")); c.follow = null; c.followNote = ""; save(); setTimeout(() => { render(); toast("Done. Set the next one from their card."); }, 350); return; }
  const a = e.target.closest("[data-act]");
  if (a) { const k = a.dataset.act; if (k === "new-contact") newContact(); else if (k === "new-deal") newDeal(); else if (k === "import") show("import"); else if (k === "connections") openConnections(); return; }
  const g = e.target.closest("[data-go]"); if (g) { show(g.dataset.go); return; }
  const dl = e.target.closest("[data-deal]"); if (dl) { openDeal(dl.dataset.deal); return; }
  const o = e.target.closest("[data-open]"); if (o) { openContact(o.dataset.open); return; }
  if (!e.target.closest(".menu")) { $id("menuList").hidden = true; $id("menuBtn").setAttribute("aria-expanded", "false"); }
});
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const t = e.target; if (!t.matches || !t.matches(".row[tabindex],.deal[tabindex]")) return;
  e.preventDefault(); t.click();
});
$id("addBtn").onclick = newContact;
$id("menuBtn").onclick = () => { const l = $id("menuList"); l.hidden = !l.hidden; $id("menuBtn").setAttribute("aria-expanded", String(!l.hidden)); };
$id("mConn").onclick = () => { $id("menuList").hidden = true; openConnections(); };
$id("mImport").onclick = () => { $id("menuList").hidden = true; show("import"); };
$id("mExport").onclick = () => { $id("menuList").hidden = true; exportCSV(); };
$id("mRefresh").onclick = async () => { $id("menuList").hidden = true; if (await fetchBook()) { render(); toast("Up to date"); } };
$id("mLogout").onclick = async () => { $id("menuList").hidden = true; await api("logout", { method: "POST" }); db = null; showSignin(); };

start();
})();
