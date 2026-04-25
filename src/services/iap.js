// In-app purchase wiring for the one-time Premium upgrade.
// Lazy-loads react-native-iap so dev / Expo Go builds without the native
// module don't crash at import time, mirroring the pattern in rewardedAds.js.

import * as premiumState from './premiumState';
import * as iapVerifier from './iapVerifier';

export const PREMIUM_SKU = 'modforge_premium';

let nativeModule = null;
let connecting = null;
let connected = false;
let purchaseSub = null;
let errorSub = null;

function getModule() {
  if (!nativeModule) {
    try {
      nativeModule = require('react-native-iap');
    } catch (e) {
      nativeModule = null;
    }
  }
  return nativeModule;
}

export function isAvailable() {
  return !!getModule();
}

async function ensureConnected() {
  const mod = getModule();
  if (!mod) return null;
  if (connected) return mod;
  if (connecting) {
    await connecting;
    return connected ? mod : null;
  }
  connecting = (async () => {
    try {
      await mod.initConnection();
      connected = true;
    } catch (e) {
      connected = false;
    } finally {
      connecting = null;
    }
  })();
  await connecting;
  return connected ? mod : null;
}

// Subscribe to purchase updates. Called once on app start so that
// off-app or pending purchases (e.g. parental approval) reconcile to
// premiumState whenever they finalize.
export async function startPurchaseListener() {
  const mod = await ensureConnected();
  if (!mod) return;
  if (purchaseSub) return;

  purchaseSub = mod.purchaseUpdatedListener(async purchase => {
    try {
      if (purchase?.productId !== PREMIUM_SKU) return;

      // Verify the receipt signature against our Play license key
      // before unlocking. If the verifier is configured and the
      // signature does not match, this is either a forged purchase
      // event or a hooked native bridge — drop it on the floor.
      // If the verifier isn't configured (no public key in
      // playLicense.js), fail open: acceptable for dev / sideload,
      // and the cold-start reconcileWithPlay still re-checks against
      // Google on next launch.
      if (iapVerifier.isConfigured()) {
        const v = await iapVerifier.verifyPurchase(purchase);
        if (!v.ok || !v.verified) {
          // Don't finishTransaction — let Play retry it; if it's
          // genuine, restorePurchases on next cold start will pick
          // it up and re-verify.
          return;
        }
      }

      await premiumState.setPremium(true);
      try {
        await mod.finishTransaction(purchase, false);
      } catch {}
    } catch {}
  });

  errorSub = mod.purchaseErrorListener(() => {
    // Silently swallow — the caller of requestPurchase already surfaces errors.
  });
}

export function stopPurchaseListener() {
  try { purchaseSub?.remove?.(); } catch {}
  try { errorSub?.remove?.(); } catch {}
  purchaseSub = null;
  errorSub = null;
}

// Returns the localized product info for the Premium SKU, or null.
// react-native-iap v12 API: getProducts(skuArray) returns Product[].
export async function getPremiumProduct() {
  const mod = await ensureConnected();
  if (!mod) return null;
  try {
    const products = await mod.getProducts([PREMIUM_SKU]);
    return products?.[0] || null;
  } catch {
    return null;
  }
}

// Kicks off the purchase flow. Returns { ok, reason }. The actual unlock
// happens in the purchase listener (so it works for both this caller and
// off-app finalizations).
// v12 API: requestPurchase(sku) on iOS, requestPurchase({skus:[sku]}) on
// Android. We pass the v12-friendly object form which works on both.
export async function purchasePremium() {
  const mod = await ensureConnected();
  if (!mod) return { ok: false, reason: 'iap-unavailable' };
  try {
    await mod.requestPurchase({ sku: PREMIUM_SKU, skus: [PREMIUM_SKU] });
    return { ok: true };
  } catch (e) {
    const code = e?.code || '';
    if (code === 'E_USER_CANCELLED') return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: code || 'purchase-failed' };
  }
}

// Walks an array of purchase objects and returns the first one whose
// productId matches PREMIUM_SKU AND whose Play signature verifies. If
// no public key is configured, signature checking is skipped (fail-open
// — see iapVerifier.isConfigured()).
async function findVerifiedPremium(purchases) {
  if (!Array.isArray(purchases)) return null;
  const candidates = purchases.filter(p => p?.productId === PREMIUM_SKU);
  if (candidates.length === 0) return null;
  if (!iapVerifier.isConfigured()) return candidates[0];
  for (const p of candidates) {
    const v = await iapVerifier.verifyPurchase(p);
    if (v.ok && v.verified) return p;
  }
  return null;
}

// Restores a previous purchase on a new install / device. Returns
// { ok, restored } — `restored: true` means the user owns Premium.
export async function restorePurchases() {
  const mod = await ensureConnected();
  if (!mod) return { ok: false, restored: false, reason: 'iap-unavailable' };
  try {
    const purchases = await mod.getAvailablePurchases();
    const verified = await findVerifiedPremium(purchases);
    if (verified) {
      await premiumState.setPremium(true);
    }
    return { ok: true, restored: !!verified };
  } catch (e) {
    return { ok: false, restored: false, reason: e?.code || 'restore-failed' };
  }
}

// Anti-tamper: re-derive premium from Google Play on every cold start
// instead of trusting the AsyncStorage cache. If a user flipped the
// AsyncStorage flag manually (rooted device, sideloaded patched APK,
// emulator), or if Google revoked the purchase (refund / chargeback),
// this overwrites the cached value to match Play's source of truth.
//
// Behaviour:
//   - Play says owned → setPremium(true).
//   - Play says not owned → setPremium(false), revoking any cached unlock.
//   - IAP unavailable / Play offline / query times out → leave cache alone
//     (don't punish offline users on a flaky connection).
//
// timeoutMs caps how long warm-up will wait. Returns the final state.
export async function reconcileWithPlay({ timeoutMs = 3000 } = {}) {
  const mod = getModule();
  if (!mod) return { ok: false, reason: 'iap-unavailable' };

  const result = await Promise.race([
    (async () => {
      const ready = await ensureConnected();
      if (!ready) return { ok: false, reason: 'connect-failed' };
      try {
        const purchases = await ready.getAvailablePurchases();
        const verified = await findVerifiedPremium(purchases);
        const owned = !!verified;
        await premiumState.setPremium(owned);
        return { ok: true, owned };
      } catch (e) {
        return { ok: false, reason: e?.code || 'query-failed' };
      }
    })(),
    new Promise(resolve => setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs)),
  ]);

  return result;
}
