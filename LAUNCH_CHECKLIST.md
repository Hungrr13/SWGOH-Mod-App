# ModForge — Play Store Launch Checklist

External (non-code) work needed before submitting to Google Play. Code-side
compliance (rationale dialogs, disclaimer text, manifest, foreground service
type) is already in the build.

## 1. Play Console — Sensitive Permissions declaration

When you upload a build with `SYSTEM_ALERT_WINDOW`, Play Console will require
you to fill out the "Sensitive permissions" declaration. Use these:

- **Core functionality:** "ModForge draws a small overlay button on top of
  Star Wars: Galaxy of Heroes so the user can tap it to scan their own mod
  inventory while the game is in the foreground."
- **User benefit:** "Users can identify and catalog their mods without
  manually typing each entry, then send the parsed mod into the Finder or
  Slicer tabs to plan upgrades."
- **Why no alternative works:** "The user must interact with the app while
  SWGOH is foregrounded. There is no way to surface a tap target over another
  app without the overlay permission."

## 2. Play Console — Data Safety form

App content → Data safety. Recommended answers:

- **Data collected:** None.
- **Data shared:** None.
- **Security practices:** Data encrypted in transit (AdMob), user can delete
  data by uninstalling.
- If you want to be conservative on local storage, declare:
  "App activity → mod scan history (stored on device only, not transmitted)."

Be honest — Google audits this and lying gets the app pulled.

## 3. Play Console — Foreground Services declaration

App content → Foreground services. Justification:

- **Service:** `mediaProjection` + `specialUse` (`overlay_capture_mod_scanner`).
- **Why:** "Used only while the user has explicitly enabled the scanner
  bubble. The service stops automatically when the user taps Stop, dismisses
  the bubble, or removes the app from the recent-apps list (`stopWithTask`)."
- **User-initiated only:** Confirm yes — the service never starts in the
  background or on boot.

## 4. Play listing description

Include the disclaimer language verbatim somewhere in the long description:

> Companion app for Star Wars: Galaxy of Heroes. Not affiliated with or
> endorsed by Electronic Arts, Capital Games, or Lucasfilm. Uses overlay
> permission to display a scan button over the game. No automation —
> passive screen reading only.

## 5. Demo video (~60s)

Reviewers frequently request this for overlay + screen-capture apps.
Record once and keep handy. The video should show:

1. App opening and landing on the Scanner tab.
2. Tapping **Start Scanner Bubble**.
3. The "Display Over Other Apps" rationale dialog appearing.
4. The Android system overlay-permission settings screen, then granting it.
5. The "Capture Screen To Read Mod" rationale dialog appearing.
6. The Android MediaProjection prompt, then granting it.
7. The bubble overlaid on SWGOH.
8. Tapping the bubble while a mod is open → capture / parse.
9. Tapping **Stop Scanner Bubble** to dismiss.

## 6. Privacy policy

Host [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md) at a public URL (GitHub Pages
is free and acceptable). Paste that URL into:

- Play Console → App content → Privacy Policy
- Play Console → Store listing → Privacy Policy URL field

## Pre-launch — swap test ad unit IDs for real ones

All three ad surfaces (banner / interstitial / rewarded) read from one
config file: [`src/config/adsConfig.js`](src/config/adsConfig.js).

To go live:

1. Fill in the three real AdMob unit IDs in `PROD_UNITS` (banner,
   interstitial, rewarded).
2. Set `USE_TEST_AD_UNITS = false` in the same file.
3. Swap the AdMob app ID in [`app.json`](app.json)
   (`GADApplicationIdentifier` / `react-native-google-mobile-ads.android_app_id`)
   for your production app ID.
4. Register your physical test device(s) in the AdMob console
   ([`Settings → Test devices`](https://apps.admob.com/v2/settings/test-devices))
   so you can verify in production builds without serving yourself live ads.

**Keep `USE_TEST_AD_UNITS = true` for ALL testing tracks** (internal,
closed, open). Tapping your own real ads = AdMob ban. Shipping test IDs in
the production track is also a Play Policy violation, so make this swap
part of the production-promote commit, not earlier.

## 7. Dedupe legacy character names in `src/data/chars.js`

Some characters in [`src/data/chars.js`](src/data/chars.js) carry legacy /
alternate spellings that don't match the in-game name today (e.g. faction
renames, "Old"/"Young" prefixes, hyphenation differences). Audit and either:

- Normalize each entry to the current in-game display name, OR
- Add an `aliases: [...]` field per character so search/lookup matches both
  the modern and legacy names without producing duplicate roster entries.

Cross-check against the live roster lookup payload — any name we ship that
the swgoh.gg API returns under a different string will silently fail to
match an owned character and will incorrectly recommend it as "missing."

## Already covered in code (no action needed)

- ✅ `AndroidManifest.xml` declares `SYSTEM_ALERT_WINDOW`,
  `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`,
  `FOREGROUND_SERVICE_SPECIAL_USE`, `POST_NOTIFICATIONS`.
- ✅ Service declared with `foregroundServiceType="specialUse|mediaProjection"`
  and `stopWithTask="true"`.
- ✅ In-app rationale `Alert.alert` shown before each system permission
  prompt (`OverlayCaptureScreen.runStartFlow`).
- ✅ No auto-request of overlay permission on screen mount — only on
  explicit user action.
- ✅ Disclaimer block on the Scanner tab naming SWGOH/EA/Lucasfilm and
  stating "no automation, screenshots local-only."
