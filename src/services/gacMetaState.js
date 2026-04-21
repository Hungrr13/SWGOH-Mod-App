// Pub/sub state wrapper around gacMetaService, matching the pattern used
// by rosterState + premiumState. Stores the last-fetched payload for
// each bracket and notifies subscribers on change.

import * as gacMetaService from './gacMetaService';

const listeners = new Set();
const byBracket = {
  '3v3': null,
  '5v5': null,
};
const inflight = {
  '3v3': null,
  '5v5': null,
};

function emit() {
  for (const fn of Array.from(listeners)) {
    try { fn(getSnapshot()); } catch {}
  }
}

export function getSnapshot() {
  return {
    '3v3': byBracket['3v3'],
    '5v5': byBracket['5v5'],
  };
}

export function getBracket(bracket) {
  return byBracket[bracket] || null;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadBracket(bracket, options = {}) {
  const b = bracket === '3v3' ? '3v3' : '5v5';
  if (inflight[b]) return inflight[b];
  const p = (async () => {
    const payload = await gacMetaService.fetchGacMeta(b, options);
    byBracket[b] = payload;
    emit();
    return payload;
  })();
  inflight[b] = p.finally(() => { inflight[b] = null; });
  return inflight[b];
}

export async function refreshBracket(bracket) {
  return loadBracket(bracket, { forceRefresh: true });
}

export function clearAll() {
  byBracket['3v3'] = null;
  byBracket['5v5'] = null;
  emit();
}
