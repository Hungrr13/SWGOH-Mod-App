# tools/

Dev-side scripts. Nothing here ships in the app — everything is run from the repo root and writes to `src/data/`, `assets/`, `docs/`, or `tools/debug_out/`.

## Data pipeline: `src/data/chars.js` upkeep

- **`refresh-secondary-focus.js`** — Top-level orchestrator. Chains `build-mod-source-best-mod-urls` → `build-mod-source-unit-urls` → `mod-source-secondary-import` → `secondary-focus-generator` → `build-sec-focus`. Run this when refreshing meta.
- **`build-mod-source-best-mod-urls.js`** — Resolves character names to swgoh.gg slugs, writes URL list for the Best Mods report.
- **`build-mod-source-unit-urls.js`** — Same for per-unit pages.
- **`mod-source-secondary-import.js`** — Fetches HTML, extracts secondary-focus rows into a CSV.
- **`secondary-focus-generator.js`** — CSV → normalized per-character secondary priority list.
- **`build-sec-focus.js`** — Writes `src/data/secFocus.js` (generated).
- **`import-secondary-focus-from-html.js`** — Alternative entry: import from locally saved HTML instead of re-scraping.
- **`verify-chars-vs-swgoh.js`** — Diffs `src/data/chars.js` against the swgoh.gg Mod Meta Report. Dry run: `node tools/verify-chars-vs-swgoh.js`. Apply: `--apply`.
- **`apply-kit-caveat-overrides.js`** — Applies a hand-curated override map on top of scraped data (see the `overrides` object at top of file).
- **`merge-tags-from-html.js`** — Merges role/tag metadata from saved unit HTML into `chars.js`.
- **`map-chars-to-base-ids.js`** — Builds `src/data/charBaseIds.js` by matching display names against roster + Tosche Station DEFID dictionary.
- **`extract-ability-text.js`** — Pulls ability descriptions from saved unit pages.
- **`open-mod-source-best-mod-urls.js`** — Opens the URL list in a browser in batches (manual review helper). Pairs with `open_abilities_batches.bat` on Windows.

## Set classifier

- **`export-set-classifier-dataset.js`** — Turns labeled crops in `tools/set-classifier/debug-crops/` into a training-data folder.
- **`train-set-classifier-model.js`** — Writes `tools/set-classifier/model-debug/set-classifier-model.json`.

## Build artifacts

- **`build-todo-doc.js`** — Rewrites `docs/TODO.docx` from the embedded status table. Run whenever TODO rows change.
- **`icon-gen.js`** — Renders ModForge launcher icons. `node tools/icon-gen.js preview` for 512px PNGs; `... apply <name>` to blast into `android/app/src/main/res/` density buckets.

## Shape icons

- **`slice-shapes.py`** — One-off: slices a composite shape strip into 6 individual transparent PNGs.
- **`clean-shapes.py`** — Post-processes those PNGs (alpha cleanup, centering).

## Debug / QA

- **`pull_debug.ps1`** — Pulls the latest overlay debug dump from the phone into `tools/debug_out/`. Downscales PNGs to 400px longest edge so Claude's Read tool can load them. Flags: `-Png` (include classifier PNGs), `-All` (include per-scan focused/stats/shape/icon/set), `-Full` (skip downscale).
- **`slice-comparison-test.js`** — Calibration harness. Runs the slice engine against a small fixture of community rules-of-thumb and diffs the output. Not a unit test — run manually.

## Conventions

- All Node scripts assume the repo root as cwd. Run them from there: `node tools/whatever.js`.
- Scripts that touch `src/data/` can usually do a dry run first. Check the file for a `--apply` / `--write` flag.
- Generated files: `src/data/secFocus.js`, `tools/set-classifier/training-data/**`, `assets/mod-templates/learned-sets/**`. Hand-edited source of truth: `src/data/chars.js`.
