# -*- coding: utf-8 -*-
"""生成 PWA 图标（青色圆角方块 + 白色 720）。用法：py -3.11 tools/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent / "icons"
ROOT.mkdir(exist_ok=True)
TEAL = (20, 125, 120)
FONT = r"C:\Windows\Fonts\arialbd.ttf"

def make(size, name, radius_ratio=0.22, pad_ratio=0.0):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(size * pad_ratio)
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=int(size * radius_ratio), fill=TEAL)
    font = ImageFont.truetype(FONT, int(size * 0.42))
    text = "720"
    box = d.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1] - size * 0.04), text, font=font, fill="white")
    small = ImageFont.truetype(FONT, int(size * 0.13))
    box2 = d.textbbox((0, 0), "TOEIC", font=small)
    w2 = box2[2] - box2[0]
    d.text(((size - w2) / 2 - box2[0], size * 0.70), "TOEIC", font=small, fill=(234, 245, 243))
    img.save(ROOT / name)
    print("wrote", name, size)

make(192, "icon-192.png")
make(512, "icon-512.png")
make(512, "icon-maskable-512.png", radius_ratio=0.0)
make(180, "apple-touch-icon.png", radius_ratio=0.0)
