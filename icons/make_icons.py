#!/usr/bin/env python3
"""Build the English Learning App logo + PWA icon set with PIL."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)))
TOMATO = (200, 75, 49)        # #C84B31
CREAM = (255, 253, 246)       # #FFFDF6
SERIF_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"

def draw_mark(d, cx, cy, s):
    """Cream speech bubble with 'ABC' in tomato serif, centered at (cx, cy), size s."""
    bw, bh = int(s * 0.66), int(s * 0.50)          # bubble w/h
    x0, y0 = cx - bw // 2, cy - bh // 2 - int(s * 0.02)
    x1, y1 = x0 + bw, y0 + bh
    r = int(s * 0.10)
    # tail (draw first, behind bubble)
    tx = x0 + int(bw * 0.28)
    d.polygon([(tx, y1 - r), (tx + int(s * 0.10), y1 - r),
               (tx + int(s * 0.015), y1 + int(s * 0.13))], fill=CREAM)
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=CREAM)
    # 'ABC' fitted inside the bubble
    target_w = int(bw * 0.72)
    size = int(s * 0.30)
    font = ImageFont.truetype(SERIF_BOLD, size)
    bbox = d.textbbox((0, 0), "ABC", font=font)
    tw = bbox[2] - bbox[0]
    if tw > target_w:
        size = int(size * target_w / tw)
        font = ImageFont.truetype(SERIF_BOLD, size)
        bbox = d.textbbox((0, 0), "ABC", font=font)
        tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    d.text((cx - tw / 2 - bbox[0], y0 + (bh - th) / 2 - bbox[1]),
           "ABC", font=font, fill=TOMATO)

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
