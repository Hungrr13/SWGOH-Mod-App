#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function fetchText(url) {
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    client
      .get(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 Codex SWGOH importer',
          accept: 'text/html,application/xhtml+xml',
        },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, url).toString();
          resolve(fetchText(nextUrl));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Request failed for ${url}: ${res.statusCode}`));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(html) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
  );
}

function cleanLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function normalizeStatName(name) {
  return name
    .replace(/\s+/g, ' ')
    .replace(/Critical Damage/gi, 'Crit Dmg')
    .replace(/Critical Chance/gi, 'Crit Chance')
    .replace(/Critical Avoidance/gi, 'Crit Avoidance')
    .trim();
}

function parseSecondaryRows(lines, url) {
  const idx = lines.findIndex((line) => line.toLowerCase() === 'secondary stat focus');
  if (idx === -1) {
    throw new Error(`Could not find "Secondary Stat Focus" in ${url}`);
  }

  const rows = [];
  for (let i = idx + 1; i < lines.length - 1; i += 1) {
    const stat = lines[i];
    if (/^(show all|show fewer|relic|average stats|best mod set|more data)$/i.test(stat)) break;
    const next = lines[i + 1];
    const match = next.match(/^\+?([\d,]+(?:\.\d+)?)\s*(%?)\s+avg\s+([\d.]+)%$/i);
    if (!match) continue;

    const avgValue = `${match[1]}${match[2] || ''}`.replace(/,/g, '');
    rows.push({
      stat: normalizeStatName(stat) + (match[2] && !/%$/.test(stat) ? '%' : ''),
      avg: avgValue,
      usage_pct: match[3],
    });
    i += 1;
  }

  if (!rows.length) {
    throw new Error(`Found section but parsed no rows in ${url}`);
  }
  return rows;
}

function parseCharacterName(lines, url) {
  const title = lines.find((line) => /^Best Mods for /i.test(line));
  if (title) {
    return title
      .replace(/^Best Mods for /i, '')
      .replace(/\s*\(GAC[\s\S]*$/i, '')
      .trim();
  }
  const fallback = url.match(/\/units\/([^/]+)\/best-mods/i);
  if (!fallback) throw new Error(`Could not determine character name for ${url}`);
  return fallback[1]
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

async function parseUrl(url) {
  const html = await fetchText(url);
  const lines = cleanLines(stripHtml(html));
  const name = parseCharacterName(lines, url);
  const rows = parseSecondaryRows(lines, url);
  return rows.map((row) => ({ name, ...row }));
}

async function main() {
  const args = parseArgs(process.argv);
  const root = process.cwd();
  const inputPath = path.resolve(root, args.input || 'references/mod-source/mod_source_best_mods_urls.txt');
  const outputPath = path.resolve(root, args.out || 'references/mod-source/secondary_focus_import.csv');

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const urls = fs.readFileSync(inputPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const allRows = [];
  const failures = [];

  for (const url of urls) {
    try {
      const rows = await parseUrl(url);
      allRows.push(...rows);
      console.log(`Parsed ${rows.length} rows from ${url}`);
    } catch (error) {
      failures.push({ url, error: error.message });
      console.error(`Failed: ${url}`);
      console.error(`  ${error.message}`);
    }
  }

  const headers = ['name', 'stat', 'avg', 'usage_pct'];
  const lines = [headers.join(',')];
  for (const row of allRows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');

  console.log(JSON.stringify({
    input: inputPath,
    output: outputPath,
    urls: urls.length,
    rows: allRows.length,
    failures,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
