/* Presentations: PIN screen, deck picker and a full-screen presenter for two decks (listing and buyer).

   Presenting: → / Space / Page Down / a clicker = next, ← / Page Up = back, F = full screen,
   O = all slides, N = speaker notes, Esc = close. Swipe on a tablet. Items on a slide appear one by one.
   Client name, priorities and must-haves are kept for this browser tab only (sessionStorage).

   To edit the words, change DECKS below. Each slide is built by one of the templates in T. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const money = v => new Intl.NumberFormat("en-CA", {style: "currency", currency: "CAD", maximumFractionDigits: 0}).format(Math.round(v));
  const pct = (v, d = 2) => (+v.toFixed(d)) + "%";
  const store = {
    get(k, d) { try { const v = sessionStorage.getItem("ghp_" + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { sessionStorage.setItem("ghp_" + k, JSON.stringify(v)); } catch (_) {} },
    clear() { try { Object.keys(sessionStorage).filter(k => k.startsWith("ghp_")).forEach(k => sessionStorage.removeItem(k)); } catch (_) {} },
  };

  /* ---------- PIN ----------
     Only the SHA-256 hash of the PIN is stored. To change it, put the new hash here (in a browser console:
     crypto.subtle.digest("SHA-256", new TextEncoder().encode("1234")) ...). This keeps visitors out, but it
     is not bank-grade security: keep confidential client data out of these slides. */
  const PIN_HASH = "6c25c8f454fea8dd5cd0b201b4f739993aebfc454de7b410ee9457c553699a85";
  async function sha256(s) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
  }

  /* ---------- Gentian's details (used on title and closing slides) ---------- */
  const AGENT = {
    name: "Gentian Hysenaj", title: "Registered real estate salesperson",
    brokerage: "Royal LePage Pinnacle Real Estate, Brokerage",
    phone: "(416) 836-9772", email: "Gentian.Hysenaj@gmail.com", ig: "@realtorgentian",
    photo: "/assets/img/gentian-avatar.webp",
  };
  const IMG = n => `/assets/tour/${n}.webp?v=3`;

  /* ---------- small HTML helpers ---------- */
  const K = t => `<div class="kicker">${t}</div>`;
  const H = (t, soft) => `<h2>${t}${soft ? ` <span class="soft">${soft}</span>` : ""}</h2>`;
  const sub = t => t ? `<p class="sub">${t}</p>` : "";
  const bg = src => `<div class="bg"><img src="${src}" alt="" decoding="async"></div>`;
  const plain = s => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const n2 = i => String(i + 1).padStart(2, "0");
  const range = (name, label, min, max, step, val) =>
    `<div class="row"><label><span>${label}</span><output data-o="${name}"></output></label>` +
    `<input class="r" type="range" data-r="${name}" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${label}"></div>`;
  const opts = (name, label, choices) =>
    `<div class="row"><label><span>${label}</span></label><div class="opts" data-opt="${name}">` +
    choices.map(([v, t], i) => `<button type="button" data-v="${v}" aria-pressed="${i === 0}">${t}</button>`).join("") + `</div></div>`;
  // wire up sliders and option buttons in a slide, calling fn on every change
  function controls(el, fn) {
    const paint = r => r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min) * 100) + "%");
    $$("input.r", el).forEach(r => { paint(r); r.addEventListener("input", () => { paint(r); fn(); }); });
    $$(".opts", el).forEach(g => g.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      $$("button", g).forEach(x => x.setAttribute("aria-pressed", x === b)); fn();
    }));
    const v = n => +$(`[data-r="${n}"]`, el).value;
    const o = n => $(`[data-opt="${n}"] [aria-pressed="true"]`, el).dataset.v;
    const out = (n, t) => { const x = $(`[data-o="${n}"]`, el); if (x) x.textContent = t; };
    return {v, o, out, set(n, val) { const r = $(`[data-r="${n}"]`, el); r.value = val; paint(r); }};
  }

  /* ---------- money rules (Ontario, 2026) ---------- */
  const brackets = (p, b) => { let t = 0, lo = 0; for (const [hi, r] of b) { if (p > lo) t += (Math.min(p, hi) - lo) * r; lo = hi; } return t; };
  const ontarioLTT = p => brackets(p, [[55e3, .005], [25e4, .01], [4e5, .015], [2e6, .02], [Infinity, .025]]);
  const torontoMLTT = p => brackets(p, [[55e3, .005], [25e4, .01], [4e5, .015], [2e6, .02], [3e6, .025], [4e6, .044], [5e6, .0545], [1e7, .065], [2e7, .0755], [Infinity, .086]]);
  const minDown = p => p >= 15e5 ? p * .2 : p <= 5e5 ? p * .05 : 25e3 + (p - 5e5) * .1;
  const cmhcRate = (ltv, years) => { const r = ltv > .9 ? 4 : ltv > .85 ? 3.1 : ltv > .8 ? 2.8 : 0; return r && years > 25 ? r + .2 : r; };
  const payment = (loan, rate, years) => { const i = Math.pow(1 + rate / 200, 1 / 6) - 1, n = years * 12; return i ? loan * i / (1 - Math.pow(1 + i, -n)) : loan / n; };

  /* ---------- slide templates ---------- */
  const T = {
    title: o => ({sec: "Welcome", title: o.h, cls: "title dark", notes: o.notes, html: `${bg(o.bg)}
      <img class="brandmark" src="/assets/brand/logo-dark.svg?v=2" alt="">
      ${K(o.kicker)}<h1>${o.h}</h1>${sub(o.sub)}
      <div class="for"><label>Prepared for</label><input type="text" data-client placeholder="Type their names" autocomplete="off" spellcheck="false" aria-label="Prepared for"></div>
      <div class="agent"><img src="${AGENT.photo}" alt=""><div><b>${AGENT.name}</b><span>${AGENT.title} · ${AGENT.brokerage}</span></div></div>`}),

    cards: o => {
      const many = o.items.length > 5;
      return {sec: o.sec, title: o.h, notes: o.notes, html: `${K(o.kicker || o.sec)}${H(o.h, o.soft)}${sub(o.sub)}
        <div class="cards c${o.cols || o.items.length}${o.compact ? " compact" : ""}${many ? " step" : ""}">` +
        o.items.map(([t, d], i) => `<div class="card-s${many ? "" : " step"}">${o.nonum ? "" : `<span class="n">${n2(i)}</span>`}<h3>${t}</h3><p>${d}</p></div>`).join("") + `</div>`};
    },

    statement: o => ({sec: o.sec, title: o.text, cls: "statement" + (o.bg ? " dark" : ""), notes: o.notes,
      html: `${o.bg ? bg(o.bg) : ""}${K(o.kicker || o.sec)}<p class="big">${o.text}</p>${o.sub ? `<p class="sub step">${o.sub}</p>` : ""}`}),

    tasks: o => ({sec: o.sec, title: o.h, notes: o.notes, html: `${K(o.sec)}${H(o.h, o.soft)}
      <div class="pills step">${o.items.map((t, i) => `<span style="--i:${i}">${t}</span>`).join("")}</div>`}),

    split: o => ({sec: o.sec, title: o.h, notes: o.notes, html: `${K(o.sec)}${H(o.h, o.soft)}${sub(o.sub)}
      <div class="split">
        <div class="col dim step">${K(o.left[0])}<ul>${o.left[1].map(x => `<li>${x}</li>`).join("")}</ul></div>
        <div class="col hi step">${K(o.right[0])}<ul>${o.right[1].map(x => `<li>${x}</li>`).join("")}</ul></div>
      </div>`}),

    markets: o => ({sec: o.sec, title: o.h, notes: o.notes, html: `${K(o.sec)}${H(o.h, o.soft)}
      <div class="seg" role="group" aria-label="Market">${o.plans.map((p, i) => `<button type="button" data-m="${i}" aria-pressed="${i === 0}">${p[0]}</button>`).join("")}</div>
      <div class="split">${o.plans.map((p, i) => `<div class="col ${i === 0 ? "hi" : "dim"}" data-col="${i}">${K(p[1])}<ul>${p[2].map(x => `<li>${x}</li>`).join("")}</ul></div>`).join("")}</div>`,
      init(el) {
        $(".seg", el).addEventListener("click", e => {
          const b = e.target.closest("button"); if (!b) return;
          $$(".seg button", el).forEach(x => x.setAttribute("aria-pressed", x === b));
          $$("[data-col]", el).forEach(c => { const on = c.dataset.col === b.dataset.m; c.classList.toggle("hi", on); c.classList.toggle("dim", !on); });
        });
      }}),

    priorities: o => ({sec: o.sec, title: o.h, notes: o.notes, html: `${K(o.sec)}${H(o.h, o.soft)}
      <p class="sub">${o.sub} <span class="picked-count"></span></p>
      <div class="chips">${o.options.map(([k, t, d]) => `<button type="button" class="chip" data-k="${k}" aria-pressed="false"><b>${t}</b><small>${d}</small></button>`).join("")}</div>`,
      init(el, ctx) {
        const key = ctx.deck + "_prio";
        const sync = () => {
          const picks = store.get(key, []);
          $$(".chip", el).forEach(c => c.setAttribute("aria-pressed", picks.includes(c.dataset.k)));
          $(".picked-count", el).textContent = picks.length ? `${picks.length} picked.` : "";
        };
        $(".chips", el).addEventListener("click", e => {
          const c = e.target.closest(".chip"); if (!c) return;
          const picks = store.get(key, []), i = picks.indexOf(c.dataset.k);
          i < 0 ? picks.push(c.dataset.k) : picks.splice(i, 1);
          store.set(key, picks); sync();
        });
        sync(); el.addEventListener("refresh", sync);
      }}),

    recap: o => ({sec: o.sec, title: o.h, notes: o.notes, html: `${K(`${o.sec}<span data-client-for></span>`)}${H(o.h, o.soft)}<div class="recap-host"></div>`,
      show(el, ctx) {
        const picks = store.get(ctx.deck + "_prio", []), host = $(".recap-host", el);
        const byKey = Object.fromEntries(o.options.map(x => [x[0], x]));
        host.innerHTML = picks.length
          ? `<div class="recap">${picks.map(k => `<div><b>${byKey[k][1]}</b><span>${byKey[k][3]}</span></div>`).join("")}</div>`
          : `<div class="recap-empty"><p class="sub">We haven't picked priorities yet. Let's go back and choose what matters most.</p>
             <button type="button" class="reelbtn" data-goto="${ctx.indexOf("priorities")}"><i>←</i>Pick priorities</button></div>`;
      }}),

    about: o => ({sec: "About me", title: o.h, notes: o.notes, html: `${K("About me")}${H(o.h, o.soft)}
      <div class="tabs"><div class="tablist" role="tablist">${o.tabs.map((t, i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-t="${i}"><small>${n2(i)}</small>${t[0]}</button>`).join("")}</div>
      <div class="tabpanel" role="tabpanel"></div></div>`,
      init(el) {
        const panel = $(".tabpanel", el);
        const pick = i => {
          $$("[role=tab]", el).forEach(b => b.setAttribute("aria-selected", b.dataset.t == i));
          const [, h, body, img] = o.tabs[i];
          panel.innerHTML = `<div><h3>${h}</h3>${body}</div>${img ? `<img src="${img}" alt="">` : ""}`;
        };
        $(".tablist", el).addEventListener("click", e => { const b = e.target.closest("[role=tab]"); if (b) pick(+b.dataset.t); });
        pick(0);
      }}),

    pricing: o => ({sec: "Pricing", title: o.h, notes: o.notes, html: `${K("Pricing")}${H(o.h, o.soft)}
      <div class="pricing">
        <div class="ctl">${range("dev", "Asking price compared with market value", -10, 10, 1, 0)}
          <div class="scale"><span>10% under</span><span>At value</span><span>10% over</span></div>
          <div class="crowd" aria-hidden="true">${"<i></i>".repeat(24)}</div>
          <div class="tagline">Illustration: the dots are the buyers who'd book a showing.</div></div>
        <div class="say"><span class="kicker" data-o="pool"></span><h3 data-o="head"></h3><p data-o="body"></p></div>
      </div>`,
      init(el) {
        const dots = $$(".crowd i", el);
        const c = controls(el, () => {
          const d = c.v("dev");
          c.out("dev", d === 0 ? "At value" : (d > 0 ? "+" : "") + d + "%");
          const pool = d <= 0 ? 1 : Math.max(.12, 1 - d * .088);
          const lit = Math.round(24 * pool);
          dots.forEach((x, i) => x.classList.toggle("on", i < lit));
          const [head, body, tag] =
            d <= -3 ? ["Priced to draw a crowd", "Lots of showings and a real chance of competing offers. Works best with an offer date in a busy market.", "Most buyers"]
          : d <= 1 ? ["Priced at market value", "The biggest group of buyers sees it, books it and makes offers. This is where strong results usually start.", "Most buyers"]
          : d <= 5 ? ["A little high", "Fewer showings, and buyers start using your home to make the others look like good value.", "Fewer buyers"]
          :          ["Well over value", "Most buyers scroll right past. It sits, gets stale, and the final price often ends up lower than if it had been priced right.", "Very few buyers"];
          c.out("head", head); c.out("body", body); c.out("pool", tag);
        });
        el.dispatchEvent(new Event("calc")); $("input.r", el).dispatchEvent(new Event("input"));
      }}),

    prep: o => ({sec: "Preparation", title: o.h, notes: o.notes, html: `${K("Preparation")}${H(o.h, o.soft)}
      <div class="two">
        <div class="ba"><img src="/assets/img/prep-before.webp" alt="Room before preparation"><img class="after" src="/assets/img/prep-after.webp" alt="The same room prepared and professionally photographed">
          <span class="line"></span><span class="tag" style="left:18px">Before</span><span class="tag" style="right:18px">After</span>
          <input type="range" min="0" max="100" value="50" aria-label="Before and after"></div>
        <ul class="ticks">${o.items.map(([t, d]) => `<li class="step"><b>${t}</b><span>${d}</span></li>`).join("")}</ul>
      </div>`,
      init(el) { const ba = $(".ba", el), r = $("input", ba); r.addEventListener("input", () => ba.style.setProperty("--pos", r.value + "%")); }}),

    launch: o => ({sec: "Marketing", title: o.h, notes: o.notes, html: `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:30px"><div style="display:grid;gap:30px">${K("Marketing")}${H(o.h, o.soft)}</div>
      <button type="button" class="reelbtn" data-reel><i>▶</i>Play a sample listing reel</button></div>
      <div class="channels step">${o.items.map(([t, d], i) => `<div><span class="n">${n2(i)}</span><b>${t}</b><span>${d}</span></div>`).join("")}</div>`,
      init(el, ctx) { $("[data-reel]", el).addEventListener("click", () => ctx.reel()); }}),

    offers: o => ({sec: o.sec, title: o.h, notes: o.notes, html: `${K(o.sec)}${H(o.h, o.soft)}
      <p class="ask">${o.ask}</p>
      <div class="offers">${[o.a, o.b].map((x, i) => `<button type="button" class="offer${o.win === i ? " win" : ""}"><span class="badge">STRONGER</span><h3>${x.name}</h3>
        <dl>${x.rows.map(([k, v, q]) => `<div><dt>${k}</dt><dd class="${q || ""}">${v}</dd></div>`).join("")}</dl></button>`).join("")}</div>
      <div class="why">${o.why.map((w, i) => `<span style="--i:${i}">${w}</span>`).join("")}</div>`,
      init(el) { $(".offers", el).addEventListener("click", e => { if (e.target.closest(".offer")) $(".offers", el).classList.add("revealed"); }); },
      // the first "next" reveals the answer
      next(el) { const w = $(".offers", el); if (w.classList.contains("revealed")) return false; w.classList.add("revealed"); return true; }}),

    net: o => ({sec: "The numbers", title: o.h, notes: o.notes, html: `${K("The numbers")}${H(o.h, o.soft)}
      <div class="calc"><div class="ctl">
        ${range("price", "Sale price", 300000, 3000000, 5000, 1000000)}
        ${range("mort", "Mortgage to pay off", 0, 2000000, 5000, 450000)}
        ${range("rate", "Commission", 0, 6, .25, 4)}
        ${range("legal", "Legal fees", 0, 6000, 100, 2000)}
        ${range("other", "Other costs (penalty, moving)", 0, 60000, 500, 0)}
      </div><div class="result"><span class="lbl">Estimated net proceeds</span><span class="big" data-o="net"></span>
        <dl><div><dt>Sale price</dt><dd data-o="p"></dd></div><div><dt>Mortgage payout</dt><dd data-o="m"></dd></div>
        <div><dt>Commission</dt><dd data-o="c"></dd></div><div><dt>HST on commission (13%)</dt><dd data-o="h"></dd></div>
        <div><dt>Legal and other costs</dt><dd data-o="l"></dd></div></dl>
        <p class="note">An estimate to plan with. Your lawyer's statement of adjustments is the final word. Capital gains tax doesn't apply to most principal residences.</p></div></div>`,
      init(el) {
        const c = controls(el, () => {
          const p = c.v("price"), m = c.v("mort"), r = c.v("rate"), l = c.v("legal") + c.v("other");
          const com = p * r / 100, hst = com * .13, net = p - m - com - hst - l;
          c.out("price", money(p)); c.out("mort", money(m)); c.out("rate", pct(r)); c.out("legal", money(c.v("legal"))); c.out("other", money(c.v("other")));
          c.out("net", (net < 0 ? "−" : "") + money(Math.abs(net)));
          c.out("p", money(p)); c.out("m", "−" + money(m)); c.out("c", "−" + money(com)); c.out("h", "−" + money(hst)); c.out("l", "−" + money(l));
        });
        $("input.r", el).dispatchEvent(new Event("input"));
      }}),

    timeline: o => ({sec: o.sec, title: o.h, notes: o.notes, html: `${K(o.sec)}${H(o.h, o.soft)}
      <div class="tl"><div class="steps"><span class="fill"></span>${o.steps.map(([w, t], i) => `<button type="button" class="st" data-i="${i}"><i>${i + 1}</i><small>${w}</small><b>${t}</b></button>`).join("")}</div>
      <div class="detail"><button type="button" class="playbtn" aria-label="Play the timeline">▶</button><div><h3 data-o="t"></h3><p data-o="d"></p></div></div></div>`,
      init(el) {
        let at = 0, timer = 0;
        const steps = $$(".st", el), play = $(".playbtn", el);
        const set = i => {
          at = i; steps.forEach((s, j) => { s.classList.toggle("cur", j === i); s.classList.toggle("done", j < i); });
          $(".steps", el).style.setProperty("--f", i / (steps.length - 1));
          $("[data-o=t]", el).textContent = o.steps[i][0] + " · " + o.steps[i][1]; $("[data-o=d]", el).textContent = o.steps[i][2];
        };
        const stop = () => { clearInterval(timer); timer = 0; play.textContent = "▶"; };
        play.addEventListener("click", () => {
          if (timer) return stop();
          if (at === steps.length - 1) set(0);
          play.textContent = "❚❚";
          timer = setInterval(() => { if (at >= steps.length - 1) return stop(); set(at + 1); }, 2200);
        });
        $(".steps", el).addEventListener("click", e => { const b = e.target.closest(".st"); if (b) { stop(); set(+b.dataset.i); } });
        el.addEventListener("hide", stop); set(0);
      }}),

    reviews: o => ({sec: "Reviews", title: o.h, notes: o.notes, html: `${K("Reviews")}${H(o.h, o.soft)}
      <div class="revs">${o.items.map(([q, n, c]) => `<figure class="step"><span class="stars" aria-label="5 stars">★★★★★</span><blockquote>“${q}”</blockquote><figcaption><b>${n}</b>${c} · Google review</figcaption></figure>`).join("")}</div>`}),

    insurance: o => ({sec: "Financing", title: o.h, notes: o.notes, html: `${K("Financing")}${H(o.h, o.soft)}
      <div class="calc" style="grid-template-columns:1.1fr 1fr">
        <div class="acc">${o.faq.map(([q, a], i) => `<details${i === 0 ? " open" : ""}><summary>${q}</summary><p>${a}</p></details>`).join("")}</div>
        <div class="tiers">${[["5% to 9.99% down", "Mortgage is over 90% of the price", "4.00%"], ["10% to 14.99% down", "85.01% to 90% of the price", "3.10%"],
          ["15% to 19.99% down", "80.01% to 85% of the price", "2.80%"], ["20% or more down", "No mortgage insurance needed", "None"]]
          .map(([b, s, r], i) => `<button type="button" class="tier" aria-pressed="${i === 0}"><b>${b}</b><small>${s}</small><em>${r}</em></button>`).join("")}
          <p class="tagline">Premium as a share of the mortgage. Add 0.20% for a 30-year amortization (first-time buyers and new builds).</p></div>
      </div>`,
      init(el) {
        $$(".acc details", el).forEach(d => d.addEventListener("toggle", () => { if (d.open) $$(".acc details", el).forEach(x => { if (x !== d) x.open = false; }); }));
        $(".tiers", el).addEventListener("click", e => { const b = e.target.closest(".tier"); if (b) $$(".tier", el).forEach(x => x.setAttribute("aria-pressed", x === b)); });
      }}),

    cmhc: o => ({sec: "Financing", title: o.h, notes: o.notes, html: `${K("Financing")}${H(o.h, o.soft)}
      <div class="calc"><div class="ctl">
        ${range("price", "Purchase price", 300000, 2000000, 5000, 900000)}
        ${range("down", "Down payment", 5, 40, .5, 10)}
        ${opts("yrs", "Amortization", [["25", "25 years"], ["30", "30 years"]])}
      </div><div class="result"><span class="lbl">Mortgage insurance premium</span><span class="big" data-o="prem"></span>
        <dl><div><dt>Down payment</dt><dd data-o="d"></dd></div><div><dt>Mortgage before insurance</dt><dd data-o="l"></dd></div>
        <div><dt>Premium rate</dt><dd data-o="r"></dd></div><div><dt>Total mortgage (premium added)</dt><dd data-o="t"></dd></div>
        <div><dt>Ontario sales tax, due at closing</dt><dd data-o="pst"></dd></div></dl>
        <p class="warn" data-o="warn"></p>
        <p class="note">An estimate. Your lender and insurer confirm the final premium. 30-year insured amortizations are for first-time buyers and new builds.</p></div></div>`,
      init(el) {
        const c = controls(el, () => {
          const p = c.v("price"), dp = c.v("down"), yrs = +c.o("yrs"), d = p * dp / 100, loan = p - d, ltv = loan / p;
          let warn = "";
          if (d + .5 < minDown(p)) warn = `The minimum down payment at this price is ${money(minDown(p))}.`;
          else if (ltv > .8 && p >= 15e5) warn = "Homes at $1.5 million or more need at least 20% down.";
          const rate = (ltv > .8 && p < 15e5) ? cmhcRate(ltv, yrs) : 0, prem = loan * rate / 100;
          c.out("price", money(p)); c.out("down", pct(dp, 1) + " · " + money(d));
          c.out("prem", rate ? money(prem) : "None"); c.out("d", money(d)); c.out("l", money(loan));
          c.out("r", rate ? pct(rate) : "None (20%+ down)"); c.out("t", money(loan + prem)); c.out("pst", money(prem * .08)); c.out("warn", warn);
        });
        $("input.r", el).dispatchEvent(new Event("input"));
      }}),

    closingCosts: o => ({sec: "Financing", title: o.h, notes: o.notes, html: `${K("Financing")}${H(o.h, o.soft)}
      <div class="calc"><div class="ctl">
        ${range("price", "Purchase price", 300000, 2500000, 5000, 900000)}
        ${range("down", "Down payment", 5, 40, .5, 10)}
        ${opts("where", "Where is the home?", [["to", "Toronto"], ["on", "Elsewhere in Ontario"]])}
        ${opts("first", "First-time buyer?", [["y", "Yes"], ["n", "No"]])}
        ${opts("type", "Type of home", [["house", "House"], ["condo", "Condo"]])}
      </div><div class="result tight"><span class="lbl">Cash needed on closing day</span><span class="big" data-o="total"></span>
        <dl><div><dt>Down payment</dt><dd data-o="d"></dd></div><div><dt>Ontario land transfer tax</dt><dd data-o="ltt"></dd></div>
        <div><dt>Toronto land transfer tax</dt><dd data-o="mltt"></dd></div><div><dt>Sales tax on mortgage insurance</dt><dd data-o="pst"></dd></div>
        <div><dt>Legal fees and title insurance</dt><dd data-o="legal"></dd></div><div><dt>Inspection or status certificate</dt><dd data-o="insp"></dd></div>
        <div><dt>Adjustments (prepaid tax, utilities)</dt><dd data-o="adj"></dd></div></dl>
        <p class="note">Estimates. Land transfer tax includes first-time buyer refunds (Ontario up to $4,000, Toronto up to $4,475). Your lawyer confirms the final figures.</p></div></div>`,
      init(el) {
        const c = controls(el, () => {
          const p = c.v("price"), dp = c.v("down"), d = p * dp / 100, to = c.o("where") === "to", first = c.o("first") === "y", condo = c.o("type") === "condo";
          const ltt = Math.max(0, ontarioLTT(p) - (first ? 4000 : 0)), mltt = to ? Math.max(0, torontoMLTT(p) - (first ? 4475 : 0)) : 0;
          const loan = p - d, ltv = loan / p, prem = (ltv > .8 && p < 15e5) ? loan * cmhcRate(ltv, 25) / 100 : 0, pst = prem * .08;
          const legal = 2500 + 450, insp = condo ? 150 : 550, adj = 1000;
          c.out("price", money(p)); c.out("down", pct(dp, 1) + " · " + money(d));
          c.out("d", money(d)); c.out("ltt", money(ltt)); c.out("mltt", to ? money(mltt) : "Not in Toronto"); c.out("pst", money(pst));
          c.out("legal", money(legal)); c.out("insp", money(insp)); c.out("adj", money(adj));
          c.out("total", money(d + ltt + mltt + pst + legal + insp + adj));
        });
        $("input.r", el).dispatchEvent(new Event("input"));
      }}),

    monthly: o => ({sec: "Financing", title: o.h, notes: o.notes, html: `${K("Financing")}${H(o.h, o.soft)}
      <div class="calc wide"><div class="ctl two">
        ${range("price", "Purchase price", 300000, 2500000, 5000, 900000)}
        ${range("down", "Down payment", 5, 40, .5, 10)}
        ${range("rate", "Interest rate", 2, 8, .05, 4.5)}
        ${opts("yrs", "Amortization", [["25", "25 years"], ["30", "30 years"]])}
        ${opts("type", "Type of home", [["house", "House"], ["condo", "Condo"]])}
        ${range("tax", "Property tax", 0, 20000, 100, 6800)}
        ${range("util", "Utilities and insurance", 100, 1200, 25, 350)}
        <div class="full" data-condo hidden>${range("fee", "Condo fees", 0, 1500, 25, 600)}</div>
      </div><div class="result"><span class="lbl">Estimated cost each month</span><span class="big" data-o="total"></span>
        <dl><div><dt>Mortgage payment</dt><dd data-o="pay"></dd></div><div><dt>Property tax</dt><dd data-o="t"></dd></div>
        <div data-condo-row hidden><dt>Condo fees</dt><dd data-o="f"></dd></div><div><dt>Utilities and insurance</dt><dd data-o="u"></dd></div>
        <div><dt>Mortgage amount</dt><dd data-o="loan"></dd></div></dl>
        <p class="note">Fixed-rate payment with semi-annual compounding, the way Canadian mortgages work. Includes mortgage insurance when less than 20% is down. An estimate to plan with.</p></div></div>`,
      init(el) {
        let taxTouched = false;
        $('[data-r="tax"]', el).addEventListener("input", e => { if (e.isTrusted) taxTouched = true; });
        const c = controls(el, () => {
          const p = c.v("price"), dp = c.v("down"), r = c.v("rate"), yrs = +c.o("yrs"), condo = c.o("type") === "condo";
          if (!taxTouched) c.set("tax", Math.round(p * .0075 / 100) * 100);
          const d = p * dp / 100, base = p - d, ltv = base / p, loan = base * (1 + ((ltv > .8 && p < 15e5) ? cmhcRate(ltv, yrs) : 0) / 100);
          const pay = payment(loan, r, yrs), tax = c.v("tax") / 12, fee = condo ? c.v("fee") : 0, util = c.v("util");
          $("[data-condo]", el).hidden = !condo; $("[data-condo-row]", el).hidden = !condo;
          c.out("price", money(p)); c.out("down", pct(dp, 1) + " · " + money(d)); c.out("rate", pct(r)); c.out("tax", money(c.v("tax")) + " a year");
          c.out("fee", money(c.v("fee")) + " a month"); c.out("util", money(util) + " a month");
          c.out("pay", money(pay)); c.out("t", money(tax)); c.out("f", money(fee)); c.out("u", money(util)); c.out("loan", money(loan));
          c.out("total", money(pay + tax + fee + util));
        });
        $("input.r", el).dispatchEvent(new Event("input"));
      }}),

    musthaves: o => ({sec: o.sec, title: o.h, notes: o.notes, html: `${K(o.sec)}${H(o.h, o.soft)}${sub(o.sub)}
      <div class="mh"><div class="pool">${o.items.map(t => `<button type="button" data-s="">${t}</button>`).join("")}</div>
      <div class="lists"><div class="list" data-l="must"><h3>Must-haves</h3></div><div class="list" data-l="nice"><h3>Nice-to-haves</h3></div></div></div>`,
      init(el, ctx) {
        const key = ctx.deck + "_mh";
        const draw = () => {
          const s = store.get(key, {});
          $$(".pool button", el).forEach(b => b.dataset.s = s[b.textContent] || "");
          ["must", "nice"].forEach(l => {
            const box = $(`[data-l="${l}"]`, el), items = Object.keys(s).filter(k => s[k] === l);
            box.innerHTML = `<h3>${l === "must" ? "Must-haves" : "Nice-to-haves"}</h3>` + (items.length ? items.map(t => `<span>${t}</span>`).join("") : `<span class="empty">Nothing yet</span>`);
          });
        };
        $(".pool", el).addEventListener("click", e => {
          const b = e.target.closest("button"); if (!b) return;
          const s = store.get(key, {}), cur = s[b.textContent] || "", nxt = cur === "" ? "must" : cur === "must" ? "nice" : "";
          if (nxt) s[b.textContent] = nxt; else delete s[b.textContent];
          store.set(key, s); draw();
        });
        draw();
      }}),

    strength: o => ({sec: "Offers", title: o.h, notes: o.notes, html: `${K("Offers")}${H(o.h, o.soft)}
      <div class="strength"><div class="toggles">${o.items.map(([t, d]) => `<button type="button" class="tog" aria-pressed="false"><b>${t}</b><small>${d}</small></button>`).join("")}</div>
      <div class="meter"><span class="lbl">Your offer looks</span><span class="word" data-o="w">Weak</span><div class="track"><i></i></div><p data-o="p"></p></div></div>`,
      init(el) {
        const words = [["Weak", "Tap what your offer would include."], ["Fair", "A start. In a busy market, sellers will want more certainty."],
          ["Fair", "Getting there. Each piece makes saying yes easier."], ["Competitive", "Now you're in the conversation on offer night."],
          ["Competitive", "A seller will take this seriously."], ["Strong", "Hard to turn down, even against a slightly higher price."], ["Very strong", "This is the offer sellers hope for."]];
        const draw = () => {
          const n = $$(".tog[aria-pressed=true]", el).length;
          $(".meter", el).style.setProperty("--m", (8 + n / o.items.length * 92) + "%");
          $("[data-o=w]", el).textContent = words[n][0]; $("[data-o=p]", el).textContent = words[n][1];
        };
        $(".toggles", el).addEventListener("click", e => { const b = e.target.closest(".tog"); if (b) { b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"); draw(); } });
        draw();
      }}),

    closing: o => ({sec: "Thank you", title: o.h, cls: "dark", notes: o.notes, html: `${bg(o.bg)}
      ${K("Thank you")}${H(o.h, o.soft)}${sub(o.sub)}
      <div class="close-grid"><div style="display:grid;gap:22px"><span class="prepared" data-client-line></span>
        <div class="kicker">When you're ready</div><ol class="next-steps">${o.next.map(x => `<li>${x}</li>`).join("")}</ol></div>
        <div class="contact-card"><div class="agent"><img src="${AGENT.photo}" alt=""><div><b>${AGENT.name}</b><span>${AGENT.title}</span></div></div>
          <div class="lines"><span>${AGENT.phone}</span><span>${AGENT.email}</span><span>Instagram ${AGENT.ig}</span></div>
          <span class="tagline">${AGENT.brokerage}</span></div></div>`}),
  };

  // every slide remembers which template made it (used to find the priorities slide from the recap)
  Object.entries(T).forEach(([kind, fn]) => { T[kind] = o => ({...fn(o), kind}); });

  /* ---------- priorities: what the client picks, and how Gentian delivers each one ---------- */
  const LISTING_PRIO = [
    ["price", "Top dollar", "Every dollar the market will pay", "A price built from real sales, a launch that creates competition, and negotiation that protects every dollar."],
    ["certainty", "A deal that sticks", "Firm terms and a reliable buyer", "I check every buyer's deposit, financing and conditions, so the offer you accept is the one that closes."],
    ["timing", "The right closing date", "Lined up with your next move", "We set your ideal closing date up front and make it part of every negotiation."],
    ["buysell", "Buying and selling", "Doing both without the stress", "One plan for both moves, with timing, financing questions and conditions worked out early."],
    ["easy", "Minimal disruption", "Showings that fit your life", "Showings booked inside the windows you choose, with notice, and grouped where we can."],
    ["privacy", "Privacy", "Discreet marketing and access", "Controlled showings, no personal photos in the listing, and only serious buyers through the door."],
    ["updates", "Regular updates", "Honest feedback every week", "A weekly update with showings, feedback and my recommendation, plus a call whenever anything changes."],
    ["budget", "Smart prep spending", "Only fixes that pay off", "A prep list ranked by return, so you only spend where buyers will notice it and pay for it."],
  ];
  const BUYER_PRIO = [
    ["budget", "Staying on budget", "Payments that feel comfortable", "We set your budget from your monthly comfort, not the most a lender will approve."],
    ["area", "The right area", "Schools, commute, community", "Neighbourhoods compared side by side, with real sale prices, schools and commute times."],
    ["space", "Room to grow", "Space for the next five years", "Every home tested against how your life will look in five years, not just today."],
    ["ready", "Move-in ready", "Or open to a project", "I'll point out what work a home really needs, and roughly what it costs, before you offer."],
    ["win", "Winning in competition", "Ready when the one appears", "Pre-approval, deposit and offer strategy ready before offer night, so we can move fast."],
    ["calm", "A calm search", "No pressure, ever", "We go at your pace. If a home isn't right, I'll be the first to say so."],
    ["value", "Long-term value", "A home that holds its worth", "Every offer checked against recent sales and what makes a home easy to sell later."],
    ["learn", "Learning as we go", "Especially for a first home", "Every step explained in plain English, from deposits to closing day. No question is too small."],
  ];
  const REV = {
    jp: ["I was very apprehensive going into the housing market… until we met Gentian. Every recommendation he made was SPOT ON, from searching for houses, to offer negotiations, to navigating mortgage talks, to the inspection.", "JP M.", "Bought a home"],
    april: ["From the very beginning, he was professional, knowledgeable, patient, and genuinely invested in helping us find the right home. We never felt pressured or rushed.", "April", "Bought a home"],
    victoria: ["He worked tirelessly to help us sell our home and went above and beyond every step of the way. We always felt supported and confident knowing he was handling everything with such commitment and care.", "Victoria A.", "Sold a home"],
    henri: ["He helped us get the house we wanted at a great price and always treated us as if we were his own family.", "Henri X.", "Bought a family home"],
  };
  const ABOUT_TABS = [
    ["Hello", "I'm Gentian.", `<p>A registered real estate salesperson with ${AGENT.brokerage}. I help families across Toronto and the GTA sell well and buy with confidence.</p>`, "/assets/img/gentian-portrait.webp"],
    ["How I work", "Straight answers, real numbers.", "<p>I'd rather tell you something hard early than surprise you later. You get honest advice, clear numbers, and someone who picks up the phone.</p>", ""],
    ["My brokerage", "Royal LePage Pinnacle.", "<p>Part of Royal LePage, one of Canada's best-known real estate networks, with the reach, tools and support that come with that name.</p>", ""],
    ["Where I work", "Toronto and the GTA.", `<p>Neighbourhood by neighbourhood, with recent sales at my fingertips.</p><div class="areas">${["Toronto", "North York", "Etobicoke", "Scarborough", "Mississauga", "Oakville", "Vaughan", "Richmond Hill", "Markham"].map(a => `<span>${a}</span>`).join("")}</div>`, ""],
  ];

  /* ---------- the two decks ---------- */
  const DECKS = {
    listing: {name: "Listing presentation", slides: [
      T.title({kicker: "Listing presentation", h: "Selling your home.", sub: "The plan, the numbers and the work behind it, from today to closing day.", bg: IMG("01-front"),
        notes: "Thank them for having you. Set the agenda: their goals first, then the plan, then the numbers. About 45 minutes. Ask if anyone else is part of the decision."}),
      T.cards({sec: "Your goals", h: "What we're aiming for.", soft: "Together.", items: [
        ["The strongest price", "Prep, pricing, marketing and negotiation, all pulling in the same direction."],
        ["Timing that fits your life", "Your next move, your closing date and your family's calendar shape the plan."],
        ["A calm, clear process", "You'll always know what's happening, what comes next and why."]],
        notes: "Ask which of the three matters most to them right now. Listen more than you talk on this slide."}),
      T.priorities({sec: "Your goals", h: "What matters most", soft: "to you?", sub: "Tap everything that's important. We'll come back to these at the end.", options: LISTING_PRIO,
        notes: "Hand them the laptop or tablet and let them choose. Don't steer. Their picks come back on the second-last slide with how you'll deliver each one."}),
      T.statement({sec: "Why it matters", text: "The biggest complaint sellers have about agents isn't the price. It's the silence.",
        sub: "So updates are part of the plan: every week, good news or bad.",
        notes: "Pause after the first line. Ask if they've sold before and how the communication was."}),
      T.tasks({sec: "Behind the scenes", h: "Selling a home takes more than a sign.", soft: "Here's what goes into it.", items: [
        "Walk-through of your home", "Comparable sales research", "Competition review", "Pricing strategy", "Prep and repair list", "Staging plan",
        "Professional photography", "Video and floor plans", "Listing copy", "Feature sheets", "MLS® listing", "realtor.ca exposure", "Coming-soon campaign",
        "Social media ads", "Agent network email", "Agent preview", "Open houses", "Showing scheduling", "Lockbox and security", "Showing feedback calls",
        "Weekly seller updates", "Price reviews", "Offer presentations", "Offer comparison", "Negotiation", "Deposit tracking", "Condition deadlines",
        "Lawyer coordination", "Appraisal access", "Closing day keys"],
        notes: "Don't read the list. Let it land: this is the work they're hiring you to do."}),
      T.split({sec: "Two ways to list", h: "Same house.", soft: "Very different results.", left: ["The bare-minimum listing", [
        "A few phone photos", "Listed on MLS® and left to sit", "Showings booked, no follow-up", "Price drops as the only strategy", "You chase your agent for news"]],
        right: ["The way I list", ["A price built from evidence", "Prep, staging and professional media", "A launch designed to create urgency", "Every showing followed up", "Weekly updates and clear choices"]],
        notes: "Ask what they've noticed about other listings on their street. Most of them will have seen the left column."}),
      T.about({h: "Who I am.", tabs: ABOUT_TABS,
        notes: "Keep it short. Tap through the tabs that matter to them. They care more about what you'll do for them than your history."}),
      T.statement({sec: "Pricing", text: "Price is the biggest decision we'll make together.", bg: IMG("05-open-concept"),
        sub: "It decides who sees your home, how fast it sells and how strong the offers are.",
        notes: "Slow down here. Everything that follows builds on the price."}),
      T.pricing({h: "Your price decides", soft: "who shows up.",
        notes: "Drag the slider slowly to the right. Let them watch the buyers disappear as the price climbs. Then bring it back to market value."}),
      T.cards({sec: "Pricing", h: "A price built on evidence,", soft: "not a guess.", cols: 5, items: [
        ["Recent sales nearby", "What similar homes actually sold for, adjusted for size, condition and lot."],
        ["Today's competition", "The homes buyers will compare yours with this week."],
        ["What didn't sell", "Expired and withdrawn listings show where buyers said no."],
        ["How buyers are acting", "Showings, offer dates and days on market, right now."],
        ["Your goals", "Your timing and your next move."]],
        notes: "Bring the printed comparables. Walk through two or three, not twenty."}),
      T.markets({sec: "Strategy", h: "Two markets,", soft: "two plans.", plans: [
        ["Busy market", "When buyers are competing", ["Price to attract the biggest crowd", "A week of showings, then an offer date", "Early offers handled on your terms", "Multiple offers managed fairly and transparently"]],
        ["Slower market", "When buyers take their time", ["Price close to market value from day one", "Offers welcome any time", "Changes based on feedback, not nerves", "Negotiate terms as hard as price"]]],
        notes: "Tap between the two. Explain which one today's market looks like in their neighbourhood, and why."}),
      T.prep({h: "Buyers buy how a home", soft: "feels.", items: [
        ["A room-by-room prep plan", "Small fixes ranked by what buyers notice."],
        ["Staging that fits your home", "From a refresh with what you own to full staging."],
        ["Professional photos, video and floor plans", "Most buyers decide online whether to book a showing."]],
        notes: "Drag the before and after slider. Same room, same furniture, prepared and photographed properly."}),
      T.launch({h: "A launch built to", soft: "create demand.", items: [
        ["Coming-soon teasers", "Build a waiting list before day one."], ["MLS® and realtor.ca", "In front of every buyer and agent."],
        ["Photos, video and floor plans", "A listing people stop to look at."], ["Targeted social ads", "Reaching buyers where they scroll."],
        ["Agent preview", "Local agents see it first and bring buyers."], ["My buyer network", "Clients and contacts already looking."],
        ["Open houses", "Planned and promoted, not just a sign."], ["Feature sheets and signage", "Everything a buyer needs to remember it."]],
        notes: "Play the sample reel if there's time. It shows the kind of video every listing gets."}),
      T.cards({sec: "On the market", h: "Every showing,", soft: "followed up.", cols: 4, items: [
        ["Showings on your schedule", "Booked through a secure system, inside the times you set."],
        ["Feedback from every agent", "I call buyer agents after each showing and pass on what they really think."],
        ["A weekly report", "Showings, online views, feedback and what I recommend next."],
        ["Decisions on evidence", "If something needs to change, we'll see it in the numbers first."]],
        notes: "Promise only what you'll do. Mention how they'll get updates: call, text or email, their choice."}),
      T.offers({sec: "Offers", h: "Which offer", soft: "would you take?", ask: "Tap the one you'd accept.", win: 1,
        a: {name: "Offer A", rows: [["Price", "$1,050,000", "good"], ["Deposit", "$25,000", "bad"], ["Financing", "Condition, 5 days", "bad"], ["Inspection", "Condition, 5 days", "bad"], ["Closing", "30 days (you need 90)", "bad"]]},
        b: {name: "Offer B", rows: [["Price", "$1,030,000", ""], ["Deposit", "$60,000", "good"], ["Financing", "None, firm", "good"], ["Inspection", "Done before the offer", "good"], ["Closing", "90 days, as you asked", "good"]]},
        why: ["Firm: nothing left that can fall apart", "A bigger deposit shows commitment", "The date fits your plan"],
        notes: "Ask which they'd take before revealing. Pressing next reveals the answer. The point: price isn't the whole offer."}),
      T.cards({sec: "Offers", h: "Your offers,", soft: "handled with care.", cols: 4, items: [
        ["I advise, you decide", "Every choice is yours, with my honest recommendation."],
        ["Every term, line by line", "Price, deposit, conditions, dates and inclusions, in plain English."],
        ["Firm, fair negotiation", "I protect your price and terms without burning bridges."],
        ["By the book", "Every offer handled under RECO's rules, openly."]],
        notes: "Explain how offer night works if they're likely to get more than one offer."}),
      T.net({h: "Your estimated", soft: "net proceeds.",
        notes: "Ask for their mortgage balance beforehand, or use a round number. Move the price slider to show what each $10,000 is worth to them."}),
      T.timeline({sec: "Timeline", h: "What happens,", soft: "and when.", steps: [
        ["Week 1", "Walk-through and pricing", "We walk the home together, review the comparables and agree on a price and plan."],
        ["Weeks 1–2", "Prep and staging", "Small fixes, decluttering and staging, guided by the prep list."],
        ["Week 2", "Photos, video and coming soon", "Professional media, then a coming-soon campaign to build interest."],
        ["Launch", "Live on MLS®", "The listing goes live everywhere at once, with an agent preview."],
        ["On market", "Showings and feedback", "Showings on your schedule, with feedback after every one."],
        ["Offers", "Review and negotiate", "We compare every offer line by line and negotiate the best terms."],
        ["Sold", "Conditions and firm deal", "I track every condition until the deal is firm."],
        ["Closing day", "Keys handed over", "Your lawyer completes the sale and the keys change hands."]],
        notes: "Press play, or tap a step. Point out where their own dates fit in."}),
      T.cards({sec: "After the sale", h: "With you all the way", soft: "to closing day.", cols: 4, items: [
        ["Conditions tracked", "Every deadline in the agreement, watched and handled."],
        ["Paperwork managed", "Your lawyer gets everything they need, on time."],
        ["Visits arranged", "Buyer visits and appraisals booked around you."],
        ["Closing day", "Keys, final details and a call when it's done."]],
        notes: "Sellers worry most about the gap between 'sold' and 'closed'. Reassure them you stay involved."}),
      T.reviews({h: "Don't just take", soft: "my word for it.", items: [REV.victoria, REV.april, REV.jp],
        notes: "Let them read. Offer to connect them with a past client if they'd like a reference."}),
      T.cards({sec: "My commitments", h: "If I'm not doing what I promised,", soft: "tell me.", cols: 4, items: [
        ["A weekly update", "Every week, whether the news is good or bad."],
        ["Calls returned quickly", "You won't be left waiting for answers."],
        ["No surprise costs", "Every cost explained before you agree to it."],
        ["Honest advice", "Even when it's not what you hoped to hear."]],
        notes: "These are your commitments. Adjust the wording to what you're comfortable promising."}),
      T.cards({sec: "Getting started", h: "What I'll need", soft: "from you.", cols: 4, items: [
        ["A walk-through", "Room by room, including the basement and garage."],
        ["Recent upgrades", "What was done and roughly when: roof, windows, kitchen, furnace."],
        ["Mortgage details", "So we can order a payout statement and plan the numbers."],
        ["Your ideal timing", "When you'd like to move, and where to."]],
        notes: "This sets up the close naturally: these are the first steps if they say yes."}),
      T.recap({sec: "Your goals", h: "What matters to you,", soft: "and how I'll deliver it.", options: LISTING_PRIO,
        notes: "Read each one back to them. This is your promise, in their words."}),
      T.closing({h: "Thank you.", soft: "Whenever you're ready, I am too.", bg: IMG("08-backyard"),
        sub: "No decisions tonight. Take your time and ask me anything.",
        next: ["I'll give you RECO's Information Guide and walk you through it", "We'll go through the listing agreement together, line by line", "Then the plan starts: prep, photos and launch"],
        notes: "One gentle ask, then stop talking. Let them respond in their own time."}),
    ]},

    buyer: {name: "Buyer presentation", slides: [
      T.title({kicker: "Buyer presentation", h: "Buying your home.", sub: "Finding it, financing it, winning it and closing it, one step at a time.", bg: IMG("03-door-open"),
        notes: "Welcome them. Set the agenda: their goals, the money, the search, then the offer. Ask how far along they are: browsing, pre-approved, or ready to go."}),
      T.cards({sec: "How I help", h: "Four ways", soft: "I'll help.", cols: 4, items: [
        ["Find the right home", "Every match, the moment it's listed, and an honest opinion on each."],
        ["Win it at the right price", "Offers set by real sales, negotiated term by term."],
        ["Line up the money early", "Pre-approval and closing costs worked out before you shop."],
        ["Keep it simple", "One person to call, and every step explained."]],
        notes: "Ask which of these they're most worried about."}),
      T.split({sec: "The search", h: "The usual search,", soft: "or a guided one.", left: ["The usual way", [
        "Scrolling listings at midnight", "Falling for a home you can't afford", "Losing to better-prepared buyers", "Learning the costs at the lawyer's office"]],
        right: ["With me", ["Your budget set before you shop", "New matches sent automatically", "Offers built to win", "Every cost explained up front"]],
        notes: "Most first-time buyers recognise themselves in the left column. Keep it light."}),
      T.cards({sec: "The plan", h: "Three steps,", soft: "built around you.", cols: 3, items: [
        ["Know your numbers", "Pre-approval, a budget you're comfortable with and your closing costs."],
        ["See the right homes", "Curated matches, showings booked for you, and straight talk on each one."],
        ["Win the one you want", "An offer strategy, strong negotiation and help right through to closing."]],
        notes: "This is the roadmap for the rest of the presentation."}),
      T.priorities({sec: "Your goals", h: "What matters most", soft: "to you?", sub: "Tap everything that's important. We'll come back to these at the end.", options: BUYER_PRIO,
        notes: "Hand them the screen. Their picks come back near the end, with how you'll deliver each one."}),
      T.insurance({h: "Mortgage insurance,", soft: "in plain English.", faq: [
        ["What it is", "Insurance that protects your lender when you put down less than 20%. It's what lets you buy with as little as 5% down."],
        ["When you need it", "When your down payment is under 20% on a home under $1.5 million. At $1.5 million or more, you need at least 20% down."],
        ["How it's priced", "A one-time premium: a percentage of your mortgage, based on how much you put down. More down means a lower rate."],
        ["Added to your mortgage", "Most buyers add the premium to the mortgage and pay it off over time, so it isn't cash out of pocket."],
        ["Sales tax at closing", "Ontario's 8% sales tax on the premium can't be added to the mortgage. It's paid on closing day."]],
        notes: "Tap the questions they ask. Then tap the tier that matches their down payment."}),
      T.cmhc({h: "Your mortgage insurance", soft: "estimate.",
        notes: "Use their real price range and down payment. Show how moving from 9% to 10% down changes the premium."}),
      T.closingCosts({h: "What you'll need", soft: "on closing day.",
        notes: "This surprises most first-time buyers. Walk through the land transfer tax and the first-time buyer refunds."}),
      T.cards({sec: "Financing", h: "Get pre-approved", soft: "first.", cols: 3, items: [
        ["Know your budget", "Shop with a real number, not a guess."],
        ["Hold a rate", "Many lenders hold your rate for a few months while you look."],
        ["Make a stronger offer", "Sellers trust buyers whose financing is already lined up."]],
        notes: "Offer to introduce them to a mortgage specialist if they don't have one."}),
      T.offers({sec: "Offers", h: "Which buyer", soft: "would you choose?", ask: "You're the seller. Tap the buyer you'd pick.", win: 0,
        a: {name: "Buyer A", rows: [["Price", "$975,000", ""], ["Mortgage", "Pre-approved", "good"], ["Deposit", "Ready, same day", "good"], ["Conditions", "None, inspection done", "good"], ["Closing", "Flexible", "good"]]},
        b: {name: "Buyer B", rows: [["Price", "$985,000", "good"], ["Mortgage", "Hasn't applied yet", "bad"], ["Deposit", "In a few days", "bad"], ["Conditions", "Financing and inspection", "bad"], ["Closing", "Fixed date only", "bad"]]},
        why: ["The seller knows the money is there", "Nothing left to fall through", "Easy to say yes to"],
        notes: "Ask them to pick before revealing. Pressing next reveals the answer. The lesson: be buyer A."}),
      T.statement({sec: "The search", text: "Your search should run on your list, not on whatever someone wants to show you.", bg: IMG("04-foyer"),
        sub: "So you'll see every match, as soon as it's listed.",
        notes: "Transition into how the search works with you."}),
      T.cards({sec: "The search", h: "You're in", soft: "control.", cols: 5, items: [
        ["Your criteria, saved", "Areas, price, size and must-haves."],
        ["New matches, fast", "Listings sent the moment they hit the MLS®."],
        ["You choose", "Shortlist from home. I'll book the showings."],
        ["Honest opinions", "What I'd worry about, not just what's nice."],
        ["Zero pressure", "We go at your pace, always."]],
        notes: "Offer to set up their search alerts tonight."}),
      T.musthaves({sec: "The search", h: "Must-haves and", soft: "nice-to-haves.", sub: "Tap once for a must-have, twice for a nice-to-have.", items: [
        "Garage", "Big backyard", "Walk to schools", "Home office", "Finished basement", "Close to transit", "Quiet street", "Open-concept kitchen",
        "Primary ensuite", "Second-floor laundry", "Parking for two", "Natural light", "Pool", "Low condo fees"],
        notes: "Let them build the list together. It often starts a useful conversation between partners."}),
      T.cards({sec: "Offers", h: "When you find", soft: "the one.", cols: 3, items: [
        ["An offer built for this home", "Price and terms set by recent sales and the seller's situation."],
        ["Presented in person", "I make your case to the listing agent, not just send a PDF."],
        ["Negotiated term by term", "Price, deposit, conditions, closing date and what's included."]],
        notes: "Explain how you research the seller's situation before writing an offer."}),
      T.strength({h: "What makes an offer", soft: "stronger.", items: [
        ["Pre-approval in hand", "The seller can see your financing is real."], ["Deposit ready same day", "Shows you're serious from the start."],
        ["A price backed by sales", "Grounded in what similar homes sold for."], ["A closing date that suits them", "Timing can matter as much as price."],
        ["Fewer conditions", "Less that can go wrong for the seller."], ["Inspection done before offer day", "Lets you offer with confidence and no condition."]],
        notes: "Tap the pieces they could offer. Watch the meter climb."}),
      T.cards({sec: "Protection", h: "Protected at", soft: "every step.", cols: 4, compact: true, nonum: true, items: [
        ["I work for you", "My duty is to your interests."], ["Your rights, explained", "RECO's Information Guide, walked through together."],
        ["Real comparables", "Every price checked against recent sales."], ["Protective conditions", "Inspection, financing or status certificate, when they make sense."],
        ["Your deposit, held in trust", "Safe with the listing brokerage until closing."], ["If I represent both sides", "You'll be told first, and it's your decision."],
        ["Deadlines watched", "Every condition date tracked."], ["Your lawyer in the loop", "Documents sent the moment they're signed."]],
        notes: "Buyers rarely know these protections exist. Pick two or three to explain in detail."}),
      T.timeline({sec: "Timeline", h: "Your purchase,", soft: "step by step.", steps: [
        ["Start", "Buyer consultation", "We talk through your goals, budget, timing and must-haves."],
        ["Step 1", "Pre-approval", "A lender confirms your budget and holds a rate while you shop."],
        ["Step 2", "Your search", "Matches sent automatically. You shortlist the ones you love."],
        ["Showings", "Seeing homes", "I book the showings and tell you honestly what I see."],
        ["Step 3", "Offer and negotiation", "We write a strong offer and I negotiate every term."],
        ["Accepted", "Conditions", "Inspection, financing or status certificate, if your offer has them."],
        ["Firm", "Lawyer and lender", "Your lawyer and lender prepare everything for closing."],
        ["Closing day", "Your keys", "The keys are yours. Welcome home."]],
        notes: "Press play or tap a step. Give them a realistic timeline from today."}),
      T.cards({sec: "Why me", h: "Why buyers", soft: "work with me.", cols: 4, items: [
        ["One agent, start to finish", "You deal with me, not a rotating team."],
        ["A brokerage behind me", "Royal LePage Pinnacle's network and resources."],
        ["Straight answers", "If a home has a problem, you'll hear it from me."],
        ["Local knowledge", "Toronto and the GTA, neighbourhood by neighbourhood."]],
        notes: "Keep it about them: what each point means for their search."}),
      T.reviews({h: "Don't just take", soft: "my word for it.", items: [REV.jp, REV.henri, REV.april],
        notes: "Let them read. Offer a past client as a reference if they'd like one."}),
      T.monthly({h: "What it costs", soft: "each month.",
        notes: "Use a rate from their lender if they have one. Show how a condo's fees compare with a house's upkeep."}),
      T.cards({sec: "What you get", h: "What you", soft: "get.", cols: 4, items: [
        ["A pre-approval before you shop", "Know your number from day one."],
        ["New listings, automatically", "Every match, as soon as it's listed."],
        ["Pricing and negotiation", "My knowledge working on your side of the table."],
        ["Help after closing", "Trades, questions and your home's value, any time."]],
        notes: "Summarise the value before the close."}),
      T.recap({sec: "Your goals", h: "What matters to you,", soft: "and how I'll deliver it.", options: BUYER_PRIO,
        notes: "Read each one back to them. This is your promise, in their words."}),
      T.closing({h: "Thank you.", soft: "Let's find your home.", bg: IMG("05-open-concept"),
        sub: "No pressure and no rush. When you're ready to start, I'm ready to help.",
        next: ["I'll give you RECO's Information Guide and walk you through it", "We'll review the buyer representation agreement together", "Then I'll set up your search and book your first showings"],
        notes: "One gentle ask, then let them answer in their own time."}),
    ]},
  };

  /* ---------- views: PIN, picker, presenter ---------- */
  const pinform = $("#pinform"), home = $("#home"), present = $("#present"), viewport = $("#viewport"), stage = $("#stage");
  const notesEl = $("#notes"), overview = $("#overview");
  function view(v) {
    pinform.hidden = v !== "pin"; home.hidden = v !== "home"; present.hidden = v !== "present";
    document.body.classList.toggle("presenting", v === "present");
    $("#lock").hidden = v === "pin";
  }
  pinform.addEventListener("submit", async e => {
    e.preventDefault();
    if (await sha256($("#pin").value.trim()) === PIN_HASH) {
      try { sessionStorage.setItem("gh_pres", "1"); } catch (_) {}
      $("#pin").value = ""; $("#pinerr").textContent = ""; view("home");
    } else { $("#pinerr").textContent = "That PIN isn't right. Try again."; $("#pin").select(); }
  });
  $("#lock").addEventListener("click", () => { try { sessionStorage.removeItem("gh_pres"); } catch (_) {} store.set("active", null); exitFull(); view("pin"); $("#pin").focus(); });
  $("#fresh").addEventListener("click", () => { store.clear(); $("#fresh").textContent = "Cleared. Ready for a new client."; });
  $$("[data-deck]").forEach(b => b.addEventListener("click", () => start(b.dataset.deck, 0)));
  $$("[data-count]").forEach(s => s.textContent = DECKS[s.dataset.count].slides.length + " slides");

  /* ---------- presenter ---------- */
  let deck = null, slides = [], els = [], cur = 0, shown = 0;
  const ctx = {
    get deck() { return deck; },
    indexOf: kind => slides.findIndex(s => s.kind === kind),
    reel: () => openReel(),
  };

  function start(key, at) {
    deck = key; slides = DECKS[key].slides; cur = 0;
    stage.innerHTML = ""; els = slides.map((s, i) => {
      const el = document.createElement("section");
      el.className = "slide " + (s.cls || ""); el.setAttribute("aria-roledescription", "slide"); el.setAttribute("aria-label", `${i + 1} of ${slides.length}`);
      el.innerHTML = s.html + `<div class="foot"><span>${AGENT.name} · ${AGENT.brokerage}</span><span>${n2(i)} / ${slides.length}</span></div>`;
      stage.append(el); return el;
    });
    slides.forEach((s, i) => s.init && s.init(els[i], ctx));
    syncClient();
    $("#deckname").textContent = DECKS[key].name;
    view("present"); fit(); go(Math.min(at || 0, slides.length - 1), true, true);
    store.set("active", key);
  }
  function go(i, all = false, first = false) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    if (!first && els[cur]) { els[cur].classList.remove("on"); els[cur].dispatchEvent(new Event("hide")); }
    cur = i; const el = els[cur];
    el.classList.add("on");
    const steps = $$(".step", el); shown = all ? steps.length : 0;
    steps.forEach((s, j) => s.classList.toggle("shown", j < shown));
    if (slides[cur].show) slides[cur].show(el, ctx);
    el.dispatchEvent(new Event("refresh"));
    $("#sec").textContent = slides[cur].sec || "";
    $("#count").textContent = `${n2(cur)} / ${slides.length}`;
    $("#prog").style.width = ((cur + 1) / slides.length * 100) + "%";
    $("#prev").disabled = cur === 0; $("#next").disabled = cur === slides.length - 1 && shown >= steps.length;
    notesEl.innerHTML = `<b>Notes · slide ${cur + 1}</b>${slides[cur].notes || "No notes for this slide."}`;
    if (!overview.hidden) markThumb();
    store.set("pos_" + deck, cur);
  }
  function next() {
    const el = els[cur], steps = $$(".step", el);
    if (slides[cur].next && slides[cur].next(el)) return;
    if (shown < steps.length) { steps[shown++].classList.add("shown"); }
    else if (cur < slides.length - 1) go(cur + 1);
    $("#next").disabled = cur === slides.length - 1 && shown >= $$(".step", els[cur]).length;
  }
  function prev() { if (cur > 0) go(cur - 1, true); }
  $("#next").addEventListener("click", next);
  $("#prev").addEventListener("click", prev);
  $("#exit").addEventListener("click", () => { exitFull(); closeReel(); store.set("active", null); view("home"); });

  // "Prepared for": typed once on the title slide, shown wherever it's needed
  function syncClient(from) {
    const name = from !== undefined ? from : store.get("client", "");
    $$("[data-client]", stage).forEach(i => { if (i.value !== name) i.value = name; });
    $$("[data-client-for]", stage).forEach(s => s.textContent = name ? ` · for ${name}` : "");
    $$("[data-client-line]", stage).forEach(s => s.textContent = name ? `Prepared for ${name}` : "");
  }
  stage.addEventListener("input", e => { if (e.target.matches("[data-client]")) { store.set("client", e.target.value); syncClient(e.target.value); } });
  stage.addEventListener("click", e => { const g = e.target.closest("[data-goto]"); if (g) go(+g.dataset.goto, true); });

  // scale the 1600 x 900 stage to fit
  function fit() {
    if (present.hidden) return;
    const r = viewport.getBoundingClientRect(), pad = document.fullscreenElement ? 0 : Math.min(28, r.width * .025);
    const k = Math.max(.1, Math.min((r.width - pad * 2) / 1600, (r.height - pad * 2) / 900));
    stage.style.transform = `scale(${k})`; stage.style.setProperty("--k", k);
  }
  addEventListener("resize", fit);

  // full screen, with controls that fade away while presenting
  const toggleFull = () => document.fullscreenElement ? exitFull() : (present.requestFullscreen || present.webkitRequestFullscreen || (() => {})).call(present);
  function exitFull() { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
  $("#full").addEventListener("click", toggleFull);
  if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled) $("#full").hidden = true; // e.g. iPhone Safari
  document.addEventListener("fullscreenchange", () => { $("#full").setAttribute("aria-pressed", !!document.fullscreenElement); setTimeout(fit, 50); poke(); });
  let idle = 0;
  function poke() { present.classList.remove("idle"); clearTimeout(idle); if (document.fullscreenElement) idle = setTimeout(() => present.classList.add("idle"), 2600); }
  present.addEventListener("pointermove", poke);

  // notes and the all-slides view
  function toggleNotes(force) { const on = force !== undefined ? force : notesEl.hidden; notesEl.hidden = !on; $("#notesbtn").setAttribute("aria-pressed", on); }
  $("#notesbtn").addEventListener("click", () => toggleNotes());
  function toggleOverview(force) {
    const on = force !== undefined ? force : overview.hidden;
    overview.hidden = !on; $("#slidesbtn").setAttribute("aria-pressed", on);
    if (!on) return;
    const grid = $(".overview-grid", overview); grid.innerHTML = "";
    els.forEach((el, i) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "thumb"; b.dataset.i = i;
      b.innerHTML = `<div class="mini"></div><span><b>${n2(i)}</b>${plain(slides[i].title || slides[i].sec || "")}</span>`;
      const clone = el.cloneNode(true); clone.classList.add("on"); clone.removeAttribute("aria-label"); clone.setAttribute("inert", "");
      $(".mini", b).append(clone); grid.append(b);
    });
    requestAnimationFrame(() => { $$(".thumb .mini", grid).forEach(m => { const s = m.clientWidth / 1600; m.firstChild.style.transform = `scale(${s})`; }); markThumb(true); });
  }
  function markThumb(scroll) { $$(".thumb", overview).forEach(t => t.classList.toggle("on", +t.dataset.i === cur)); if (scroll) { const t = $(".thumb.on", overview); t && t.scrollIntoView({block: "center"}); } }
  overview.addEventListener("click", e => { const t = e.target.closest(".thumb"); if (t) { go(+t.dataset.i, true); toggleOverview(false); } });
  $("#slidesbtn").addEventListener("click", () => toggleOverview());

  // sample listing reel, made from the house tour photos
  const REEL = [["01-front", "Curb appeal", "First impressions"], ["02-door", "The arrival", "Details that sell"], ["04-foyer", "A grand foyer", "Light and space"],
    ["05-open-concept", "Open-concept living", "Room to gather"], ["07-back-door-open", "Indoor–outdoor flow", "Doors that open wide"], ["08-backyard", "Evenings outside", "The view buyers remember"]];
  let reelTimer = 0;
  function openReel() {
    closeReel();
    const r = document.createElement("div"); r.className = "reel"; r.id = "reel";
    r.innerHTML = REEL.map(([img, t, s]) => `<figure><img src="${IMG(img)}" alt=""><figcaption><small>${s}</small>${t}</figcaption></figure>`).join("") +
      `<img class="brandmark" src="/assets/brand/logo-dark.svg?v=2" alt=""><button type="button" class="x" aria-label="Close the reel">×</button>`;
    stage.append(r);
    const figs = $$("figure", r); let i = 0;
    const show = () => figs.forEach((f, j) => f.classList.toggle("on", j === i));
    requestAnimationFrame(() => requestAnimationFrame(show));
    reelTimer = setInterval(() => { i++; if (i >= figs.length) return closeReel(); show(); }, 3600);
    $(".x", r).addEventListener("click", closeReel);
  }
  function closeReel() { clearInterval(reelTimer); const r = $("#reel"); if (r) r.remove(); }

  // keyboard, clickers and swipes
  document.addEventListener("keydown", e => {
    if (present.hidden) return;
    const t = e.target, k = e.key;
    const typing = t.matches && t.matches("input[type=text],textarea"), slider = t.matches && t.matches("input[type=range]");
    if (typing && !["PageDown", "PageUp", "Escape"].includes(k)) return;
    if (slider && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(k)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(k)) { e.preventDefault(); if (typing) t.blur(); next(); }
    else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(k)) { e.preventDefault(); if (typing) t.blur(); prev(); }
    else if (k === "f" || k === "F") toggleFull();
    else if (k === "o" || k === "O") toggleOverview();
    else if (k === "n" || k === "N") toggleNotes();
    else if (k === "Home") go(0);
    else if (k === "End") go(slides.length - 1, true);
    else if (k === "Escape") { if ($("#reel")) closeReel(); else if (!overview.hidden) toggleOverview(false); else if (!notesEl.hidden) toggleNotes(false); }
    else return;
    poke();
  });
  let sx = null, sy = 0;
  viewport.addEventListener("touchstart", e => {
    if (e.touches.length !== 1 || e.target.closest("input, .ba, .chips, .pool, .toggles, .steps")) { sx = null; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, {passive: true});
  viewport.addEventListener("touchend", e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) dx < 0 ? next() : prev();
  }, {passive: true});

  /* ---------- open where we left off ---------- */
  let ok = false; try { ok = sessionStorage.getItem("gh_pres") === "1"; } catch (_) {}
  view(ok ? "home" : "pin");
  const active = store.get("active", null);
  if (ok && active && DECKS[active]) start(active, store.get("pos_" + active, 0));
})();
