# READMEBEFOREEDITING

This is the current repo map after the cleanup pass. If you are not sure where to make a change, start here instead of guessing from old root-level files.

## Root layout

- `App.js`: app shell, tab host, menu, theme toggle, and overlay-capture event handoff.
- `index.js`: React Native app registration.
- `src/`: all live app code.
- `assets/`: bundled app assets, including scanner template images.
- `tools/`: maintenance scripts and classifier workflows.
- `references/`: saved imports, scraped HTML, and manual review/reference files.
- `docs/`: human-facing setup and workflow notes.
- `archive/`: old experiments and legacy files that are no longer on the active path.
- `android/`: generated/native Android project.
- `plugins/`: Expo config plugins for native wiring.

## Live app code

- `src/screens/LookupScreen.js`: character search and filter flow for browsing recommended builds.
- `src/screens/FinderScreen.js`: scores entered mod shells against character build data.
- `src/screens/SliceScreen.js`: slicer UI, value entry, and overlay-prefill target.
- `src/screens/OverlayCaptureScreen.js`: Android scanner workflow, capture review, debug crops, and learning buttons.
- `src/screens/GacScreen.js`: GAC Meta tab. Premium/rewarded-ad gated. Renders top 3v3 / 5v5 squads scraped from swgoh.gg, toggles defense (holds) vs offense (counters), and ranks by `winRate * 0.7 + coverage * 0.3` when a roster is linked. Missing squad members are marked red.
- `src/components/CharacterCard.js`: full character build card with main and backup builds.
- `src/components/CustomPicker.js`: reusable picker UI for set/shape/primary fields.
- `src/components/StatPickerModal.js`: searchable stat picker modal.
- `src/components/ModShapeIcon.js`: shared shape icon renderer and shape colors.
- `src/components/GuideModal.js`: in-app onboarding for Lookup, Finder, and Slice.
- `src/components/AdBanner.js`: ad wrapper.
- `src/components/LoadingScreen.js`: animated cold-start / scanner warm-up splash with cycling generic sci-fi status phrases.
- `src/theme/appTheme.js`: light/dark palettes and theme context.

## Services and scoring

- `src/services/sliceEngine.js`: main slice scoring algorithm used by the Slicer screen.
- `src/services/sliceRules.js`: scorer weights, thresholds, and synergy rules used by `sliceEngine.js`.
- `src/services/modCaptureParser.js`: OCR normalization and parsed mod extraction.
- `src/services/overlayCapture.js`: native Android overlay bridge.
- `src/services/overlayRecommendation.js`: quick recommendation text for overlay results.
- `src/services/modTemplateLibrary.js`: scanner template manifest hydration/status helper.
- `src/services/rosterService.js`: fetches/caches a player's SWGOH roster via ally code (proxied swgoh.gg player API). Exports `fetchRoster`, `getCachedRoster`, `clearCachedRoster`, `ownedBaseIdSet`, `setRosterApiBase`.
- `src/services/rosterState.js`: module-level roster state holder. Hydrated from AsyncStorage on app start, exposes `getCurrentOwnedIds()` for synchronous reads in the overlay event handler, and `setAllyCode`/`clearAllyCode`/`subscribe` for the ally-code UI.
- `src/services/premiumState.js`: AsyncStorage-backed premium / rewarded-unlock state. `FEATURES` enum (`ROSTER`, `FINDER_FULL`, `SLICER_WHY`, `GAC_META`) keys 24 h rewarded unlocks. `isPremium` is the one-time-IAP flag; `hasFeature(name)` returns true when either gate is satisfied.
- `src/services/gacMetaService.js`: fetches/caches top GAC squads via the roster-worker `?gac=3v3|5v5` route. Includes `normalizeGacData` (defensive shape-normalizer) and `recommendSquads(payload, ownedBaseIds)` which filters to ≥60% coverage and scores by `winRate*0.7 + coverage*0.3`.
- `src/services/gacMetaState.js`: pub/sub wrapper around `gacMetaService` with per-bracket storage and inflight dedup. Same pattern as `rosterState` / `premiumState`.

## Canonical data

- `src/data/chars.js`: master character build dataset. Edit this when a character's sets, primaries, or recommended secondaries change.
- `src/data/secFocus.js`: generated secondary-focus weight map. Do not hand-edit unless you are doing a one-off fix.
- `src/constants/modData.js`: shared shape, set, primary, and slice-threshold constants.
- `src/data/modTemplateManifest.js`: manifest for bundled scanner templates.
- `assets/mod-templates/`: scanner shapes, atlases, real set icons, and learned set assets.

## References and imports

- `references/mod-source-html/`: saved third-party mod-reference HTML pages used for offline parsing/import work. (Formerly `references/swgohgg-html/`; individual files renamed to `Best Mods for <Name>.htm`.)
- `references/mod-source-html/Abilities/`: optional raw ability pages if you want to regenerate ability text JSON later.
- `references/mod-source/`: generated URL lists (`mod_source_unit_urls.txt`, `mod_source_best_mods_urls.txt`) plus secondary-focus import/suggestion CSVs. (Formerly `references/swgohgg/`.)
- `references/character-data/ability_text.json`: extracted ability text snapshot.
- `references/character-data/character_faction_tag_review.csv`: manual faction/tag review notes.
- `references/character-data/kit_caveat_suggestions.csv`: manual secondary-focus override hints.
- `references/native-overlay-template/`: Kotlin template files for the Android overlay module/service.

## Tooling

- `tools/set-classifier/debug-crops/`: labeled raw set-crop source images.
- `tools/set-classifier/training-data/`: generated set-classifier dataset. Rebuild with `npm run export:set-dataset`.
- `tools/set-classifier/model-debug/`: debug JSON/model output for set-classifier work.
- `tools/slice-eval/run-slice-eval.mjs`: manual slice scorer sandbox script.
- `tools/debug_out/`: pulled overlay debug output from device sessions. Shape-classifier debug bitmaps and `shape-classifier-observed-debug.txt` are now written by the app to `<getExternalFilesDir>/overlay-debug/`, so `tools/pull_debug.ps1` pulls them via plain `adb pull` (works on release builds; no `run-as` required).
- `tools/roster-worker/`: Cloudflare Worker that proxies swgoh.gg's player API (bypasses Cloudflare's interactive bot challenge) and scrapes GAC meta HTML. Deploy with `wrangler deploy` from inside the folder. Live at `swgoh-roster-proxy.trash-receipt123.workers.dev`. Supports `?allycode=<9-digit>[&mods=1]`, `?gac=3v3|5v5`, plus `probe=1` / `gacProbe=1` / `scrape=<path>` diagnostics.
- `tools/*.js`: import, scraping, and data-refresh helpers.

## Current mod-shape status

- Active native shape classifier work is in `android/app/src/main/java/com/hungrr13/modhelper/overlay/ModIconClassifier.kt`.
- Live outer-shape references are bundled in `android/app/src/main/assets/mod_shapes/`:
  - `arrow_mask.png`
  - `circle_mask.png`
  - `cross_mask.png`
  - `diamond_mask.png`
  - `square_mask.png`
  - `triangle_mask.png`
- The app matches observed masks/contours against those bundled masks, not against the old scratch files under `archive/` or the Claude worktree debug exports.
- Runtime reference loading is wired through `SHAPE_REFERENCE_ASSET_NAMES` and `loadBundledShapeReferences()` in `ModIconClassifier.kt`.

## Current mod-shape debugging workflow

- Pull fresh device debug into `tools/debug_out/`.
- The useful current candidate files are:
  - `*-candidate-inner-overlay.png`
  - `*-candidate-inner-mask.png`
  - `*-candidate-outer-overlay.png`
  - `*-candidate-outer-mask.png`
  - `*-candidate-mask-only-mask.png`
  - `*-observed-debug.txt`
- `shape-classifier-observed-debug.txt` logs:
  - `shapeSyntheticWinner`
  - per-candidate top matches for `inner`, `outer`, `unguided`, and `mask-only`
- Do not trust only the final observed mask. Compare the candidate overlays first, then check which candidate actually won.

## Current mod-shape findings

- Crop/ROI is good enough to work on tracing and mask construction instead of crop tuning.
- The runtime exports separate synthetic candidates (`inner`, `outer`, `fallback`, `unguided`, `mask-only`) so we can compare them directly.
- **Shape is now driven by the contour-driven candidates** (`outer`/`fallback`). Those trace the rim edge directly and are immune to inner-icon variations.
- Cavity candidates (`inner`/`unguided`) threshold dark pixels and fill holes; they used to win by default but blob into a circle-like mask when the primary icon has enough disconnected dark elements (e.g. Crit Dmg crossed swords) that `fillInternalHoles` can't fully enclose.
- `mask-only` remains a last-resort fallback for when every guided candidate scores below the minimum confidence bar.

## Recent changes (April 2026)

### GAC screen: My-roster vs All-meta view toggle
- Added a third toggle row on `GacScreen` (below Defense/Offense, shown only when a roster is linked) that switches between **My roster** and **All meta**. My-roster mode is the existing behavior — `recommendSquads` filters to ≥60% coverage and ranks by `winRate * 0.7 + coverage * 0.3`. All-meta mode shows the full top-30 from the worker payload, role-filtered and sorted by raw win-rate, so players can see what to strive toward even if they can't field the squad today.
- All-meta mode still computes per-squad `ownedCount` / `coverage` against the linked roster so missing-member red chips render correctly. The no-roster case (no ally code linked) already behaves like All-meta and collapses into the same code path via `const showAll = !hasRoster || view === 'all'`.
- Subtitle and summary banner adjust to reflect the active view: My-roster shows "N of M top squads have ≥60% coverage", All-meta shows "Showing full meta — missing members highlighted in red".

### GAC screen: Attack/Defense toggle respects role when no roster is loaded
- With no roster linked, `GacScreen.squadsToShow` returned `payload.squads.slice(0, 30)` regardless of which toggle was selected. The worker concatenates defense squads first, then offense, so the unfiltered top 30 was always all defenders — Attack mode showed Jabba/Lord Vader/Rey leads with empty win% fields (offenseWinRate is null on defense rows and vice versa).
- Fix in `src/screens/GacScreen.js`: the no-roster branch now filters `payload.squads` by `sq.role === role` and sorts by the matching win-rate metric (`offenseWinRate` for Attack, `defenseWinRate` for Defense). The result is wrapped in `{ squad, ownedCount: null, coverage: null }` so the render code's existing `item.squad || item` fallback keeps working unchanged.
- After install: Attack with no roster shows Sith Eternal 96% / Malgus trios 93% / etc. matching the swgoh.gg `?perspective=attack&sort=percent` page. Defense continues to show Jabba 27% / Queen Amidala 17% / etc.

### GAC worker: scrape both attack and defense perspectives of /gac/squads/
- Problem: GAC Meta tab was empty on the Offense toggle for both 3v3 and 5v5. Client was receiving squads, but every entry had `offenseWinRate: null` so `recommendSquads().offense` returned an empty bucket.
- Investigation found swgoh.gg's `/gac/squads/` page takes a `perspective` query param. Default (no param) returns top **defensive** squads sorted by Hold % — "squads left on defense and how often they hold". `?perspective=attack&sort=percent` returns a completely different list: top **attacking** squads sorted by Win % — "squads players actually run to attack and how often they win". Neither is derivable from the other (e.g. top attacker is `SITHPALPATINE` solo at 96%; top defender is `JABBATHEHUTT + BOUSHH + KRRSANTAN` at 27% hold). Early attempts to derive offense as `1 - holdPct` produced wrong rankings.
- Fix in `tools/roster-worker/worker.js`: `scrapeGacSquads(bracket)` now fetches **both** perspectives in parallel (default defense view + `?perspective=attack&sort=percent` offense view), parses each through `parseGacSquadsHtml(html, role)`, and concatenates the results. Each squad carries its own role tag (`'defense'` or `'offense'`) and exactly one populated win-rate field. Season parity gates candidates (odd = 3v3, even = 5v5); the attack view legitimately includes 1-member solo squads (Wampa, Palpatine, etc.) so bracket detection runs off the defense view only.
- Verified live: `GET /?gac=3v3` returns 87 squads (42 defense + 45 offense) from the current season, with top offense = `SITHPALPATINE` solo at 96% win and top defense = `JABBATHEHUTT` lead at 27% hold. `GET /?gac=5v5` returns 70 squads (37 defense + 33 offense) from season 76, top offense = Bounty Hunter pack at 92% and top defense = `LORDVADER` at 33% hold.
- Client is unchanged: `recommendSquads` already splits by role and ranks by the appropriate win-rate metric. Cache TTL is 12 h; users tap the Refresh button on the GAC screen for immediate pickup.

### Slice screen: single unified verdict card
- Removed the duplicate Decision card below the ladder plan. The two cards were running two independent engines (step-by-step ladder vs. score-based decision) and producing contradictory verdicts on the same mod — e.g. ladder plan said `Slice to 5B` (cyan) while the Decision card said `Filler - not worth slicing`. User-confusing.
- `SliceScreen.js` now renders one card driven by `result.ladderPlan`. The old Decision card's score (`finalScore / 100`) and top `reasonLines[0]` are folded into the ladder card as footer lines so no information is lost. The old card still exists as a fallback branch if `ladderPlan` ever fails to build — keeps the verdict chrome intact for edge cases.

### Scanner: parser fixes for stuck-tier OCR + dropped roll counts
- **Stuck-tier fix.** OCR sometimes glues the mod's tier letter onto the front of the first secondary line — real capture: `C (2) 4.12% Protection` (a 5C Cross). The original `extractModTier` patterns required `LVL`/`LEVEL`/`Tier` context or a standalone letter near a level banner, so this layout returned `null` and the Slice tab showed the wrong tier. Added a last-resort pattern `^([A-E])\s+\(\d+\)` that scans each line for a single A–E letter followed immediately by a `(n)` roll-count. Verified against `tools/debug_out/ocr-debug-last.txt`: now returns `5C` correctly.
- **Dropped-rolls fix.** `extractSecondaries()` runs three regex patterns on every secondary line — `statFirstPattern`, `valueFirstPattern`, `rollFirstPattern`. For a line like `(2) 4.12% Protection`, both `valueFirstPattern` and `rollFirstPattern` match, but `valueFirstPattern` fires first *without* a rolls field. The old dedup picked the first match per stat, so the `(2)` from `rollFirstPattern` got discarded and every secondary came through with `rolls=undefined`. Fixed the dedup to prefer the entry that carries a finite `rolls` value — `Protection% (2)`, `Offense% (2)`, `Speed (1)`, `Defense (1)` now survive end-to-end to `parsed.secondaries`.
- Downstream impact: `App.js`'s tier-aware roll-clamping + `estimateRolls` fallback now only runs when the OCR genuinely didn't see a roll count, instead of overriding the real count with an estimate. Also means the `(1)` on a flat Defense secondary no longer misleads the Slice engine into treating it as a 5-roll stat.
- **Header-stripping regression.** `OCR_NOISE_PATTERNS` had `/\bprim\w*\b/gi` and `/\bseco\w*\b/gi` entries that were intended to kill log-style lines like `"reading the visible primary and secondary stats"` — but they also nuked the literal `"PRIMARY STAT"` and `"SECONDARY STATS"` section headers the mod card produces. Without those headers, `findLineIndex(... 'secondary stat')` returned `-1` in both `extractPrimary` and `extractSecondaries`, falling through to the "scan every line" path and ingesting the primary stat (`5.88% Health`) as a secondary. Dropped those two overly broad regex patterns; the narrower `reading the visible primary and secondary stats` noise pattern still handles the log-line case.
- **Primary-dedup-before-promotion bug.** `extractSecondaries` compares `stat.toLowerCase() === primaryKey` before the flat-to-% promotion step, so a line like `5.88% Health` on a Health%-primary mod would pass as flat `Health` (since `'health' !== 'health%'`), *then* get promoted to `Health%`, collide with the primary in the secondaries list, and push the real 4th secondary (flat Defense in the repro case) past the 4-item `slice(0, 4)` cap. Added a final pass after promotion that filters any secondary whose (post-promotion) stat matches the primary.
- Verified end-to-end with a node trace harness against the actual on-device OCR dump (`ocr-debug-last.txt` pulled from R5CX10W4LJY): parser now returns `{ modSet: 'Health', modShape: 'Cross', primary: 'Health%', tier: '5C', secondaries: [Protection% 4.12% (2), Offense% 0.72% (2), Speed 5 (1), Defense 9 (1)] }`.

### Slice engine: step-by-step ladder + tier OCR on scans
- `buildLadderPlan()` now emits a new **`SLICE_NEXT`** verdict (cyan) for pre-5A mods with catalyst potential. Instead of projecting an end-state verdict from current rolls, the engine recommends "slice one tier forward, re-evaluate after the new roll" — which matches how slicing actually works (each tier slice adds one random roll to one secondary, chosen across the 4 revealed slots). A 5C mod with Speed at 1 roll + priority stats shows `Slice to 5B` → "Speed already rolling — the 5C→5B slice has a ~25% shot at boosting it again. Take one step, then re-check. Don't pay further mats if the next roll lands elsewhere."
- Gate: `hasCatalystPotential = speedMayBoost || priorityMayBoost`. `speedMayBoost` = Speed secondary present and rolls < 5. `priorityMayBoost` = at least one priority stat with `SLICE_GAIN >= 0.3` (Offense%, Defense%, Health%, Protection%, Potency%, Tenacity%, or Defense flat). Pre-5A + `matsAhead` + catalyst potential → `SLICE_NEXT`. Otherwise falls through to the existing Filler / Sellable / Cap-at-5A paths.
- Firing order preserved: `forcedsell` (3+ flat) → obvious-trash sellable → definitive-usable (Speed arrow, hard Speed, strong upside, Speed-backed) → **NEW `SLICE_NEXT`** → 5A `Cap at 5A` / sellable → pre-5A filler / sellable. This means clear-cut cases still get end-state verdicts; only ambiguous pre-5A mods get the step-by-step framing.
- UI: `SliceScreen.js` renders `SLICE_NEXT` with "Next step: → {nextTier} — re-evaluate after roll" instead of the old "Stop at: X" phrasing.
- Tier OCR: `extractModTier(text, lines)` in `modCaptureParser.js` pulls the `E/D/C/B/A` letter from the mod-card OCR (patterns: `Tier C`, `LVL 15 · C`, `Level 15 A`, plus a standalone-letter fallback that requires a nearby `LVL|LEVEL` token). Emits `parsed.modTier = '5C'` etc. Threaded through `App.js` → `slicePrefill.tier` → `SliceScreen` so the tier pill auto-selects from the scan. `6E` isn't extracted yet (needs pip-count detection) — user taps 6E manually on a 6-dot mod.
- Fallback: if OCR doesn't find a tier letter, `SliceScreen` now clears `tier` to `''` on prefill instead of leaving the previous/initial `'5A'`. Ladder plan falls through to `Not sliceable — No tier selected`, prompting the user to pick manually. Prior behaviour silently displayed wrong 5A verdicts on every scan.

### Slice engine: community-tuned weights + thresholds
- Audited `sliceRules.js` weights and `buildLadderPlan` thresholds against the community consensus (swgoh.gg top-1000 Kyber GAC meta, Grandivory `characterSettings.js`, Crouching-Rancor efficiency formula, and YouTube guidance from Warrior / MobileGamer / Ahnaldt101).
- Weight change: `Defense%` dropped from `5.0` → `4.0`. Community consensus is ~3–4; our previous 5.0 was biasing tank mods ~25% above consensus.
- Ladder change: `strongUpside` SLICE_GAIN cutoff lowered from `>= 0.5` → `>= 0.3`. This brings `Protection%` (SLICE_GAIN 0.33) into the 6-dot-catalyst bucket so a Prot%-primary mod with strong Prot% secondary rolls can earn a `Usable` verdict instead of falling through to `Cap at 5A` / `Filler`.
- Ladder change: `hasDecentFit` floor raised from `finalScore >= 40` → `>= 50`. Grandivory's `HOLD` band is 60, so a 40-floor was pushing mediocre mods into `Filler` too eagerly. New floor also tightens the `Cap at 5A` gate so only mods with genuine fit encourage finishing the free 5A level climb.
- Verified unchanged: Speed-arrow rule (always Usable when Speed secondary present), 3+ flat base secondaries → `forcedsell`, `avgPriorityQuality < 35 && finalScore < 40` → Sellable pre-5A, and the Crouching-Rancor efficiency formula `(value - r*min) / (r*(max - min))` in `rollEfficiency`.

### Slice engine: tightened 5A→6E gate (speed value floor + unified overlay)
- Dropped the `speedBacked` path (`Speed >= 2 rolls && avgPriorityQuality >= 55` → `Usable`). Speed at only 2 rolls is inconclusive — each remaining slice is ~25% to hit Speed again, so a mod can sit at its current Speed value through every slice. On 2 rolls the engine now falls through to `SLICE_NEXT` (step-by-step) so the user re-evaluates after each roll instead of committing 6-dot mats on a gamble.
- Added a Speed value floor to `speedHitHard`: `speedRolls >= 3 && speedVal >= 14`. The 3-roll proxy was a stand-in for the community rule "Speed ≥ 15 before 6-dot" (3 rolls average 15 at the 3–6 range midpoint), but unlucky rolls at the bottom of the range can leave a 3-roll mod at 9–13 Speed. The value floor catches those cases and routes them to `Cap at 5A` / step-by-step instead of auto-USABLE.
- Unified overlay verdict with Slice-tab verdict. `overlayRecommendation.js` used to call `pickChars(options.ownedBaseIds)` (roster-filtered) while `SliceScreen` evaluates against the full `DECODED_CHARS` pool, which produced divergent verdicts when a slice-worthy mod's ideal users weren't in the user's roster (overlay said "don't slice", Slice tab said "→6E"). Overlay now also evaluates against `DECODED_CHARS`; ownership is reflected via the per-character status badges in the character panel rather than by filtering the priority-scoring pool. Removed the now-unused `pickChars` helper + `CHAR_BASE_IDS` import from `overlayRecommendation.js`.

### Slice engine: 5-state tier-ladder verdict
- `buildLadderPlan()` in `sliceEngine.js` walks the tier ladder `5E → 5D → 5C → 5B → 5A → 6E`, reading the revealed secondaries, priority-stat hit count, and average roll quality to emit a 5-state verdict surfaced in a new ladder card on `SliceScreen.js`:
  - **Usable** (green) — worth taking to 6E (Speed arrow + Speed sec; Speed sec ≥3 rolls; high-SLICE_GAIN priority stat rolled ≥65% quality; or Speed ≥2 rolls backed by ≥55% avg quality).
  - **Cap at 5A** (yellow) — only fires when `tier === '5A'` and `hasDecentFit` is true. Message: finish the free money 5A 1→15 climb but skip 6-dot mats.
  - **Filler** (blue) — mod is at 5B/5C/5D/5E with `hasDecentFit` but no 6-dot catalyst. "Equip as-is at current tier until a better replacement appears; don't spend tier-slice mats."
  - **Sellable** (red) — forced-sell on 3+ flat base stats, or pre-5A mods with no priority hits + no Speed, or pre-5A mods with `avgPriorityQuality < 35 && finalScore < 40`, or 5A mods with weak fit.
  - **Not sliceable** (grey) — already 6E, no tier selected, or no character build uses the shell/primary.
- The `Cap at 5A` guard is important: prior to the fix it fired on any tier with a decent fit, which implicitly pushed users to burn tier-slice mats (5B→5A, 5C→5B, etc.). Within-tier level 1→15 costs credits only; tier slices cost mats. `Filler` is the correct verdict for decent-but-not-slice-worthy mods sitting below 5A.
- `SLICE_GAIN` table in `modData.js` drives the 6-dot catalyst rule: stats whose cap jumps meaningfully at 6E (Offense% 2.02×, Defense% 1.34×, Health% 0.78×, Protection% 0.33×) are candidates; stats that barely move (Speed 0.03×, Crit Chance% 0.04×) are not — which is why Speed secondaries don't justify 6E on their own, only Speed arrow primaries do.

### chars.js refreshed from swgoh.gg mod meta report
- `src/data/chars.js` rewritten against `https://swgoh.gg/stats/mod-meta-report/` — the single-page consensus table that lists recommended sets + per-shape primary for every character. 277 entries had drifted from the current meta (e.g. Aayla cross `Potency` → `Protection/Offense`, Ahsoka Tano set `Offense(x4)+Health(x2)` → `Speed(x4)+Health(x2)`). 47 entries were already correct. 1 character (Cobb Vanth) isn't in the meta table yet and was left as-is. `src/data/chars.js.bak` is the pre-rewrite snapshot.
- Verifier: `tools/verify-chars-vs-swgoh.js`. Fetches the meta report through our Cloudflare Worker (scrape allow-list now includes `/stats/`), parses each `<tbody>` row (character slug, stacked `stat-mod-set-def-icon--set-<id>` icons, last 4 `<td>`s = Arrow/Triangle/Circle/Cross primaries), and diffs against `chars.js`. Supports multi-primary tolerance lists like `Protection / Tenacity` — a local value is a match if it appears anywhere in the reported list. Run dry: `node tools/verify-chars-vs-swgoh.js`. Apply: `node tools/verify-chars-vs-swgoh.js --apply`.
- Set decoding rule: each `set-<id>` icon is one active set-bonus instance. 4-piece sets (Speed / Offense / Crit Dmg) contribute 4 mods per icon; 2-piece sets (Health / Defense / Crit Chance / Potency / Tenacity) contribute 2 mods per icon. So `set-4 + set-7` = `Speed(x4) + Tenacity(x2)`; `set-1 + set-1 + set-3` = `Health(x4) + Defense(x2)`.

### Slot-aware mod comparison on the Slice tab
- `SliceScreen.js` moves the purple priority-star indicator out of the priority chip row and into two dedicated per-character badges below the character name: **Primary stat match** (purple) and **Set match** (yellow, substring-matched against the scanned mod's set). These show regardless of roster state; owned-mod badges (Empty / Better fit / Same fit / Worse fit) render only when a roster is loaded.
- Verdict model simplified from score-based Upgrade/Sidegrade/Downgrade to a count-based **Better fit / Same fit / Worse fit** that compares the number of priority-aligned secondaries on the scanned mod vs. the currently-equipped slot mod. Magnitude-insensitive — any matching-priority secondary counts as 1, regardless of roll value or tier. New `countAlignedForMatch(match, secondaries)` export in `sliceEngine.js` drives both sides.
- Priority chips on match rows are now uniformly green when aligned (no purple — the primary-stat match lives in its own badge now).
- Character recommendations are filtered by the scanned mod's set. When a set is selected, only characters whose `c.set` string includes that set name (substring match, so `Defense` matches both `Defense(x4)+...` and `...+Defense(x2)`) are surfaced in Best Characters / Best Fit.
- `rosterService.js` cache key bumped `swgoh_roster_v2_` → `swgoh_roster_v3_` to invalidate caches that predate mod `primary` + `secondaries` normalization. Any future shape change to the cached roster needs another bump.

### Flat / % priority equivalence (% trumps flat)
- New `promoteToPercent` + `normalizePriorityName` helpers in `sliceEngine.js`. Priority-list matching now treats `Health` (flat) and `Health%` as the same target — a scanned `Health%` satisfies a `Health` priority and vice versa.
- `deriveAltPrioritiesFromFocus` coalesces flat + % SEC_FOCUS entries before ranking (keeps the higher `usagePct`, always emits the % variant), so derived alt builds no longer leak flat entries from research positions 5–6.
- `scoreEnteredSecondaries` already applies `FLAT_TIEBREAKER_MULTIPLIER = 0.25` when a scanned flat stat supports a % plan, so the reverse case — scanned flat matching a % priority — remains a soft / "shitty" match as intended.

### Priority alignment visible on match rows
- `scoreMatchAgainstEnteredSecondaries` in `sliceEngine.js` now also returns `alignedPriorityIndices`, `alignedStats`, `offPriorityHits`, and `primaryPriorityIndex`. Threaded through `rankedMatches` → `alignedMatches` → `matchedCharacters` so the UI can render without re-running matching.
- `SliceScreen.js` replaces the flat `Speed › Offense% › Crit Chance%` text on each match row with colored chips: green ✓ for an entered secondary that hit that priority slot, purple ★ for a primary-stat hit, muted for unhit slots. Shown in compact mode (Your Roster / Best Fit) too, limited to top-3 chips.
- `Main build` / `Alt build` label now renders on every match row (previously hidden in compact). Overlay `charLine` tags alternate-build entries with `(alt)` so `Gamorrean Guard (alt)` is distinguishable from the Speed-first main build.

### Alt build priorities derived from research + no-Speed penalty
- `sliceEngine.js` `deriveAltPrioritiesFromFocus(char)` builds alt priority lists at runtime from `SEC_FOCUS` usage data instead of reading the manually-curated `buSecs`. Strategy: keep positions `#1` and `#2` from `char.secs`, then append positions `#5` and `#6` from the full usage-sorted list (skipping anything already in main). Speed is locked — if the main build has Speed at position `N`, the alt keeps Speed at `N`. Characters whose research shows Speed outside the top-6 (naturally slow) are respected; Speed is not force-injected. Falls back to `char.buSecs` if `SEC_FOCUS` lacks the character.
- `finalScore` takes a `-12` penalty when the mod has `3+` revealed secondaries and none is Speed. A new reason line (`No Speed secondary – almost every character wants Speed first.`) surfaces alongside. Soft penalty (not auto-SELL) so a legit tank / slow-character mod can still rank well if the shell matches.

### Free-user overlay characters panel gated + top expanded to 20
- `App.js` overlay event handler now checks `premiumState.hasFeature(ROSTER) || isPremium` and swaps `dual.characters` for a `Top Characters — Premium` pitch when the user is free. Free users shouldn't see a top-N list because there's no roster context to meaningfully rank against.
- `overlayRecommendation.js` `topMatches` cap bumped from `slice(0, 6)` to `slice(0, 20)` and the title from `Top 6 Users` to `Top 20 Users`. With ~330 SWGOH characters, six was too tight to show real alternates.

### GAC meta tab (premium)
- New `GAC` tab (`src/screens/GacScreen.js`) wired in `App.js`. Gated behind premium or the `GAC_META` 24 h rewarded unlock; unlocked users get 3v3 / 5v5 + defense / offense toggles, locked users see the gate card.
- Data flows through `gacMetaService` → `gacMetaState` → screen. `recommendSquads` filters to ≥60 % roster coverage and ranks by `winRate*0.7 + coverage*0.3`.
- When no ally code is linked, the screen falls back to the raw global top-30 (no personalisation) so free users still see a useful page.
- Worker scraper (`tools/roster-worker/worker.js`): swgoh.gg has no JSON API for GAC squads, so the worker fetches `/gac/squads/` and `/gac/who-to-attack/` as HTML, parses the `stat-table` rows (3-member = 3v3, 5-member = 5v5), and walks back up to six `season_id` candidates until it finds a page matching the requested bracket. Returns `{ bracket, source, squads, timestamp }` — `defenseWinRate` is the observed hold rate, `offenseWinRate` is `1 - hold` when scraped from the defense tab.
- Added `scrape=<path>` diagnostic (allow-listed to `/gac/`, `/meta/`, `/squads/`, `/characters/`, `/ships/`, `/stats/`) and `gacProbe=1` for endpoint discovery. Both kept in so we can re-check schema changes without redeploying.
- Premium state gained `FEATURES.GAC_META = 'gac_meta'`.

### Overlay ownership + upgrade-vs-empty badges
- `src/services/overlayRecommendation.js` `charLine()` now stamps explicit status badges based on `modStatusFor(name)`:
  - Not owned → `· Not unlocked`
  - Owned, no mod data yet → `· Owned`
  - Owned with mods → `· N/6 · Empty slot` when any slot is blank, `· 6/6 · Upgrade (N↑)` when the scanned mod beats the equipped one, `· 6/6 · Maxed` when nothing to gain.
- `App.js` builds `modStatusFor` only when `rosterState.getCurrentOwnedIds()` is populated — free (non-premium, non-rewarded) users see the general recommendation list with no ownership badges, as asked.
- Free users who tap the ally-code input or Load button get a single "Unlock Premium Features" alert with an inline Watch Ad button. `AllyCodePanel` gates both the TextInput `onPressIn` and the Load handler on `rosterUnlocked`.
- `SliceScreen.js` "Your Roster" card now re-numbers 1-based from `ownedMatches` index instead of inheriting the global Best-Characters rank.

### Shape classifier: Circle → Diamond rescue (outer-contour tiebreaker)
- `ModIconClassifier.kt` adds an `outerDebug` lookup on the `outer` synthetic candidate plus an `outerContourLooksNonRound` flag (`Circle score ≤ 0.35` **and** `circularity ≤ 0.55`).
- New high-priority rescue rule ahead of the `winnerStronglyRound`-gated branch: `Circle` winner with `diamondCornerScore ≥ 0.88`, `aspectRatio in 0.92..1.10`, and `outerContourLooksNonRound` → flip to `Diamond`.
- Motivated by a real misclassification where `mask-only` smoothed a Diamond silhouette into a Circle at 0.97 confidence. Observed `dCorner` alone can't separate a rotated Diamond from a genuinely round icon like Grievous; the raw outer-contour scan is the disambiguator.

### Color-invariant set classifier
- `buildObservedSymbolMask` and `buildObservedSymbolEdgeMask` in `ModIconClassifier.kt` now derive thresholds from the per-image luminance median + MAD instead of hardcoded cutoffs (`luminance > 92`, etc.). Same pipeline now handles teal Potency, purple Crit Chance, orange Offense, etc. without per-color tuning.
- Polarity (dark-symbol-on-light vs light-symbol-on-dark) is detected from the center-vs-overall luminance gap; inverted symbols flip the mask logic.
- Removed the inner-only `tightly = cw > 0.32` constraint on the inverted branch — it stripped Potency's crosshair *circle ring*, leaving only the "+" cross which then matched the Health template.
- Removed the tightest generic crop variant (`(0.20, 0.41, 0.26, 0.26)` in `cropSetSymbolVariants`) for the same reason — the inner-only crop matched Health on Potency.

### Set classifier: parent crop selection
- Each `iconBitmap` variant is scored independently inside `detectSet`; the parent loop picks the best across them. Previous logic preferred the highest aggregate score, which let inflated softmax scores from a misleading crop beat a near-perfect template match from a clean crop.
- New rule: high-confidence override at `peakRawConfidence >= 0.85`. The threshold was previously 0.7 but cases in the 0.70–0.84 range fired on misleading crops with weak margins (Offense template scoring 0.79 on a Crit Chance icon). 0.85+ requires a near-identical match.
- File-based debug log written to `<getExternalFilesDir>/set-debug-last.txt` (Log.d is stripped from release builds). The log accumulates across all `detectSet` calls within one scan and ends with a `===FINAL===` marker showing which crop the parent chose.

### Slice scoring tightening (`sliceEngine.js`)
- `PRIORITY_BAND_POINTS` extended from `[36, 28, 18, 10]` to `[36, 28, 18, 10, 6, 4]` with a `PRIORITY_BAND_TAIL = 2` fallback so 7th+ priority stats still earn a small contribution instead of returning `undefined`.
- Off-priority stats with `SEC_FOCUS` data now contribute `min(focus.score * 0.12, 8)` instead of an all-or-nothing `+4` at `focus.score >= 55`. Characters with strong meta usage on uncurated stats now get graceful credit.
- New `SET_AFFINITY_STATS` map (`Crit Dmg → ["Crit Dmg%"]`, `Speed → ["Speed"]`, etc.) applies a `1.20x` weight multiplier in `scoreEnteredSecondaries` when the secondary stat aligns with the worn set's bonus stat. Reflects the in-game amplification of those stats by their set bonuses.

### Overlay capture readiness
- After granting MediaProjection permission, `runStartFlow` in `OverlayCaptureScreen.js` polls `getOverlayCaptureStatus()` through `[150, 250, 400, 600, 800]` ms delays until `screenCaptureReady` is true — fixes "scan button needs two taps on first launch" regression.
- Bubble-attachment polling now runs **before** `launchSwgoh()` rather than after. JS execution pauses when SWGOH takes foreground, so anything queued after `launchSwgoh()` was stalling until the user swapped back to the scanner. Now the bubble is confirmed attached first, then the game launches.
- Roll-count prefill: `App.js` now estimates roll count via `overlayRecommendation.estimateRolls(stat, value)` when OCR misses the `(N)` prefix, so slice-tab roll pills populate instead of staying blank.

### Ally-code UI + owned filter plumbed into overlay events (step 4)
- App menu gets a new "Set Ally Code" action that opens `AllyCodeModal` (defined inline in `App.js`). The modal fetches through `rosterService`, saves the 9-digit code to AsyncStorage, and keeps a Set of owned base_ids in `rosterState` for the overlay event handler to read synchronously.
- `App.js` hydrates `rosterState` on startup and passes `rosterState.getCurrentOwnedIds()` to `buildOverlayRecommendations` in the `captureSuccess` handler, so scan results filter to characters the player actually owns.
- Default `rosterService` API base is Tosche Station's public worker — the feature works immediately without deploying anything. Swap to a private worker via `setRosterApiBase()` once `tools/roster-worker` is deployed.
- Dependency added: `@react-native-async-storage/async-storage` (`npx expo install`).

### Owned-character filter on overlay recommendations (step 3)
- `src/services/overlayRecommendation.js` now accepts `options.ownedBaseIds` (a `Set<string>` of swgoh.gg base_ids, from `ownedBaseIdSet(rosterPayload)`). When present and non-empty, `DECODED_CHARS` is filtered to only entries whose `chars.js` name maps to an owned base_id via `src/data/charBaseIds.js` *before* `evaluateSliceMod` runs.
- Falls back to full roster when the option is omitted, so every existing call site keeps working unchanged.
- Two known duplicate mappings (same base_id from two `chars.js` names: `AHSOKATANO` and `HOTHLEIA`) are in-game renames, not mapping bugs — flagged for a chars.js cleanup pass.

### chars.js → swgoh.gg base_id mapping (step 2)
- `src/data/charBaseIds.js` (auto-generated): `CHAR_BASE_IDS` + `BASE_ID_TO_CHAR_NAME` for all 325 `chars.js` entries.
- Generator: `node tools/map-chars-to-base-ids.js`. Pulls from Hungrr's live roster (232 authoritative), Tosche Station's scraped `DEFID` table (52), and a manual-override block (41, with medium-confidence entries flagged in-file). Regenerate whenever a `chars.js` name is added or changed.
- Review artifacts: `tools/roster-mapping/chars-baseid-map.json` and `chars-baseid-unmatched.json`.

### Roster service (step 1 of ally-code integration)
- New `src/services/rosterService.js`. Takes an ally code, returns a normalized `{ playerName, roster: { BASE_ID: { stars, gearLevel, relicTier, isGL, ... } }, unitCount, timestamp, fromCache }`.
- Caches in AsyncStorage when `@react-native-async-storage/async-storage` is installed; falls back to an in-process Map otherwise. Default TTL 6 hours, overridable via `fetchRoster(code, { ttlMs })` or bypass via `{ forceRefresh: true }`.
- API base is configurable via `setRosterApiBase(url)`. Default is `https://swgoh.gg/api/player/` but that endpoint is behind Cloudflare's interactive bot challenge — direct calls from RN will fail. Point at a proxy worker instead (see below).
- Relic conversion follows swgoh.gg's offset: `relic_tier ≥ 2` → `relic_tier - 1`, anything lower → 0.
- New `tools/roster-worker/`: ~40-line Cloudflare Worker that proxies `swgoh.gg/api/player/<ally>/`. Deploy with `wrangler deploy`; then call `setRosterApiBase('https://<your-subdomain>.workers.dev/?allycode=')`. Free tier covers vastly more than we'll ever use.
- Not yet wired into any screen or the overlay recommendation pipeline — that's step 3 (`chars.js` `baseId` annotation) and step 4 (filter `DECODED_CHARS` by owned set inside `buildOverlayRecommendation*`).

### Set classifier: ZNCC template matching with peak-aware crop selection
- Replaced the mask-based set-symbol classifier with zero-mean normalized cross-correlation (ZNCC) on raw grayscale templates. Booleanized 64×64 masks threw away too much information; fist (Tenacity) and crosshair (Potency) both collapsed into ambiguous blobs and misclassifications cycled through Potency → Health → Speed → Crit Dmg before ever resolving to the correct Tenacity.
- `scoreBitmapAgainstRawTemplates(...)` in `ModIconClassifier.kt` resizes each training sample to 48×48, normalizes to zero mean / unit variance *only over an elliptical window mask* (profile-specific: triangle cy=0.62 rx=0.22 ry=0.20; arrow cy=0.52 rx=0.26 ry=0.22; generic cy=0.54 rx=0.26 ry=0.22), then correlates observed vs. stored template. The window excludes the silver frame, which is byte-identical across all sets and was otherwise dominating similarity (every pair scored 0.97+).
- Softmax temperature raised from 8 to 20 to keep decisive peaks from getting washed out across the mixture.
- Per-class aggregation uses a top-half average of ZNCC scores across crop variants; a byte-identical template match at raw=1.000 now decisively wins.
- Outer icon-crop selection prefers the crop with the highest peak raw NCC (not the highest softmax-amplified score). Rationale: a well-aligned crop with raw=1.000 is more trustworthy than a poorly-aligned crop whose relative margin gets amplified by softmax. Added `peakRawConfidence` and `peakRawWinner` to `SetDetectionResult` so the outer loop can pick the right crop.
- Raw-peak override inside `detectSet`: if `overallPeakRaw >= 0.55` and the peak-winning class differs from the aggregate winner by margin ≥ 0.05, the peak winner wins.
- `preferredSetProfileFromOcr` in `ModOverlayCaptureService.kt` simplified to only hint `arrow` when primary is Speed — the old triangle/arrow hints keyed off primary-name text that overlapped with secondary stat text and produced false hints.

### Shape classifier: contour-driven is source of truth
- `buildObservedSilhouetteEvaluation` in `ModIconClassifier.kt` now always prefers the contour-driven candidates (`outer`/`fallback`) over the dark-pixel cavity candidates (`inner`/`unguided`) when picking `bestGuided`.
- Reason: shape should come from the rim outline, not the inner icon. Cavity masks get polluted by primary-icon dark elements that `fillInternalHoles` can't enclose (the mask blobs into a circle and scores Circle/Arrow on shapes that are clearly Triangle/Cross/Diamond etc.).
- Contour candidates use a relaxed `contourMinScore = 0.20` so a modestly-scored triangle rim beats a confident-looking but polluted cavity blob. Cavity only wins when both contour candidates fall below 0.20 (then the normal `guidedMinScore = 0.30` gate applies to all guided candidates).

### Shape classifier: portrait detection tuned
- `hasPlayerPortraitBubble(sourceMat)` now requires `populatedBuckets >= 2` (down from 3) of distinct 15°-wide hue bins at bottom-left. Tighter shape crops (e.g. shape-2 variant at 144×143) only catch a partial portrait, so the old 3-bucket threshold missed them and the portrait cut never applied — the cavity mask pulled the portrait in and drifted to Cross/Arrow.
- When portrait is detected, the color-zone fallback in `buildObservedSilhouetteMask` and the cavity cut in `buildInnerCavitySilhouetteMask` both carve an ellipse at ~(0.22w, 0.80h) with radii (0.30w, 0.26h). After close+fillHoles, a final `cleanupInnerObservedMask` pass re-applies the cut so dilation can't re-merge the portrait region.
- Cavity candidates now always try portrait removal when the detector fires; contour candidates (`outer`/`fallback`) never cut — they trust the rim contour.

### OCR parser: alias boundary fix
- `normalizeText` in `src/services/modCaptureParser.js` was running OCR-correction aliases (`spe → Speed`, `def → Defense`, `crit chance → Crit Chance%`, etc.) without word boundaries. Partial aliases matched *inside* correctly-OCR'd stat names: "Speed" → "Speeded", "Defense" → "Defenseense%e%se%nse", "Crit Chance%" → "Crit Chance%%". `canonicalizeStat` then couldn't map those to `SEC_STATS` and dropped them — the overlay kept reporting "Need 2+ clear secondaries" on scans that clearly had 4.
- Fix: a new `buildAliasPattern(from)` helper wraps the escaped alias in `\b…\b`, but only on sides where the alias starts/ends with a word char (so aliases ending in `%`, `(`, or space still match). Plus a `%%+` → `%` collapse to handle aliases that re-add `%` onto stats that already have one.
- Net effect: secondaries parse cleanly and the `Shell Match` branch of `buildOverlayRecommendations` stops firing on good scans.

### Shape classifier rescues
- `refineShapeSelection(...)` in `ModIconClassifier.kt` now looks at other candidates' rule debug (mask-only, inner, outer, unguided) to recover missed shapes.
- Rescues added:
  - Cross → Square when the mask-only candidate shows a near-full square fill (hollow-frame false positive), **gated on `!anyCandidateStronglyCross`** so Speed-set Crosses (halo-fills-bbox makes mask-only look square) don't get flipped when inner/outer candidates still score Cross ≥ 0.65.
  - Circle → Arrow when any candidate flags `arrowLooksCompact` with Arrow ≥ 0.50, **gated on `!winnerStronglyRound`** (a gold Circle whose mask-only reports Circle:0.97 stronglyRound=true was being flipped by unguided `arrowLooksCompact`).
  - Circle → Diamond when any candidate flags `circleLooksDiamondish` with Diamond ≥ 0.35, **gated on `!winnerStronglyRound`** so the Grievous-Circle case (mask-only Circle:0.97, stronglyRound=true) isn't flipped by `shapeDiamondCornerScore` artifacts from the character portrait.
  - Cross/Square → Diamond when `diamondCornerScore ≥ 0.80`, aspect ~1, **and `extent ≤ 0.73`**. Extent guard calibrated against real-Diamond samples (extent 0.65–0.70, corners empty) vs. Cross-with-set-icon (extent ~0.78, icon+halo fill the bbox). dDiag was abandoned as a guard after a real Diamond scanned with dDiag=0.358.
  - HIGH-PRIORITY Circle rescue: when `maskOnlyLooksStronglyCircle` (mask-only Circle score ≥ 0.75, stronglyRound, circularity ≥ 0.85) and no candidate flags diamondish — trust it over any prior Square/Diamond pick. A classic rounded Diamond scores mask-only Circle ≈ 0.26 with circularity ≈ 0.66, safely below.
  - HIGH-PRIORITY Triangle rescue: a gold Triangle with a central set icon can produce a vertical+horizontal bar that makes the outer candidate pick Cross; when `triangleScore ≥ 0.55`, `asymmetry ≥ 0.90`, and aspect ~1, flip to Triangle. Real Diamonds (asymmetry ≤ 0.79) and Speed Crosses (asymmetry ≤ 0.69) don't trigger.
  - HIGH-PRIORITY Square → Cross majority vote: when the outer candidate narrowly raw-scores Square over Cross because the icon+halo traces a boxy outline, but **≥ 2 other candidates score Cross ≥ 0.60** from different vantage points, flip Square to Cross. Calibrated from a Speed Cross scan where inner=0.689 and unguided=0.658 both voted Cross while outer raw-scored Square:0.66 vs Cross:0.635.
  - HIGH-PRIORITY Explicit-Square rescue: when any candidate fires `squareLooksExplicit=true` with Square ≥ 0.75, force Square regardless of top-level pick. This flag is a dedicated multi-feature check (4 straight edges + centered fill + square aspect) and is the strongest Square signal we produce, so it outranks noisy Cross/Circle scores from other candidates.
  - HIGH-PRIORITY Circle → Square (physical-bounds rescue): a Circle cannot geometrically fill more than π/4 ≈ 0.785 of its bbox, and real Circle scans come in at extent 0.73–0.77. When `detection.name == "Circle"` but the winning mask-only silhouette has `extent ≥ 0.80`, it's physically a square/rectangle with softened corners (e.g. portrait-erase ellipses clipping the edges, natural anti-aliasing), not a Circle.
  - HIGH-PRIORITY Circle → Diamond (outer-contour tiebreaker): a rounded Diamond with a set icon can smooth mask-only into Circle:0.97 stronglyRound=true, and the observed `diamondCornerScore` can reach 0.92 — matching the Grievous-Circle numbers exactly. Discriminator is the `outer` contour candidate: a real Circle's outer trace scores Circle ≥ 0.6 with circularity ≥ 0.70, while a Diamond's outer trace sees the corners and scores Circle ≤ 0.35 with circularity ≤ 0.55. Rule: force Diamond when `dCorner ≥ 0.88`, aspect ~1, and outer-Circle ≤ 0.35 AND outer-circularity ≤ 0.55. Fires before the `winnerStronglyRound`-gated rescues so over-smoothed Diamonds aren't blocked.
- Binary-mask portrait erase: before morphology, `binaryMat` has two 0.30W × 0.34H ellipses punched at the top-left and bottom-left quadrant centers. This removes character-portrait bleed from the mask-only candidate's silhouette, which was causing the Grievous Circle to read as Diamond.
- Mask-only override: when the `mask-only` candidate scores ≥ 0.85 AND beats the best guided candidate by ≥ 0.20, it wins regardless of the usual guided preference. Landed alongside the portrait erase to rescue the Grievous Circle.
- Triangle rescue relaxed to use `contourMetrics.cornerCount ≤ 4` instead of the less reliable geometry vertex count.

### Overlay UX
- Floating bubble label is now **"Scan"** (was "MOD").
- While scanning, the bubble animates "Scanning." → "Scanning.." → "Scanning..." on a dedicated `HandlerThread` so heavy scan work on other threads cannot stall the ticks. Dots are padded with non-breaking spaces so the TextView width stays constant.
- When the floating button is started, the scanner now switches focus to Star Wars: Galaxy of Heroes automatically.
- SWGOH launch now works on Android 11+ — `AndroidManifest.xml` declares package visibility via `<queries>` (both `<intent>` MAIN/LAUNCHER and explicit `<package>` entries), and `launchSwgoh` tries several package-name variants plus a launcher scan fallback (`swgoh`, `starwarscapital`, `starwarsgalaxy`).
- React Native LogBox (yellow warning popup) is silenced in `App.js` with `LogBox.ignoreAllLogs()`.

### Scan-result overlay (two-card layout)
- After a successful scan the native service now shows **two** WindowManager overlay cards:
  - **Right card** (`recommendationCard`, gravity TOP|END, 40% screen width): slice verdict (decision + score) from `sliceEngine.evaluateSliceMod`.
  - **Left card** (`characterCard`, gravity TOP|START, 40% screen width): top recommended characters from the `chars.js` shell match.
- JS entry point: `overlayRecommendation.buildOverlayRecommendations(parsed)` returns `{ slice: {title, body}, characters: {title, body} }`.
- JS bridge: `overlayCapture.showDualOverlayRecommendation(sliceTitle, sliceBody, charTitle, charBody)` → native `showDualRecommendationOverlay`.
- Falls back to the legacy single-card path when the native module is missing.
- The original verbose readout (OCR text, shape/set top matches, scores) is preserved behind `DEBUG_READOUT_MODE` in `ModOverlayCaptureService.kt`. Flip to `true` when diagnosing shape/set misreads.
- `OUTER_SHAPE_TRAINING_MODE` (also in `ModOverlayCaptureService.kt`) remains the separate toggle for the "Teach Outer Shape" training flow.

### Native overlay: new constants / methods
- Service constants: `ACTION_SHOW_DUAL_RECOMMENDATION`, `EXTRA_CHARACTER_TITLE`, `EXTRA_CHARACTER_BODY`.
- Service methods: `showCharacterOverlay(title, body)`, `hideCharacterOverlay()` (mirror the existing recommendation methods, positioned TOP|START).
- Module method: `@ReactMethod fun showDualRecommendationOverlay(sliceTitle, sliceBody, charTitle, charBody, promise)`.
- `hideRecommendationOverlay` hides both cards.

### Loading screen
- Restored from `archive/legacy-ui/LoadingScreen.js` to `src/components/LoadingScreen.js`.
- `AppShell` in `App.js` renders it while `isWarmingUp` is true. A warm-up effect calls `overlayCapture.warmScanner()` and drops the splash after it resolves, with a minimum visible duration of 1200ms so it doesn't flash on fast restarts.
- `warmScanner()` now *actually* waits: native `ModOverlayCaptureService` exposes `awaitWarmUp(Runnable)` / `markWarmedUp()`. The `@ReactMethod warmScanner` Promise resolves only after classifier assets and the ML Kit OCR recognizer are both primed, so the first scan after the splash is fast.
- Subtitle cycles through generic sci-fi status phrases (e.g. "Starting thrusters", "Entering hyperdrive", "Avoiding comet field", "Plotting jump coordinates", "Warming reactor core") with a fade transition. Phrase list lives in `STATUS_PHRASES` at the top of `LoadingScreen.js`. Trademark-specific terms (Dagobah, kyber, holotables) were deliberately swapped out for generic sci-fi alternates.

### Scan-overlay dismissal
- Recommendation and character cards set `FLAG_WATCH_OUTSIDE_TOUCH`. Tapping anywhere outside the cards (i.e. anywhere in the game) dismisses both cards via `ACTION_OUTSIDE`. The floating Scan bubble stays attached so you can immediately scan the next mod.
- Both cards shrunk from 40% → 32% of screen width.

### Character-card formatting
- Left character card now lists users as a numbered ranking (`1. Rey`, `2. Padme`, …). Users whose build uses this shape's main set are tagged with ` • Set Match`. The raw `fitTier` string (e.g. `primaryBuildMainSet`) is no longer shown.
- `charLine` / `buildOverlayRecommendations` in `src/services/overlayRecommendation.js`.

### OCR parser regex fix
- `src/services/modCaptureParser.js` was throwing `Invalid RegExp: Parenthesized expression not closed` when an alias contained regex specials (e.g. `'defense('`). Aliases are now run through an `escapeRegExp` helper before being fed to `new RegExp`. Without this fix the JS event handler silently crashed and no overlay cards appeared after a scan.

### Event plumbing
- `ModOverlayCaptureModule.emitEvent(...)` no longer gates on `listenerCount` — it checks `hasActiveCatalystInstance()` and logs the emit. This avoids dropped events in edge cases where `NativeEventEmitter.addListener` hadn't bumped the counter yet.
- Diagnostic logs added in both native (`emitEvent: name=… listenerCount=… hasCatalyst=…`) and JS (`[overlay] event received`, `[overlay] calling showDualOverlayRecommendation`, `[overlay] showDualOverlayRecommendation done`, `[overlay] handler error: …`) are retained — useful the next time the overlay pipeline stops popping up.

### Naming / de-branding
- App Android package: `com.hungrr13.modsswgoh` → `com.hungrr13.modhelper`. Kotlin source moved to `android/app/src/main/java/com/hungrr13/modhelper/`. All `package com.hungrr13.modsswgoh…` declarations updated.
- `android/app/build.gradle` (`namespace`, `applicationId`), `multidex-config.pro`, `app.json` and `tools/pull_debug.ps1` all updated to the new package.
- Reference folders renamed: `references/swgohgg/` → `references/mod-source/`, `references/swgohgg-html/` → `references/mod-source-html/`.
- Individual HTML scrape filenames stripped of ` - Star Wars Galaxy of Heroes - SWGOH.GG` suffix (648 entries) — now `Best Mods for <Name>.htm` / `Best Mods for <Name>_files`.
- Tool scripts renamed: `tools/swgohgg-secondary-import.js` → `tools/mod-source-secondary-import.js`; `tools/open-swgohgg-best-mod-urls.js` → `tools/open-mod-source-best-mod-urls.js`; `tools/build-swgohgg-unit-urls.js` → `tools/build-mod-source-unit-urls.js`; `tools/build-swgohgg-best-mod-urls.js` → `tools/build-mod-source-best-mod-urls.js`. `package.json` scripts and `tools/refresh-secondary-focus.js` updated.
- Data files inside `references/mod-source/`: `swgohgg_*.txt` → `mod_source_*.txt`.
- **Kept intentionally:** the `<queries>` block in `AndroidManifest.xml` and the `launchSwgoh` helper in `ModOverlayCaptureModule.kt` still target EA's real game package IDs (`com.ea.game.starwarscapital_row`, etc.) because those are needed to switch focus to the game.

## Follow-ups / TODO

- **Scanner dismiss on app resume:** after a scan, the overlay stays live when the user swaps back to the app. The Slice tab can't be reviewed without manually killing the overlay first. Should auto-close on app foreground so the Slice breakdown is immediately visible.
- **Stat-comparative slot badges:** the slot-aware badges (`Empty Circle` / `Upgrade Circle` / `Circle maxed`) are structural only — `Circle maxed` means `6-dot/15/A`, not "equipped mod has better stats than the scanned one." Next: feed both mods into the slice engine and surface a real verdict (e.g. `Upgrade Circle — +8 speed`). Requires passing the equipped mod's secondaries from `rosterService` into the comparison, not just level/tier/pips.
- **Circle back:** the `Best Mods for <Name>_files/` subfolders under `references/mod-source-html/` still contain SWGOH.GG's minified webpack bundles (`apps-*.js`, etc.). The filenames themselves are generic, but their *contents* reference `swgohgg`. The parsers (`extract-ability-text.js`, `import-secondary-focus-from-html.js`, `merge-tags-from-html.js`) only read the top-level `.htm` files and never touch these `_files/` subfolders. Options: delete the `_files/` subfolders wholesale (safe — repo will shrink meaningfully), or leave them. Decide next session.

### Git / build notes
- `.gitignore` extended to cover `android/build/`, `android/app/build/`, `android/.gradle/`, `android/.kotlin/`, `android/local.properties`, `android/captures/`, `android/.idea/`, `android/app/release/`, `*.iml`, `*.hprof`, and `.expo/`.
- Native Kotlin + `AndroidManifest.xml` changes require `./gradlew installDebug` (or equivalent). JS-only changes (`App.js`, `src/**/*.js`) reload via Metro.

## Archive

- `archive/legacy-scoring/shape/`: old shape-classifier experiments and debug output that are no longer on the active path.
- `archive/legacy-scoring/set/`: old set-scoring scratch files.
- `archive/legacy-scoring/slice/`: retired slice-scoring prototypes.
- `archive/legacy-character-data/`: old raw character exports kept only for reference.
- `archive/legacy-ui/`: retired UI files.
- `archive/legacy-android/`: one-off Android extraction leftovers.

## Where to edit for common tasks

- Character recommendations: `src/data/chars.js`
- Shape/set names or slice thresholds: `src/constants/modData.js`
- Slice scoring behavior: `src/services/sliceEngine.js` and `src/services/sliceRules.js`
- Scanner OCR parsing: `src/services/modCaptureParser.js`
- Scanner template assets: `assets/mod-templates/` plus `src/data/modTemplateManifest.js`
- Secondary-focus refresh pipeline: `tools/refresh-secondary-focus.js` plus files under `references/mod-source/`
- Native overlay work: `plugins/withOverlayCapture.js`, `android/`, and `references/native-overlay-template/`

## Generated vs hand-edited

- Generated: `src/data/secFocus.js`
- Generated: `tools/set-classifier/training-data/`
- Generated/synced: `assets/mod-templates/learned-sets/`
- Hand-edited source of truth: `src/data/chars.js`
- Non-runtime storage: everything under `archive/`
