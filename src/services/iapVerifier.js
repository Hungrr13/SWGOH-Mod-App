// Wrapper around the native ModForgeIapVerifier module that does
// RSA-SHA1 signature verification of Google Play purchase receipts.
//
// Returns:
//   { ok: true, verified: true }  — signature matched
//   { ok: true, verified: false } — signature did NOT match (reject!)
//   { ok: false, reason: '...' }  — could not run the check (no key
//     configured, native module missing, malformed input). Caller decides
//     whether to fail-open or fail-closed.

import { NativeModules } from 'react-native';
import { PLAY_LICENSE_PUBLIC_KEY } from '../config/playLicense';

function getNative() {
  return NativeModules?.ModForgeIapVerifier || null;
}

export function isConfigured() {
  return !!PLAY_LICENSE_PUBLIC_KEY && PLAY_LICENSE_PUBLIC_KEY.length > 0;
}

export async function verifyPurchase(purchase) {
  if (!isConfigured()) {
    return { ok: false, reason: 'no-public-key' };
  }
  const native = getNative();
  if (!native?.verifyPurchase) {
    return { ok: false, reason: 'native-module-missing' };
  }
  // react-native-iap surfaces the raw INAPP_PURCHASE_DATA as
  // `dataAndroid` and INAPP_DATA_SIGNATURE as `signatureAndroid`.
  // Older versions used `originalJson` / `signature`; check both.
  const receiptJson = purchase?.dataAndroid || purchase?.originalJson || '';
  const signatureB64 = purchase?.signatureAndroid || purchase?.signature || '';
  if (!receiptJson || !signatureB64) {
    return { ok: false, reason: 'missing-receipt' };
  }
  try {
    const verified = await native.verifyPurchase(
      receiptJson,
      signatureB64,
      PLAY_LICENSE_PUBLIC_KEY,
    );
    return { ok: true, verified: !!verified };
  } catch (e) {
    return { ok: false, reason: e?.code || 'verify-error' };
  }
}
