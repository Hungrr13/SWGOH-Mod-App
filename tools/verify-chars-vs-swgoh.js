#!/usr/bin/env node
// Verify src/data/chars.js against swgoh.gg's Mod Meta Report.
//
// Source: https://swgoh.gg/stats/mod-meta-report/  (fetched once, via our
// Cloudflare Worker to bypass Cloudflare bot protection). The page is a table
// with one row per character listing the recommended mod sets and the top
// primary stat for each shape (Arrow / Triangle / Circle / Cross). When
// multiple primaries are equally valid swgoh.gg renders them as "A / B", which
// we parse as a tolerance list.
//
// Usage:
//   node tools/verify-chars-vs-swgoh.js              # diff report (dry-run)
//   node tools/verify-chars-vs-swgoh.js --refresh    # re-fetch the page
//   node tools/verify-chars-vs-swgoh.js --only Name  # filter by name substr
//   node tools/verify-chars-vs-swgoh.js --apply      # rewrite chars.js

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = process.cwd();
const CHARS_PATH = path.resolve(ROOT, 'src/data/chars.js');
const CACHE_PATH = path.resolve(ROOT, '.cache/mod-meta-report.html');
const REPORT_PATH = path.resolve(ROOT, '.cache/verify-report.json');
const WORKER_URL = 'https://swgoh-roster-proxy.trash-receipt123.workers.dev/?scrape=/stats/mod-meta-report/';

const SET_ID_TO_NAME = {
  1: 'Health', 2: 'Offense', 3: 'Defense', 4: 'Speed',
  5: 'Crit Chance', 6: 'Crit Dmg', 7: 'Tenacity', 8: 'Potency',
};
const FOUR_PIECE_SETS = new Set(['Offense', 'Speed', 'Crit Dmg']);

const PRIMARY_ABBR = {
  'Speed': 'Sp', 'Offense': 'O', 'Health': 'H', 'Defense': 'D', 'Protection': 'P',
  'Potency': 'Po', 'Tenacity': 'T', 'Critical Chance': 'CC', 'Critical Damage': 'CD',
  'Accuracy': 'Ac', 'Critical Avoidance': 'CA',
  'Crit Chance': 'CC', 'Crit Damage': 'CD', 'Crit Dmg': 'CD',
};

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const k = t.slice(2);
    const n = argv[i + 1];
    if (!n || n.startsWith('--')) args[k] = true;
    else { args[k] = n; i++; }
  }
  return args;
}

function readChars() {
  const text = fs.readFileSync(CHARS_PATH, 'utf8');
  const start = text.indexOf('[');
  const end = text.lastIndexOf('];');
  return JSON.parse(text.slice(start, end + 1));
}

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 ModForge' } }, (resp) => {
      let data = '';
      resp.on('data', (c) => { data += c; });
      resp.on('end', () => resolve({ status: resp.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function loadMetaReport(refresh) {
  if (!refresh && fs.existsSync(CACHE_PATH)) {
    return fs.readFileSync(CACHE_PATH, 'utf8');
  }
  const { status, body } = await fetchHtml(WORKER_URL);
  if (status !== 200 || !body || body.length < 10000) {
    throw new Error(`Meta report fetch failed: HTTP ${status} len=${body?.length}`);
  }
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, body, 'utf8');
  return body;
}

// Decode two set icons (or one 4-piece + one 2-piece) into the local format.
// Each icon is one set-bonus instance: 4-piece sets contribute 4 mods; 2-piece
// sets contribute 2 mods (and stack if the icon appears twice).
function setIdsToModSet(ids) {
  const counts = {};
  for (const id of ids) {
    const name = SET_ID_TO_NAME[id];
    if (!name) continue;
    const per = FOUR_PIECE_SETS.has(name) ? 4 : 2;
    counts[name] = (counts[name] || 0) + per;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  if (entries.length === 1) return `${entries[0][0]}(x${entries[0][1]})`;
  return entries.map(([n, c]) => `${n}(x${c})`).join('+');
}

function primaryToAbbrList(raw) {
  if (!raw) return [];
  return String(raw)
    .split('/')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => PRIMARY_ABBR[s] || s);
}

// Parse all <tr> rows in the mod meta report <tbody>.
function parseMetaReport(html) {
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return {};
  const tbody = tbodyMatch[1];
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  const out = {};
  let m;
  while ((m = rowRe.exec(tbody)) !== null) {
    const row = m[1];
    const slugMatch = row.match(/\/units\/([^/]+)\/best-mods\//);
    if (!slugMatch) continue;
    const slug = slugMatch[1];
    const nameMatch = row.match(/\/best-mods\/">([^<]+)</);
    const name = nameMatch ? nameMatch[1].trim() : slug;

    const setIds = [];
    const setRe = /stat-mod-set-def-icon--set-(\d+)/g;
    let sm;
    while ((sm = setRe.exec(row)) !== null) setIds.push(Number(sm[1]));
    const modSet = setIdsToModSet(setIds);

    // Primaries live in the last 4 <td>s. Grab all <td>s, take the tail 4.
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1].trim());
    const last4 = tds.slice(-4).map(s => s.replace(/<[^>]+>/g, '').trim());
    const [arrowRaw, triangleRaw, circleRaw, crossRaw] = last4;

    out[slug] = {
      slug,
      name,
      modSet,
      primaries: {
        arrow: primaryToAbbrList(arrowRaw),
        triangle: primaryToAbbrList(triangleRaw),
        circle: primaryToAbbrList(circleRaw),
        cross: primaryToAbbrList(crossRaw),
      },
    };
  }
  return out;
}

// Extract swgoh.gg slug from a local char entry if stored (not currently), or
// infer from its name. We match best-effort by slugifying; the meta report map
// is keyed by slug so we also check a name-to-slug index for fuzzy fallback.
function slugify(name) {
  return String(name)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' ')
    .replace(/['".,]/g, '')
    .replace(/[()]/g, ' ')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '')
    .toLowerCase();
}

// Some local names don't slugify to swgoh.gg's URL. Map known exceptions.
const SLUG_OVERRIDES = {
  'Ahsoka Tano': 'commander-ahsoka-tano',
};

function diffChar(local, remote) {
  const diffs = [];
  if (remote.modSet && local.modSet !== remote.modSet) {
    diffs.push({ field: 'modSet', from: local.modSet, to: remote.modSet });
  }
  for (const shape of ['arrow', 'triangle', 'circle', 'cross']) {
    const localAbbr = local[shape];
    const remoteList = remote.primaries[shape] || [];
    if (remoteList.length === 0) continue;
    if (!remoteList.includes(localAbbr)) {
      diffs.push({ field: shape, from: localAbbr, to: remoteList.join(' / ') });
    }
  }
  return diffs;
}

async function main() {
  const args = parseArgs(process.argv);
  const refresh = !!args.refresh;
  const only = args.only || null;
  const apply = !!args.apply;

  console.log('Fetching mod meta report ...');
  const html = await loadMetaReport(refresh);
  const report = parseMetaReport(html);
  const bySlug = report;
  const byName = {};
  for (const r of Object.values(report)) byName[r.name.toLowerCase()] = r;
  console.log(`Parsed ${Object.keys(report).length} characters from meta report.`);

  const chars = readChars();
  const target = only
    ? chars.filter(c => c.name.toLowerCase().includes(String(only).toLowerCase()))
    : chars;

  const results = [];
  let ok = 0, miss = 0, noMeta = 0;
  for (const c of target) {
    const slug = SLUG_OVERRIDES[c.name] || slugify(c.name);
    const remote = bySlug[slug] || byName[c.name.toLowerCase()];
    if (!remote) {
      results.push({ name: c.name, slug, noMeta: true });
      noMeta++;
      continue;
    }
    const diffs = diffChar(c, remote);
    results.push({ name: c.name, slug: remote.slug, local: c, remote, diffs });
    if (diffs.length === 0) ok++;
    else miss++;
  }

  const mismatches = results.filter(r => r.diffs && r.diffs.length);
  const noMetaList = results.filter(r => r.noMeta);

  console.log('');
  console.log(`Match: ${ok}   Mismatch: ${miss}   No meta: ${noMeta}`);
  console.log('');
  console.log('Mismatches:');
  for (const r of mismatches) {
    console.log(`  ${r.name}`);
    for (const d of r.diffs) {
      console.log(`    - ${d.field}: "${d.from}" -> "${d.to}"`);
    }
  }
  if (noMetaList.length) {
    console.log('');
    console.log(`Not in meta report (${noMetaList.length}):`);
    for (const r of noMetaList) console.log(`  ${r.name}  [slug tried: ${r.slug}]`);
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nReport: ${REPORT_PATH}`);

  if (apply) {
    let text = fs.readFileSync(CHARS_PATH, 'utf8');
    let applied = 0;
    for (const r of mismatches) {
      // Match the JSON form of the name as stored in the file (so interior
      // quotes become \" and backslashes become \\ before regex-escaping).
      const jsonName = JSON.stringify(r.name);
      const jsonNameRe = jsonName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const objRe = new RegExp('\\{"name":' + jsonNameRe + '[^}]*\\}');
      const objMatch = text.match(objRe);
      if (!objMatch) continue;
      let newObj = objMatch[0];
      for (const d of r.diffs) {
        if (d.field === 'modSet') {
          newObj = newObj.replace(/"modSet":"[^"]*"/, `"modSet":"${r.remote.modSet}"`);
        } else {
          // For shape fields: pick swgoh.gg's first option (most popular).
          const first = r.remote.primaries[d.field][0];
          const re = new RegExp(`"${d.field}":"[^"]*"`);
          if (re.test(newObj) && first) newObj = newObj.replace(re, `"${d.field}":"${first}"`);
        }
      }
      if (newObj !== objMatch[0]) {
        text = text.replace(objMatch[0], newObj);
        applied++;
      }
    }
    fs.writeFileSync(CHARS_PATH, text, 'utf8');
    console.log(`\nApplied ${applied} update(s) to chars.js`);
  } else {
    console.log('\n(dry-run — pass --apply to rewrite chars.js)');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
