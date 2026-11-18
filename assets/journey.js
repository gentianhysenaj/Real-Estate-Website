/* Scroll journey on the home page.
   Scroll position (0 to 1) drives a walk through a home, from the street to the backyard at sunset.

   ── Three ways to feed it, best first ──────────────────────────────────────────────────────
   1. FRAMES (seamless, no buffering): one continuous walk-through video, cut into still frames
      with tools/make-tour-frames.sh. Every frame is preloaded (coarse pass first, then the gaps),
      and scrolling flips through them on a canvas, so it never stalls. Set TOUR.frames.count.
   2. VIDEO: set TOUR.video to an mp4. The whole file is downloaded before scrubbing starts.
   3. PHOTOS (fallback): TOUR.shots, each photo pushes in and dissolves into the next.
   ─────────────────────────────────────────────────────────────────────────────────────────── */
const TOUR = {
  frames: {dir: "/assets/tour/frames/", count: 0, ext: "webp", digits: 4},   // count = number of frames made by the script
  video: "",
  // Interim photos: free to use under the Unsplash licence (unsplash.com/license). Photographers credited in the footer.
  shots: [
    {room: "Arrival",    from: 0,   to: .17, focus: [50, 62], zoom: [1.04, 1.55], src: "photo-1613490493576-7fde63acd811", by: "Avi Werde"},
    {room: "Front door", from: .15, to: .30, focus: [50, 55], zoom: [1.0, 1.7],   src: "photo-1613544723301-176686aa9f09", by: "Zac Gudakov"},
    {room: "Entrance",   from: .28, to: .44, focus: [55, 50], zoom: [1.05, 1.45], src: "photo-1778731525521-d0e6477b1bda", by: "Franco Debartolo"},
    {room: "Living",     from: .42, to: .61, focus: [50, 50], zoom: [1.05, 1.4],  src: "photo-1757524503555-b62633f47670", by: "Michael Brown"},
    {room: "Kitchen",    from: .59, to: .80, focus: [50, 50], zoom: [1.05, 1.4],  src: "photo-1778731660397-6a66493be391", by: "Franco Debartolo"},
    {room: "Backyard",   from: .78, to: 1,   focus: [50, 60], zoom: [1.3, 1.02],  src: "photo-1757356657991-c3fd6e2e812e", by: "Michael Brown"},
  ],
};

(() => {
  const $ = id => document.getElementById(id);
  const journey = $("journey"), shotsEl = $("shots"), grade = $("grade"), flash = $("flash"),
        video = $("tour-video"), clock = $("clock"), rooms = [...document.querySelectorAll("#rooms li")];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("yr").textContent = new Date().getFullYear();

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const seg = (p, a, b) => clamp((p - a) / (b - a));
  const ease = t => t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const url = (id, w) => id.startsWith("/") || id.startsWith("http") ? id
    : `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=72`;

  /* ---------- 1. frame sequence on a canvas ---------- */
  const F = TOUR.frames, useFrames = F && F.count > 0;
  const canvas = $("tour-canvas"), ctx = canvas && canvas.getContext("2d"), loader = $("tour-loader");
  const frames = [];
  let loaded = 0, lastDrawn = -1;
  if (useFrames) {
    shotsEl.hidden = true; canvas.hidden = false;
    const name = i => F.dir + String(i + 1).padStart(F.digits, "0") + "." + F.ext;
    // load order: every 16th frame, then every 4th, then the rest, so any scroll position has a close frame early
    const order = [], seen = new Set();
    for (const step of [16, 4, 1]) for (let i = 0; i < F.count; i += step) if (!seen.has(i)) { seen.add(i); order.push(i); }
    let next = 0;
    const pump = () => {
      if (next >= order.length) return;
      const i = order[next++], img = new Image();
      img.decoding = "async";
      img.onload = async () => {
        try { await img.decode(); } catch(_){}
        frames[i] = img; loaded++;
        if (loader) { loader.style.setProperty("--pct", (loaded / F.count * 100).toFixed(1) + "%"); if (loaded === F.count) loader.classList.add("done"); }
        if (i === 0 || lastDrawn < 0) render(shown);
        pump();
      };
      img.onerror = () => { loaded++; pump(); };
      img.src = name(i);
    };
    for (let k = 0; k < 6; k++) pump();
    if (loader) loader.hidden = false;
  }
  function sizeCanvas(){
    if (!canvas) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); lastDrawn = -1;
  }
  function drawFrame(p){
    const want = Math.round(p * (F.count - 1));
    let i = want;                                            // nearest frame that has arrived
    for (let d = 0; d < F.count; d++) { if (frames[want - d]) { i = want - d; break; } if (frames[want + d]) { i = want + d; break; } }
    const img = frames[i]; if (!img || i === lastDrawn) return;
    const cw = canvas.width, ch = canvas.height, s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h); lastDrawn = i;
  }

  /* ---------- 3. photo layers (fallback) ---------- */
  const shots = (useFrames ? [] : TOUR.shots).map((s, i) => {
    const img = new Image();
    img.alt = ""; img.decoding = "async"; img.loading = i < 2 ? "eager" : "lazy";
    if (i === 0) img.fetchPriority = "high";
    img.src = url(s.src, 1600);
    if (!s.src.startsWith("/")) img.srcset = [1000, 1600, 2400].map(w => `${url(s.src, w)} ${w}w`).join(", ");
    img.sizes = "100vw";
    img.style.transformOrigin = `${s.focus[0]}% ${s.focus[1]}%`;
    img.style.objectPosition = `${s.focus[0]}% ${s.focus[1]}%`;
    img.onerror = () => img.classList.add("broken");
    shotsEl.append(img);
    return {...s, img};
  });
  // load the later rooms once the page is idle, so they're ready before you scroll there
  addEventListener("load", () => setTimeout(() => shots.forEach(s => s.img.loading = "eager"), 300));

  // photo credits (required courtesy for Unsplash photos)
  const credits = $("credits");
  if (credits && shots.length) credits.textContent = "Photos: " + [...new Set(shots.filter(s => s.by).map(s => s.by))].join(", ") + " on Unsplash.";

  /* ---------- optional scroll-scrubbed video ---------- */
  const useVideo = !useFrames && !!TOUR.video;
  if (useVideo) {
    shotsEl.hidden = true; video.hidden = false;
    // download the whole clip first so seeking never has to wait on the network
    fetch(TOUR.video).then(r => r.blob()).then(b => {
      video.src = URL.createObjectURL(b);
      video.addEventListener("loadedmetadata", () => render(shown), {once: true});
    }).catch(() => { video.src = TOUR.video; });
  }

  /* ---------- the timeline ---------- */
  let target = 0, shown = 0;
  function render(p){
    if (useFrames) drawFrame(p);
    else if (useVideo) {
      if (video.duration && !video.seeking) video.currentTime = p * (video.duration - .05);
    } else {
      shots.forEach((s, i) => {
        const fadeIn = i === 0 ? 1 : seg(p, s.from, s.from + .03);
        const fadeOut = i === shots.length - 1 ? 1 : 1 - seg(p, s.to - .03, s.to);
        const o = Math.min(fadeIn, fadeOut);
        s.img.style.opacity = o.toFixed(3);
        s.img.style.visibility = o > 0 ? "visible" : "hidden";
        if (o > 0) {
          const t = reduce ? .3 : ease(seg(p, s.from, s.to));
          s.img.style.transform = `scale(${lerp(s.zoom[0], s.zoom[1], t).toFixed(4)})`;
          // a touch of motion blur while walking through a doorway
          const blur = reduce ? 0 : (1 - o) * 6;
          s.img.style.filter = blur > .2 ? `blur(${blur.toFixed(1)}px)` : "";
        }
      });
    }
    // light: neutral midday, then warmer and warmer toward sunset
    const warm = seg(p, .35, .95);
    grade.style.opacity = (useFrames || useVideo) ? "0" : (warm * .4).toFixed(3);
    flash.style.opacity = "0";

    // HUD: room + time of day (10:30 AM to 8:30 PM)
    let on = 0; rooms.forEach((li, i) => { if (p + .02 >= +li.dataset.at) on = i; });
    rooms.forEach((li, i) => li.classList.toggle("on", i === on));
    const mins = Math.round((10.5 * 60 + p * 600) / 5) * 5, hh = Math.floor(mins / 60), mm = mins % 60;
    clock.textContent = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
  }

  // if the last panel (contact form) is taller than the screen, give the page room for it
  const last = document.querySelector(".panel.last");
  function fit(){ journey.style.marginBottom = Math.max(0, last.offsetTop + last.offsetHeight - journey.offsetHeight) + "px"; }
  function measure(){
    const r = journey.getBoundingClientRect(), range = journey.offsetHeight - innerHeight;
    target = clamp(-r.top / range);
    document.body.classList.toggle("hud-off", r.bottom < innerHeight * .6);
  }
  let raf = 0;
  function tick(){
    shown += (target - shown) * (reduce ? 1 : .12);              // gentle, cinematic smoothing
    if (Math.abs(target - shown) < .0002) shown = target;
    render(shown);
    raf = shown !== target ? requestAnimationFrame(tick) : 0;
  }
  function kick(){ measure(); if (!raf) raf = requestAnimationFrame(tick); }
  addEventListener("scroll", kick, {passive: true});
  addEventListener("resize", () => { sizeCanvas(); fit(); measure(); render(shown); });
  sizeCanvas(); fit(); measure(); shown = target; render(shown);

  rooms.forEach(li => li.addEventListener("click", () => {
    const range = journey.offsetHeight - innerHeight;
    scrollTo({top: journey.offsetTop + range * (+li.dataset.at + .03), behavior: reduce ? "auto" : "smooth"});
  }));
  document.querySelectorAll("[data-reason]").forEach(a => a.addEventListener("click", () => { const s = $("c-reason"); if (s) s.value = a.dataset.reason; }));
})();
