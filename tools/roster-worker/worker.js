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
//   allycode=XXXXXXXXX   required, 9 digits
//   mods=1               include per-character mod arrays (extra upstream call)
//   probe=1              diagnostic: returns shape summaries for every
//                        candidate mod endpoint so we can see which path
//                        swgoh.gg actually exposes publicly
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

export default {
  async fetch(request) {
    const url = new URL(request.url);
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

    // Base player response.
    const playerResp = await fetchUpstream(`${UPSTREAM_BASE}/api/player/${ally}/`);
    if (!playerResp.ok) return json({ error: `upstream ${playerResp.status}` }, playerResp.status);
    const data = await playerResp.json();

    // Merge mods if requested.
    if (url.searchParams.get('mods') === '1') {
      let modsStatus = 'no-candidate-worked';
      let modsSource = null;
      for (const tpl of MOD_ENDPOINT_CANDIDATES) {
        const path = tpl.replace('{code}', ally);
        const r = await fetchJsonOrNull(UPSTREAM_BASE + path);
        if (r.status === 200 && r.body) {
          const arr = extractModsArray(r.body);
          if (Array.isArray(arr) && arr.length > 0) {
            const byId = groupModsByCharacter(arr);
            const units = Array.isArray(data?.units) ? data.units : [];
            for (const u of units) {
              const d = u?.data || u;
              if (!d) continue;
              const id = String(d.base_id || '').toUpperCase();
              if (id && byId[id]) d.mods = byId[id];
            }
            modsStatus = 'ok';
            modsSource = path;
            break;
          }
          modsStatus = `endpoint-${r.status}-empty`;
          modsSource = path;
        } else {
          modsStatus = `endpoint-${r.status}`;
        }
      }
      data.__modsStatus = modsStatus;
      data.__modsSource = modsSource;
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
