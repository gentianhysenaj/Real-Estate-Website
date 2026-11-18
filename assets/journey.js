/* Scroll journey on the home page.
   Scroll position (0 to 1) drives one continuous camera move through one house: the front in full sun,
   up the walk as the front door swings open, through the foyer into the open-concept living space,
   then out through the back glass doors to the backyard as the sun sets and the lights come on.
   Info panels scroll over the top.

   ── Three ways to feed it, best first ──────────────────────────────────────────────────────
   1. FRAMES (seamless walk-through video, no buffering): cut a continuous video into frames with
      tools/make-tour-frames.sh and set TOUR.frames.count. Every frame is preloaded.
   2. VIDEO: set TOUR.video to an mp4. The whole file downloads before scrubbing starts.
   3. PHOTOS (what's live now): TOUR.shots. Each photo is a "set" the camera glides across;
      neighbouring sets melt into each other while the camera keeps moving, so there is no cut.
      cam: camera keyframes [at, x, y, zoom] — at is 0..1 inside the shot, x/y the point of the
      photo at the centre of the screen (0..1), zoom 1 = photo just covers the screen.
   ─────────────────────────────────────────────────────────────────────────────────────────── */
const TOUR = {
  frames: {dir: "/assets/tour/frames/", count: 0, ext: "webp", digits: 4},
  video: "",
  // One house, eight AI-generated shots made to match (Canva). The camera keeps moving through each
  // hand-off. Pairs marked seamlessOut/seamlessIn share one camera position, so the front door and the
  // back doors appear to swing open in place as you scroll.
  shots: [
    {room: "Front",            src: "/assets/tour/01-front.webp",         from: 0,   to: .14,
      cam: [[0, .5, .5, 1.0], [1, .5, .6, 2.0]]},
    {room: "Front door",       src: "/assets/tour/02-door.webp",          from: .12, to: .25, seamlessOut: true,
      cam: [[0, .5, .52, 1.0], [1, .5, .5, 1.1]]},
    {room: "Door opens",       src: "/assets/tour/03-door-open.webp",     from: .20, to: .36, seamlessIn: true, seamlessOut: true,
      // walk in through the doorway: the foyer photo is set into it (tools/compose-doorway.py)
      cam: [[0, .5, .5, 1.08], [1, .5026, .4681, 2.1]]},
    {room: "Foyer",            src: "/assets/tour/04-foyer.webp",         from: .31, to: .47, seamlessIn: true,
      // this photo is the view through the doorway of the shot before: centre and zoom printed by
      // tools/compose-doorway.py, so the two stay locked together while one dissolves into the other
      inside: {x: .5026, y: .4681, scale: 1.797},
      cam: [[0, .5, .5, 1.05], [1, .5, .52, 1.45]]},
    {room: "Open concept",     src: "/assets/tour/05-open-concept.webp",  from: .44, to: .64,
      cam: [[0, .42, .56, 1.12], [.5, .47, .55, 1.06], [1, .47, .52, 1.45]]},
    {room: "Back door closed", src: "/assets/tour/06-back-door.webp",     from: .61, to: .77, seamlessOut: true,
      cam: [[0, .5, .5, 1.0], [1, .5, .5, 1.1]]},
    {room: "Back door opens",  src: "/assets/tour/07-back-door-open.webp", from: .72, to: .86, seamlessIn: true,
      cam: [[0, .5, .5, 1.08], [1, .5, .56, 1.8]]},
    {room: "Backyard",         src: "/assets/tour/08-backyard.webp",      from: .83, to: 1,
      cam: [[0, .52, .65, 1.35], [.6, .5, .58, 1.1], [1, .5, .5, 1.0]],
      glows: [
        {x: .5, y: .655, r: .11, c: "255,170,80", flicker: 1},  // fire pit
        {x: .32, y: .44, r: .12, c: "255,196,120"},             // uplit olive and garden wall, left
        {x: .8, y: .46, r: .14, c: "255,196,120"},              // uplit olive and garden wall, right
        {x: .15, y: .14, r: .09, c: "255,214,150"},             // soffit downlights
      ]},
  ],
};

(() => {
  const $ = id => document.getElementById(id);
  const journey = $("journey"), shotsEl = $("shots"), video = $("tour-video"), clock = $("clock"),
        sun = $("sun"), dusk = $("dusk"), grade = $("grade"), rooms = [...document.querySelectorAll("#rooms li")];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("yr").textContent = new Date().getFullYear();

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const seg = (p, a, b) => clamp((p - a) / (b - a));
  const smooth = t => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const OVERLAP = .05;                                         // how long neighbouring sets melt together

  /* ---------- 1. frame sequence on a canvas ---------- */
  const F = TOUR.frames, useFrames = F && F.count > 0;
  const canvas = $("tour-canvas"), ctx = canvas && canvas.getContext("2d"), loader = $("tour-loader");
  const frames = [];
  let loaded = 0, lastDrawn = -1;
  if (useFrames) {
    shotsEl.hidden = true; canvas.hidden = false; if (loader) loader.hidden = false;
    const name = i => F.dir + String(i + 1).padStart(F.digits, "0") + "." + F.ext;
    const order = [], seen = new Set();                        // coarse pass first, then fill the gaps
    for (const step of [16, 4, 1]) for (let i = 0; i < F.count; i += step) if (!seen.has(i)) { seen.add(i); order.push(i); }
    let next = 0;
    const pump = () => {
      if (next >= order.length) return;
      const i = order[next++], img = new Image();
      img.decoding = "async";
      img.onload = async () => {
        try { await img.decode(); } catch (_) {}
        frames[i] = img; loaded++;
        if (loader) { loader.style.setProperty("--pct", (loaded / F.count * 100).toFixed(1) + "%"); if (loaded === F.count) loader.classList.add("done"); }
        if (lastDrawn < 0) render(shown);
        pump();
      };
      img.onerror = () => { loaded++; pump(); };
      img.src = name(i);
    };
    for (let k = 0; k < 6; k++) pump();
  }
  function sizeCanvas(){
    if (!useFrames) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); lastDrawn = -1;
  }
  function drawFrame(p){
    const want = Math.round(p * (F.count - 1));
    let i = -1;
    for (let d = 0; d < F.count; d++) { if (frames[want - d]) { i = want - d; break; } if (frames[want + d]) { i = want + d; break; } }
    const img = frames[i]; if (!img || i === lastDrawn) return;
    const cw = canvas.width, ch = canvas.height, s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h); lastDrawn = i;
  }

  /* ---------- 2. whole-file video ---------- */
  const useVideo = !useFrames && !!TOUR.video;
  if (useVideo) {
    shotsEl.hidden = true; video.hidden = false;
    fetch(TOUR.video).then(r => r.blob()).then(b => {
      video.src = URL.createObjectURL(b);
      video.addEventListener("loadedmetadata", () => render(shown), {once: true});
    }).catch(() => { video.src = TOUR.video; });
  }

  /* ---------- 3. photo sets with a moving camera ---------- */
  const shots = (useFrames || useVideo ? [] : TOUR.shots).map((s, i) => {
    const wrap = document.createElement("div"); wrap.className = "set";
    const img = new Image(); img.alt = ""; img.decoding = "async"; img.src = s.src;
    if (i === 0) img.fetchPriority = "high";
    wrap.append(img);
    const glows = (s.glows || []).map(g => {
      const el = document.createElement("i"); el.className = "glow" + (g.flicker ? " flicker" : "");
      el.style.cssText = `left:${g.x * 100}%;top:${g.y * 100}%;--r:${g.r};--c:${g.c}`;
      wrap.append(el); return el;
    });
    shotsEl.append(wrap);
    const shot = {...s, wrap, img, glows, w: 0, h: 0};
    // decode up front so no frame of the scroll ever waits on an image
    const ready = () => (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => { shot.w = img.naturalWidth; shot.h = img.naturalHeight; layout(); render(shown); });
    if (img.complete && img.naturalWidth) queueMicrotask(ready); else img.addEventListener("load", ready, {once: true});
    return shot;
  });
  function layout(){
    const W = innerWidth, H = innerHeight;
    shots.forEach(s => {
      if (!s.w) return;
      const c = Math.max(W / s.w, H / s.h);                    // "cover" size at zoom 1
      s.bw = s.w * c; s.bh = s.h * c;
      s.wrap.style.width = s.bw + "px"; s.wrap.style.height = s.bh + "px";
      s.glows.forEach(g => { const r = parseFloat(g.style.getPropertyValue("--r")) * s.bw; g.style.width = g.style.height = r * 2 + "px"; g.style.margin = -r + "px 0 0 " + -r + "px"; });
    });
  }
  function camAt(cam, t){
    for (let i = 1; i < cam.length; i++) if (t <= cam[i][0]) {
      const a = cam[i - 1], b = cam[i], k = smooth((t - a[0]) / (b[0] - a[0] || 1));
      return [lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k)];
    }
    const z = cam.at(-1); return [z[1], z[2], z[3]];
  }
  // Where the camera is for shot i at scroll p: x/y = point of the photo at the screen centre, z = zoom.
  // A seamlessIn shot first rides on the previous shot's camera (mapped through `inside` when its photo
  // sits inside the previous one, like the foyer seen through the front door), so both photos stay
  // locked together through the dissolve; then it eases onto its own path.
  function camFor(s, i, p){
    const W = innerWidth, H = innerHeight;
    // the camera keeps moving through the melt: before/after its range the shot keeps drifting the same way
    const span = s.to - s.from, t = (p - s.from) / span;
    let [x, y, z] = camAt(s.cam, clamp(t));
    if (t > 1 && !s.seamlessOut) z *= 1 + (t - 1) * span * 4;  // keep pushing forward while leaving
    if (t < 0 && !s.seamlessIn) z *= 1 / (1 - t * span * 2.5);  // arrive slightly wide, already moving in
    const prev = shots[i - 1];
    if (s.seamlessIn && prev && prev.cur && p < s.from + 2 * OVERLAP) {
      const m = s.inside || {x: .5, y: .5, scale: 1}, [px, py, pz] = prev.cur;
      const k = smooth(seg(p, s.from + OVERLAP, s.from + 2 * OVERLAP));
      x = lerp(.5 + (px - m.x) * m.scale, x, k);
      y = lerp(.5 + (py - m.y) * m.scale, y, k);
      z = lerp(pz / m.scale, z, k);
    }
    if (reduce) z = 1.02;
    z = Math.max(z, 1);
    const hw = W / 2 / (s.bw * z), hh = H / 2 / (s.bh * z);    // never show the photo's edges
    x = clamp(x, hw, 1 - hw); y = clamp(y, hh, 1 - hh);
    return (s.cur = [x, y, z]);
  }
  function placeShot(s, [x, y, z]){
    const W = innerWidth, H = innerHeight;
    s.wrap.style.transform = `translate3d(${(W / 2 - x * s.bw * z).toFixed(1)}px,${(H / 2 - y * s.bh * z).toFixed(1)}px,0) scale(${z.toFixed(4)})`;
  }

  /* ---------- the timeline ---------- */
  let target = 0, shown = 0;
  function render(p){
    if (useFrames) drawFrame(p);
    else if (useVideo) { if (video.duration && !video.seeking) video.currentTime = p * (video.duration - .05); }
    else shots.forEach((s, i) => {
      if (!s.bw) { s.cur = null; return; }
      const cam = camFor(s, i, p);
      // each set dissolves in on top of the one before; the one below stays solid until it's covered,
      // so the background never shows through mid-dissolve
      const fadeIn = i === 0 ? 1 : smooth(seg(p, s.from, s.from + OVERLAP));
      const next = shots[i + 1], covering = next ? seg(p, next.from, next.from + OVERLAP) : 0;
      const o = covering >= 1 ? 0 : fadeIn;
      s.wrap.style.opacity = o.toFixed(3);
      s.wrap.style.visibility = o > .001 ? "visible" : "hidden";
      if (o > .001) placeShot(s, cam);
      // the outgoing set softens as you move past it, so the hand-off reads as motion, not a cut
      const soft = reduce || s.seamlessOut ? 0 : covering * 5;
      s.img.style.filter = soft > .2 ? `blur(${soft.toFixed(1)}px)` : "";
      if (s.glows.length) {
        const lights = smooth(seg(p, .87, .99));
        s.glows.forEach(g => g.style.opacity = lights.toFixed(3));
      }
    });

    // daylight: a bright sun to start, warming through the afternoon, a sunset sky over the backyard
    if (!useFrames && !useVideo) {
      // the photos carry their own daylight, so these only add a touch of sun, warmth and sunset
      sun.style.opacity = ((1 - smooth(seg(p, .06, .2))) * .6).toFixed(3);
      grade.style.opacity = (smooth(seg(p, .3, .95)) * .18).toFixed(3);
      dusk.style.opacity = (smooth(seg(p, .85, 1)) * .25).toFixed(3);
    }

    let on = 0; rooms.forEach((li, i) => { if (p + .02 >= +li.dataset.at) on = i; });
    rooms.forEach((li, i) => li.classList.toggle("on", i === on));
    const mins = Math.round((10.5 * 60 + p * 600) / 5) * 5, hh = Math.floor(mins / 60), mm = mins % 60;
    clock.textContent = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
  }

  const last = document.querySelector(".panel.last");
  function fit(){ journey.style.marginBottom = Math.max(0, last.offsetTop + last.offsetHeight - journey.offsetHeight) + "px"; }
  function measure(){
    const r = journey.getBoundingClientRect(), range = journey.offsetHeight - innerHeight;
    target = clamp(-r.top / range);
    document.body.classList.toggle("at-top", target < .03);
    document.body.classList.toggle("hud-off", r.bottom < innerHeight * .6 ||
      (innerWidth <= 860 && last.getBoundingClientRect().top < innerHeight * .3));   // the tall contact form on phones
  }
  let raf = 0;
  function tick(){
    shown += (target - shown) * (reduce ? 1 : .1);              // a little inertia, like a steady camera
    if (Math.abs(target - shown) < .0001) shown = target;
    render(shown);
    raf = shown !== target ? requestAnimationFrame(tick) : 0;
  }
  function kick(){ measure(); if (!raf) raf = requestAnimationFrame(tick); }
  addEventListener("scroll", kick, {passive: true});
  addEventListener("resize", () => { sizeCanvas(); layout(); fit(); measure(); render(shown); });
  sizeCanvas(); layout(); fit(); measure(); shown = target; render(shown);

  rooms.forEach(li => li.addEventListener("click", () => {
    const range = journey.offsetHeight - innerHeight;
    scrollTo({top: journey.offsetTop + range * (+li.dataset.at + .02), behavior: reduce ? "auto" : "smooth"});
  }));
  document.querySelectorAll("[data-reason]").forEach(a => a.addEventListener("click", () => { const s = $("c-reason"); if (s) s.value = a.dataset.reason; }));
})();
