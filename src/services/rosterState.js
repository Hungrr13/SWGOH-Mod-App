// Module-level roster state, hydrated from AsyncStorage on app start and
// kept in sync when the user updates their ally code. The overlay event
// handler reads getCurrentOwnedIds() synchronously when a scan fires, so
// we keep the Set in memory rather than awaiting storage on the hot path.

import { fetchRoster, clearCachedRoster, ownedBaseIdSet, modSummary } from './rosterService';

let AsyncStorage = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch (e) {
  AsyncStorage = null;
}

const ALLY_CODE_KEY = 'swgoh_ally_code';

let currentAllyCode = null;
let currentRoster = null;
let currentOwnedIds = null;
const listeners = new Set();

function emit() {
  listeners.forEach(fn => {
    try { fn(getSnapshot()); } catch {}
  });
}

function setRosterPayload(payload) {
  currentRoster = payload || null;
  currentOwnedIds = payload ? ownedBaseIdSet(payload) : null;
  currentAllyCode = payload?.allyCode || null;
  emit();
}

export function getSnapshot() {
  return {
    allyCode: currentAllyCode,
    playerName: currentRoster?.playerName || null,
    unitCount: currentRoster?.unitCount || 0,
    ownedCount: currentOwnedIds?.size || 0,
    timestamp: currentRoster?.timestamp || 0,
    hasRoster: !!currentOwnedIds && currentOwnedIds.size > 0,
  };
}

export function getCurrentOwnedIds() {
  return currentOwnedIds;
}

export function getCurrentAllyCode() {
  return currentAllyCode;
}

export function getCurrentRoster() {
  return currentRoster;
}

export function getModSummary(baseId) {
  return modSummary(currentRoster, baseId);
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function hydrate() {
  if (!AsyncStorage) return getSnapshot();
  try {
    const code = await AsyncStorage.getItem(ALLY_CODE_KEY);
    if (!code) return getSnapshot();
    // Let fetchRoster read from its own cache. Cache-only on hydrate —
    // we don't want to block app start on a network round-trip.
    const payload = await fetchRoster(code, { ttlMs: 24 * 60 * 60 * 1000 });
    setRosterPayload(payload);
  } catch (e) {
    console.warn('[rosterState] hydrate failed:', e?.message || e);
  }
  return getSnapshot();
}

export async function setAllyCode(rawCode, { forceRefresh = false } = {}) {
  const payload = await fetchRoster(rawCode, { forceRefresh });
  setRosterPayload(payload);
  if (AsyncStorage) {
    try {
      await AsyncStorage.setItem(ALLY_CODE_KEY, payload.allyCode);
    } catch {}
  }
  return payload;
}

export async function clearAllyCode() {
  const code = currentAllyCode;
  setRosterPayload(null);
  if (AsyncStorage) {
    try { await AsyncStorage.removeItem(ALLY_CODE_KEY); } catch {}
  }
  if (code) {
    try { await clearCachedRoster(code); } catch {}
  }
}
