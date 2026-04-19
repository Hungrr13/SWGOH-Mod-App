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
- `tools/debug_out/`: pulled overlay debug output from device sessions.
- `tools/roster-worker/`: Cloudflare Worker that proxies swgoh.gg's player API (bypasses Cloudflare's interactive bot challenge). Deploy with `wrangler deploy` from inside the folder.
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
  - Cross → Square when the mask-only candidate shows a near-full square fill (hollow-frame false positive).
  - Circle → Arrow when any candidate flags `arrowLooksCompact` with Arrow ≥ 0.50.
  - Circle → Diamond when any candidate flags `circleLooksDiamondish` with Diamond ≥ 0.35.
  - Cross → Diamond when `anyCandidateLooksDiamond` and `diamondCornerScore ≥ 0.80` (rounded diamond misread as plus).
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
