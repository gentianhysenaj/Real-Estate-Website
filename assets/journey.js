/* Scroll journey: maps scroll position (0 to 1) to a "camera" on three drawn scenes,
   opens the front door, walks through the house, and turns day into sunset. */
(() => {
  const $ = id => document.getElementById(id);
  const journey = $("journey"), sky = $("sky"), ext = $("ext"), int = $("int"), yard = $("yard"),
        door = $("door"), flash = $("flash"), slideL = $("slideL"), slideR = $("slideR"),
        duskInt = $("dusk-int"), clock = $("clock"), rooms = [...document.querySelectorAll("#rooms li")];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById("yr").textContent = new Date().getFullYear();

  /* ---------- helpers ---------- */
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const seg = (p, a, b) => clamp((p - a) / (b - a));               // 0..1 progress inside [a,b]
  const ease = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const hex = h => [1,3,5].map(i => parseInt(h.slice(i, i+2), 16));
  const mix = (c1, c2, t) => { const a = hex(c1), b = hex(c2); return `rgb(${a.map((v,i) => Math.round(lerp(v, b[i], t))).join(",")})`; };
  function keyframes(list, p){                                     // list: [[at, value], ...] of hex colours
    for (let i = 1; i < list.length; i++) if (p <= list[i][0]) {
      const [a, ca] = list[i-1], [b, cb] = list[i]; return mix(ca, cb, (p - a) / (b - a)); }
    return mix(list.at(-1)[1], list.at(-1)[1], 0);
  }
  function camera(svg, cx, cy, w){                                 // a viewBox with the screen's aspect ratio
    const a = innerWidth / innerHeight, h = w / a;
    svg.setAttribute("viewBox", `${(cx - w/2).toFixed(2)} ${(cy - h/2).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
  }
  function wide(){                                                 // framing that shows a whole 1600x900 scene
    const a = innerWidth / innerHeight;
    if (a >= 16/9) { const w = 1600, h = w / a; return {cx: 800, cy: 900 - h/2, w}; }
    if (a >= 1)    { const w = 900 * a; return {cx: 800, cy: 450, w}; }
    const w = 1150, h = w / a, bottom = 900 + (h - 900) * .18; return {cx: 800, cy: bottom - h/2, w};
  }

  /* ---------- sky colours through the day: [scroll position, colour] ---------- */
  const SKY = {
    s1: [[0,"#2a86d6"],[.45,"#3b82cc"],[.7,"#4a68a8"],[.84,"#2a2c62"],[1,"#141a3a"]],
    s2: [[0,"#74b8ee"],[.45,"#8fc0e6"],[.7,"#d8a27c"],[.84,"#c65f78"],[1,"#6b3a66"]],
    s3: [[0,"#d9f0fd"],[.45,"#f2e8cc"],[.7,"#ffd08a"],[.84,"#ffab5e"],[1,"#e0794e"]],
    hill: [[0,"#93b99c"],[.5,"#8fae8f"],[.7,"#8a7f74"],[.84,"#5a3f5e"],[1,"#3b2b45"]],
    tree: [[0,"#5d8b55"],[.5,"#577f4f"],[.7,"#5b5a46"],[.84,"#3b2b45"],[1,"#24202b"]],
    pool: [[0,"#5fb4d6"],[.6,"#6aa9c6"],[.84,"#d6727a"],[1,"#8a4a6a"]],
  };

  /* ---------- string light bulbs placed along the wires ---------- */
  const bulbs = $("bulbs"), NS = "http://www.w3.org/2000/svg", bulbEls = [];
  ["wire1","wire2"].forEach(id => {
    const path = $(id), len = path.getTotalLength(), n = id === "wire1" ? 22 : 17;
    for (let i = 1; i < n; i++) {
      const pt = path.getPointAtLength(len * i / n);
      const g = document.createElementNS(NS, "circle"); g.setAttribute("cx", pt.x); g.setAttribute("cy", pt.y + 9); g.setAttribute("r", 28); g.setAttribute("fill", "url(#y-bulb)");
      const b = document.createElementNS(NS, "circle"); b.setAttribute("cx", pt.x); b.setAttribute("cy", pt.y + 9); b.setAttribute("r", 5);
      bulbs.append(g, b); bulbEls.push([g, b, Math.random() * .15]);
    }
  });
  const yardLights = [...yard.querySelectorAll(".lights, .uplight")];
  const lamps = [...int.querySelectorAll(".lamp")];

  /* ---------- the timeline ---------- */
  let target = 0, shown = 0;
  function render(p){
    const a = innerWidth / innerHeight;

    // sky
    for (const k of ["s1","s2","s3"]) sky.style.setProperty("--" + k, keyframes(SKY[k], p));
    for (const k of ["hill","tree","pool"]) int.style.setProperty("--" + k, keyframes(SKY[k], p));

    // 1. exterior: walk up the path and zoom to the front door, which swings open
    const z = ease(seg(p, 0, .17)), W = wide(), wEnd = 205 * a;
    if (!reduce) camera(ext, lerp(W.cx, 800, z), lerp(W.cy, 546, z), W.w * Math.pow(wEnd / W.w, z));
    else camera(ext, W.cx, W.cy, W.w);
    const open = ease(seg(p, .1, .165));
    door.setAttribute("transform", `translate(760 0) scale(${(1 - open * .9).toFixed(3)} 1) translate(-760 0)`);

    // 2. interior: step in, pan through living room, kitchen and great room, then the glass doors slide open
    const H = 900, wI = H * a, panEnd = 4360, panStart = wI / 2 - 40;
    const step = ease(seg(p, .18, .23)), pan = ease(seg(p, .22, .7)), zoomOut = ease(seg(p, .7, .8));
    let cx = lerp(panStart, panEnd, pan), w = wI * lerp(.72, 1, step);
    if (zoomOut > 0) w = wI * Math.pow((560 * a) / wI, zoomOut);
    if (reduce) { cx = p < .4 ? panStart : p < .58 ? 2400 : panEnd; w = wI; }
    camera(int, cx, 450 + (1 - step) * 40, w);
    const slide = ease(seg(p, .72, .79)) * 350;
    slideL.setAttribute("transform", `translate(${-slide} 0)`); slideR.setAttribute("transform", `translate(${slide} 0)`);
    duskInt.setAttribute("opacity", (seg(p, .45, .8) * .35).toFixed(3));
    const lampOn = .25 + seg(p, .35, .75) * .75; lamps.forEach(l => l.setAttribute("opacity", lampOn.toFixed(3)));

    // 3. backyard: step out and look around as the lights come on
    const out = ease(seg(p, .8, .93)), Y = wide();
    if (!reduce) camera(yard, lerp(820, Y.cx, out), lerp(640, Y.cy, out), lerp(Y.w * .62, Y.w, out));
    else camera(yard, Y.cx, Y.cy, Y.w);
    const lights = seg(p, .83, .97);
    yardLights.forEach(el => el.setAttribute("opacity", lights.toFixed(3)));
    bulbEls.forEach(([g, b, d]) => { const t = clamp((lights - d) * 1.3); g.setAttribute("opacity", t.toFixed(3)); b.setAttribute("fill", mix("#5a4a38", "#fff0c4", t)); });

    // scene switching, hidden behind two flashes of light
    ext.style.opacity = p < .185 ? 1 : 0;
    int.style.opacity = p >= .185 && p < .8 ? 1 : 0;
    yard.style.opacity = p >= .8 ? 1 : 0;
    const f1 = 1 - Math.abs(p - .185) / .03, f2 = 1 - Math.abs(p - .8) / .035;
    flash.style.background = p < .5 ? "#fff1d2" : "#ffd9a6";
    flash.style.opacity = clamp(Math.max(f1, f2)).toFixed(3);

    // HUD: room + time of day (10:30 AM to 8:30 PM)
    let on = 0; rooms.forEach((li, i) => { if (p + .02 >= +li.dataset.at) on = i; });
    rooms.forEach((li, i) => li.classList.toggle("on", i === on));
    const mins = Math.round((10.5 * 60 + p * 600) / 5) * 5, hh = Math.floor(mins / 60), mm = mins % 60;
    clock.textContent = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
  }

  // if the last panel (contact form) is taller than the screen, give the page room for it
  const last = document.querySelector(".panel.last");
  function fit(){ journey.style.marginBottom = Math.max(0, last.offsetTop + last.offsetHeight - journey.offsetHeight) + "px"; }
  fit();
  function measure(){
    const r = journey.getBoundingClientRect(), range = journey.offsetHeight - innerHeight;
    target = clamp(-r.top / range);
    document.body.classList.toggle("hud-off", r.bottom < innerHeight * .6);
  }
  let raf = 0;
  function tick(){
    shown += (target - shown) * (reduce ? 1 : .14);                 // gentle smoothing
    if (Math.abs(target - shown) < .0002) shown = target;
    render(shown);
    raf = shown !== target ? requestAnimationFrame(tick) : 0;
  }
  function kick(){ measure(); if (!raf) raf = requestAnimationFrame(tick); }
  addEventListener("scroll", kick, {passive: true});
  addEventListener("resize", () => { fit(); measure(); render(shown); });
  measure(); shown = target; render(shown);

  // clicking a room in the HUD scrolls there
  rooms.forEach(li => li.addEventListener("click", () => {
    const range = journey.offsetHeight - innerHeight;
    scrollTo({top: journey.offsetTop + range * (+li.dataset.at + .03), behavior: reduce ? "auto" : "smooth"});
  }));
  // "What's my home worth?" buttons preselect the reason in the contact form
  document.querySelectorAll("[data-reason]").forEach(a => a.addEventListener("click", () => { const s = $("c-reason"); if (s) s.value = a.dataset.reason; }));
})();
