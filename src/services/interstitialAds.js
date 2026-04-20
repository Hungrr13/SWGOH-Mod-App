// Cold-start interstitial helper. Shows at most one ad per cap window
// (default 6h). Loads lazily so dev builds don't bring in the native module.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAdUnitId } from '../config/adsConfig';

const STORAGE_KEY = '@modforge/lastInterstitialAt';
const CAP_MS = 6 * 60 * 60 * 1000;
const ADS_ENABLED = !__DEV__;

let nativeModule = null;
let cachedAd = null;
let loadPromise = null;

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
  return getAdUnitId('interstitial', getModule());
}

async function withinCap() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  const last = Number(raw);
  if (!Number.isFinite(last)) return false;
  return Date.now() - last < CAP_MS;
}

function preload() {
  const mod = getModule();
  if (!mod) return null;
  if (cachedAd) return cachedAd;
  if (loadPromise) return loadPromise;

  const ad = mod.InterstitialAd.createForAdRequest(getUnitId(), {
    requestNonPersonalizedAdsOnly: true,
  });

  loadPromise = new Promise((resolve, reject) => {
    const offLoaded = ad.addAdEventListener(mod.AdEventType.LOADED, () => {
      offLoaded?.();
      offError?.();
      cachedAd = ad;
      loadPromise = null;
      resolve(ad);
    });
    const offError = ad.addAdEventListener(mod.AdEventType.ERROR, err => {
      offLoaded?.();
      offError?.();
      cachedAd = null;
      loadPromise = null;
      reject(err);
    });
    ad.load();
  });

  return loadPromise;
}

export async function maybeShowColdStartInterstitial() {
  if (!ADS_ENABLED) return false;
  if (await withinCap()) return false;

  try {
    const ad = await preload();
    if (!ad) return false;
    const mod = getModule();
    if (!mod) return false;

    return await new Promise(resolve => {
      let settled = false;
      const finish = shown => {
        if (settled) return;
        settled = true;
        offClosed?.();
        offError?.();
        cachedAd = null;
        resolve(shown);
      };
      const offClosed = ad.addAdEventListener(mod.AdEventType.CLOSED, () => finish(true));
      const offError = ad.addAdEventListener(mod.AdEventType.ERROR, () => finish(false));
      ad.show().catch(() => finish(false));
      AsyncStorage.setItem(STORAGE_KEY, String(Date.now())).catch(() => {});
    });
  } catch (_e) {
    return false;
  }
}
