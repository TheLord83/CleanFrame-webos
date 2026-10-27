#!/usr/bin/env python3
"""Shrink the packaged images without a visible change.

Wallpapers, thumbnails and panels are re-encoded at quality 86, progressive.
Quality 82 was 0,8 MB smaller but dropped the worst picture to 34 dB PSNR, which
is where a photo starts to look soft. 86 keeps the minimum at 35,4 dB.

The material variants (blur, frost, tint, soft) are downscaled: they are all
heavily blurred already (edge variance 6..169 against 1510 for a full photo), so
800x450 upscaled by the TV is indistinguishable. Measured over all sixty files:
minimum 38,8 dB PSNR, median 47,3 dB.
"""
import io
import os
import glob
import statistics
from PIL import Image, ImageFilter

LANCZOS = getattr(Image, "LANCZOS", None) or Image.Resampling.LANCZOS

WP = "app/assets/wallpapers"
MAT = "app/assets/materials"


def save(im, path, q):
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
    data = buf.getvalue()
    old = os.path.getsize(path)
    if len(data) < old:
        with open(path, "wb") as fh:
            fh.write(data)
        return old, len(data)
    return old, old


def psnr(im, target):
    """PSNR between the image and its downscale-upscale round trip."""
    small = im.resize(target, LANCZOS)
    up = small.resize(im.size, LANCZOS)
    import math
    pa, pu = im.convert("L").tobytes(), up.convert("L").tobytes()
    mse = sum((x - y) ** 2 for x, y in zip(pa, pu)) / len(pa)
    return 99.0 if mse == 0 else 10 * math.log10(255 * 255 / mse)


before = after = 0
print("== Wallpaper, Thumbnails, Panels ==")
for path in sorted(glob.glob(WP + "/*.jpg")):
    im = Image.open(path).convert("RGB")
    o, n = save(im, path, 86)
    before += o
    after += n
print("  %d Dateien: %.1f MB -> %.1f MB" % (len(glob.glob(WP + "/*.jpg")), before / 1048576, after / 1048576))

print("== Materialien (verkleinert) ==")
mb = ma = 0
checks = []
for path in sorted(glob.glob(MAT + "/*.jpg")):
    im = Image.open(path).convert("RGB")
    target = (480, 270) if path.endswith("-study-soft.jpg") else (800, 450)
    p = psnr(im, target)
    checks.append(p)
    small = im.resize(target, LANCZOS)
    o, n = save(small, path, 82)
    mb += o
    ma += n
print("  %d Dateien: %.1f MB -> %.1f MB" % (len(glob.glob(MAT + "/*.jpg")), mb / 1048576, ma / 1048576))
print("  PSNR der Rundreise: min %.1f dB, median %.1f dB" % (min(checks), statistics.median(checks)))
print()
print("Gesamt: %.1f MB -> %.1f MB" % ((before + mb) / 1048576, (after + ma) / 1048576))
