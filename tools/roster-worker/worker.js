// Cloudflare Worker: proxies SWGOH.gg's public player API so mobile clients
// aren't blocked by Cloudflare's interactive bot challenge.
//
// Deploy:
//   npm install -g wrangler
//   cd tools/roster-worker
//   wrangler login
//   wrangler deploy
//
// Usage from the app:
//   import { setRosterApiBase } from '../services/rosterService';
//   setRosterApiBase('https://<your-worker-subdomain>.workers.dev/?allycode=');

const UPSTREAM = 'https://swgoh.gg/api/player/';
const CACHE_TTL_SECONDS = 60 * 30;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const ally = (url.searchParams.get('allycode') || '').replace(/\D/g, '');
    if (ally.length !== 9) {
      return json({ error: 'Invalid ally code — expected 9 digits' }, 400);
    }

    const cacheKey = new Request(`${UPSTREAM}${ally}/`, { method: 'GET' });
    const cache = caches.default;
    let resp = await cache.match(cacheKey);
    if (!resp) {
      resp = await fetch(cacheKey, {
        headers: { 'User-Agent': 'toscheClone/1.0 (+roster-worker)' },
        cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
      });
      if (resp.ok) {
        const clone = new Response(resp.body, resp);
        clone.headers.set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`);
        await cache.put(cacheKey, clone.clone());
        resp = clone;
      }
    }
    if (!resp.ok) return json({ error: `upstream ${resp.status}` }, resp.status);

    const data = await resp.json();
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
