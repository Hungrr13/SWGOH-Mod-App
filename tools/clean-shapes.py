"""Post-process the cleaned shape PNGs.

For each shape image:
  - Find connected components of fully-transparent pixels (alpha == 0).
  - Components that touch the image border are the OUTSIDE — leave clear.
  - Components that DO NOT touch the border are inner holes (e.g. the hollow
    center of the circle/cross frame) — fill them with opaque black.

Then copy the result to assets/shapes/<shape>.png so ModShapeIcon picks it up.
"""

from PIL import Image
import os
import sys

ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'shapes')
SRC_DIR = os.path.join(ROOT, 'Shapes to clean up')
OUT_DIR = ROOT

# Map source filename -> canonical output name expected by ModShapeIcon.
NAME_MAP = {
    'arrow_recreated.png':    'arrow.png',
    'circle_recreated_v4.png': 'circle.png',
    'cross_recreated_v2.png':  'cross.png',
    'diamond_recreated.png':  'diamond.png',
    'square_recreated.png':   'square.png',
    'triangle_recreated.png': 'triangle.png',
}


def fill_inner_holes(img):
    img = img.convert('RGBA')
    w, h = img.size
    px = img.load()

    # Mask: 1 if pixel is fully transparent.
    mask = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0:
                mask[y * w + x] = 1

    # Flood-fill from all border pixels — every transparent pixel reachable
    # from the border belongs to the OUTSIDE region.
    border_label = 2  # use 2 so we can distinguish unvisited(1) from outside(2)
    stack = []
    for x in range(w):
        for y in (0, h - 1):
            i = y * w + x
            if mask[i] == 1:
                mask[i] = border_label
                stack.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            i = y * w + x
            if mask[i] == 1:
                mask[i] = border_label
                stack.append((x, y))

    while stack:
        x, y = stack.pop()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h:
                ni = ny * w + nx
                if mask[ni] == 1:
                    mask[ni] = border_label
                    stack.append((nx, ny))

    # Anything still mask==1 is an INNER hole — fill with opaque black.
    filled = 0
    for y in range(h):
        for x in range(w):
            if mask[y * w + x] == 1:
                px[x, y] = (0, 0, 0, 255)
                filled += 1

    return img, filled


def main():
    if not os.path.isdir(SRC_DIR):
        print(f'ERROR: {SRC_DIR} not found', file=sys.stderr)
        sys.exit(1)

    for src_name, out_name in NAME_MAP.items():
        src = os.path.join(SRC_DIR, src_name)
        out = os.path.join(OUT_DIR, out_name)
        if not os.path.exists(src):
            print(f'  skip {src_name} — not found')
            continue
        img = Image.open(src)
        cleaned, filled = fill_inner_holes(img)
        cleaned.save(out, 'PNG', optimize=True)
        print(f'  {src_name} -> {out_name} (filled {filled} inner-hole pixels)')


if __name__ == '__main__':
    main()
