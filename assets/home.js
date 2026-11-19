/* Home page sections under the walk-through: before/after slider, selling-plan tabs,
   net proceeds calculator, reviews carousel, and links that pre-pick a reason on the contact form. */
(() => {
  const $ = id => document.getElementById(id);

  // links like "What's my home worth?" pre-select the matching option on the contact form
  document.querySelectorAll("[data-reason]").forEach(a => a.addEventListener("click", () => {
    const r = document.querySelector(`#contact input[name="reason"][value="${a.dataset.reason}"]`);
    if (r) r.checked = true;
  }));

  // before / after slider
  const frame = $("compare");
  if (frame) {
    const range = frame.querySelector("input");
    const set = v => frame.style.setProperty("--pos", v + "%");
    range.addEventListener("input", () => set(range.value));
    set(range.value);
  }

  // selling plan: busy / slower market tabs
  const tabs = [...document.querySelectorAll('#selling [role="tab"]')];
  const pick = t => tabs.forEach(b => {
    const on = b === t;
    b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1;
    $(b.getAttribute("aria-controls")).hidden = !on;
  });
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => pick(t));
    t.addEventListener("keydown", e => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) { const n = tabs[(i + d + tabs.length) % tabs.length]; pick(n); n.focus(); }
    });
  });

  // net proceeds calculator
  if ($("calc")) {
    const money = new Intl.NumberFormat("en-CA", {style: "currency", currency: "CAD", maximumFractionDigits: 0});
    const num = id => parseFloat($(id).value.replace(/[^\d.]/g, "")) || 0;
    const ids = ["k-price", "k-mort", "k-pen", "k-legal", "k-other"];
    const out = (id, v, neg) => { $(id).textContent = (neg && v ? "−" : "") + money.format(Math.abs(v)); };
    const calc = () => {
      const price = num("k-price"), mort = num("k-mort"), rate = Math.min(num("k-rate"), 100), pen = num("k-pen"),
            legal = num("k-legal"), other = num("k-other");
      const comm = price * rate / 100, hst = comm * .13, net = price - mort - comm - hst - pen - legal - other;
      $("k-net").textContent = (net < 0 ? "−" : "") + money.format(Math.abs(net));
      out("k-o-price", price); out("k-o-mort", mort, 1); out("k-o-comm", comm, 1); out("k-o-hst", hst, 1);
      out("k-o-pen", pen, 1); out("k-o-legal", legal, 1); out("k-o-other", other, 1);
      $("k-o-rate").textContent = (+rate.toFixed(2)) + "%";
      $("k-nudge").textContent = `Every extra $10,000 in sale price puts about ${money.format(10000 * (1 - rate / 100 * 1.13))} more in your pocket.`;
    };
    ids.forEach(id => {
      const el = $(id);
      el.addEventListener("input", calc);
      el.addEventListener("blur", () => { const v = num(id); el.value = v ? Math.round(v).toLocaleString("en-CA") : "0"; });
    });
    $("k-rate").addEventListener("input", calc);
    calc();
  }

  // reviews carousel arrows
  const track = $("rev-track");
  if (track) document.querySelectorAll("#reviews .arrow").forEach(b => b.addEventListener("click", () => {
    const card = track.querySelector(".review");
    const step = card ? card.getBoundingClientRect().width + 16 : track.clientWidth * .8;
    track.scrollBy({left: step * +b.dataset.dir, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
  }));
})();
