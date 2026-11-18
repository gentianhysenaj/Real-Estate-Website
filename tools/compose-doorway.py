#!/usr/bin/env python3
"""Put the foyer photo inside the open front doorway, so the view through the door is exactly the foyer.

The tour then zooms into the doorway until the opening fills the screen height and dissolves into the
foyer photo, which lines up pixel for pixel, so walking through the door has no visible change of room.

Usage:  python3 tools/compose-doorway.py door-open.jpg foyer.jpg out.webp
Needs Pillow (pip install pillow). Coordinates are fractions of the door-open photo.
"""
import sys
from PIL import Image, ImageDraw, ImageFilter

# Opening inside the door frame (left, top, right, bottom) and the open door leaf, which stays in front.
OPENING = (0.379, 0.193, 0.628, 0.751)
LEAF = [(0.515, 0.223), (0.574, 0.171), (0.574, 0.751), (0.519, 0.744)]


def compose(door_path, foyer_path, out_path, width=2400):
    door = Image.open(door_path).convert("RGB")
    foyer = Image.open(foyer_path).convert("RGB")
    if door.width < width:
        door = door.resize((width, round(door.height * width / door.width)), Image.LANCZOS)
    W, H = door.size
    l, t, r, b = (round(OPENING[0] * W), round(OPENING[1] * H), round(OPENING[2] * W), round(OPENING[3] * H))
    oh = b - t
    # scale the foyer so its full height fills the opening height, centred on the opening
    fw = round(foyer.width * oh / foyer.height)
    fy = foyer.resize((fw, oh), Image.LANCZOS)
    cx = (l + r) // 2
    crop = fy.crop((fw // 2 - (cx - l), 0, fw // 2 + (r - cx), oh))
    # a touch of depth: slightly darker at the edges of the opening, like light falling off inside
    shade = Image.new("L", crop.size, 0)
    ImageDraw.Draw(shade).rectangle((0, 0, crop.width - 1, crop.height - 1), outline=70, width=max(2, crop.width // 60))
    shade = shade.filter(ImageFilter.GaussianBlur(crop.width // 40 or 1))
    crop = Image.composite(Image.new("RGB", crop.size, (40, 30, 20)), crop, shade)
    out = door.copy()
    out.paste(crop, (l, t))
    # put the open door leaf back in front, from the original photo
    mask = Image.new("L", door.size, 0)
    ImageDraw.Draw(mask).polygon([(x * W, y * H) for x, y in LEAF], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1))
    out = Image.composite(door, out, mask)
    out.save(out_path, quality=86, method=6)
    print(f"Saved {out_path} ({W}x{H}). Doorway centre {((l + r) / 2 / W):.4f}, {((t + b) / 2 / H):.4f}; "
          f"zoom to fill the height {1 / (OPENING[3] - OPENING[1]):.3f}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    compose(*sys.argv[1:])
