// In-app purchase wiring for the one-time Premium upgrade.
// Lazy-loads react-native-iap so dev / Expo Go builds without the native
// module don't crash at import time, mirroring the pattern in rewardedAds.js.

import * as premiumState from './premiumState';

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
      if (purchase?.productId === PREMIUM_SKU) {
        await premiumState.setPremium(true);
        try {
          await mod.finishTransaction(purchase, false);
        } catch {}
      }
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

// Restores a previous purchase on a new install / device. Returns
// { ok, restored } — `restored: true` means the user owns Premium.
export async function restorePurchases() {
  const mod = await ensureConnected();
  if (!mod) return { ok: false, restored: false, reason: 'iap-unavailable' };
  try {
    const purchases = await mod.getAvailablePurchases();
    const hasPremium = (purchases || []).some(p => p.productId === PREMIUM_SKU);
    if (hasPremium) {
      await premiumState.setPremium(true);
    }
    return { ok: true, restored: hasPremium };
  } catch (e) {
    return { ok: false, restored: false, reason: e?.code || 'restore-failed' };
  }
}
