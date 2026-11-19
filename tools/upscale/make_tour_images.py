"""Make the sharper tour webps from the 8K AI upscales.

  name@2x.webp  whole photo at 3840 px wide          (big or high-density screens)
  name@hd.webp  middle half of the photo, full height, at 6144 px across the whole photo
                (phones, tall screens, and desktops once the camera pushes in; see VARIANTS in journey.js)
  name.webp     1920 px, only with --lo (normally left as it is)

Usage: python make_tour_images.py UP8K_DIR SRC_DIR REPO_DIR [--lo] [N ...]
  UP8K_DIR holds 1.png ... 8.png straight from esrgan_upscale.py with no out_width (7680 px wide).
  SRC_DIR holds the original 1920 px Canva images 1.png ... 8.png; a little of each is blended back in
  so surfaces keep some natural grain instead of looking painted.
"""
import sys, os, importlib.util, tempfile
from PIL import Image

args = [a for a in sys.argv[1:] if not a.startswith("--")]
up, src, repo = args[:3]
which = [int(a) for a in args[3:]] or list(range(1, 9))
make_lo = "--lo" in sys.argv
names = ["01-front", "02-door", "03-door-open", "04-foyer", "05-open-concept", "06-back-door", "07-back-door-open", "08-backyard"]
out = os.path.join(repo, "assets/tour")
spec = importlib.util.spec_from_file_location("cd", os.path.join(repo, "tools/compose-doorway.py"))
cd = importlib.util.module_from_spec(spec); spec.loader.exec_module(cd)
HD_W, HD_STRIP = 6144, (.25, .75)


def prep(i, width, grain):
    big = Image.open(os.path.join(up, f"{i}.png")).convert("RGB")
    assert big.width == 7680, (i, big.size)
    size = (width, round(big.height * width / big.width))
    im = big.resize(size, Image.LANCZOS) if size != big.size else big
    return Image.blend(im, Image.open(os.path.join(src, f"{i}.png")).convert("RGB").resize(size, Image.BICUBIC), grain)


def photo(i, width, grain):
    if names[i - 1] != "03-door-open":
        return prep(i, width, grain)
    # the open front door with the foyer set into the doorway, composed at full size
    with tempfile.TemporaryDirectory() as d:
        a, b, c = (os.path.join(d, n) for n in ("door.png", "foyer.png", "out.png"))
        prep(3, width, grain).save(a); prep(4, width, grain).save(b)
        cd.compose(a, b, c, width)
        return Image.open(c).convert("RGB")


for i in which:
    n = names[i - 1]
    hi = photo(i, 3840, .10)
    hi.save(os.path.join(out, n + "@2x.webp"), quality=90, method=6)
    if make_lo:
        hi.resize((1920, round(hi.height * 1920 / hi.width)), Image.LANCZOS).save(os.path.join(out, n + ".webp"), quality=84, method=6)
    hd = photo(i, HD_W, .08)
    hd = hd.crop((round(HD_STRIP[0] * hd.width), 0, round(HD_STRIP[1] * hd.width), hd.height))
    hd.save(os.path.join(out, n + "@hd.webp"), quality=88, method=6)
    kb = lambda f: os.path.getsize(os.path.join(out, n + f)) // 1024
    print(n, kb("@2x.webp"), "KB @2x,", kb("@hd.webp"), f"KB @hd {hd.size}", flush=True)
