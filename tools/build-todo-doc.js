const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType, ShadingType,
} = require('docx');

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function todoRow(status, area, description, notes) {
  const cellProps = (fill) => ({
    borders: BORDERS,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
  });
  const statusFill = {
    OPEN: 'FFF4CE',
    'IN PROGRESS': 'D9E7FF',
    DONE: 'D5F0D5',
    BLOCKED: 'FADBD8',
    PARKED: 'E6E0EC',
  }[status] || undefined;
  return new TableRow({
    children: [
      new TableCell({
        ...cellProps(statusFill),
        width: { size: 1400, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({ text: status, bold: true })] })],
      }),
      new TableCell({
        ...cellProps(),
        width: { size: 2000, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun(area)] })],
      }),
      new TableCell({
        ...cellProps(),
        width: { size: 3500, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun(description)] })],
      }),
      new TableCell({
        ...cellProps(),
        width: { size: 2460, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun(notes || '')] })],
      }),
    ],
  });
}

function headerRow() {
  const h = (text, width) => new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: '2E4A6A', type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: 'FFFFFF' })] })],
  });
  return new TableRow({
    tableHeader: true,
    children: [
      h('Status', 1400),
      h('Area', 2000),
      h('Description', 3500),
      h('Notes', 2460),
    ],
  });
}

const rows = [
  headerRow(),
  todoRow(
    'DONE',
    'Options menu',
    'Restore Premium option + test button that was in the options menu',
    'Lost in recent rebrand / scaffolding work. Find in git history and reinstate.',
  ),
  todoRow(
    'DONE',
    'Shape classifier',
    'Grievous-Circle now classifies as Circle. Gated the refineShapeSelection Circle\u2192Diamond rescue rules on !winnerStronglyRound so shapeDiamondCornerScore can\u2019t override a mask-only winner that scored Circle:0.97 with stronglyRound=true.',
    'Landed 2026-04-20 in commit 4eb5ff2 alongside earlier bd8c535 (portrait-erase binary mask + mask-only \u2265 0.85 override). Verified on-device. Archive on next sweep.',
  ),
  todoRow(
    'DONE',
    'Shape classifier',
    'Cross/Triangle/Circle calibration bundle: ported suspicious-nobel fixes + added Square\u2192Cross majority-vote rescue (when \u22652 candidates score Cross\u22650.60, flip Square to Cross). Cross/Square\u2192Diamond now requires extent\u22640.73. Cross\u2192Square gated on !anyCandidateStronglyCross. Added high-priority Circle rescue (maskOnlyLooksStronglyCircle) and Triangle rescue (asymmetry\u22650.90).',
    'Landed 2026-04-20 in commit a704edf + follow-up majority-vote rescue. Verified on-device: Cross now classifies as Cross. Archive on next sweep.',
  ),
  todoRow(
    'PARKED',
    'Shape classifier',
    'Inner cavity mask shows notch at top on Circle \u2014 investigate if portrait-removal or pip-cleanup clipping the rim',
    'Parked 2026-04-23 pending fresh sample. See shape-classifier-candidate-inner-mask.png from the Apr 20 Circle scan.',
  ),
  todoRow(
    'DONE',
    'Tooling / debug',
    'pull_debug.ps1 now downscales PNGs to a 400px longest edge before writing to tools/debug_out/',
    'Text debug was already pulled first. Added a System.Drawing bicubic downscale step in Pull-SafePng that runs after the magic-byte guard and before the final Move-Item. Typical classifier crops drop from ~100KB to ~20\u201340KB, which keeps Claude\u2019s Read tool happy. -Full switch bypasses the downscale when native-resolution is actually needed. Archive on next sweep.',
  ),
  todoRow(
    'DONE',
    'UI / shape icons',
    'Shape icons on Slice/Finder pickers now use assets/shapes PNGs and were bumped 22 \u2192 28',
    'ModShapeIcon.js was already wired to assets/shapes/*.png. Bumped size on SliceScreen.js:278 and FinderScreen.js:597. Archive on next sweep.',
  ),
  todoRow(
    'DONE',
    'Ally code / privacy',
    'AllyCodePanel placeholder changed from the owner\u2019s real ally code to 123-456-789',
    'Change captured in the staged diff for AllyCodePanel.js (489-758-819 \u2192 123-456-789). Archive on next sweep.',
  ),
  todoRow(
    'DONE',
    'Repo hygiene',
    'references/mod-source-html/*_files/ (SWGOH.GG webpack bundles) removed from working tree; not tracked in git on either branch',
    'User confirmed external backup kept in case parsers ever need them. Verified on 2026-04-25: references/ contains only character-data, mod-source, and native-overlay-template; no _files/ subdirs anywhere; git ls-files references/mod-source-html returns 0 entries on both main and friendly-stonebraker. Archive on next sweep.',
  ),
  todoRow(
    'DONE',
    'Repo hygiene / cleanup',
    'Codebase cleanup pass: deleted archive/, removed src/data/chars.js.bak, deduplicated DECODED_CHARS, consolidated verdict helpers, documented tools/',
    'Landed 2026-04-24. archive/ (53 files) deleted with backup pushed to backup/pre-cleanup-2026-04-24 and chars.js.bak copied to C:/Users/Chad/my-app/backups/. New src/data/charDecoding.js exports DECODED_CHARS + ENGINE_SLICE_REF used by both overlayRecommendation and SliceScreen. New getDecisionDescription() export on sliceEngine.js replaces two slightly drifted decisionDefinition() helpers. New tools/README.md catalogs all 22 dev scripts.',
  ),
  todoRow(
    'DONE',
    'Theme / shape icons',
    'Light-mode shape icons: cross/triangle/diamond/etc. now have light-mode variants so they don\u2019t render as black blobs on the white background',
    'Each shape PNG has a metallic colored frame + dark inner cavity + dark outer drop-shadow. New tools/gen-shape-lightmode.py rewrites pixels with max(R,G,B) < 55 to white while preserving alpha (soft black aura becomes soft white glow). Generated assets/shapes/{name}-light.png for all 6 shapes. ModShapeIcon.js now reads isDark from useThemeControls() and swaps source maps accordingly. Verified visually before commit. Push LUM_MAX from 55 to 65 in the script if any dark specks survive on-device.',
  ),
  todoRow(
    'DONE',
    'Slice screen / layout',
    'Shrink the Best Character Fit card and place a "Your Characters" card next to it (premium-only)',
    'Two-card row. "Your Characters" populated from ally-code roster; gated behind premium.',
  ),
  todoRow(
    'DONE',
    'Slice screen / suggestions',
    'Capped Best Characters + Your Roster to top 25 by fit score',
    'SliceScreen slices setFilteredMatches and ownedMatches to MAX_VISIBLE_MATCHES=25. matchedCharacters is already sorted desc by matchScore so the cap surfaces the strongest fits. Headers show \u201CTop 25 of N\u201D when truncated, plain \u201CN\u201D otherwise. Archive on next sweep.',
  ),
  todoRow(
    'DONE',
    'Slice screen / scoring',
    'Investigate suggestion scoring \u2014 likely only comparing set + primary, ignoring secondaries',
    'Audit scoring path. Secondaries should weight into fit score; otherwise suggestions are noisy.',
  ),
  todoRow(
    'OPEN',
    'Scan performance',
    'Increase overall scan speed on the overlay capture flow',
    'Focused/stats/shape/icon/set crops + two classifiers (set + shape) run sequentially per mod. Profile the hot path and see what can be parallelized or cached between mods on the same screen.',
  ),
  todoRow(
    'DONE',
    'Scan UX',
    'First scan-button press is swallowed when the screen was just swapped \u2014 user has to click twice',
    'FIXED: warmScanner (ACTION_WARM_ONLY) race was tearing the bubble down after MediaProjection grant. Made warm-only never remove an attached bubble. Also cancel the 900ms launchSwgoh retry on AppState=active so swapping back to ModForge doesn\u2019t bounce to SWGOH. Scan-button touch-slop threshold added in ModOverlayCaptureService.',
  ),
  todoRow(
    'DONE',
    'Roster / premium',
    'Pull user mods via ally code and flag empty slots + upgrade opportunities (premium)',
    'DONE: rosterService fetches ?mods=1 and returns per-character missingSlots + upgradeable count (level<15 OR pips<6 OR tier<5). SliceScreen shows \u201cX to upgrade\u201d / missing-slot badges. Slot-level upgrade-vs-scan delta is tracked in the separate Slice-engine slot-badge row.',
  ),
  todoRow(
    'PARKED',
    'Shape classifier',
    'Second Circle mod reads as Cross: no candidate view sees a round outline (outer circularity 0.404, mask-only circularity 0.333, extent 0.933, stronglyRound=false)',
    'Parked 2026-04-23 pending broader Circle sample set. Unlike Grievous, this Circle\u2019s mask-only candidate doesn\u2019t see the round outline at all. Hypotheses: (a) capture framing cut off part of the mod, (b) different Circle visual tier/set produces a different silhouette profile. Collect multiple Circle scans (different tiers/sets/primaries) to determine whether new rescue rule is needed or whether it\u2019s a capture artifact.',
  ),
  todoRow(
    'DONE',
    'Branch hygiene',
    'Consolidate stale Claude branches: claude/inspiring-khorana-78c3aa, claude/strange-williams-65919b, claude/suspicious-nobel-1ad793, claude/vibrant-morse-0c5795, wip/shape-classifier',
    'Suspicious-nobel held the Cross/Triangle calibration work which we\u2019ve now ported into friendly-stonebraker. Once committed to main, delete the local+remote suspicious-nobel branch and audit the other claude/* branches for any uncommitted fixes worth rescuing.',
  ),
  todoRow(
    'OPEN',
    'Launch / privacy',
    'Host privacy_policy at a public URL (GitHub Pages) and link it in the Play Console listing + in-app Settings',
    'File exists in repo at my-app/privacy_policy but isn\u2019t live anywhere. Required for Play submission because the app uses SYSTEM_ALERT_WINDOW + screen capture. Policy must cover: screen-content capture, what\u2019s processed (mod shape/stat data), what\u2019s stored (local only), what\u2019s transmitted (none), retention/deletion.',
  ),
  todoRow(
    'OPEN',
    'Launch / Play Console',
    'Fill Sensitive Permissions declaration for SYSTEM_ALERT_WINDOW',
    'Core functionality: overlay button over SWGOH to scan the user\u2019s own mod inventory. User benefit: catalog mods without manual typing. Why no alternative: user must interact with game while app is visible \u2014 impossible without overlay. Play Console blocks the upload until this form is completed.',
  ),
  todoRow(
    'DONE',
    'Launch / permissions UX',
    'Rationale alerts now fire before both SYSTEM_ALERT_WINDOW and MediaProjection prompts, with Play-reviewer-friendly copy',
    'OverlayCaptureScreen.runStartFlow() wraps both permission grants in confirmRationale() with bullet-pointed explanations. Overlay dialog calls out: user-initiated only, no content reading from other apps, no input simulation. Capture dialog calls out: user-initiated only, on-device parsing, image discarded immediately, no cloud/ad upload. Archive on next sweep.',
  ),
  todoRow(
    'OPEN',
    'Launch / Play Console',
    'Complete Data Safety form: be honest about screen capture + local mod storage',
    'Data collected = "App activity" (scanned mod data stored locally); shared = None; security = user can delete data. Google audits and pulls apps that misrepresent. Description must explicitly acknowledge screen capture to match this form.',
  ),
  todoRow(
    'DONE',
    'Launch / manifest',
    'FOREGROUND_SERVICE + FOREGROUND_SERVICE_MEDIA_PROJECTION permissions declared; capture service flagged with android:foregroundServiceType="specialUse|mediaProjection"',
    'AndroidManifest.xml already has the pair plus FOREGROUND_SERVICE_SPECIAL_USE; ModOverlayCaptureService declared with foregroundServiceType="specialUse|mediaProjection" and a PROPERTY_SPECIAL_USE_FGS_SUBTYPE of "overlay_capture_mod_scanner". Still pending on the Play side: the separate App-content \u2192 Foreground services declaration form. Archive on next sweep.',
  ),
  todoRow(
    'OPEN',
    'Launch / listing copy',
    'Play Store description must explicitly include: "Companion app for Star Wars: Galaxy of Heroes", "Not affiliated with or endorsed by Electronic Arts, Capital Games, or Lucasfilm", "Uses overlay permission to display a scan button over the game", "No automation \u2014 passive screen reading only"',
    'Reviewers look for the bolded language. Missing the "no automation" disclaimer is a common rejection trigger.',
  ),
  todoRow(
    'OPEN',
    'Launch / demo video',
    'Record ~60s screen recording for Play Console: app open \u2192 permission prompts \u2192 user grants \u2192 overlay appears over SWGOH \u2192 scan works \u2192 overlay dismissed',
    'Frequently requested for overlay + screen-capture apps. Have it ready before first submission rather than reactively after a rejection.',
  ),
  todoRow(
    'OPEN',
    'Launch / rollout',
    'Submit to Internal Testing track first (not Production) and iterate through Closed \u2192 Open \u2192 Production',
    'Internal Testing has lighter review. Most overlay apps need 2\u20133 submissions before passing. If rejected, fix per the email and resubmit \u2014 do not appeal.',
  ),
  todoRow(
    'OPEN',
    'Monetization',
    'Swap AdMob test IDs for real production unit IDs before submitting to Play',
    'Carried over from prior launch-prep notes. Real ad unit IDs must be wired in before Production rollout; leaving test IDs in a shipped build returns nothing but causes listing review issues if Data Safety mentions ads.',
  ),
  todoRow(
    'DONE',
    'Slice engine / tier progression',
    'Walk tier ladder (E \u2192 D \u2192 C \u2192 B \u2192 A \u2192 6E) using actual rolled secondaries as signal. 6-state verdict: Usable / Slice to next tier / Cap at 5A / Filler / Sellable / Not sliceable.',
    'buildLadderPlan() in sliceEngine.js emits per-step verdicts. Pre-5A mods with catalyst potential (Speed secondary with rolls<5, or priority stat with SLICE_GAIN\u22650.3) now return SLICE_NEXT (cyan) \u2014 \u201ctake one step, re-evaluate after the roll\u201d \u2014 instead of projecting an end-state from current rolls. Definite-Usable paths (Speed arrow, hard Speed, strongUpside, speedBacked) still return USABLE. Cap at 5A is scoped to mods already at 5A. SliceScreen renders SLICE_NEXT as \u201cNext step: \u2192 {nextTier} \u2014 re-evaluate after roll\u201d. Archive on next sweep.',
  ),
  todoRow(
    'DONE',
    'Slice engine / tier OCR on scans',
    'Scanner auto-populates the slice-tab tier pill from the mod card (E/D/C/B/A letter near the level banner)',
    'extractModTier() in modCaptureParser.js reads Tier/LVL/Level patterns from the OCR output and returns \u20185E\u2019\u2026\u20185A\u2019. Threaded through parsed.modTier \u2192 App.js slicePrefill.tier \u2192 SliceScreen. 6E (6-dot) isn\u2019t auto-detected yet (needs pip-count detection) \u2014 user taps 6E manually. When OCR misses the letter, SliceScreen clears tier to \u2018\u2019 on prefill so the ladder plan falls through to \u201cNot sliceable \u2014 No tier selected\u201d rather than silently showing wrong 5A verdicts.',
  ),
  todoRow(
    'DONE',
    'Scanner / parser fixes',
    'Parser: four cascading fixes for a 5C Cross scan that was showing wrong tier + Health% phantom secondary',
    'Fix 1: extractModTier() catches tier letter glued onto first secondary line (\u201cC (2) 4.12% Protection\u201d) via ^([A-E])\\s+\\(\\d+\\) pattern. Fix 2: extractSecondaries() dedup prefers the match that carries an explicit rolls field so valueFirstPattern doesn\u2019t win over rollFirstPattern. Fix 3: removed overly broad \\bprim\\w*\\b / \\bseco\\w*\\b noise patterns that were nuking the literal \u201cPRIMARY STAT\u201d / \u201cSECONDARY STATS\u201d headers and breaking findLineIndex-based section segmentation. Fix 4: primary-dedup now runs AFTER flat-to-% promotion so a flat \u201cHealth\u201d on a Health%-primary mod can\u2019t sneak into secondaries and push a real secondary past the 4-item cap. Verified end-to-end against on-device ocr-debug-last.txt.',
  ),
  todoRow(
    'DONE',
    'Slice screen / verdict UI',
    'Collapsed the duplicate Decision card into the ladder-plan card so users see a single verdict',
    'Previously SliceScreen rendered the ladder plan (\u201cSlice to 5B\u201d, cyan) AND a separate score-based Decision (\u201cFiller \u2014 not worth slicing\u201d) at the same time, which gave contradictory recommendations. Now renders one card driven by result.ladderPlan with Score: X/100 + reasonLines[0] folded in as footer lines. Old Decision card retained as fallback branch when ladderPlan is absent.',
  ),
  todoRow(
    'DONE',
    'GAC screen / no-roster toggle filter',
    'Attack/Defense toggle now shows the right squads when no roster is linked',
    'Previously GacScreen.squadsToShow returned payload.squads.slice(0,30) when hasRoster was false \u2014 worker concatenates defense first, then offense, so the unfiltered top 30 was always all defenders, and the Attack toggle showed Jabba/LV/Rey leads with empty win% (offenseWinRate is null on defense rows). No-roster branch now filters by sq.role === role and sorts by the matching win-rate metric. Wrapped in {squad, ownedCount: null, coverage: null} so the render code\u2019s existing item.squad || item fallback keeps working. After install: Attack shows Sith Eternal 96% / Malgus trios 93% / etc. matching swgoh.gg.',
  ),
  todoRow(
    'DONE',
    'GAC worker / attack + defense perspectives',
    'Scrape both perspectives of /gac/squads/ so Offense shows real top attackers (not inverse of defense holds)',
    'swgoh.gg\u2019s /gac/squads/ page takes a ?perspective=attack&sort=percent query param that returns a completely different list (top attacking squads sorted by Win %) than the default defense view (top defenders sorted by Hold %). Top attacker (SITHPALPATINE solo, 96%) is not derivable from top defender (JABBATHEHUTT+BOUSHH+KRRSANTAN 27% hold) \u2014 they\u2019re independent datasets. scrapeGacSquads now fetches both perspectives in parallel, parses each through parseGacSquadsHtml(html, role), and emits squads tagged with the appropriate role and single populated win-rate field. Attack view legitimately includes 1-member solo squads so bracket detection runs off the defense view only. Deployed. Verified: /?gac=3v3 returns 87 squads (42 def + 45 off); /?gac=5v5 returns 70 (37 def + 33 off).',
  ),
  todoRow(
    'DONE',
    'Slice tab / incomplete secondary transfer',
    'Secondaries now transfer fully from scan \u2192 Slice tab',
    'User-verified resolved on 2026-04-23. Likely fell out of the parser cascading fixes (tier-letter-glued-to-first-secondary + rollFirstPattern dedup preference + primary-dedup-after-flat-promotion) that landed earlier this session. Archive on next sweep.',
  ),
  todoRow(
    'DONE',
    'GAC tab / roster vs meta view toggle',
    'Added a My roster / All meta toggle so users can see the full meta regardless of coverage',
    'GacScreen now has a third toggle row (shown only when a roster is linked) that switches between ranked.offense/ranked.defense (Mine, \u226560% coverage gate) and a role-filtered win-rate sort of payload.squads (All, no gate). All mode still computes per-squad coverage/ownedCount so red-chip rendering for missing members keeps working. No-roster case already behaves like All \u2014 collapsed into the same code path via const showAll = !hasRoster || view === "all". Subtitle + summary banner adjusted to reflect the active view.',
  ),
  todoRow(
    'OPEN',
    'Scanner / tier OCR incomplete coverage',
    'Scans aren\u2019t reliably grabbing all tier levels (D, C, B, A, etc.) \u2014 some mods come through with tier blank or wrong',
    'extractModTier() in modCaptureParser.js has patterns for Tier C / LVL 15 \u00B7 C / Level 15 A / the ^([A-E])\\s+\\(\\d+\\) stuck-tier fallback, but on-device captures still miss the letter on some cards. Collect fresh ocr-debug-last.txt dumps for each of 5E/5D/5C/5B/5A and audit which patterns are firing (or failing) per tier. Likely need: more tolerant spacing/punctuation between \u201CLVL 15\u201D and the letter, separate pattern for each tier\u2019s actual on-card layout, and possibly a bounded region scan instead of full-text regex. Related: native tier-color detection would eliminate this dependency entirely.',
  ),
  todoRow(
    'DONE',
    'Slice engine / missed-speed recovery',
    'Decided against a \u201Ccatalyst-streak\u201D nudge: slicing a low-Speed mod on streak logic would waste mats.',
    'A mod with Speed missed 3\u00D7 is probably sitting at 3\u20135 Speed, and one more 25% hit still doesn\u2019t clear the keeper threshold (~10+). The only case where an extra slice helps is when current Speed is already \u226510 and one more roll locks it in \u2014 and the ladder already covers that via SLICE_NEXT on high-Speed partials. No new heuristic needed; archive.',
  ),
  todoRow(
    'OPEN',
    'Scanner / native tier-color detection',
    'Detect mod tier from frame color in the native classifier (E=gray, D=green, C=blue, B=purple, A=gold) + detect 6-dot vs 5-dot from pips',
    'Complement to the OCR-based tier extractor. Native pixel sampling on the mod frame would be more reliable than OCR and would unlock 6E detection. Add to ModIconClassifier.kt, wire through ModOverlayCaptureService.kt \u2192 JS bridge \u2192 parsed.modTier fallback.',
  ),
  todoRow(
    'DONE',
    'Slice engine / community tuning',
    'Audit weights + ladder thresholds against community guidance (swgoh.gg top-1000 Kyber meta, Grandivory, Crouching-Rancor)',
    'Defense% weight 5.0 \u2192 4.0 (was biasing tanks ~25% above consensus). strongUpside SLICE_GAIN cutoff 0.5 \u2192 0.3 so Protection% (0.33) counts as a 6-dot catalyst on Prot%-primary mods with strong rolls. hasDecentFit finalScore floor 40 \u2192 50 to tighten the Filler / Cap-at-5A gate vs Grandivory\u2019s HOLD=60. Flat-stat sell, Speed-arrow rule, and Crouching-Rancor rollEfficiency formula verified against sources. See sliceRules.js weights + buildLadderPlan() in sliceEngine.js. Archive on next sweep.',
  ),
  todoRow(
    'DONE',
    'GAC / premium',
    '3v3 + 5v5 Grand Arena team recommender backed by swgoh.gg meta HTML scrape',
    'Landed via Cloudflare Worker route + client service + state module + GacScreen UI (offense/defense split, roster filter). Installed on R5CX10W4LJY. Archive on next sweep.',
  ),
  todoRow(
    'DONE',
    'Slice screen / layout',
    'Removed Best Fit split card; premium Slice screen shows a single full-width Your Roster card',
    'Supersedes the earlier \u201cshrink Best Character Fit + Your Characters card\u201d row \u2014 user asked to drop Best Fit entirely. See SliceScreen.js.',
  ),
  todoRow(
    'DONE',
    'Slice engine / scoring',
    'Audit + fix character suggestion scoring: secondaries now weighted, primary bonus adds priority-band points, set/shell tiering preserved',
    'scoreMatchAgainstEnteredSecondaries returns alignedPriorityIndices + primaryPriorityIndex; final score = rankFitTier*100 + avgSecondaryScore + primaryBonus.',
  ),
  todoRow(
    'DONE',
    'Slice UI / chips',
    'Match rows show priority alignment chips (\u2713 scanned secondary hit, \u2605 primary hit, muted otherwise)',
    'Primary \u2605 now takes visual precedence over \u2713 when both hit the same slot so users see the primary match even when a secondary aligns at #1.',
  ),
  todoRow(
    'DONE',
    'Slice engine / alt builds',
    'Alt-build priorities derived at runtime from SEC_FOCUS research (positions #1,#2 from main + #5,#6 from ranked usage, Speed locked to main position)',
    'Falls back to hand-curated buSecs when SEC_FOCUS missing. Added soft no-Speed penalty (12pts) when 3+ secondaries revealed without Speed.',
  ),
  todoRow(
    'DONE',
    'Slice engine / flat vs %',
    'Flat and % priority stats now match each other asymmetrically: scanned % satisfies a flat priority fully; scanned flat gives 25% credit vs a % priority',
    'normalizePriorityName promotes Health/Offense/Protection/Defense \u2192 their % form for comparison. Primary bonus lookup normalized too.',
  ),
  todoRow(
    'DONE',
    'Overlay / premium gating',
    'Free-user overlay now gates the characters panel behind ROSTER unlock; top character list expanded from 6 to 20',
    'buildOverlayRecommendations() slices to 20; App.js substitutes a \u201cPremium\u201d placeholder card when ROSTER is locked.',
  ),
  todoRow(
    'DONE',
    'Scan UX',
    'Scanner / scan-button overlay should dismiss when user swaps back to the app so Slice tab is reviewable without manually killing the overlay',
    'OBSOLETE: after the first-run bubble fix the overlay persists across app swaps, so auto-dismissing would force a \u201cReady to scan\u201d tap every time. Keeping the bubble up is the desired UX.',
  ),
  todoRow(
    'DONE',
    'Slice engine / slot badge',
    'Slot-aware mod badge scores scanned mod vs currently-equipped mod (Upgrade / Sidegrade / Downgrade) using the slice engine, not just structural emptiness',
    'compareScannedVsEquipped() in sliceEngine.js:1130 scores both mods against the match priorities, then returns verdict (rawDelta>4 Upgrade, <-6 Downgrade, else Sidegrade), scoreDelta, and per-priority stat deltas for the badge label. Archive on next sweep.',
  ),
  todoRow(
    'DONE',
    'Permissions UX',
    'Screen Capture row now reflects MediaProjection grant after a successful scan',
    'User-verified on the 2026-04-22 install. Resolved without a targeted code change \u2014 likely fell out of the capture/recommendation plumbing refresh in the same build. Archive on next sweep.',
  ),
  todoRow(
    'OPEN',
    'Scanner / coverage verification',
    'Verify classifier on a full matrix: every shape \u00d7 every set \u00d7 every primary color/tier \u00d7 every mod level/dot-tier',
    'Following the variant-consensus tiebreak fix (mask-only wins when outer rim is rounded on a Diamond), we need an end-to-end sweep. Capture at least one scan per cell of the matrix: 6 shapes (Square/Arrow/Diamond/Triangle/Circle/Cross) \u00d7 all sets (Health/Defense/Crit Chance/Crit Dmg/Offense/Potency/Tenacity/Speed) \u00d7 tier colors (E gray/D green/C blue/B purple/A gold) \u00d7 dot levels (5 vs 6) \u00d7 primaries. Log shape/set classification result + OCR primary+secondaries per cell, then fix misses. Batch the captures into tools/debug_out/ with a naming convention so we can regression-test later.',
  ),
  todoRow(
    'DONE',
    'Slice engine / 6-dot gate',
    'Tightened the 5A\u21926E gate: dropped the 2-roll \u201cspeedBacked\u201d path, added a Speed value floor of 14 to the 3-roll path, and unified overlay + slice-tab verdicts',
    'Previously a mod like Speed 10 \u00d7 2 rolls with mid-55% avgPriorityQuality would fire USABLE \u2192 6E; now it falls to SLICE_NEXT \u2192 5B (step-by-step). Added `speedVal >= 14` to `speedHitHard` so an unlucky 3-roll Speed that landed 9\u201313 doesn\u2019t slip through. overlayRecommendation.js now evaluates against the full DECODED_CHARS pool (matches SliceScreen) so roster-filter differences don\u2019t produce conflicting verdicts between the overlay and the Slice tab. Aligns with community guidance (\u201cSpeed \u226515 before 6-dot\u201d). GuideModal Slicer page + READMEBEFOREEDITING.md updated.',
  ),
  todoRow(
    'DONE',
    'Theme / persistence',
    'Light/dark toggle now persists across app kill+reopen; loading screen waits on AsyncStorage hydration so returning users don\u2019t see a one-frame flash of the wrong theme',
    'Refactored src/theme/appTheme.js to expose hydrateTheme() with a module-level cachedIsDark cache. App.js warm-up now awaits hydrateTheme() before dropping LoadingScreen. AppThemeProvider uses a lazy useState(() => cachedIsDark) initializer plus a useEffect that re-syncs to the LIVE cachedIsDark on remount instead of the stale promise-resolved value \u2014 fixes a regression where Android Activity recreation re-fired runApplication and clobbered toggles made earlier in the session. toggleTheme writes synchronously to cachedIsDark, then persists to AsyncStorage. Cold-start default remains dark for fresh installs (useState(true) before hydration completes). Verified on R5CX10W4LJY: toggle to light \u2192 swipe-from-recents to kill \u2192 reopen \u2192 still light. Commits 5e90623, 248b270, 44d5451.',
  ),
  todoRow(
    'DONE',
    'Premium / cold-start reconcile',
    'Re-derive Premium from Google Play on every cold start instead of trusting the AsyncStorage cache (anti-tamper)',
    'Added iap.reconcileWithPlay({ timeoutMs: 3000 }) to App.js warm-up sequence. Calls getAvailablePurchases through react-native-iap, filters to PREMIUM_SKU, and overwrites premiumState to match Google\u2019s source of truth. Behaviour: Play says owned \u2192 setPremium(true); Play says not owned \u2192 setPremium(false), revoking any cached unlock from a flipped AsyncStorage flag / sideloaded patched APK / refunded purchase; IAP unavailable / Play offline / query times out \u2192 leaves cache alone (don\u2019t punish offline users on flaky connections). Helper findVerifiedPremium() filters to verified-signature purchases when a Play license key is configured, falls open to first PREMIUM_SKU match when not. restorePurchases() also routes through findVerifiedPremium so manual restore reuses the same verification path.',
  ),
  todoRow(
    'DONE',
    'Premium / signature verification',
    'Native Kotlin module verifies Google Play purchase signatures (RSA-SHA1) before unlocking Premium \u2014 rejects forged purchase events injected by Frida/Xposed hooks',
    'New IapVerifierModule.kt + IapVerifierPackage.kt registered in MainApplication.kt. Module name ModForgeIapVerifier. Uses Signature.getInstance("SHA1withRSA") + X509EncodedKeySpec on the Play license public key, verifies against raw INAPP_PURCHASE_DATA UTF-8 bytes. Returns false on malformed Base64 (fail-closed). JS wrapper in src/services/iapVerifier.js handles dataAndroid/originalJson + signatureAndroid/signature field aliases. iap.purchaseUpdatedListener now calls verifyPurchase before setPremium(true); invalid signatures drop the event without finishTransaction so Play retries. NOTE: src/config/playLicense.js ships with PLAY_LICENSE_PUBLIC_KEY=\u2019\u2019 (empty) which fails open for dev/sideload builds \u2014 the empty key slot is documented in-file and must be populated from Play Console before the Play release build (see separate OPEN row).',
  ),
  todoRow(
    'DONE',
    'Premium / R8 + ProGuard',
    'Enabled R8 minification + resource shrinking on release builds; native modules and IAP signature classes pinned via -keep rules',
    'gradle.properties: android.enableMinifyInReleaseBuilds=true + android.enableShrinkResourcesInReleaseBuilds=true. proguard-rules.pro: -keep on com.hungrr13.modhelper.overlay.**, com.hungrr13.modhelper.iap.**, the @ReactMethod surface on ReactContextBaseJavaModule subclasses, plus java.security.** and javax.crypto.** so R8 doesn\u2019t strip the verifier\u2019s reflection targets. Hermes JS bytecode (already enabled) covers the JS bundle. Slows reverse-engineering of the Kotlin overlay/IAP-verifier modules and strips debug symbols.',
  ),
  todoRow(
    'DONE',
    'Premium / react-native-iap dependency',
    'react-native-iap@12.16.4 installed and verified on R5CX10W4LJY \u2014 cold-start reconcile against Play is now live',
    'Installed react-native-iap@^12.16.4 (the v12 line that matches the requestPurchase({sku, skus:[SKU]}) / getProducts shape iap.js was already written for). Pinned the play flavor in android/app/build.gradle via missingDimensionStrategy \u2018store\u2019, \u2018play\u2019 (the lib ships dual play/amazon flavors). Added com.android.vending.BILLING permission to AndroidManifest.xml \u2014 the lib does NOT auto-add it via manifest merge. Patched the RN 0.81 currentActivity break: ReactContextBaseJavaModule was converted to Kotlin in RN 0.81, and the Java-getter-as-Kotlin-property syntax stopped resolving \u2014 RNIapModule.kt and react-native-google-mobile-ads\u2019 ReactNativeGoogleMobileAdsModule.kt + FullScreenAdModule.kt all needed currentActivity \u2192 getCurrentActivity() (~7 sites total). Patches live in patches/ via patch-package@^8.0.1 with a postinstall hook so they survive npm install. Verified on R5CX10W4LJY 2026-04-25: cold-start logcat shows three RNIapModule responseCode: 0 lines within 3s of bundle load \u2014 initConnection, getProducts, getAvailablePurchases (= reconcileWithPlay) all OK. No FATAL EXCEPTION, no stripped-class errors, no unhandled rejections. The hardening pipeline is no longer inert.',
  ),
  todoRow(
    'OPEN',
    'Premium / Play License key',
    'Populate PLAY_LICENSE_PUBLIC_KEY in src/config/playLicense.js before producing the Play release build',
    'Empty string ships by default. iapVerifier.isConfigured() returns false on empty, which causes the purchase listener and reconcileWithPlay to FAIL OPEN (trust any purchase event for PREMIUM_SKU). Acceptable for dev/sideload, NOT for prod. Currently blocked on Play Console identity verification before the licensing key field becomes available. To populate once unblocked: Play Console \u2192 your app \u2192 Monetize \u2192 Monetization setup (older console: Setup \u2192 Licensing) \u2192 copy the Base64-encoded RSA public key (long block of A-Z/a-z/0-9/+// chars, no PEM headers) \u2192 paste as the PLAY_LICENSE_PUBLIC_KEY export. Consider adding a release-build assertion that fails the build if the key is empty.',
  ),
  todoRow(
    'DONE',
    'Build / R8 missing classes',
    'R8 release build was failing on android.media.LoudnessCodecController missing-class warnings from Google Mobile Ads SDK',
    'Resolved by adding -dontwarn android.media.LoudnessCodecController and -dontwarn android.media.LoudnessCodecController$OnLoudnessCodecUpdateListener to android/app/proguard-rules.pro. The class is API 35+; we compile against API 34, and the AdMob SDK guards usage at runtime with SDK_INT checks so silencing the warning is safe. Lower-risk than bumping compileSdkVersion 34 \u2192 35.',
  ),
  todoRow(
    'DONE',
    'Build / Gradle JVM heap + metaspace',
    'Bumped Gradle daemon JVM args from -Xmx2g/-XX:MaxMetaspaceSize=512m to -Xmx4g/-XX:MaxMetaspaceSize=1024m',
    'After adding react-native-iap to the classpath, release builds (R8 + Kotlin compile across the full RN+Expo+iap+ads module graph) hit OutOfMemoryError: Metaspace inside the daemon. Symptom was deceptive: the daemon stayed alive at full CPU running endless GC cycles, no APK output, no error to stderr (only visible in ~/.gradle/daemon/8.14.3/daemon-<pid>.out.log). 1g of metaspace leaves comfortable headroom; can lower again if memory becomes scarce.',
  ),
];

const table = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [1400, 2000, 3500, 2460],
  rows,
});

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('ModForge \u2014 Working TODO')] }),
      new Paragraph({ children: [new TextRun({ text: 'Living list. Update status as items move. Add new rows at the bottom.', italics: true, color: '555555' })] }),
      new Paragraph({ children: [new TextRun('')] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Active items')] }),
      table,
      new Paragraph({ children: [new TextRun('')] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Status legend')] }),
      new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun({ text: 'OPEN ', bold: true }), new TextRun('\u2014 not started')] }),
      new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun({ text: 'IN PROGRESS ', bold: true }), new TextRun('\u2014 actively working')] }),
      new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun({ text: 'BLOCKED ', bold: true }), new TextRun('\u2014 waiting on something external')] }),
      new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun({ text: 'DONE ', bold: true }), new TextRun('\u2014 completed; leave in doc for one pass, then archive')] }),
    ],
  }],
});

const out = path.resolve(__dirname, '..', 'docs', 'TODO.docx');
fs.mkdirSync(path.dirname(out), { recursive: true });
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(out, buffer);
  console.log('Wrote ' + out);
});
