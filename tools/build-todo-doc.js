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
    'OPEN',
    'Shape classifier',
    'Inner cavity mask shows notch at top on Circle \u2014 investigate if portrait-removal or pip-cleanup clipping the rim',
    'See shape-classifier-candidate-inner-mask.png from the Apr 20 Circle scan.',
  ),
  todoRow(
    'IN PROGRESS',
    'Tooling / debug',
    'Pull-debug workflow keeps breaking Claude when large shape PNGs get sampled \u2014 add size cap / text-first flow',
    'Shape classifier now writes debug to <getExternalFilesDir>/overlay-debug. Next: update pull_debug.ps1 to always grab the .txt first + downscale PNGs before they land in tools/debug_out/, so Claude never reads raw 100KB+ crops.',
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
    'OPEN',
    'Repo hygiene',
    'Decide fate of references/mod-source-html/*_files/ (SWGOH.GG webpack bundles)',
    'Carried over from READMEBEFOREEDITING.md follow-ups. Parsers never touch them; deleting would shrink repo meaningfully.',
  ),
  todoRow(
    'DONE',
    'Slice screen / layout',
    'Shrink the Best Character Fit card and place a "Your Characters" card next to it (premium-only)',
    'Two-card row. "Your Characters" populated from ally-code roster; gated behind premium.',
  ),
  todoRow(
    'OPEN',
    'Slice screen / suggestions',
    'Reduce total number of suggested characters \u2014 140 is too high',
    'Pick a sane cap (e.g. top 20\u201330 by fit score) and sort by best match.',
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
    'OPEN',
    'Shape classifier',
    'Second Circle mod reads as Cross: no candidate view sees a round outline (outer circularity 0.404, mask-only circularity 0.333, extent 0.933, stronglyRound=false)',
    'Unlike Grievous, this Circle\u2019s mask-only candidate doesn\u2019t see the round outline at all. Hypotheses: (a) capture framing cut off part of the mod, (b) different Circle visual tier/set produces a different silhouette profile. Collect multiple Circle scans (different tiers/sets/primaries) to determine whether new rescue rule is needed or whether it\u2019s a capture artifact.',
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
    'OPEN',
    'Launch / permissions UX',
    'Show in-app rationale dialog BEFORE opening Settings.ACTION_MANAGE_OVERLAY_PERMISSION',
    'Play reviewers actively test for this. Alert must explain: the app draws a small scan button over other apps, does NOT read other apps\u2019 content, does NOT simulate input, only captures screen when user taps the button. Apps that jump straight to the system dialog get rejected. Same treatment needed before the MediaProjection consent dialog.',
  ),
  todoRow(
    'OPEN',
    'Launch / Play Console',
    'Complete Data Safety form: be honest about screen capture + local mod storage',
    'Data collected = "App activity" (scanned mod data stored locally); shared = None; security = user can delete data. Google audits and pulls apps that misrepresent. Description must explicitly acknowledge screen capture to match this form.',
  ),
  todoRow(
    'OPEN',
    'Launch / manifest',
    'Declare FOREGROUND_SERVICE + FOREGROUND_SERVICE_MEDIA_PROJECTION and mark the overlay/capture service with android:foregroundServiceType="mediaProjection"',
    'Android 14+ requires this pair for screen-capture foreground services. Separate Play Console declaration under App content \u2192 Foreground services also required with justification.',
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
