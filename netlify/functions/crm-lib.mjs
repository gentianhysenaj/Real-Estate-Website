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
  await store().setJSON("inbox/" + id, { ...lead, id, received: new Date().toISOString() });
  return id;
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
