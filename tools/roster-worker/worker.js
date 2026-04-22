// Cloudflare Worker: proxies SWGOH.gg's public player API so mobile clients
// aren't blocked by Cloudflare's interactive bot challenge.
//
// Deploy:
//   npm install -g wrangler
//   cd tools/roster-worker
//   wrangler login
//   wrangler deploy
//
// Query params:
//   allycode=XXXXXXXXX   required for roster/mod routes, 9 digits
//   mods=1               include per-character mod arrays (extra upstream call)
//   probe=1              diagnostic: returns shape summaries for every
//                        candidate mod endpoint so we can see which path
//                        swgoh.gg actually exposes publicly
//   gac=3v3 | gac=5v5    GAC meta route: returns top offense/defense squads
//                        for the selected bracket (no allycode required)
//   gacProbe=1           diagnostic: tries every candidate GAC meta endpoint
//                        and reports shape/status for each
//
// Usage from the app:
//   import { setRosterApiBase } from '../services/rosterService';
//   setRosterApiBase('https://<your-worker-subdomain>.workers.dev/?allycode=');

const UPSTREAM_BASE = 'https://swgoh.gg';
const UA = 'modforge/1.0 (+roster-worker)';
const CACHE_TTL_SECONDS = 60 * 30;

// Candidate paths that might return mod data. We try them in order when
// probe=1, and use the first one that returns JSON when mods=1.
const MOD_ENDPOINT_CANDIDATES = [
  '/api/player/{code}/mods/',
  '/api/player-mods/{code}/',
  '/api/players/{code}/mods/',
  '/api/player/{code}/?mods=true',
];

// Candidate paths for GAC meta data. swgoh.gg exposes squad win-rates on
// their /gac/ reports; we don't yet know which (if any) have clean JSON
// endpoints so we probe broadly and promote whichever returns usable data.
// Expected bracket shape: '3v3' or '5v5'.
const GAC_ENDPOINT_CANDIDATES = [
  '/api/meta/squads/{bracket}/',
  '/api/meta/report/gac/{bracket}/',
  '/api/gac/',
  '/api/gac/squads/',
  '/api/squads/{bracket}/',
  '/api/squads/',
  '/api/3v3/',
  '/api/5v5/',
  '/api/gac/squads/{bracket}/',
  '/api/gac/top-squads/{bracket}/',
  '/api/gac/meta/{bracket}/',
  '/api/gac/{bracket}/squads/',
  '/gac/insights/squads/{bracket}/',
  '/api/meta-report/gac/{bracket}/',
];

async function fetchUpstream(url) {
  const cacheKey = new Request(url, { method: 'GET' });
  const cache = caches.default;
  let resp = await cache.match(cacheKey);
  if (!resp) {
    resp = await fetch(cacheKey, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
    });
    if (resp.ok) {
      const clone = new Response(resp.body, resp);
      clone.headers.set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`);
      await cache.put(cacheKey, clone.clone());
      resp = clone;
    }
  }
  return resp;
}

async function fetchJsonOrNull(url) {
  try {
    const resp = await fetchUpstream(url);
    const ct = resp.headers.get('content-type') || '';
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return {
        status: resp.status,
        body: null,
        contentType: ct,
        bodyPreview: text.slice(0, 240),
      };
    }
    if (!ct.includes('json')) {
      const text = await resp.text().catch(() => '');
      return {
        status: resp.status,
        body: null,
        contentType: ct,
        bodyPreview: text.slice(0, 240),
      };
    }
    return { status: resp.status, body: await resp.json(), contentType: ct };
  } catch (e) {
    return { status: 0, body: null, error: e.message };
  }
}

function describe(body) {
  if (body == null) return { type: typeof body };
  if (Array.isArray(body)) {
    return {
      type: 'array',
      length: body.length,
      firstKeys: body[0] && typeof body[0] === 'object' ? Object.keys(body[0]).slice(0, 20) : null,
    };
  }
  if (typeof body === 'object') {
    return {
      type: 'object',
      keys: Object.keys(body).slice(0, 30),
      modsFieldTypes: {
        'units[0].data.mods': Array.isArray(body?.units?.[0]?.data?.mods)
          ? `array[${body.units[0].data.mods.length}]`
          : typeof body?.units?.[0]?.data?.mods,
        'mods': Array.isArray(body?.mods) ? `array[${body.mods.length}]` : typeof body?.mods,
        'data': Array.isArray(body?.data) ? `array[${body.data.length}]` : typeof body?.data,
      },
    };
  }
  return { type: typeof body };
}

function extractModsArray(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.mods)) return body.mods;
  if (Array.isArray(body?.data)) return body.data;
  return null;
}

// Pull the given swgoh.gg page and extract `/api/...` references plus any
// URLs that look like they return JSON. Lets us discover real endpoints
// without having to guess paths.
async function scrapeApiReferences(path) {
  try {
    const resp = await fetchUpstream(UPSTREAM_BASE + path);
    const ct = resp.headers.get('content-type') || '';
    if (!resp.ok || !ct.includes('html')) {
      return { status: resp.status, contentType: ct, urls: [] };
    }
    const html = await resp.text();
    const urls = new Set();
    const re = /["'`](\/api\/[^"'`\s]+|https:\/\/swgoh\.gg\/api\/[^"'`\s]+)["'`]/g;
    let m;
    while ((m = re.exec(html)) !== null) urls.add(m[1]);
    // Also look for fetch("..."/axios calls on JSON-ish paths
    const re2 = /fetch\(\s*["'`]([^"'`]+)["'`]/g;
    while ((m = re2.exec(html)) !== null) {
      const u = m[1];
      if (u.startsWith('/') || u.includes('swgoh.gg')) urls.add(u);
    }
    return {
      status: resp.status,
      contentType: ct,
      htmlLength: html.length,
      urls: Array.from(urls).slice(0, 60),
    };
  } catch (e) {
    return { error: e.message, urls: [] };
  }
}

function groupModsByCharacter(mods) {
  const byId = {};
  for (const m of mods) {
    if (!m || typeof m !== 'object') continue;
    const cid = String(
      m.character || m.character_base_id || m.base_id || m.characterId || ''
    ).toUpperCase();
    if (!cid) continue;
    (byId[cid] = byId[cid] || []).push(m);
  }
  return byId;
}

function validBracket(raw) {
  const s = String(raw || '').toLowerCase();
  return s === '3v3' || s === '5v5' ? s : null;
}

// Candidate season IDs to probe. swgoh.gg alternates 3v3/5v5 seasons, so we
// walk backwards a few seasons until we find one matching the desired bracket.
// Current season URL uses no season_id param; older seasons use
// `CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_<n>`.
const SEASON_LOOKBACK = 6;
function seasonCandidates() {
  const out = [null];
  for (let n = 78; n >= 78 - SEASON_LOOKBACK; n--) {
    out.push(`CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_${n}`);
  }
  return out;
}

// swgoh.gg alternates 3v3/5v5 by season: odd = 3v3, even = 5v5.
function seasonBracket(seasonId) {
  if (!seasonId) return null;
  const m = String(seasonId).match(/SEASON_(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  return n % 2 === 1 ? '3v3' : '5v5';
}

// Parse a single swgoh.gg GAC squads page into structured squad rows.
// Each row has:
//   - 3 (=3v3) or 5 (=5v5) div[data-unit-def-tooltip-app="<BASE_ID>"] members
//   - Numeric cells: Seen (e.g. "143K"), Hold % (e.g. "27%"), Banners (e.g. "40.9")
function parseGacSquadsHtml(html, defaultRole) {
  const squads = [];
  // Grab the first stat-table (defense on /gac/squads/, offense on /gac/who-to-attack/).
  const tableMatch = html.match(/<table[^>]*class="[^"]*stat-table[^"]*"[\s\S]*?<\/table>/);
  if (!tableMatch) return squads;
  const table = tableMatch[0];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let row;
  let bracketDetected = null;
  while ((row = rowRe.exec(table)) !== null) {
    const inner = row[1];
    if (/<th\b/i.test(inner)) continue;
    const members = [];
    const memberRe = /data-unit-def-tooltip-app="([A-Z0-9_]+)"/g;
    let mm;
    while ((mm = memberRe.exec(inner)) !== null) members.push(mm[1]);
    if (members.length !== 3 && members.length !== 5) continue;
    if (!bracketDetected) bracketDetected = members.length === 3 ? '3v3' : '5v5';

    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const cells = [];
    let cm;
    while ((cm = cellRe.exec(inner)) !== null) {
      const text = cm[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      cells.push(text);
    }
    const numericCells = cells.filter(c => /[0-9]/.test(c) && c.length < 20);
    const seen = parseCompactNumber(numericCells[0]);
    const holdRaw = numericCells[1];
    const holdPct = holdRaw ? parseFloat(holdRaw.replace('%', '')) : null;
    const banners = numericCells[2] ? parseFloat(numericCells[2]) : null;

    squads.push({
      name: `${members[0]} lead`,
      members,
      role: defaultRole,
      sampleSize: Number.isFinite(seen) ? seen : null,
      offenseWinRate: defaultRole === 'offense' && Number.isFinite(holdPct)
        ? Math.max(0, Math.min(1, 1 - holdPct / 100))
        : null,
      defenseWinRate: defaultRole === 'defense' && Number.isFinite(holdPct)
        ? holdPct / 100
        : null,
      banners: Number.isFinite(banners) ? banners : null,
    });
  }
  return { squads, bracket: bracketDetected };
}

function parseCompactNumber(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/,/g, '');
  const m = s.match(/^([0-9]*\.?[0-9]+)\s*([KMB]?)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2].toUpperCase();
  const mult = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : 1;
  return Math.round(n * mult);
}

async function scrapeGacPageForBracket(pagePath, bracket, role) {
  for (const seasonId of seasonCandidates()) {
    const qs = seasonId ? `?season_id=${seasonId}` : '';
    const fullUrl = UPSTREAM_BASE + pagePath + qs;
    try {
      const resp = await fetchUpstream(fullUrl);
      if (!resp.ok) continue;
      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('html')) continue;
      const html = await resp.text();
      const parsed = parseGacSquadsHtml(html, role);
      if (parsed.bracket !== bracket) continue;
      if (parsed.squads.length === 0) continue;
      return { squads: parsed.squads, source: pagePath + qs };
    } catch {
      // try next season
    }
  }
  return { squads: [], source: null };
}

// /gac/who-to-attack/ serves a list of individual lead characters (not
// squads) with "Seen" and "Win %" stats — i.e. leaders you might face on
// defense and your aggregate win rate attacking them. We parse each panel
// into a 1-member offense entry so downstream ranking (which expects a
// members[] + offenseWinRate shape) can treat each as "attack priority".
function parseGacWhoToAttackHtml(html) {
  const entries = [];
  // Split the document into chunks starting at each size-sm panel so we
  // can scan a bounded region for each entry's fields.
  const panelRe = /<div[^>]*class="[^"]*panel\s+panel--size-sm[^"]*"[^>]*>/g;
  const starts = [];
  let pm;
  while ((pm = panelRe.exec(html)) !== null) starts.push(pm.index);
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : start + 4000;
    const block = html.slice(start, end);
    const unitMatch = block.match(/data-unit-def-tooltip-app="([A-Z0-9_]+)"/);
    if (!unitMatch) continue;
    const seenMatch = block.match(
      />\s*Seen\s*<\/div>\s*<div[^>]*class="[^"]*font-bold[^"]*"[^>]*>\s*([^<\s][^<]*?)\s*</,
    );
    const winMatch = block.match(
      />\s*Win\s*%\s*<\/div>\s*<div[^>]*class="[^"]*font-bold[^"]*"[^>]*>\s*([0-9]+(?:\.[0-9]+)?)\s*%/,
    );
    const seen = seenMatch ? parseCompactNumber(seenMatch[1]) : null;
    const winPct = winMatch ? parseFloat(winMatch[1]) : null;
    if (winPct == null && seen == null) continue;
    entries.push({ unitId: unitMatch[1], seen, winPct });
  }
  return entries;
}

async function scrapeGacOffense(bracket) {
  for (const seasonId of seasonCandidates()) {
    const sBracket = seasonBracket(seasonId);
    if (seasonId && sBracket && sBracket !== bracket) continue;
    const qs = seasonId ? `?season_id=${seasonId}` : '';
    const fullUrl = UPSTREAM_BASE + '/gac/who-to-attack/' + qs;
    try {
      const resp = await fetchUpstream(fullUrl);
      if (!resp.ok) continue;
      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('html')) continue;
      const html = await resp.text();
      // For the current-season request (seasonId=null) we need to confirm
      // the page's bracket. The HTML embeds season IDs in pagination and
      // other season links — first SEASON_<n> we find tells us the
      // currently active season.
      let pageBracket = sBracket;
      if (!pageBracket) {
        const m = html.match(/CHAMPIONSHIPS_GRAND_ARENA_GA2_EVENT_SEASON_(\d+)/);
        if (m) {
          const n = parseInt(m[1], 10);
          pageBracket = n % 2 === 1 ? '3v3' : '5v5';
        }
      }
      if (pageBracket && pageBracket !== bracket) continue;
      const entries = parseGacWhoToAttackHtml(html);
      if (entries.length === 0) continue;
      const squads = entries.map(e => ({
        name: `Attack ${e.unitId} lead`,
        members: [e.unitId],
        role: 'offense',
        sampleSize: Number.isFinite(e.seen) ? e.seen : null,
        offenseWinRate: Number.isFinite(e.winPct) ? e.winPct / 100 : null,
        defenseWinRate: null,
        banners: null,
      }));
      return { squads, source: '/gac/who-to-attack/' + qs };
    } catch {
      // try next season
    }
  }
  return { squads: [], source: null };
}

async function scrapeGacSquads(bracket) {
  // Defense squads live on /gac/squads/ as a stat-table of 3- or 5-member
  // squads. Offense data lives on /gac/who-to-attack/ but uses a totally
  // different layout — per-lead entries with Seen + Win % stats — so
  // needs its own parser.
  const [defense, offense] = await Promise.all([
    scrapeGacPageForBracket('/gac/squads/', bracket, 'defense'),
    scrapeGacOffense(bracket),
  ]);
  const squads = [...defense.squads, ...offense.squads];
  return {
    bracket,
    source: [defense.source, offense.source].filter(Boolean).join(' + ') || null,
    squads,
    timestamp: Date.now(),
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // GAC routes don't require an ally code — check them first.
    const gacProbe = url.searchParams.get('gacProbe') === '1';
    const gacBracket = validBracket(url.searchParams.get('gac'));

    // Raw scrape mode: returns arbitrary swgoh.gg page HTML so we can
    // inspect what URLs/widgets are embedded. Restricted to /gac/ tree
    // to avoid becoming an open proxy.
    const scrapePath = url.searchParams.get('scrape');
    if (scrapePath) {
      if (!scrapePath.startsWith('/')) {
        return json({ error: 'scrape path must start with /' }, 400);
      }
      const allowed = /^\/(gac|meta|squads|characters|ships|stats|units)\/?/.test(scrapePath);
      if (!allowed) {
        return json({ error: 'scrape path not on allow-list' }, 400);
      }
      const resp = await fetchUpstream(UPSTREAM_BASE + scrapePath);
      const text = await resp.text();
      return new Response(text, {
        status: resp.status,
        headers: {
          'Content-Type': resp.headers.get('content-type') || 'text/html',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (gacProbe) {
      const bracket = validBracket(url.searchParams.get('bracket')) || '5v5';
      const results = {};
      for (const tpl of GAC_ENDPOINT_CANDIDATES) {
        const path = tpl.replace('{bracket}', bracket);
        const r = await fetchJsonOrNull(UPSTREAM_BASE + path);
        results[path] = {
          status: r.status,
          contentType: r.contentType,
          error: r.error,
          bodyPreview: r.bodyPreview,
          shape: r.body != null ? describe(r.body) : null,
        };
      }
      // Also scrape the /gac/ page HTML and extract candidate API URLs so
      // we can discover the real endpoints that the swgoh.gg front-end
      // actually hits.
      const scrape = await scrapeApiReferences('/gac/');
      return json({ bracket, probeResults: results, scrapedFromGacPage: scrape }, 200);
    }

    if (gacBracket) {
      // swgoh.gg serves GAC meta as HTML on /gac/squads/ (defense) and
      // /gac/who-to-attack/ (offense). Each season alternates between
      // 3v3 and 5v5; we scan /gac/squads/ and a small window of recent
      // seasons to find pages matching the requested bracket.
      const result = await scrapeGacSquads(gacBracket);
      return json(result, 200);
    }

    const ally = (url.searchParams.get('allycode') || '').replace(/\D/g, '');
    if (ally.length !== 9) {
      return json({ error: 'Invalid ally code — expected 9 digits' }, 400);
    }

    // Diagnostic mode: hit every candidate mod endpoint and report what
    // each one returns. Lets us choose the right upstream without rebuilding.
    if (url.searchParams.get('probe') === '1') {
      const results = {};
      for (const tpl of MOD_ENDPOINT_CANDIDATES) {
        const path = tpl.replace('{code}', ally);
        const r = await fetchJsonOrNull(UPSTREAM_BASE + path);
        results[path] = {
          status: r.status,
          contentType: r.contentType,
          error: r.error,
          shape: r.body != null ? describe(r.body) : null,
        };
      }
      return json({ allyCode: ally, probeResults: results }, 200);
    }

    // Single upstream fetch. `?mods=true` returns units AND a top-level
    // `mods` array (406+ entries). When mods aren't requested, the base
    // endpoint is lighter — fetch it instead.
    const wantMods = url.searchParams.get('mods') === '1';
    const upstreamUrl = wantMods
      ? `${UPSTREAM_BASE}/api/player/${ally}/?mods=true`
      : `${UPSTREAM_BASE}/api/player/${ally}/`;
    const playerResp = await fetchUpstream(upstreamUrl);
    if (!playerResp.ok) return json({ error: `upstream ${playerResp.status}` }, playerResp.status);
    const data = await playerResp.json();

    if (wantMods) {
      const arr = Array.isArray(data?.mods) ? data.mods : [];
      if (arr.length > 0) {
        const byId = groupModsByCharacter(arr);
        const units = Array.isArray(data?.units) ? data.units : [];
        for (const u of units) {
          const d = u?.data || u;
          if (!d) continue;
          const id = String(d.base_id || '').toUpperCase();
          if (id && byId[id]) d.mods = byId[id];
        }
        data.__modsStatus = 'ok';
        data.__modsCount = arr.length;
      } else {
        data.__modsStatus = 'empty';
      }
      // Drop the top-level mods array to reduce payload — we've already
      // distributed them onto units.
      delete data.mods;
    }

    return json(data, 200);
  },
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
