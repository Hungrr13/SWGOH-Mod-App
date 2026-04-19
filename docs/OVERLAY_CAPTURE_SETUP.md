# Overlay Capture Setup

This app now has an `Overlay Capture` screen and Android manifest permissions prepared for the next native step.

## What is already in place

- `Overlay Capture` entry in the `Options` menu
- Full setup/status screen in `src/screens/OverlayCaptureScreen.js`
- JS bridge in `src/services/overlayCapture.js`
- Android permissions and service manifest injection through `plugins/withOverlayCapture.js`
- Native Android template files in `references/native-overlay-template/android-overlay/`

## What still needs native Android work

1. Add a native module named `ModOverlayCapture`
   - `getStatus()`
   - `requestOverlayPermission()`
   - `requestScreenCapture()`
   - `startFloatingButton()`
   - starting point template: `references/native-overlay-template/android-overlay/ModOverlayCaptureModule.kt`

2. Add an Android foreground service for the floating overlay button
   - service type: `mediaProjection`
   - persistent notification required by Android
   - starting point template: `references/native-overlay-template/android-overlay/ModOverlayCaptureService.kt`

3. Use `MediaProjection` to capture the current screen
   - save a temporary screenshot
   - return its path to JS

4. Add OCR / image parsing
   - detect set
   - detect shape
   - detect primary
   - detect secondaries and values

5. Deep-link parsed results back into Finder or Slicer

## Current behavior

- On Android, the screen shows live capability status.
- The native Android module is now wired into the generated Android app.
- Overlay permission opens the correct Android settings screen.
- Screen capture permission now uses the real Android MediaProjection consent dialog and stores approval state.
- Starting the overlay launches a foreground service and a draggable `MOD` floating bubble.
- The floating bubble is still a placeholder trigger. It does not capture or parse the mod screen yet.
- On iPhone, the screen explains that this workflow is Android-only.

## Build note

The repo now includes an `android/` project in the workspace, but the overlay manifest setup still flows through the local config plugin:

```powershell
npx expo prebuild --platform android
```

After prebuild or any Android regeneration step, wire the real Kotlin files into the Android project using the templates as the starting point.
