// Module-level premium / unlock state. Two ways a feature can be unlocked:
//   1. isPremium === true (one-time IAP, ad-free everything + all features)
//   2. rewardedUnlocks[feature] > Date.now() (24h unlock from a rewarded ad)
//
// Storage keys are JSON blobs in AsyncStorage; in-memory cache is the source
// of truth between hydrate() and writes so callers don't await on the hot path.

let AsyncStorage = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch (e) {
  AsyncStorage = null;
}

const PREMIUM_KEY = '@modforge/isPremium';
const UNLOCKS_KEY = '@modforge/rewardedUnlocks';
const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;

let isPremium = false;
let rewardedUnlocks = {};
const listeners = new Set();

function emit() {
  listeners.forEach(fn => {
    try { fn(getSnapshot()); } catch {}
  });
}

function pruneExpired() {
  const now = Date.now();
  let changed = false;
  for (const key of Object.keys(rewardedUnlocks)) {
    if (!rewardedUnlocks[key] || rewardedUnlocks[key] <= now) {
      delete rewardedUnlocks[key];
      changed = true;
    }
  }
  return changed;
}

export function getSnapshot() {
  pruneExpired();
  return {
    isPremium,
    rewardedUnlocks: { ...rewardedUnlocks },
    adFree: isPremium,
  };
}

export function hasFeature(name) {
  if (isPremium) return true;
  const expiry = rewardedUnlocks[name];
  return !!expiry && expiry > Date.now();
}

export function getUnlockExpiry(name) {
  if (isPremium) return Infinity;
  return rewardedUnlocks[name] || 0;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function hydrate() {
  if (!AsyncStorage) return getSnapshot();
  try {
    const [premiumRaw, unlocksRaw] = await Promise.all([
      AsyncStorage.getItem(PREMIUM_KEY),
      AsyncStorage.getItem(UNLOCKS_KEY),
    ]);
    isPremium = premiumRaw === 'true';
    if (unlocksRaw) {
      try {
        const parsed = JSON.parse(unlocksRaw);
        if (parsed && typeof parsed === 'object') {
          rewardedUnlocks = parsed;
        }
      } catch {}
    }
    if (pruneExpired()) await persistUnlocks();
    emit();
  } catch (e) {
    console.warn('[premiumState] hydrate failed:', e?.message || e);
  }
  return getSnapshot();
}

async function persistUnlocks() {
  if (!AsyncStorage) return;
  try {
    await AsyncStorage.setItem(UNLOCKS_KEY, JSON.stringify(rewardedUnlocks));
  } catch {}
}

export async function grantRewardedUnlock(name, durationMs = DEFAULT_DURATION_MS) {
  rewardedUnlocks[name] = Date.now() + durationMs;
  await persistUnlocks();
  emit();
}

export async function setPremium(value) {
  isPremium = !!value;
  if (AsyncStorage) {
    try { await AsyncStorage.setItem(PREMIUM_KEY, isPremium ? 'true' : 'false'); } catch {}
  }
  emit();
}

export async function clearAll() {
  isPremium = false;
  rewardedUnlocks = {};
  if (AsyncStorage) {
    try {
      await Promise.all([
        AsyncStorage.removeItem(PREMIUM_KEY),
        AsyncStorage.removeItem(UNLOCKS_KEY),
      ]);
    } catch {}
  }
  emit();
}

// Feature keys — keep stable, used as AsyncStorage object keys.
export const FEATURES = {
  ROSTER: 'roster',
  FINDER_FULL: 'finder_full',
  SLICER_WHY: 'slicer_why',
};
