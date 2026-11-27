#!/usr/bin/env python3
"""Validates the custom illustration set in web/public/icons3d. Run from web/: python3 scripts/check-icons.py"""
import os, re, sys
from PIL import Image
D = "public/icons3d"
KINDS = {"precious", "industrial", "energy", "agri", "crypto", "index", "stock", "forex", "construction"}
errs = []; n = 0
for f in sorted(os.listdir(D)):
    if f.startswith("."): continue
    m = re.fullmatch(r"([a-z0-9-]+)\.(png|webp)", f)
    if not m: errs.append(f"{f}: name must be <id>.png or <id>.webp (lowercase, dashes)"); continue
    n += 1; p = os.path.join(D, f); im = Image.open(p)
    if im.width != im.height or im.width < 384 or im.width > 1024: errs.append(f"{f}: must be square, 384-1024 px (is {im.width}x{im.height})")
    if os.path.getsize(p) > 160_000: errs.append(f"{f}: file larger than 160 KB, export smaller (webp quality 85)")
    im = im.convert("RGBA"); w, h = im.size
    if any(im.getpixel(c)[3] > 8 for c in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]): errs.append(f"{f}: background is not transparent (corners must be transparent)")
have = {os.path.splitext(f)[0] for f in os.listdir(D) if not f.startswith(".")}
missing = KINDS - have
if n and missing: errs.append("missing category icons: " + ", ".join(sorted(missing)))
print("FAIL\n" + "\n".join(errs) if errs else f"OK ({n} icons)"); sys.exit(1 if errs else 0)
