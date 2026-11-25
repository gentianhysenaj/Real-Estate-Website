// Netlify runs this after every website form submission (the file name is the event name).
// It sends the home search sign-up and the contact form into the client book (/crm/).
import { addLead } from "./crm-lib.mjs";

const clip = (v, n = 160) => String(v ?? "").trim().slice(0, n);

export default async (req) => {
  let payload = {};
  try { payload = (await req.json()).payload || {}; } catch {}
  const d = payload.data || {};
  const form = payload.form_name || d["form-name"] || (d.first ? "home-search-signup" : d.name ? "contact" : "");
  if (form === "home-search-signup") {
    await addLead({ kind: "search", first: clip(d.first, 80), last: clip(d.last, 80), email: clip(d.email), phone: clip(d.phone, 40), consent: d.consent === "yes" });
  } else if (form === "contact") {
    const parts = clip(d.name).split(/\s+/);
    await addLead({ kind: "contact", first: parts[0] || "", last: parts.slice(1).join(" "), email: clip(d.email), phone: clip(d.phone, 40), reason: clip(d.reason, 40), message: clip(d.message, 2000) });
  }
  return new Response("ok");
};
