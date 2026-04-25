"""Generate light-mode variants of the shape icons.

Each shape PNG (assets/shapes/*.png) has a metallic colored frame plus two
dark regions: an inner cavity (pure black) and a soft outer drop-shadow
(dark, sometimes slightly tinted with the frame's hue from bleed). Those
darks blend invisibly into the dark-mode background but stand out as ugly
blobs on the light-mode background. This script rewrites dim pixels as
white while keeping alpha and the colored frame intact, producing
`{shape}-light.png` alongside the original.

Classification per pixel (sourced RGBA):
  - If max(R,G,B) < LUM_MAX -> treat as cavity/aura and force to white,
    preserving alpha (so semi-transparent aura becomes soft white glow).
  - Otherwise copy through unchanged.

LUM_MAX was chosen by looking at the histogram of max-channel brightness
on opaque pixels: the "dark region" population plateaus around 55–60 on
every shape; the frame body starts contributing meaningfully above ~65.
Chroma is NOT filtered — the aura picks up color from the frame, so a
grey-only rule misses the most offending corner blobs.

Run from repo root:  python tools/gen-shape-lightmode.py
"""
from pathlib import Path

from PIL import Image

SHAPES = ['square', 'arrow', 'diamond', 'triangle', 'circle', 'cross']
LUM_MAX = 55

def convert(src: Path, dst: Path) -> tuple[int, int]:
    img = Image.open(src).convert('RGBA')
    px = img.load()
    w, h = img.size
    converted = 0
    total_visible = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            total_visible += 1
            if max(r, g, b) < LUM_MAX:
                px[x, y] = (255, 255, 255, a)
                converted += 1
    img.save(dst)
    return converted, total_visible

def main() -> None:
    root = Path(__file__).resolve().parent.parent
    shapes_dir = root / 'assets' / 'shapes'
    for name in SHAPES:
        src = shapes_dir / f'{name}.png'
        dst = shapes_dir / f'{name}-light.png'
        if not src.exists():
            print(f'SKIP {name}: source not found at {src}')
            continue
        changed, visible = convert(src, dst)
        pct = (changed / visible * 100) if visible else 0
        print(f'{name:<10} {changed:>6}/{visible:>6} pixels whitened ({pct:4.1f}%) -> {dst.name}')

if __name__ == '__main__':
    main()
