// Single source of truth for AdMob unit IDs.
//
// FLIP TO PRODUCTION:
//   1. Set USE_TEST_AD_UNITS = false below.
//   2. Fill in PROD_UNITS with the IDs from your AdMob console.
//   3. Also swap GADApplicationIdentifier / android_app_id in app.json.
//
// IMPORTANT: keep USE_TEST_AD_UNITS = true for ALL testing tracks
// (internal, closed, open). Tapping your own real ads = AdMob ban.
// Once you ship to production, register your phone in AdMob as a
// test device so you can verify without serving yourself live ads.

export const USE_TEST_AD_UNITS = true;

// Real AdMob unit IDs (Android). Fill these in before flipping the flag.
const PROD_UNITS = {
  banner: 'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX',
  interstitial: 'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX',
  rewarded: 'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX',
};

// Returns null when react-native-google-mobile-ads isn't loadable
// (e.g. dev / Expo Go). Callers should treat null as "ads unavailable".
export function getAdUnitId(kind, mod) {
  if (!mod) return null;
  if (USE_TEST_AD_UNITS) {
    if (kind === 'banner') return mod.TestIds.BANNER;
    if (kind === 'interstitial') return mod.TestIds.INTERSTITIAL;
    if (kind === 'rewarded') return mod.TestIds.REWARDED;
    return null;
  }
  return PROD_UNITS[kind] || null;
}
