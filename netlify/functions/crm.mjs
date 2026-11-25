// Client book API. Everything except sign-in needs a valid session cookie.
//   POST /api/crm/login   {pin}         -> sets the session cookie
//   POST /api/crm/logout
//   GET  /api/crm/data                  -> {db, etag, inbox:[new leads]}
//   PUT  /api/crm/data    {db, etag}    -> saves; 409 if another device saved first
//   POST /api/crm/lead    (header x-crm-key) -> adds a lead from Zapier/Make/Meta
import { store, pinMatches, makeToken, tokenOk, addLead, json } from "./crm-lib.mjs";

const COOKIE = "crm_session";
const MAX_FAILS = 8, LOCK_MIN = 15;

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

  if (!tokenOk(context.cookies.get(COOKIE))) return json({ error: "signed_out" }, 401);

  if (route === "logout" && req.method === "POST") {
    context.cookies.delete({ name: COOKIE, path: "/api/crm" });
    return json({ ok: true });
  }

  if (route === "data" && req.method === "GET") {
    const cur = await s.getWithMetadata("db", { type: "json" });
    const { blobs } = await s.list({ prefix: "inbox/" });
    const inbox = [];
    for (const b of blobs) { const v = await s.get(b.key, { type: "json" }); if (v) inbox.push(v); }
    return json({ db: cur ? cur.data : null, etag: cur ? cur.etag : null, inbox });
  }

  if (route === "data" && req.method === "PUT") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
    if (!b || typeof b.db !== "object" || !Array.isArray(b.db.contacts)) return json({ error: "bad_db" }, 400);
    const opts = b.etag ? { onlyIfMatch: b.etag } : { onlyIfNew: true };
    const res = await s.setJSON("db", b.db, opts);
    if (!res.modified) return json({ error: "conflict" }, 409);
    // leads the app has now folded in can leave the inbox
    for (const id of Array.isArray(b.ack) ? b.ack : []) if (/^[\w-]{1,40}$/.test(id)) await s.delete("inbox/" + id);
    return json({ ok: true, etag: res.etag });
  }

  return json({ error: "not_found" }, 404);
};

export const config = { path: "/api/crm/*" };
