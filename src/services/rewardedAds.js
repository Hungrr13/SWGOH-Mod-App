// Rewarded ad helper. Resolves true when the user earns the reward,
// at which point we grant a 24h unlock for the given feature key.
// Lazy-loads react-native-google-mobile-ads so dev / Expo Go builds
// without the native module do not crash at import time.

import { grantRewardedUnlock } from './premiumState';
import { getAdUnitId } from '../config/adsConfig';

const ADS_ENABLED = !__DEV__;

let nativeModule = null;

function getModule() {
  if (!ADS_ENABLED) return null;
  if (!nativeModule) {
    try {
      nativeModule = require('react-native-google-mobile-ads');
    } catch (e) {
      nativeModule = null;
    }
  }
  return nativeModule;
}

function getUnitId() {
  return getAdUnitId('rewarded', getModule());
}

function loadAd() {
  const mod = getModule();
  if (!mod) return null;
  const ad = mod.RewardedAd.createForAdRequest(getUnitId(), {
    requestNonPersonalizedAdsOnly: true,
  });
  return new Promise((resolve, reject) => {
    const offLoaded = ad.addAdEventListener(mod.RewardedAdEventType.LOADED, () => {
      offLoaded?.();
      offError?.();
      resolve(ad);
    });
    const offError = ad.addAdEventListener(mod.AdEventType.ERROR, err => {
      offLoaded?.();
      offError?.();
      reject(err);
    });
    ad.load();
  });
}

// Returns { shown: bool, rewarded: bool, reason?: string }.
// On rewarded === true the caller should assume the feature is now unlocked
// (we already wrote the unlock via grantRewardedUnlock before resolving).
export async function showRewardedAd(featureKey, { durationMs } = {}) {
  if (!featureKey) {
    return { shown: false, rewarded: false, reason: 'missing-feature-key' };
  }
  const mod = getModule();
  if (!mod) {
    // Dev / Expo Go path: grant unlock for easy local testing.
    if (__DEV__) {
      await grantRewardedUnlock(featureKey, durationMs);
      return { shown: false, rewarded: true, reason: 'dev-grant' };
    }
    return { shown: false, rewarded: false, reason: 'ads-unavailable' };
  }

  let ad = null;
  try {
    ad = await loadAd();
  } catch (e) {
    return { shown: false, rewarded: false, reason: 'load-failed' };
  }
  if (!ad) return { shown: false, rewarded: false, reason: 'no-ad' };

  return await new Promise(resolve => {
    let earned = false;
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      offEarned?.();
      offClosed?.();
      offError?.();
      resolve(result);
    };

    const offEarned = ad.addAdEventListener(
      mod.RewardedAdEventType.EARNED_REWARD,
      async () => {
        earned = true;
        try { await grantRewardedUnlock(featureKey, durationMs); } catch {}
      },
    );
    const offClosed = ad.addAdEventListener(mod.AdEventType.CLOSED, () => {
      finish({ shown: true, rewarded: earned });
    });
    const offError = ad.addAdEventListener(mod.AdEventType.ERROR, () => {
      finish({ shown: false, rewarded: earned, reason: 'show-error' });
    });

    ad.show().catch(() => finish({ shown: false, rewarded: earned, reason: 'show-throw' }));
  });
}
