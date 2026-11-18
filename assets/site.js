/* Small shared behaviour for every page: the mobile menu and soft scroll reveals. */
(() => {
  document.documentElement.classList.add("js");

  // mobile menu
  const btn = document.querySelector(".menu-btn");
  if (btn) {
    const close = () => { document.body.classList.remove("menu-open"); btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", () => {
      const open = document.body.classList.toggle("menu-open");
      btn.setAttribute("aria-expanded", String(open));
    });
    document.querySelectorAll("nav.main a").forEach(a => a.addEventListener("click", close));
    addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  }

  // reveal: children of [data-reveal] rise into place, one after another, when they come into view
  const els = document.querySelectorAll("[data-reveal]");
  els.forEach(el => [...el.children].forEach((c, i) => c.style.setProperty("--i", i)));
  if (!("IntersectionObserver" in window)) { els.forEach(el => el.classList.add("in")); return; }
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), {rootMargin: "0px 0px -12% 0px", threshold: .08});
  els.forEach(el => io.observe(el));
})();
