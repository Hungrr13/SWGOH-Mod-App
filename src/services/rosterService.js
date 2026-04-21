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
const DEFAULT_API_BASE = 'https://swgoh-roster-proxy.trash-receipt123.workers.dev/?allycode=';
let API_BASE = DEFAULT_API_BASE;

export function setRosterApiBase(url) {
  API_BASE = url || DEFAULT_API_BASE;
}

const CACHE_KEY_PREFIX = 'swgoh_roster_v2_';
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

// swgoh.gg mod slot ids → in-game shape names
// (API returns 2..7; confirmed against a live roster payload)
const MOD_SLOT_TO_SHAPE = {
  2: 'Square', 3: 'Arrow', 4: 'Diamond',
  5: 'Triangle', 6: 'Circle', 7: 'Cross',
};

// swgoh.gg mod set ids → in-game set names
const MOD_SET_ID_TO_NAME = {
  1: 'Health', 2: 'Offense', 3: 'Defense', 4: 'Speed',
  5: 'Crit Chance', 6: 'Crit Damage', 7: 'Tenacity', 8: 'Potency',
};

function normalizeMod(m) {
  if (!m || typeof m !== 'object') return null;
  const slotRaw = m.slot ?? m.slot_id ?? null;
  const setRaw = m.set ?? m.set_id ?? null;
  return {
    id: m.id || m.mod_id || null,
    slot: MOD_SLOT_TO_SHAPE[Number(slotRaw)] || null,
    set: MOD_SET_ID_TO_NAME[Number(setRaw)] || null,
    pips: Number(m.pips ?? m.rarity ?? 0) || 0, // 1..6 dots
    level: Number(m.level ?? 0) || 0,            // 1..15
    tier: Number(m.tier ?? 0) || 0,              // 1=E .. 5=A (6-dot)
  };
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
    const rawMods = Array.isArray(d.mods) ? d.mods : [];
    const mods = rawMods.map(normalizeMod).filter(Boolean);
    roster[id] = {
      baseId: id,
      name: d.name || null,
      stars: Number(d.rarity ?? d.stars ?? 0) || 0,
      gearLevel: Number(d.gear_level ?? 0) || 0,
      relicTier: apiRelicToGame(d.relic_tier),
      isGL: !!d.is_galactic_legend,
      combatType: normalizeCombatType(d.combat_type),
      mods,
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
    ? `${API_BASE}${code}&mods=1`
    : `${API_BASE}${API_BASE.endsWith('/') ? '' : '/'}${code}/?mods=1`;
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

// Returns a quick summary of a character's mod loadout. `baseId` is the
// swgoh.gg base_id; returns null when the character isn't in the roster.
//   missingSlots:  number of empty slots (0..6). A slot is "empty" only if
//                  the mods array is present and < 6 entries, or a slot
//                  shape is absent. If mods array is empty/missing, returns
//                  null for this field (roster payload predates mod wiring).
//   upgradeable:   count of mods worth sinking mats into (level<15 OR pips<6
//                  OR tier<5). Also null when mods data isn't available.
//   hasModData:    false if the source didn't include mod info for this unit
// When `shape` (Square/Arrow/Diamond/Triangle/Circle/Cross) is supplied, the
// summary also includes slot-specific fields: `slotShape`, `slotMod` (the mod
// currently in that slot or null), `slotEmpty`, and `slotUpgradeable`.
export function modSummary(rosterPayload, baseId, shape) {
  const unit = rosterPayload?.roster?.[String(baseId || '').toUpperCase()];
  if (!unit) return null;
  const mods = Array.isArray(unit.mods) ? unit.mods : [];
  if (mods.length === 0) {
    const base = { missingSlots: null, upgradeable: null, hasModData: false };
    if (shape) {
      return { ...base, slotShape: shape, slotMod: null, slotEmpty: null, slotUpgradeable: null };
    }
    return base;
  }
  const filledShapes = new Set(mods.map(m => m.slot).filter(Boolean));
  const missingSlots = 6 - filledShapes.size;
  let upgradeable = 0;
  for (const m of mods) {
    if (!m) continue;
    if (isModUpgradeable(m)) upgradeable++;
  }
  const base = { missingSlots, upgradeable, hasModData: true };
  if (!shape) return base;
  const slotMod = mods.find(m => m && m.slot === shape) || null;
  return {
    ...base,
    slotShape: shape,
    slotMod,
    slotEmpty: !slotMod,
    slotUpgradeable: !!slotMod && isModUpgradeable(slotMod),
  };
}

function isModUpgradeable(m) {
  if (!m) return false;
  if ((m.level || 0) < 15) return true;
  if ((m.pips || 0) < 6) return true;
  if ((m.tier || 0) < 5) return true;
  return false;
}

export const __internal = { normalizeAllyCode, apiRelicToGame, normalizeRoster, normalizeMod };
