"""Slice the composite shape strip into 6 individual transparent PNGs.

The shapes are arranged left-to-right in roughly equal slots. Strategy:

  1. Find the foreground mask (max(R,G,B) > threshold).
  2. Compute the centroid X for each of 6 evenly-spaced bins, then refine
     splits as the midpoint between consecutive centroids.
  3. Within each split, find the tight bbox using a strong threshold so we
     don't pick up the next shape's glow halo bleeding across the gap.
  4. Crop with padding, soft-fade the edges to transparent, save.

Order in source (left -> right): Square, Arrow, Diamond, Triangle, Circle, Cross.
"""

from PIL import Image
import os
import sys

SRC = os.path.join(os.path.dirname(__file__), '..', 'assets', 'shapes', 'composite.png')
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'shapes')
NAMES = ['square', 'arrow', 'diamond', 'triangle', 'circle', 'cross']

BG_THRESHOLD = 28      # below this = pure black background
TIGHT_THRESHOLD = 90   # used for bbox detection — ignores soft glow tails
SOFT_EDGE = 80
PAD = 10


def main():
    img = Image.open(SRC).convert('RGBA')
    w, h = img.size
    px = img.load()

    # Column intensities at two thresholds.
    col_soft = [0] * w
    col_hard = [0] * w
    row_soft = [0] * h
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a <= 16:
                continue
            m = max(r, g, b)
            if m > BG_THRESHOLD:
                col_soft[x] += m
                row_soft[y] += m
            if m > TIGHT_THRESHOLD:
                col_hard[x] += m

    # Bin the image into 6 equal slots, compute centroid X within each.
    slot_w = w / 6
    centers = []
    for i in range(6):
        lo = int(i * slot_w)
        hi = int((i + 1) * slot_w)
        total = 0
        weighted = 0
        for x in range(lo, hi):
            v = col_hard[x]
            total += v
            weighted += v * x
        if total == 0:
            print(f'ERROR: slot {i} has no hard-foreground pixels', file=sys.stderr)
            sys.exit(1)
        centers.append(weighted / total)
    print(f'Centroids: {[round(c, 1) for c in centers]}')

    # Splits = midpoints between consecutive centroids.
    splits = [0]
    for i in range(5):
        splits.append(int((centers[i] + centers[i + 1]) / 2))
    splits.append(w)
    print(f'Splits: {splits}')

    # Vertical bounds (top/bot of any foreground in the strip).
    nz = [y for y, v in enumerate(row_soft) if v > 0]
    top = nz[0]
    bot = nz[-1]

    for i, name in enumerate(NAMES):
        seg_lo = splits[i]
        seg_hi = splits[i + 1]
        # Tight bbox using the HARD threshold so we don't grab neighbor glow.
        tight_lo = seg_hi
        tight_hi = seg_lo
        tight_top = bot
        tight_bot = top
        for y in range(top, bot + 1):
            for x in range(seg_lo, seg_hi):
                r, g, b, a = px[x, y]
                if a > 16 and max(r, g, b) > TIGHT_THRESHOLD:
                    if x < tight_lo: tight_lo = x
                    if x > tight_hi: tight_hi = x
                    if y < tight_top: tight_top = y
                    if y > tight_bot: tight_bot = y

        if tight_hi < tight_lo:
            print(f'ERROR: empty segment for {name}', file=sys.stderr)
            sys.exit(1)

        crop_lo = max(seg_lo, tight_lo - PAD)
        crop_hi = min(seg_hi, tight_hi + PAD + 1)
        crop_top = max(0, tight_top - PAD)
        crop_bot = min(h, tight_bot + PAD + 1)

        crop = img.crop((crop_lo, crop_top, crop_hi, crop_bot)).convert('RGBA')
        cw, ch = crop.size
        cpx = crop.load()
        for y in range(ch):
            for x in range(cw):
                r, g, b, a = cpx[x, y]
                m = max(r, g, b)
                if m < BG_THRESHOLD:
                    cpx[x, y] = (0, 0, 0, 0)
                elif m < SOFT_EDGE:
                    alpha = int(a * (m - BG_THRESHOLD) / (SOFT_EDGE - BG_THRESHOLD))
                    cpx[x, y] = (r, g, b, max(0, min(255, alpha)))

        out_path = os.path.join(OUT_DIR, f'{name}.png')
        crop.save(out_path, 'PNG', optimize=True)
        print(f'  wrote {out_path} ({cw}x{ch})')


if __name__ == '__main__':
    main()
