// Client book API. Everything except sign-in needs a valid session cookie.
//   POST /api/crm/login   {pin}         -> sets the session cookie
//   POST /api/crm/logout
//   GET  /api/crm/data                  -> {db, etag, inbox:[new leads]}
//   PUT  /api/crm/data    {db, etag}    -> saves; 409 if another device saved first
//   POST /api/crm/lead    (header x-crm-key) -> adds a lead from Make/Zapier (Meta lead ads)
//   GET  /api/crm/hook/deals, POST /api/crm/hook/email (header x-crm-key) -> the twice-daily Gmail check
//   GET  /api/crm/hook/alerts, GET /api/crm/hook/summary (header x-crm-key) -> new-lead alerts and the morning email
//   POST /api/crm/google-lead           (google_key in the body) -> Google Ads lead form webhook
//   PUT/GET/DELETE /api/crm/files/<deal>/<file>  -> documents attached to a deal (signed in)
//   GET  /api/crm/setup                 -> the key and URLs shown on the Connections page
import { store, pinMatches, makeToken, tokenOk, addLead, json, buildSummary } from "./crm-lib.mjs";

const COOKIE = "crm_session";
const MAX_FAILS = 8, LOCK_MIN = 15;
const MAX_FILE = 5 * 1024 * 1024;

export default async (req, context) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/crm\/?/, "").replace(/\/$/, "");
  const s = store();

  if (route === "login" && req.method === "POST") {
    const key = "auth/fails/" + (context.ip || "unknown").replace(/[^0-9a-f.:]/gi, "");
    const rec = (await s.get(key, { type: "json" })) || { n: 0, until: 0 };
    if (rec.until > Date.now()) return json({ error: "locked", minutes: Math.ceil((rec.until - Date.now()) / 6e4) }, 429);
    let pin = "";
    try { pin = (await req.json()).pin; } catch {}
    if (!pinMatches(pin)) {
      rec.n += 1;
      if (rec.n >= MAX_FAILS) { rec.n = 0; rec.until = Date.now() + LOCK_MIN * 6e4; }
      await s.setJSON(key, rec);
      return json({ error: "wrong_pin", left: rec.until > Date.now() ? 0 : MAX_FAILS - rec.n }, 401);
    }
    await s.delete(key);
    context.cookies.set({ name: COOKIE, value: makeToken(30), path: "/api/crm", httpOnly: true, secure: true, sameSite: "Strict", maxAge: 30 * 86400 });
    return json({ ok: true });
  }

  if (route === "lead" && req.method === "POST") {
    const want = Netlify.env.get("CRM_LEAD_KEY");
    if (!want || req.headers.get("x-crm-key") !== want) return json({ error: "bad_key" }, 401);
    let b = {};
    try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
    const name = String(b.full_name || b.name || "").trim().split(/\s+/);
    await addLead({
      kind: b.kind === "contact" ? "contact" : "meta",
      first: String(b.first_name || b.first || name[0] || "").slice(0, 80),
      last: String(b.last_name || b.last || name.slice(1).join(" ") || "").slice(0, 80),
      email: String(b.email || "").slice(0, 160), phone: String(b.phone_number || b.phone || "").slice(0, 40),
      ad: String(b.ad_name || b.ad || "").slice(0, 160), campaign: String(b.campaign_name || b.campaign || "").slice(0, 160),
      answers: typeof b.answers === "object" && b.answers ? b.answers : {},
    });
    return json({ ok: true });
  }

  // Google Ads lead form webhook: Google posts the form with the key typed into the ad's webhook settings.
  if (route === "google-lead" && req.method === "POST") {
    const want = Netlify.env.get("CRM_LEAD_KEY");
    let b = {};
    try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
    if (!want || b.google_key !== want) return json({ error: "bad_key" }, 401);
    const cols = {}, answers = {};
    for (const c of Array.isArray(b.user_column_data) ? b.user_column_data : []) {
      const id = String(c.column_id || ""), v = String(c.string_value ?? "").slice(0, 300);
      cols[id] = v;
      if (!["FULL_NAME", "FIRST_NAME", "LAST_NAME", "EMAIL", "PHONE_NUMBER", "WORK_EMAIL", "WORK_PHONE"].includes(id)) answers[String(c.column_name || id).slice(0, 80)] = v;
    }
    const full = String(cols.FULL_NAME || "").trim().split(/\s+/);
    if (b.is_test) answers["Test lead"] = "Sent from Google Ads to check the connection";
    await addLead({ kind: "google", first: (cols.FIRST_NAME || full[0] || "").slice(0, 80), last: (cols.LAST_NAME || full.slice(1).join(" ") || "").slice(0, 80),
      email: (cols.EMAIL || cols.WORK_EMAIL || "").slice(0, 160), phone: (cols.PHONE_NUMBER || cols.WORK_PHONE || "").slice(0, 40),
      ad: String(b.form_id ? "Lead form " + b.form_id : "").slice(0, 160), campaign: String(b.campaign_id ? "Campaign " + b.campaign_id : "").slice(0, 160), answers });
    return json({});
  }

  // Gmail check (Google Apps Script in Gentian's account) and other tools, signed with CRM_LEAD_KEY
  if (route.startsWith("hook/")) {
    const want = Netlify.env.get("CRM_LEAD_KEY");
    if (!want || req.headers.get("x-crm-key") !== want) return json({ error: "bad_key" }, 401);
    if (route === "hook/deals" && req.method === "GET") {
      // what the inbox check should look for: open deals by street address, MLS number and client email
      const cur = await s.get("db", { type: "json" });
      const db = cur || { contacts: [], deals: [] };
      const deals = (db.deals || []).filter(d => d.status !== "Closed" && d.addr).map(d => {
        const c = (db.contacts || []).find(x => x.id === d.client);
        return { id: d.id, addr: d.addr, mls: d.mls || "", email: c && c.email ? c.email : "" };
      });
      return json({ deals });
    }
    if (route === "hook/email" && req.method === "POST") {
      let b = {};
      try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 150).map(i => ({
        deal: String(i.deal || "").slice(0, 40), id: String(i.id || "").slice(0, 80), from: String(i.from || "").slice(0, 200),
        subject: String(i.subject || "").slice(0, 300), snippet: String(i.snippet || "").slice(0, 400), date: String(i.date || "").slice(0, 40) }));
      await addLead({ kind: "email", items, checkedAt: String(b.checkedAt || new Date().toISOString()).slice(0, 40) });
      return json({ ok: true, received: items.length });
    }
    if (route === "hook/alerts" && req.method === "GET") {
      // new leads to email about; each one is handed out once
      const { blobs } = await s.list({ prefix: "alerts/" });
      const items = [];
      for (const b of blobs) { const v = await s.get(b.key, { type: "json" }); if (v) items.push(v); await s.delete(b.key); }
      await s.setJSON("status/alerts", { last: new Date().toISOString() });
      return json({ items, crm: url.origin + "/crm/" });
    }
    if (route === "hook/summary" && req.method === "GET") {
      const cur = await s.get("db", { type: "json" });
      await s.setJSON("status/summary", { last: new Date().toISOString() });
      return json(buildSummary(cur, url.origin));
    }
    return json({ error: "not_found" }, 404);
  }

  if (!tokenOk(context.cookies.get(COOKIE))) return json({ error: "signed_out" }, 401);

  if (route === "setup" && req.method === "GET") {
    const alerts = await s.get("status/alerts", { type: "json" });
    const summary = await s.get("status/summary", { type: "json" });
    return json({ key: Netlify.env.get("CRM_LEAD_KEY") || "", base: url.origin + "/api/crm",
      alertsLast: alerts ? alerts.last : null, summaryLast: summary ? summary.last : null });
  }

  if (route === "logout" && req.method === "POST") {
    context.cookies.delete({ name: COOKIE, path: "/api/crm" });
    return json({ ok: true });
  }

  // Documents attached to a deal. The file sits in Blobs under files/<deal>/<file>; the deal keeps the list.
  const fm = route.match(/^files\/([\w-]{1,40})\/([\w-]{1,40})$/);
  if (fm) {
    const key = "files/" + fm[1] + "/" + fm[2];
    if (req.method === "PUT") {
      const buf = await req.arrayBuffer();
      if (!buf.byteLength) return json({ error: "empty" }, 400);
      if (buf.byteLength > MAX_FILE) return json({ error: "too_big" }, 413);
      const name = decodeURIComponent(req.headers.get("x-file-name") || "document").replace(/[\r\n"]/g, "").slice(0, 160);
      const type = (req.headers.get("content-type") || "application/octet-stream").slice(0, 100);
      await s.set(key, buf, { metadata: { name, type, size: buf.byteLength } });
      return json({ ok: true, size: buf.byteLength });
    }
    if (req.method === "GET") {
      const got = await s.getWithMetadata(key, { type: "arrayBuffer" });
      if (!got) return json({ error: "not_found" }, 404);
      const md = got.metadata || {};
      const inline = /^(application\/pdf|image\/)/.test(md.type || "");
      return new Response(got.data, { headers: { "content-type": md.type || "application/octet-stream", "cache-control": "no-store",
        "content-disposition": (inline ? "inline" : "attachment") + '; filename="' + encodeURIComponent(md.name || "document") + '"', "x-content-type-options": "nosniff" } });
    }
    if (req.method === "DELETE") { await s.delete(key); return json({ ok: true }); }
  }

  if (route === "data" && req.method === "GET") {
    const cur = await s.get("db", { type: "json" });
    const { blobs } = await s.list({ prefix: "inbox/" });
    const inbox = [];
    for (const b of blobs) { const v = await s.get(b.key, { type: "json" }); if (v) inbox.push(v); }
    // "etag" is the book's revision number; a save must name the revision it was based on
    return json({ db: cur, etag: cur ? String(cur.rev || 0) : null, inbox });
  }

  if (route === "data" && req.method === "PUT") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
    if (!b || typeof b.db !== "object" || !Array.isArray(b.db.contacts)) return json({ error: "bad_db" }, 400);
    const cur = await s.get("db", { type: "json" });
    const curRev = cur ? String(cur.rev || 0) : null;
    if (String(b.etag ?? null) !== String(curRev)) return json({ error: "conflict" }, 409);
    b.db.rev = (cur ? (cur.rev || 0) : 0) + 1;
    await s.setJSON("db", b.db);
    // leads the app has now folded in can leave the inbox
    for (const id of Array.isArray(b.ack) ? b.ack : []) if (/^[\w-]{1,40}$/.test(id)) await s.delete("inbox/" + id);
    return json({ ok: true, etag: String(b.db.rev) });
  }

  return json({ error: "not_found" }, 404);
};

export const config = { path: "/api/crm/*" };
