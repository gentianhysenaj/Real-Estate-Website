/* Scroll journey on the home page.
   Scroll position (0 to 1) drives a walk through a real home: each photo slowly pushes in toward a
   focal point (the front door, the next doorway...) and dissolves into the next room, while the light
   warms from midday to sunset.

   ── To use your own footage ──────────────────────────────────────────────────────────────
   • Photos: replace the `src` of each shot below (e.g. "/assets/tour/01-exterior.jpg").
     `focus` is where the camera pushes in to, as % from left / top of the photo.
   • Video: set TOUR.video to a walk-through clip (e.g. "/assets/tour/walkthrough.mp4").
     Scrolling then scrubs through the video instead of the photos. For smooth scrubbing,
     export it with a keyframe on every frame, e.g.:
       ffmpeg -i in.mov -an -vf scale=1920:-2 -c:v libx264 -crf 24 -g 1 -movflags +faststart walkthrough.mp4
   ─────────────────────────────────────────────────────────────────────────────────────────── */
const TOUR = {
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

  /* ---------- build the photo layers ---------- */
  const shots = TOUR.shots.map((s, i) => {
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
  if (credits) credits.textContent = "Photos: " + [...new Set(shots.filter(s => s.by).map(s => s.by))].join(", ") + " on Unsplash.";

  /* ---------- optional scroll-scrubbed video ---------- */
  const useVideo = !!TOUR.video;
  if (useVideo) {
    video.src = TOUR.video; video.hidden = false; shotsEl.hidden = true;
    video.addEventListener("loadedmetadata", () => render(shown));
  }

  /* ---------- the timeline ---------- */
  let target = 0, shown = 0;
  function render(p){
    if (useVideo) {
      if (video.duration) video.currentTime = p * (video.duration - .05);
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
    grade.style.opacity = (warm * .4).toFixed(3);
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
  addEventListener("resize", () => { fit(); measure(); render(shown); });
  fit(); measure(); shown = target; render(shown);

  rooms.forEach(li => li.addEventListener("click", () => {
    const range = journey.offsetHeight - innerHeight;
    scrollTo({top: journey.offsetTop + range * (+li.dataset.at + .03), behavior: reduce ? "auto" : "smooth"});
  }));
  document.querySelectorAll("[data-reason]").forEach(a => a.addEventListener("click", () => { const s = $("c-reason"); if (s) s.value = a.dataset.reason; }));
})();
