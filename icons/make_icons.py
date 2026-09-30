#!/usr/bin/env python3
"""Build the English Learning App logo + PWA icon set with PIL."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)))
TOMATO = (200, 75, 49)        # #C84B31
CREAM = (255, 253, 246)       # #FFFDF6

def draw_mark(d, cx, cy, s):
    """Speech bubble with text lines, centered at (cx, cy), overall size s."""
    bw, bh = int(s * 0.62), int(s * 0.46)          # bubble w/h
    x0, y0 = cx - bw // 2, cy - bh // 2 - int(s * 0.02)
    x1, y1 = x0 + bw, y0 + bh
    r = int(s * 0.09)
    # tail (draw first, behind bubble)
    tx = x0 + int(bw * 0.28)
    d.polygon([(tx, y1 - r), (tx + int(s * 0.10), y1 - r),
               (tx + int(s * 0.015), y1 + int(s * 0.13))], fill=CREAM)
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=CREAM)
    # three text lines
    lw = int(bw * 0.68)
    lh = int(s * 0.045)
    lx = x0 + int(bw * 0.16)
    widths = [lw, int(lw * 0.72), int(lw * 0.85)]
    y = y0 + int(bh * 0.22)
    for w in widths:
        d.rounded_rectangle([lx, y, lx + w, y + lh], radius=lh // 2, fill=TOMATO)
        y += int(s * 0.105)

def standard(size, rounded_bg=True):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded_bg:
        d.rounded_rectangle([0, 0, size, size], radius=int(size * 0.23), fill=TOMATO)
    else:
        d.rectangle([0, 0, size, size], fill=TOMATO)
    draw_mark(d, size // 2, size // 2, size)
    return img.convert("RGB")

def maskable(size):
    img = Image.new("RGB", (size, size), TOMATO)
    d = ImageDraw.Draw(img)
    draw_mark(d, size // 2, size // 2, int(size * 0.62))
    return img

os.makedirs(OUT, exist_ok=True)
# main icons
standard(512).save(os.path.join(OUT, "icon-512.png"))
standard(192).save(os.path.join(OUT, "icon-192.png"))
standard(32).save(os.path.join(OUT, "icon-32.png"))
standard(16).save(os.path.join(OUT, "icon-16.png"))
# apple touch (full bleed, Apple masks it)
maskable(180).save(os.path.join(OUT, "apple-touch-icon.png"))
# maskable for Android adaptive icons
maskable(512).save(os.path.join(OUT, "maskable-512.png"))
# multi-size .ico
ico = standard(48)
ico.save(os.path.join(OUT, "..", "favicon.ico"),
         sizes=[(16, 16), (32, 32), (48, 48)])
print("icons written to", OUT)
