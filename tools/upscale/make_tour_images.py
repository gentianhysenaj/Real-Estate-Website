"""Make the tour webps from the 4K upscales: name@2x.webp (3840) and name.webp (1920, downscaled from 4K).
Usage: python make_tour_images.py UP4K_DIR REPO_DIR [N ...]   (UP4K_DIR holds 1.png ... 8.png from esrgan_upscale.py at 3840 wide)"""
import sys, os, importlib.util
from PIL import Image
up, repo = sys.argv[1], sys.argv[2]
which = [int(a) for a in sys.argv[3:]] or list(range(1, 9))
names = ["01-front", "02-door", "03-door-open", "04-foyer", "05-open-concept", "06-back-door", "07-back-door-open", "08-backyard"]
out = os.path.join(repo, "assets/tour")
spec = importlib.util.spec_from_file_location("cd", os.path.join(repo, "tools/compose-doorway.py")); cd = importlib.util.module_from_spec(spec); spec.loader.exec_module(cd)
for i in which:
    n = names[i - 1]
    if n == "03-door-open":
        tmp = os.path.join(up, "3-composite.png")
        cd.compose(os.path.join(up, "3.png"), os.path.join(up, "4.png"), tmp, 3840)
        im = Image.open(tmp).convert("RGB")
    else:
        im = Image.open(os.path.join(up, f"{i}.png")).convert("RGB")
    assert im.width == 3840, (n, im.size)
    im.save(os.path.join(out, n + "@2x.webp"), quality=80, method=6)
    lo = im.resize((1920, round(im.height * 1920 / im.width)), Image.LANCZOS)
    lo.save(os.path.join(out, n + ".webp"), quality=84, method=6)
    print(n, os.path.getsize(os.path.join(out, n + "@2x.webp")) // 1024, "KB @2x,", os.path.getsize(os.path.join(out, n + ".webp")) // 1024, "KB 1x")
