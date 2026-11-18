"""Builds the Kizayu app icon set from the logo artwork (mobile/assets/brand/logo-source.png).

The cyan mark is cut out by colour, then placed on the brand background for each icon size.
Run from mobile/:  python scripts/make-icons.py
"""
from pathlib import Path
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "brand" / "logo-source.png"
OUT = ROOT / "assets"
BG = (10, 10, 12, 255)          # near-black from the logo
CYAN = (0, 200, 240, 255)       # brand cyan


def mark_alpha(img: Image.Image) -> Image.Image:
    """Alpha mask of the cyan mark: strongly blue/green, low red (excludes white text and grey sparkle)."""
    rgb = img.convert("RGB")
    px = rgb.load()
    w, h = rgb.size
    mask = Image.new("L", (w, h), 0)
    m = mask.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            cyan = min(g, b) - r          # high for cyan, ~0 for white/grey/black
            m[x, y] = max(0, min(255, int((cyan - 40) * 2.2)))
    bbox = mask.getbbox()
    if not bbox:
        raise SystemExit("No cyan mark found in the logo")
    return mask.crop(bbox).filter(ImageFilter.SMOOTH)


def compose(size: int, alpha: Image.Image, scale: float, color, bg=None) -> Image.Image:
    """Centre the mark at `scale` of the canvas width."""
    canvas = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0))
    w = int(size * scale)
    h = int(alpha.height * w / alpha.width)
    a = alpha.resize((w, h), Image.LANCZOS)
    layer = Image.new("RGBA", (w, h), color)
    layer.putalpha(a)
    canvas.alpha_composite(layer, ((size - w) // 2, (size - h) // 2))
    return canvas


alpha = mark_alpha(Image.open(SRC))
jobs = {
    "icon.png": (1024, 0.66, CYAN, BG),                          # iOS / generic (iOS rounds corners)
    "android-icon-foreground.png": (1024, 0.48, CYAN, None),    # inside the 66% adaptive safe zone
    "android-icon-background.png": None,
    "android-icon-monochrome.png": (1024, 0.48, (255, 255, 255, 255), None),
    "splash-icon.png": (1024, 0.70, CYAN, None),                 # splash background colour is set in app.json
    "favicon.png": (48, 0.80, CYAN, BG),
}
for name, spec in jobs.items():
    img = Image.new("RGBA", (1024, 1024), BG) if spec is None else compose(spec[0], alpha, spec[1], spec[2], spec[3])
    img.save(OUT / name)
    print("wrote", name, img.size)
