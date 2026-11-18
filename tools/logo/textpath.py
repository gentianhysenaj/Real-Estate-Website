"""Outline text to an SVG path with fontTools. text_path(text, font_file, size, tracking_em) -> (d, width, ascent)"""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

_cache = {}

def _font(path):
    if path not in _cache:
        _cache[path] = TTFont(path)
    return _cache[path]

def text_path(text, font_file, size, tracking=0.0, x=0.0, baseline=0.0):
    f = _font(font_file)
    gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f["head"].unitsPerEm
    hmtx = f["hmtx"]; s = size / upm
    pen = SVGPathPen(gs)
    cx = x
    for i, ch in enumerate(text):
        g = cmap.get(ord(ch))
        if g is None:
            continue
        tp = TransformPen(pen, (s, 0, 0, -s, cx, baseline))
        gs[g].draw(tp)
        cx += hmtx[g][0] * s
        if i < len(text) - 1:
            cx += tracking * size
    cap = f["OS/2"].sCapHeight * s if hasattr(f["OS/2"], "sCapHeight") else size * .7
    return pen.getCommands(), cx - x, cap
