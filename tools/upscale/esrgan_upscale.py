"""Real-ESRGAN x4plus on the CPU with ncnn, tiled. Usage: python esrgan_upscale.py MODEL_DIR IN OUT [out_width]
Needs: pip install ncnn numpy pillow, and realesrgan-x4plus.param/.bin in MODEL_DIR (from the Real-ESRGAN ncnn release)."""
import sys, time
import numpy as np
import ncnn
from PIL import Image

mdir, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
out_w = int(sys.argv[4]) if len(sys.argv) > 4 else 0
net = ncnn.Net()
net.opt.use_vulkan_compute = False
net.opt.num_threads = 4
net.load_param(f"{mdir}/realesrgan-x4plus.param")
net.load_model(f"{mdir}/realesrgan-x4plus.bin")

img = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255.0
H, W, _ = img.shape
S, T, P = 4, 192, 12           # scale, tile, padding
out = np.zeros((H * S, W * S, 3), np.float32)
t0 = time.time(); n = 0
tiles = [(y, x) for y in range(0, H, T) for x in range(0, W, T)]
for y, x in tiles:
    y0, x0 = max(y - P, 0), max(x - P, 0)
    y1, x1 = min(y + T + P, H), min(x + T + P, W)
    tile = np.ascontiguousarray(img[y0:y1, x0:x1].transpose(2, 0, 1))
    ex = net.create_extractor()
    ex.input("data", ncnn.Mat(tile))
    _, o = ex.extract("output")
    o = np.array(o).transpose(1, 2, 0)
    ty, tx = (y - y0) * S, (x - x0) * S
    hh, ww = min(T, H - y) * S, min(T, W - x) * S
    out[y * S:y * S + hh, x * S:x * S + ww] = o[ty:ty + hh, tx:tx + ww]
    n += 1
    if n == 1 or n % 20 == 0:
        print(f"{n}/{len(tiles)} tiles, {time.time() - t0:.0f}s", flush=True)
res = Image.fromarray((np.clip(out, 0, 1) * 255 + .5).astype(np.uint8))
if out_w:
    size = (out_w, round(res.height * out_w / res.width))
    res = res.resize(size, Image.LANCZOS)
    # keep a little of the original's natural grain so surfaces don't look painted
    res = Image.blend(res, Image.open(src).convert("RGB").resize(size, Image.BICUBIC), .1)
res.save(dst)
print("done", dst, res.size, f"{time.time() - t0:.0f}s", flush=True)
