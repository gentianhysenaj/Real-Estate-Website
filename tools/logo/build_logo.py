"""GH monogram logo concepts (ligature, house, doorway, solid), outlined from Inter / Inter Display with fontTools.
Usage: python build_logo.py OUT_DIR  (needs fontTools and the Inter OTF fonts in /usr/share/fonts/opentype/inter/).
The site uses OUT_DIR/ligature-compact-light.svg as assets/brand/logo.svg, *-lockup-* as logo-full, *-favicon as /favicon.svg."""
import os, sys, math
sys.path.insert(0, os.path.dirname(__file__))
from textpath import text_path, _font
from fontTools.pens.boundsPen import BoundsPen

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
F = "/usr/share/fonts/opentype/inter/"
INK, BRONZE, CREAM, BRONZE_D = "#2b251f", "#8a6a48", "#f4efe7", "#c9a37a"
NAME, LABEL = "GENTIAN HYSENAJ", "Gentian Hysenaj Real Estate"   # wordmark (Gentian asked for the full name, 2026-11-19)

def svg(w, h, body, title, extra=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.1f} {h:.1f}" width="{w:.0f}" height="{h:.0f}" '
            f'role="img" aria-label="{title}">{extra}<title>{title}</title>{body}</svg>\n')

def line(d, c, sw):
    return f'<path d="{d}" fill="none" stroke="{c}" stroke-width="{sw}" stroke-linecap="square" stroke-linejoin="miter"/>'

def glyph(ch, font, size, x, base, c):
    d, w, cap = text_path(ch, F + font, size, 0, x, base)
    return f'<path d="{d}" fill="{c}"/>', w

def bounds(ch, font, size):
    f = _font(F + font); gs = f.getGlyphSet(); g = f.getBestCmap()[ord(ch)]
    bp = BoundsPen(gs); gs[g].draw(bp); s = size / f["head"].unitsPerEm
    return [v * s for v in bp.bounds]

# ---- marks: return (svg body, width) ----
def mark_ligature(c, accent, sw=3.6):
    # the G's bar runs straight on as the H's crossbar
    cx, cy, r = 26, 32, 23
    a = math.radians(50)
    sx, sy = cx + r * math.cos(a), cy - r * math.sin(a)
    d = (f"M{sx:.2f} {sy:.2f} A{r} {r} 0 1 0 {cx + r} {cy} "
         f"M{cx + r} {cy - r} V{cy + r} M73 {cy - r} V{cy + r} M31 {cy} H73")
    return line(d, c, sw), 76

def mark_house(c, accent, sw=3.6):
    # a G beside an H that wears a pitched roof
    # G and H under one pitched roof
    cx, cy, r = 21, 43, 16
    a = math.radians(50)
    sx, sy = cx + r * math.cos(a), cy - r * math.sin(a)
    roof = "M3 21 L40 4 L77 21"
    g = f"M{sx:.2f} {sy:.2f} A{r} {r} 0 1 0 {cx + r} {cy} H{cx + 5}"
    h = f"M45 {cy - r} V{cy + r} M73 {cy - r} V{cy + r} M45 {cy} H73"
    return line(roof + " " + g + " " + h, c, sw), 80

def mark_doorway(c, accent, sw=2.6):
    # GH standing in an arched doorway
    arch = line("M3 62 V29 A26 26 0 0 1 55 29 V62", c, sw)
    font, size = "InterDisplay-Medium.otf", 27
    gb, hb = bounds("G", font, size), bounds("H", font, size)
    gw, hw, gap = gb[2] - gb[0], hb[2] - hb[0], 2.2
    x0 = 29 - (gw + gap + hw) / 2
    gp, _ = glyph("G", font, size, x0 - gb[0], 52, c)
    hp, _ = glyph("H", font, size, x0 + gw + gap - hb[0], 52, c)
    return arch + gp + hp, 58

def mark_solid(c, accent, sw=None):
    # bold G and H that touch, cut from Inter Display
    font, size = "InterDisplay-SemiBold.otf", 63
    gb, hb = bounds("G", font, size), bounds("H", font, size)
    gx = 1 - gb[0]
    hx = gx + gb[2] - hb[0] - .6
    gp, _ = glyph("G", font, size, gx, 55, c)
    hp, _ = glyph("H", font, size, hx, 55, c)
    return gp + hp, hx + hb[2] + 1

MARKS = {"ligature": mark_ligature, "house": mark_house, "doorway": mark_doorway, "solid": mark_solid}
NAMES = {"ligature": "GH ligature", "house": "GH house", "doorway": "GH doorway", "solid": "GH solid"}

def word(text, font, size, track, x, base, c):
    d, w, cap = text_path(text, F + font, size, track, x, base)
    return f'<path d="{d}" fill="{c}"/>', w

def lockup(key, fg, accent):
    m, mw = MARKS[key](fg, accent)
    gap = 20
    a, w1 = word(NAME, "InterDisplay-Medium.otf", 27, .26, mw + gap, 40, fg)
    b, w2 = word("REAL ESTATE", "Inter-Medium.otf", 9, .52, mw + gap + 1, 58, accent)
    return m + a + b, mw + gap + max(w1, w2) + 2, 64

def compact(key, fg, accent):
    m, mw = MARKS[key](fg, accent, **({} if key == "solid" else {"sw": 4.4 if key != "doorway" else 3.2}))
    sc = 32 / 64
    a, w = word(NAME, "InterDisplay-Medium.otf", 19.5, .24, mw * sc + 12, 24.5, fg)
    return f'<g transform="scale({sc})">{m}</g>' + a, mw * sc + 12 + w + 1, 32

def icon(key, fg, accent, bg, size=64, radius=0, sw=None):
    kw = {} if (key == "solid" or sw is None) else {"sw": sw}
    m, mw = MARKS[key](fg, accent, **kw)
    pad = 9 if key != "doorway" else 10
    s = min((size - 2 * pad) / 64, (size - 2 * pad) / mw)
    inner = f'<g transform="translate({(size - mw * s) / 2:.2f} {(size - 64 * s) / 2:.2f}) scale({s:.4f})">{m}</g>'
    rect = f'<rect width="{size}" height="{size}" rx="{radius}" fill="{bg}"/>' if bg else ""
    return svg(size, size, rect + inner, "Gentian")

def compact_animated(fg):
    """Header logo that writes itself once: the G from its top terminal round to the bar, the bar on through
    the H, then the H's left and right stems, ending at the bottom of the H; then the name wipes in."""
    sc, sw = 32 / 64, 4.4
    cx, cy, r = 26, 32, 23
    a = math.radians(50)
    sx, sy = cx + r * math.cos(a), cy - r * math.sin(a)
    # (path, start s, duration s): durations follow each stroke's length so the pen moves at one speed
    strokes = [(f"M{sx:.2f} {sy:.2f} A{r} {r} 0 1 0 {cx + r} {cy}", .30, .66),
               ("M31 32 H73", 1.02, .24), ("M49 9 V55", 1.32, .26), ("M73 9 V55", 1.64, .26)]
    paths = "".join(f'<path class="s" pathLength="1" style="animation-delay:{t}s;animation-duration:{d}s" d="{p}"/>'
                    for p, t, d in strokes)
    x0 = 76 * sc + 12
    text, w = word(NAME, "InterDisplay-Medium.otf", 19.5, .24, x0, 24.5, fg)
    style = ('<style>.s{fill:none;stroke:%s;stroke-width:%s;stroke-linecap:square;stroke-dasharray:1 1;'
             'stroke-dashoffset:1;opacity:0;animation:w 1s cubic-bezier(.45,0,.3,1) both}'
             '@keyframes w{0%%{stroke-dashoffset:1;opacity:0}1%%{opacity:1}to{stroke-dashoffset:0;opacity:1}}'
             '@media (prefers-reduced-motion:reduce){.s{animation:none;stroke-dashoffset:0;opacity:1}}</style>') % (fg, sw)
    wipe = (f'<clipPath id="wipe"><rect x="{x0 - 2}" y="0" width="0" height="32">'
            f'<animate attributeName="width" from="0" to="{w + 4:.1f}" begin="1.55s" dur=".8s" fill="freeze" '
            'calcMode="spline" keyTimes="0;1" keySplines=".4 0 .2 1"/></rect></clipPath>')
    body = f'<defs>{wipe}</defs><g transform="scale({sc})">{paths}</g><g clip-path="url(#wipe)">{text}</g>'
    return svg(x0 + w + 1, 32, body, LABEL, style)

open(f"{OUT}/ligature-compact-animated.svg", "w").write(compact_animated(INK))

FAV_SW = {"ligature": 6, "house": 6, "doorway": 4.4, "solid": None}
for key in MARKS:
    for tone, fg, acc in (("light", INK, BRONZE), ("dark", CREAM, BRONZE_D)):
        body, w, h = lockup(key, fg, acc)
        open(f"{OUT}/{key}-lockup-{tone}.svg", "w").write(svg(w, h, body, f"{LABEL} logo, {NAMES[key]}"))
        m, mw = MARKS[key](fg, acc)
        open(f"{OUT}/{key}-mark-{tone}.svg", "w").write(svg(mw, 64, m, f"Gentian mark, {NAMES[key]}"))
        body, w, h = compact(key, fg, acc)
        open(f"{OUT}/{key}-compact-{tone}.svg", "w").write(svg(w, h, body, LABEL))
    open(f"{OUT}/{key}-icon.svg", "w").write(icon(key, INK, BRONZE, CREAM, 64, 14, FAV_SW[key] and FAV_SW[key] * .8))
    open(f"{OUT}/{key}-icon-square.svg", "w").write(icon(key, INK, BRONZE, CREAM, 64, 0, FAV_SW[key] and FAV_SW[key] * .8))
    dark = '<style>@media (prefers-color-scheme:dark){[stroke="#2b251f"]{stroke:#f4efe7}[fill="#2b251f"]{fill:#f4efe7}}</style>'
    fav = icon(key, INK, BRONZE, None, 64, 0, FAV_SW[key]).replace("<title>", dark + "<title>", 1)
    open(f"{OUT}/{key}-favicon.svg", "w").write(fav)
print("ok")
