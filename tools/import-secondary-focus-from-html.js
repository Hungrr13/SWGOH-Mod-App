#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

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

function parseCharacterName(lines, fileName) {
  const title = lines.find((line) => /^Best Mods for /i.test(line));
  if (title) {
    return title
      .replace(/^Best Mods for /i, '')
      .replace(/\s*\(GAC[\s\S]*$/i, '')
      .replace(/\s*-\s*Star Wars Galaxy of Heroes\s*-\s*SWGOH\.GG$/i, '')
      .trim();
  }

  const fromFile = path.basename(fileName, path.extname(fileName))
    .replace(/[-_]+/g, ' ')
    .trim();
  return fromFile;
}

function extractUnitHeader(html, sourceLabel) {
  const match = html.match(/<div class="unit-header">[\s\S]*?<div role="tablist"/i);
  if (!match) {
    throw new Error(`Could not find unit header in ${sourceLabel}`);
  }
  return match[0];
}

function parseCharacterMeta(unitHeaderHtml) {
  const meta = {
    alignment: '',
    is_galactic_legend: 'false',
  };

  const alignmentMatch = unitHeaderHtml.match(
    /<span class="unit-alignment-text[\s\S]*?<a [^>]*>(Light Side|Dark Side|Neutral)<\/a>/i
  );
  if (alignmentMatch) {
    meta.alignment = alignmentMatch[1];
  }

  if (
    /unit-galactic-legend-text/i.test(unitHeaderHtml) ||
    />\s*Galactic Legend\s*<\/a>/i.test(unitHeaderHtml)
  ) {
    meta.is_galactic_legend = 'true';
  }

  return meta;
}

function parseSecondaryRows(lines, sourceLabel) {
  const idx = lines.findIndex((line) => line.toLowerCase() === 'secondary stat focus');
  if (idx === -1) {
    throw new Error(`Could not find "Secondary Stat Focus" in ${sourceLabel}`);
  }

  const rows = [];
  for (let i = idx + 1; i < lines.length - 3; i += 1) {
    const stat = lines[i];
    if (/^(show all|show fewer|relic|average stats|best mod set|more data|view all)$/i.test(stat)) break;
    if (/^show (all|fewer)/i.test(stat)) break;

    const avgValue = lines[i + 1];
    const avgLabel = lines[i + 2];
    const usageValue = lines[i + 3];
    const match = avgValue.match(/^\+?([\d,]+(?:\.\d+)?)(%?)$/i);
    if (!match || !/^avg$/i.test(avgLabel) || !/^[\d.]+%$/i.test(usageValue)) continue;

    rows.push({
      stat: normalizeStatName(stat) + (match[2] && !/%$/.test(stat) ? '%' : ''),
      avg: `${match[1]}${match[2] || ''}`.replace(/,/g, ''),
      usage_pct: usageValue.replace(/%$/, ''),
    });
    i += 3;
  }

  if (!rows.length) {
    throw new Error(`Found section but parsed no rows in ${sourceLabel}`);
  }
  return rows;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function walkHtmlFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkHtmlFiles(full));
    } else if (/\.(html|htm)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const root = process.cwd();
  const dirPath = path.resolve(root, args.dir || 'references/mod-source-html');
  const outPath = path.resolve(root, args.out || 'references/mod-source/secondary_focus_import.csv');

  if (!fs.existsSync(dirPath)) {
    console.error(`Directory not found: ${dirPath}`);
    process.exit(1);
  }

  const files = walkHtmlFiles(dirPath);
  const allRows = [];
  const failures = [];

  for (const file of files) {
    try {
      const html = fs.readFileSync(file, 'utf8');
      const lines = cleanLines(stripHtml(html));
      const name = parseCharacterName(lines, file);
      const unitHeaderHtml = extractUnitHeader(html, file);
      const meta = parseCharacterMeta(unitHeaderHtml);
      const rows = parseSecondaryRows(lines, file).map((row) => ({ name, ...meta, ...row }));
      allRows.push(...rows);
      console.log(`Parsed ${rows.length} rows from ${path.basename(file)}`);
    } catch (error) {
      failures.push({ file, error: error.message });
      console.error(`Failed: ${file}`);
      console.error(`  ${error.message}`);
    }
  }

  const headers = ['name', 'alignment', 'is_galactic_legend', 'stat', 'avg', 'usage_pct'];
  const lines = [headers.join(',')];
  for (const row of allRows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');

  console.log(JSON.stringify({
    dir: dirPath,
    output: outPath,
    files: files.length,
    rows: allRows.length,
    failures,
  }, null, 2));
}

main();
