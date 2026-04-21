// Fetches and caches GAC top-squad meta data via the Cloudflare Worker
// (same worker that proxies roster lookups). The worker probes swgoh.gg's
// candidate GAC endpoints and returns the first one that responds with
// usable data.
//
// The raw shape is not locked down yet — the `normalizeGacData` call is
// deliberately defensive so we can change the worker upstream without
// breaking consumers. Call sites should depend on the normalized shape:
//
//   {
//     bracket: '3v3' | '5v5',
//     source: string,                // upstream path that answered
//     squads: Array<{
//       name: string,                // "Jedi Master Kenobi lead" etc.
//       members: Array<string>,      // base IDs, upper-case
//       offenseWinRate: number|null, // 0..1
//       defenseWinRate: number|null, // 0..1
//       sampleSize: number|null,     // # of battles observed
//       role: 'offense' | 'defense' | 'either',
//     }>,
//     timestamp: number,
//   }

const DEFAULT_BASE = 'https://swgoh-roster-proxy.trash-receipt123.workers.dev/';
let API_BASE = DEFAULT_BASE;

export function setGacApiBase(url) {
  API_BASE = url || DEFAULT_BASE;
}

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const memoryCache = new Map();

let AsyncStorage = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch {
  AsyncStorage = null;
}

const CACHE_KEY_PREFIX = 'swgoh_gac_meta_v1_';

function cacheKey(bracket) {
  return `${CACHE_KEY_PREFIX}${bracket}`;
}

async function readCache(bracket) {
  if (memoryCache.has(bracket)) return memoryCache.get(bracket);
  if (!AsyncStorage) return null;
  try {
    const raw = await AsyncStorage.getItem(cacheKey(bracket));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    memoryCache.set(bracket, parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(bracket, payload) {
  memoryCache.set(bracket, payload);
  if (!AsyncStorage) return;
  try {
    await AsyncStorage.setItem(cacheKey(bracket), JSON.stringify(payload));
  } catch {}
}

function upperIds(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map(x => String(x || '').toUpperCase())
    .filter(Boolean);
}

// Defensive normalizer. Real swgoh.gg payload shape is TBD; we accept
// several common forms so the worker can swap its upstream without
// requiring a client update.
export function normalizeGacData(payload, bracket) {
  const source = payload?.source || null;
  const raw = payload?.data ?? payload;
  const rawSquads =
    (Array.isArray(raw?.squads) && raw.squads) ||
    (Array.isArray(raw?.results) && raw.results) ||
    (Array.isArray(raw) && raw) ||
    [];
  const squads = rawSquads
    .map(sq => {
      if (!sq || typeof sq !== 'object') return null;
      const members = upperIds(
        sq.members || sq.units || sq.characters || sq.squad || [],
      );
      if (members.length === 0) return null;
      const offense = numberOrNull(
        sq.offenseWinRate ?? sq.offense_win_rate ?? sq.attackWinRate ?? sq.attack_win_rate,
      );
      const defense = numberOrNull(
        sq.defenseWinRate ?? sq.defense_win_rate ?? sq.holdRate ?? sq.hold_rate,
      );
      const sampleSize = numberOrNull(
        sq.sampleSize ?? sq.sample_size ?? sq.battles ?? sq.count,
      );
      const role = offense != null && defense != null
        ? 'either'
        : offense != null
          ? 'offense'
          : defense != null
            ? 'defense'
            : 'either';
      return {
        name: String(sq.name || sq.title || sq.leader || 'Unnamed squad'),
        members,
        offenseWinRate: offense,
        defenseWinRate: defense,
        sampleSize,
        role,
      };
    })
    .filter(Boolean);
  return {
    bracket,
    source,
    squads,
    timestamp: Date.now(),
  };
}

function numberOrNull(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return null;
  // Normalise 0..100 percentages to 0..1.
  if (n > 1 && n <= 100) return n / 100;
  return n;
}

export async function fetchGacMeta(bracket, options = {}) {
  const b = bracket === '3v3' || bracket === '5v5' ? bracket : '5v5';
  const { forceRefresh = false, ttlMs = DEFAULT_TTL_MS } = options;

  if (!forceRefresh) {
    const cached = await readCache(b);
    if (cached && Date.now() - (cached.timestamp || 0) < ttlMs) {
      return { ...cached, fromCache: true };
    }
  }

  const base = API_BASE.replace(/\/$/, '');
  const url = `${base}/?gac=${b}`;
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) {
    throw new Error(`GAC fetch failed: HTTP ${resp.status}`);
  }
  const payload = await resp.json();
  if (payload?.error) throw new Error(String(payload.error));
  const normalized = normalizeGacData(payload, b);
  await writeCache(b, normalized);
  return { ...normalized, fromCache: false };
}

export async function probeGacEndpoints(bracket = '5v5') {
  const base = API_BASE.replace(/\/$/, '');
  const url = `${base}/?gacProbe=1&bracket=${bracket}`;
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  return resp.json();
}

// Given a normalized GAC payload + a Set of owned base IDs, rank squads
// by (win-rate × roster-coverage) and split into offense + defense
// buckets. Squads with < MIN_COVERAGE members owned are dropped.
const MIN_COVERAGE = 0.6;

export function recommendSquads(gacPayload, ownedBaseIds) {
  const ownedSet = ownedBaseIds instanceof Set
    ? ownedBaseIds
    : new Set(Array.from(ownedBaseIds || []));
  const ranked = (gacPayload?.squads || [])
    .map(sq => {
      const ownedCount = sq.members.reduce(
        (n, id) => n + (ownedSet.has(id) ? 1 : 0),
        0,
      );
      const coverage = sq.members.length
        ? ownedCount / sq.members.length
        : 0;
      return { squad: sq, ownedCount, coverage };
    })
    .filter(item => item.coverage >= MIN_COVERAGE);

  const rankFor = (role) => {
    const metric = role === 'offense' ? 'offenseWinRate' : 'defenseWinRate';
    return ranked
      .filter(item => (item.squad[metric] ?? null) != null || item.squad.role === 'either')
      .map(item => ({
        ...item,
        score: ((item.squad[metric] ?? 0.5) * 0.7) + (item.coverage * 0.3),
      }))
      .sort((a, b) => b.score - a.score);
  };

  return {
    offense: rankFor('offense'),
    defense: rankFor('defense'),
    totalSquadsConsidered: gacPayload?.squads?.length || 0,
    totalEligibleSquads: ranked.length,
  };
}

export const __internal = { normalizeGacData, numberOrNull };
