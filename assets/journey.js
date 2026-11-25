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
  // w/h: the size of one frame; a strip file is the middle of a w x h frame
  frames: {dir: "/assets/tour/frames/", count: 529, ext: "webp", digits: 4, w: 1600, h: 900,
           strip: {dir: "/assets/tour/frames-hd/", rect: [.25, 0, .75, 1], w: 1920, h: 1080}},
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
  const journey = $("journey"), shotsEl = $("shots"), video = $("tour-video"),
        sun = $("sun"), dusk = $("dusk"), grade = $("grade"), rooms = [...document.querySelectorAll("#rooms li")];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("yr").textContent = new Date().getFullYear();

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const seg = (p, a, b) => clamp((p - a) / (b - a));
  const smooth = t => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const OVERLAP = .05;                                         // how long neighbouring sets melt together

  /* ---------- 1. frame sequence on a canvas ---------- */
  // What keeps it smooth: every frame is downloaded once and kept compressed (about 40 MB on a laptop),
  // and only the frames around the camera are decoded, off the main thread, a little ahead of time.
  // Drawing a frame is then a plain copy, so scrolling never waits on an image decode. The canvas is
  // never bigger than the frames themselves (the browser scales it up for free), so each draw is cheap.
  const F = TOUR.frames, useFrames = F && F.count > 0;
  const canvas = $("tour-canvas"), ctx = canvas && canvas.getContext("2d", {alpha: false}), loader = $("tour-loader");
  const ua = navigator.userAgent, canBitmap = "createImageBitmap" in window;
  // Safari (and every iPhone browser) decodes images off the main thread with img.decode(); Chrome and
  // Firefox do it with createImageBitmap(blob)
  const webkit = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\/|OPR|Android/.test(ua);
  const blobs = [], bmps = new Map(), busy = new Set();
  let loaded = 0, lastDrawn = -1, dir = 1;
  // Portrait screens (phones, tablets held upright) only ever see the middle of a 16:9 frame, so they
  // load the close-up set: the middle strip at the video's full height, sharper than a scaled-down frame.
  const strip = useFrames && F.strip && innerWidth / innerHeight < .89 ? F.strip : null;
  const small = matchMedia("(pointer: coarse)").matches || innerWidth < 900;
  const AHEAD = small ? 18 : 24, BEHIND = small ? 6 : 8, DECODERS = small ? 3 : 4, CAP = AHEAD + BEHIND + 4;
  const idx = p => Math.round(clamp(p) * (F.count - 1));
  if (useFrames) {
    shotsEl.hidden = true; canvas.hidden = false; if (loader) loader.hidden = false;
    const fdir = strip ? strip.dir : F.dir;
    const name = i => fdir + String(i + 1).padStart(F.digits, "0") + "." + F.ext + (F.v ? "?v=" + F.v : "");
    // download order: the frames where the visitor is first, then a coarse pass, then the gaps
    const start = Math.round(clamp(scrollY / Math.max(1, journey.offsetHeight - innerHeight)) * (F.count - 1));
    const order = [], seen = new Set(), add = i => { if (i >= 0 && i < F.count && !seen.has(i)) { seen.add(i); order.push(i); } };
    for (let k = 0; k <= AHEAD; k++) add(start + k);
    for (const step of [16, 4, 1]) for (let i = 0; i < F.count; i += step) add(i);
    let next = 0;
    const got = (i, item) => {
      if (item) blobs[i] = item;
      loaded++;
      if (loader) { loader.style.setProperty("--pct", (loaded / F.count * 100).toFixed(1) + "%"); if (loaded === F.count) loader.classList.add("done"); }
      if (item) decodeAround();
      pump();
    };
    const pump = () => {
      if (next >= order.length) return;
      const i = order[next++];
      if (canBitmap) fetch(name(i)).then(r => r.ok ? r.blob() : null).then(b => got(i, b), () => got(i, null));
      else {                                                   // very old browsers: plain images
        const img = new Image(); img.decoding = "async";
        img.onload = () => got(i, img); img.onerror = () => got(i, null);
        img.src = name(i);
      }
    };
    for (let k = 0; k < 6; k++) pump();
  }
  const decode = async blob => {
    if (!webkit) return createImageBitmap(blob);
    const url = URL.createObjectURL(blob), img = new Image();
    try { img.src = url; await img.decode(); try { return await createImageBitmap(img); } catch (_) { return img; } }
    finally { URL.revokeObjectURL(url); }
  };
  // The frames to have ready: the one on screen, a run ahead in the direction of travel (spread out
  // when the camera still has a long way to go), and a few behind in case the visitor turns back.
  function wanted(){
    const cur = idx(shown), aim = idx(target);
    if (aim !== cur) dir = aim > cur ? 1 : -1;
    const gap = Math.abs(aim - cur), step = gap > AHEAD ? gap / AHEAD : 1, list = [cur];
    for (let k = 1; k <= AHEAD; k++) {
      list.push(cur + dir * Math.round(k * step));
      if (k % 2 === 0 && k / 2 <= BEHIND) list.push(cur - dir * (k / 2));
    }
    return list.filter((i, j) => i >= 0 && i < F.count && list.indexOf(i) === j);
  }
  function decodeAround(){
    if (!useFrames || !canBitmap) return;
    const list = wanted();
    for (const i of list) {
      if (busy.size >= DECODERS) break;
      if (bmps.has(i) || busy.has(i) || !blobs[i]) continue;
      busy.add(i);
      decode(blobs[i]).then(b => {
        busy.delete(i); bmps.set(i, b);
        // let go of the decoded frames furthest from the camera (the canvas keeps what it has drawn)
        if (bmps.size > CAP) {
          const cur = idx(shown), keep = new Set(list);
          [...bmps.keys()].filter(k => !keep.has(k) && k !== lastDrawn).sort((a, b) => Math.abs(b - cur) - Math.abs(a - cur))
            .slice(0, bmps.size - CAP).forEach(k => { const x = bmps.get(k); if (x.close) x.close(); bmps.delete(k); });
        }
        if (Math.abs(i - idx(shown)) <= 2 || Math.abs(i - idx(shown)) < Math.abs(lastDrawn - idx(shown)) || lastDrawn < 0) render(shown);
        decodeAround();
      }, () => { busy.delete(i); blobs[i] = null; decodeAround(); });
    }
  }
  // the stage's own size (100lvh), so phone address bars sliding in and out don't resize anything
  let VW = innerWidth, VH = innerHeight, DPR = 1, big = false;
  function sizeCanvas(){
    if (!useFrames && !useShots) return;
    const r = canvas.getBoundingClientRect();
    VW = r.width || innerWidth; VH = r.height || innerHeight;
    let dpr = Math.min(devicePixelRatio || 1, useShots ? 3 : 2);
    if (useShots) dpr = Math.min(dpr, Math.sqrt(16e6 / (VW * VH)));   // keep huge screens to about 16 megapixels
    // no more canvas pixels than the frames have: drawing them any bigger costs time and adds no detail
    const fw = useFrames && (strip ? strip.w : F.w), fh = useFrames && (strip ? strip.h : F.h);
    if (fw && fh) dpr = clamp(1 / Math.max(VW / fw, VH / fh), .5, dpr);
    const w = Math.round(VW * dpr), h = Math.round(VH * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; lastDrawn = -1; drawnKey = ""; }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    DPR = dpr; big = Math.max(w, h * 16 / 9) * 1.3 > 2100;      // big or high-density screen
  }
  // Each frame lasts about 20 px of scrolling, so between two frames the next one is blended in by how
  // far along the visitor is: the picture moves on every screen refresh instead of stepping 15 times a second.
  let drawnKey = "";
  function place(img){
    const cw = canvas.width, ch = canvas.height, iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const r = strip ? strip.rect : [0, 0, 1, 1];
    const fw = iw / (r[2] - r[0]), fh = ih / (r[3] - r[1]);     // size of the whole frame this file is part of
    let s = Math.max(cw / fw, ch / fh), x = (cw - fw * s) / 2 + r[0] * fw * s, y = (ch - fh * s) / 2 + r[1] * fh * s;
    if (iw * s < cw || ih * s < ch) { s = Math.max(cw / iw, ch / ih); x = (cw - iw * s) / 2; y = (ch - ih * s) / 2; }  // turned sideways
    return [x, y, iw * s, ih * s];
  }
  function drawFrame(p){
    const at = clamp(p) * (F.count - 1), i0 = Math.floor(at), mix = Math.round((at - i0) * 24) / 24;
    const has = canBitmap ? i => bmps.has(i) : i => !!blobs[i], get = i => canBitmap ? bmps.get(i) : blobs[i];
    let key, a = -1, b = -1;
    if (has(i0) && (mix === 0 || has(i0 + 1))) { a = i0; b = mix > 0 ? i0 + 1 : -1; key = i0 + ":" + mix; }
    else {                                                     // not decoded yet: the nearest frame that is
      const want = Math.round(at);
      for (let d = 0; d < F.count; d++) { if (has(want - d)) { a = want - d; break; } if (has(want + d)) { a = want + d; break; } }
      if (a < 0) return;
      key = a + ":0";
    }
    if (key === drawnKey) return;
    const A = get(a), [x, y, w, h] = place(A);
    ctx.globalAlpha = 1; ctx.drawImage(A, x, y, w, h);
    if (b >= 0) { const B = get(b); ctx.globalAlpha = mix; ctx.drawImage(B, ...place(B)); ctx.globalAlpha = 1; }
    drawnKey = key; lastDrawn = mix >= .5 && b >= 0 ? b : a;
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
  // Each frame is drawn on a canvas straight from the photo, so a zoomed-in photo is as sharp as the
  // file allows (CSS-scaled layers can be scaled up from a cached low-resolution copy and look soft).
  // Every photo is decoded ahead of time (1920 px), so scrolling never waits; on large or high-density
  // screens the 4K versions are fetched afterwards and decoded just ahead of the camera.
  const useShots = !useFrames && !useVideo && TOUR.shots.length > 0;
  if (useShots) canvas.hidden = false;
  const V = "?v=3";                                           // bump when photos change under the same name
  // Sharper files, fetched as the camera gets close and decoded only for the rooms near it:
  //   name@2x.webp  the whole photo at 3840 px, for big or high-density screens
  //   name@hd.webp  the middle half of the photo, full height, at 6144 px across the whole photo (from the
  //                 8K AI upscale). Phones and tall screens only ever see that middle strip, and desktops
  //                 see it once the camera pushes in, so it is drawn whenever it covers the whole screen.
  const VARIANTS = [{key: "hd", suffix: "@hd", rect: [.25, 0, .75, 1]}, {key: "hi", suffix: "@2x", rect: [0, 0, 1, 1]}];
  const FULL = [0, 0, 1, 1];
  let loLeft = TOUR.shots.length;
  const toBitmap = async src => {
    const img = new Image(); img.decoding = "async";
    if (src === TOUR.shots[0].src) img.fetchPriority = "high";
    img.src = src + V;
    await img.decode();
    return canBitmap ? createImageBitmap(img) : img;
  };
  const shots = (useShots ? TOUR.shots : []).map(s => {
    const glows = (s.glows || []).map(g => {
      const el = document.createElement("i"); el.className = "glow" + (g.flicker ? " flicker" : "");
      el.style.setProperty("--c", g.c); shotsEl.append(el); return {...g, el};
    });
    // furthest the camera zooms on this photo, counting the push forward while it hands over
    const maxZ = Math.max(...s.cam.map(c => c[3])) * (s.seamlessOut ? 1 : 1.2);
    const v = Object.fromEntries(VARIANTS.map(d => [d.key, {...d, want: false, blob: null, state: 0, bmp: null, busy: false}]));
    const shot = {...s, glows, maxZ, v, w: 0, h: 0, lo: null, near: false};
    toBitmap(s.src).then(b => {
      shot.lo = b; shot.w = b.width || b.naturalWidth; shot.h = b.height || b.naturalHeight;
      layout(); render(shown);
    }).catch(() => {}).finally(() => { if (--loLeft === 0) sharpen(shown); });
    return shot;
  });
  // which sharper files this screen can use for a shot
  function wants(s){
    if (!canBitmap) return;
    const stripZ = 2 * VW / s.bw;                              // zoom at which the middle strip fills the width
    s.v.hd.want = s.maxZ >= stripZ && s.bw * DPR * s.maxZ > 4400;   // and the 4K photo would be stretched
    s.v.hi.want = big && !(s.v.hd.want && stripZ <= 1.02);    // not needed where the strip always covers
  }
  function sharpen(p){
    if (loLeft > 0) return;                                    // the 1920 set always comes first
    shots.forEach(s => {
      const soon = p > s.from - .2 && p < s.to + .08;
      s.near = p > s.from - .1 && p < s.to + .05;
      Object.values(s.v).forEach(v => {
        if (v.want && soon && !v.state) {
          v.state = 1;
          fetch(s.src.replace(/\.webp$/, v.suffix + ".webp") + V).then(r => r.ok ? r.blob() : null)
            .then(b => { v.blob = b; v.state = b ? 2 : -1; if (b) sharpen(shown); }).catch(() => { v.state = -1; });
        }
        if (s.near && v.want && v.blob && !v.bmp && !v.busy) {
          v.busy = true;
          createImageBitmap(v.blob).then(b => { v.busy = false; if (s.near && v.want) { v.bmp = b; render(shown); } else b.close(); })
            .catch(() => { v.busy = false; v.blob = null; v.state = -1; });
        } else if ((!s.near || !v.want) && v.bmp) { v.bmp.close(); v.bmp = null; }
      });
    });
  }
  function layout(){
    shots.forEach(s => {
      if (!s.w) return;
      const c = Math.max(VW / s.w, VH / s.h);                  // "cover" size at zoom 1
      s.bw = s.w * c; s.bh = s.h * c;
      wants(s);
    });
    sharpen(shown);
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
    const W = VW, H = VH;
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
  function drawShots(p){
    const cw = canvas.width, ch = canvas.height, k = cw / VW, layers = [];
    if (Math.abs(p - (drawShots.at ?? -1)) > .004) { drawShots.at = p; sharpen(p); }
    shots.forEach((s, i) => {
      if (!s.bw) { s.cur = null; return; }
      const cam = camFor(s, i, p);
      // each set dissolves in on top of the one before; the one below stays solid until it's covered,
      // so the background never shows through mid-dissolve
      const fadeIn = i === 0 ? 1 : smooth(seg(p, s.from, s.from + OVERLAP));
      const next = shots[i + 1], covering = next ? seg(p, next.from, next.from + OVERLAP) : 0;
      const o = covering >= 1 ? 0 : fadeIn;
      if (o > .001) layers.push([s, cam, o]);
      if (s.glows.length) {
        const [x, y, z] = cam, lights = smooth(seg(p, .87, .99)) * o;
        s.glows.forEach(g => {
          g.el.style.opacity = lights.toFixed(3);
          if (lights > .001) {
            const r = g.r * s.bw * z, cx = VW / 2 + (g.x - x) * s.bw * z, cy = VH / 2 + (g.y - y) * s.bh * z;
            g.el.style.transform = `translate3d(${(cx - 200).toFixed(1)}px,${(cy - 200).toFixed(1)}px,0) scale(${(r / 200).toFixed(3)})`;
          }
        });
      }
    });
    // start from the top-most solid layer: nothing beneath it can show
    let first = 0; layers.forEach(([, , o], j) => { if (o >= .999) first = j; });
    if (!layers.length || layers[first][2] < .999) { ctx.globalAlpha = 1; ctx.fillStyle = "#d9cfc1"; ctx.fillRect(0, 0, cw, ch); }
    for (const [s, [x, y, z], o] of layers.slice(first)) {
      // where the whole photo sits on the canvas (device pixels)
      const dw = s.bw * z * k, dh = s.bh * z * k, dx = (VW / 2 - x * s.bw * z) * k, dy = (VH / 2 - y * s.bh * z) * k;
      // the sharpest file that covers the whole screen: the close-up strip, then the 4K photo, then 1920
      let src = s.lo, r = FULL;
      for (const v of [s.v.hd, s.v.hi]) {
        if (!v.bmp) continue;
        const [x0, y0, x1, y1] = v.rect;
        if (dx + x0 * dw <= .5 && dx + x1 * dw >= cw - .5 && dy + y0 * dh <= .5 && dy + y1 * dh >= ch - .5) { src = v.bmp; r = v.rect; break; }
      }
      const iw = src.width || src.naturalWidth, ih = src.height || src.naturalHeight;
      const ex = dx + r[0] * dw, ey = dy + r[1] * dh, ew = (r[2] - r[0]) * dw, eh = (r[3] - r[1]) * dh;
      // only the part of that file that's on screen
      const sx = Math.max(0, -ex / ew * iw), sy = Math.max(0, -ey / eh * ih);
      const sw = Math.min(iw - sx, cw / ew * iw), sh = Math.min(ih - sy, ch / eh * ih);
      ctx.globalAlpha = o;
      ctx.drawImage(src, sx, sy, sw, sh, ex + sx / iw * ew, ey + sy / ih * eh, sw / iw * ew, sh / ih * eh);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- the timeline ---------- */
  let target = 0, shown = 0;
  function render(p){
    if (useFrames) drawFrame(p);
    else if (useVideo) { if (video.duration && !video.seeking) video.currentTime = p * (video.duration - .05); }
    else drawShots(p);

    // daylight: a bright sun to start, warming through the afternoon, a sunset sky over the backyard
    if (!useFrames && !useVideo) {
      // the photos carry their own daylight, so these only add a touch of sun, warmth and sunset
      sun.style.opacity = ((1 - smooth(seg(p, .06, .2))) * .6).toFixed(3);
      grade.style.opacity = (smooth(seg(p, .3, .95)) * .18).toFixed(3);
      dusk.style.opacity = (smooth(seg(p, .85, 1)) * .25).toFixed(3);
    }

    let on = 0; rooms.forEach((li, i) => { if (p + .02 >= +li.dataset.at) on = i; });
    rooms.forEach((li, i) => li.classList.toggle("on", i === on));
  }

  const last = document.querySelector(".panel.last");
  // page geometry, read once per resize so scrolling never forces the browser to lay the page out again
  let G = {top: 0, h: 1, range: 1, lastTop: 0};
  function fit(){
    journey.style.marginBottom = Math.max(0, last.offsetTop + last.offsetHeight - journey.offsetHeight) + "px";
    const top = journey.getBoundingClientRect().top + scrollY;
    G = {top, h: journey.offsetHeight, range: Math.max(1, journey.offsetHeight - innerHeight),
         lastTop: last.getBoundingClientRect().top + scrollY};
  }
  let atTop = null, hudOff = null;
  function measure(){
    const y = scrollY - G.top;
    target = clamp(y / G.range);
    const t = target < .03, h = G.h - y < innerHeight * .6 ||
      (innerWidth <= 860 && G.lastTop - scrollY < innerHeight * .3);   // the tall contact form on phones
    if (t !== atTop) document.body.classList.toggle("at-top", atTop = t);
    if (h !== hudOff) document.body.classList.toggle("hud-off", hudOff = h);
  }
  // A little inertia, like a steady camera: the picture glides to where the page is, at the same pace
  // on 60 Hz and 120 Hz screens. TAU is how quickly it catches up (in ms).
  const TAU = 110;
  // When the visitor stops, the picture settles on the nearest whole frame (never more than about 10 px
  // of scrolling away), so what stays on screen is always one crisp frame, not a blend of two.
  const SETTLE = 150;
  let raf = 0, before = 0, lastScroll = 0;
  function tick(now){
    const dt = before ? Math.min(64, now - before) : 16.7; before = now;
    const moving = now - lastScroll < SETTLE, N1 = useFrames ? F.count - 1 : 0;
    const goal = useFrames && !moving ? Math.round(target * N1) / N1 : target;
    shown += (goal - shown) * (reduce ? 1 : 1 - Math.exp(-dt / TAU));
    if (Math.abs(goal - shown) < .00005) shown = goal;
    render(shown);
    if (useFrames) decodeAround();
    if (shown !== goal || (useFrames && moving)) raf = requestAnimationFrame(tick); else { raf = 0; before = 0; }
  }
  function kick(){ lastScroll = performance.now(); measure(); if (!raf) raf = requestAnimationFrame(tick); }
  addEventListener("scroll", kick, {passive: true});
  addEventListener("resize", () => { sizeCanvas(); layout(); fit(); measure(); render(shown); });
  // the page can grow after load (fonts, images below the tour), which moves nothing above it, but
  // re-measure anyway so the numbers stay right
  if ("ResizeObserver" in window) new ResizeObserver(() => { fit(); measure(); }).observe(journey);
  sizeCanvas(); layout(); fit(); measure(); shown = useFrames ? Math.round(target * (F.count - 1)) / (F.count - 1) : target; render(shown);

  rooms.forEach(li => li.addEventListener("click", () => {
    const range = journey.offsetHeight - innerHeight;
    scrollTo({top: journey.offsetTop + range * (+li.dataset.at + .02), behavior: reduce ? "auto" : "smooth"});
  }));
})();
