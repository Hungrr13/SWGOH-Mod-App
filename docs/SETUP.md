# Mods SWGOH – React Native App Setup

> This file is now mostly historical setup guidance. Use `READMEBEFOREEDITING.md` at the repo root for the current folder layout and edit map.

## Prerequisites

1. **Install Node.js** (v18 or later)
   - Download from https://nodejs.org/
   - Verify: `node --version` and `npm --version`

2. **Install Expo CLI**
   ```
   npm install -g expo-cli eas-cli
   ```

3. **Install dependencies**
   ```
   cd C:\Users\Chad\my-app
   npm install
   ```

## Running in Development

### Using Expo Go (limited – AdMob won't work)
```
npx expo start
```
Scan the QR code with Expo Go on your phone.
> Note: `react-native-google-mobile-ads` requires a custom dev client or production build. AdMob banner will not render in Expo Go.

### Custom Dev Client (AdMob works)
```
# Android
npx expo run:android

# iOS (Mac only)
npx expo run:ios
```
This builds a local development client that includes the native AdMob SDK.

## Production Build (EAS)

1. Log in to Expo:
   ```
   eas login
   ```

2. Configure the project:
   ```
   eas build:configure
   ```

3. Build for Android:
   ```
   eas build --platform android
   ```

4. Build for iOS:
   ```
   eas build --platform ios
   ```

## Replacing Test AdMob IDs

When ready to go live, open `app.json` and replace:
```json
"androidAppId": "ca-app-pub-3940256099942544~3347511713"
"iosAppId": "ca-app-pub-3940256099942544~1458002511"
```
with your real AdMob app IDs from https://apps.admob.com/

Then open `src/components/AdBanner.js` and replace `TestIds.BANNER`
with your real banner ad unit IDs:
```js
const BANNER_ID = Platform.select({
  ios:     'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX',
  android: 'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX',
});
```

## Project Structure

```
my-app/
├── App.js                     # Root navigation (bottom tabs)
├── app.json                   # Expo config + AdMob plugin
├── package.json
├── babel.config.js
└── src/
    ├── data/
    │   └── chars.js           # All 318 characters
    ├── constants/
    │   └── modData.js         # Mod sets, stats, slice logic
    ├── screens/
    │   ├── LookupScreen.js    # Search by name/faction + filters
    │   ├── FinderScreen.js    # Filter by mod criteria → ranked results
    │   └── SliceScreen.js     # Slice quality analyzer
    └── components/
        ├── CharacterCard.js   # Reusable card with color-coded secondaries
        └── AdBanner.js        # AdMob banner wrapper
```

## Assets

Add your app icon and splash screen to `assets/`:
- `icon.png`         – 1024×1024
- `adaptive-icon.png`– 1024×1024 (Android adaptive icon foreground)
- `splash.png`       – 1284×2778
- `favicon.png`      – 48×48
