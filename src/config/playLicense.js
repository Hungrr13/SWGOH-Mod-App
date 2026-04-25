// Google Play Console licensing public key for in-app purchase signature
// verification.
//
// HOW TO SET THIS:
//   1. Open Play Console → your app → Monetize → Monetization setup.
//      (Older console: Setup → Licensing.)
//   2. Copy the "Base64-encoded RSA public key" — a long block of
//      A-Z / a-z / 0-9 / + / / characters, no PEM headers.
//   3. Paste it as PLAY_LICENSE_PUBLIC_KEY below.
//
// Behaviour:
//   - Empty string (default): purchase signatures are NOT verified.
//     iap.purchaseUpdatedListener will trust any purchase event for the
//     Premium SKU. Acceptable for dev / sideload builds, NOT for prod.
//   - Real key set: every purchase event must verify against this key
//     before unlocking Premium. Invalid signatures are silently rejected.
//
// Security note: this key is meant to be shipped with the APK. It's a
// public key — knowing it doesn't let an attacker forge purchases. What
// it DOES let us do is reject fake purchase events injected by hooking
// into react-native-iap's listeners.
export const PLAY_LICENSE_PUBLIC_KEY = '';
