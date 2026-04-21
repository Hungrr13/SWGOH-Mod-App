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
    if (!resp.ok) return { status: resp.status, body: null };
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('json')) return { status: resp.status, body: null, contentType: ct };
    return { status: resp.status, body: await resp.json() };
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

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // GAC routes don't require an ally code — check them first.
    const gacProbe = url.searchParams.get('gacProbe') === '1';
    const gacBracket = validBracket(url.searchParams.get('gac'));

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
          shape: r.body != null ? describe(r.body) : null,
        };
      }
      return json({ bracket, probeResults: results }, 200);
    }

    if (gacBracket) {
      for (const tpl of GAC_ENDPOINT_CANDIDATES) {
        const path = tpl.replace('{bracket}', gacBracket);
        const r = await fetchJsonOrNull(UPSTREAM_BASE + path);
        if (r.status === 200 && r.body != null) {
          return json({
            bracket: gacBracket,
            source: path,
            data: r.body,
          }, 200);
        }
      }
      return json({ error: 'No GAC endpoint returned usable data', bracket: gacBracket }, 502);
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
