// Fetches and caches a SWGOH player roster from swgoh.gg's public API.
//
// Endpoint: https://swgoh.gg/api/player/<allyCode>/
// No auth, no CORS concerns from React Native (native fetch).
// Response shape per unit (abridged):
//   { data: { base_id, name, rarity, gear_level, relic_tier, is_galactic_legend, ... } }
//
// API relic_tier is offset by 1 vs. in-game relic:
//   relic_tier 0 or 1 → no relics yet (returned as 0)
//   relic_tier 2 → R1, 3 → R2, ..., 10 → R9
//
// Caches normalized rosters in AsyncStorage keyed by ally code. If the module
// is not installed, caching is a no-op and every call hits the network.

// swgoh.gg is behind Cloudflare bot protection, so direct fetch returns a
// "Just a moment..." challenge page. We go through our own Cloudflare Worker
// which proxies to https://swgoh.gg/api/player/<allyCode>/ from Cloudflare's
// own network (no challenge). Override at runtime via setRosterApiBase().
// Defaults to Tosche Station's public worker so the feature works without
// deploying our own. Swap to your own worker via setRosterApiBase() once
// tools/roster-worker is deployed.
const DEFAULT_API_BASE = 'https://tosche-station-api.alexholland1987.workers.dev/?allycode=';
let API_BASE = DEFAULT_API_BASE;

export function setRosterApiBase(url) {
  API_BASE = url || DEFAULT_API_BASE;
}

const CACHE_KEY_PREFIX = 'swgoh_roster_';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

let AsyncStorage = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch (e) {
  AsyncStorage = null;
}

const memoryCache = new Map();

function normalizeAllyCode(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length === 9 ? digits : null;
}

function apiRelicToGame(apiRelic) {
  const n = Number(apiRelic) || 0;
  return n >= 2 ? n - 1 : 0;
}

function normalizeCombatType(raw) {
  if (raw == null) return null;
  const s = String(raw).toUpperCase();
  if (s === '1' || s === 'CHARACTER') return 'CHARACTER';
  if (s === '2' || s === 'SHIP') return 'SHIP';
  return s;
}

function normalizeRoster(data, allyCode) {
  const units = Array.isArray(data?.units)
    ? data.units
    : Array.isArray(data?.roster)
      ? data.roster
      : [];
  const roster = {};
  for (const u of units) {
    const d = u?.data || u || {};
    const id = String(d.base_id || '').toUpperCase();
    if (!id) continue;
    roster[id] = {
      baseId: id,
      name: d.name || null,
      stars: Number(d.rarity ?? d.stars ?? 0) || 0,
      gearLevel: Number(d.gear_level ?? 0) || 0,
      relicTier: apiRelicToGame(d.relic_tier),
      isGL: !!d.is_galactic_legend,
      combatType: normalizeCombatType(d.combat_type),
    };
  }
  return {
    allyCode,
    playerName: data?.name || data?.data?.name || null,
    roster,
    unitCount: Object.keys(roster).length,
    timestamp: Date.now(),
  };
}

async function readCache(code) {
  if (memoryCache.has(code)) return memoryCache.get(code);
  if (!AsyncStorage) return null;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY_PREFIX + code);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    memoryCache.set(code, parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(code, payload) {
  memoryCache.set(code, payload);
  if (!AsyncStorage) return;
  try {
    await AsyncStorage.setItem(CACHE_KEY_PREFIX + code, JSON.stringify(payload));
  } catch {}
}

export async function fetchRoster(allyCode, options = {}) {
  const { forceRefresh = false, ttlMs = DEFAULT_TTL_MS } = options;
  const code = normalizeAllyCode(allyCode);
  if (!code) throw new Error('Invalid ally code — expected 9 digits');

  if (!forceRefresh) {
    const cached = await readCache(code);
    if (cached && Date.now() - (cached.timestamp || 0) < ttlMs) {
      return { ...cached, fromCache: true };
    }
  }

  const url = API_BASE.includes('?')
    ? `${API_BASE}${code}`
    : `${API_BASE}${API_BASE.endsWith('/') ? '' : '/'}${code}/`;
  const resp = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) {
    throw new Error(`Roster fetch failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  if (data?.error) throw new Error(String(data.error));

  const normalized = normalizeRoster(data, code);
  await writeCache(code, normalized);
  return { ...normalized, fromCache: false };
}

export async function getCachedRoster(allyCode) {
  const code = normalizeAllyCode(allyCode);
  return code ? readCache(code) : null;
}

export async function clearCachedRoster(allyCode) {
  const code = normalizeAllyCode(allyCode);
  if (!code) return;
  memoryCache.delete(code);
  if (AsyncStorage) {
    try {
      await AsyncStorage.removeItem(CACHE_KEY_PREFIX + code);
    } catch {}
  }
}

export function ownedBaseIdSet(rosterPayload) {
  const out = new Set();
  const roster = rosterPayload?.roster || {};
  for (const id of Object.keys(roster)) out.add(id);
  return out;
}

export const __internal = { normalizeAllyCode, apiRelicToGame, normalizeRoster };
