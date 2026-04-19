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

function normalizeStatName(stat) {
  return String(stat || '')
    .replace(/\s+%$/g, '%')
    .replace(/^Critical Damage$/i, 'Crit Dmg%')
    .replace(/^Critical Damage%$/i, 'Crit Dmg%')
    .replace(/^Critical Chance\s*%$/i, 'Crit Chance%')
    .replace(/^Critical Avoidance\s*%$/i, 'Crit Avoidance%')
    .trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      continue;
    }

    cell += ch;
  }

  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => value !== '')) rows.push(row);
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((h) => h.trim());
  return dataRows.map((cols) => {
    const obj = {};
    headers.forEach((header, idx) => {
      obj[header] = (cols[idx] || '').trim();
    });
    return obj;
  });
}

function main() {
  const args = parseArgs(process.argv);
  const root = process.cwd();
  const inputPath = path.resolve(root, args.input || 'references/mod-source/secondary_focus_import.csv');
  const outputPath = path.resolve(root, args.out || 'src/data/secFocus.js');

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(inputPath, 'utf8'))
    .map((row) => ({
      name: row.name,
      stat: normalizeStatName(row.stat),
      avg: Number(String(row.avg || '').replace(/%/g, '').replace(/,/g, '')),
      usagePct: Number(row.usage_pct),
    }))
    .filter((row) => row.name && row.stat && !Number.isNaN(row.avg) && !Number.isNaN(row.usagePct));

  const maxByStat = new Map();
  for (const row of rows) {
    const current = maxByStat.get(row.stat) || { avg: 0, usagePct: 0 };
    current.avg = Math.max(current.avg, row.avg);
    current.usagePct = Math.max(current.usagePct, row.usagePct);
    maxByStat.set(row.stat, current);
  }

  const focus = {};
  for (const row of rows) {
    const maxima = maxByStat.get(row.stat) || { avg: row.avg || 1, usagePct: row.usagePct || 1 };
    const avgScore = maxima.avg > 0 ? (row.avg / maxima.avg) * 60 : 0;
    const usageScore = maxima.usagePct > 0 ? (row.usagePct / maxima.usagePct) * 40 : 0;
    const score = Number((avgScore + usageScore).toFixed(2));

    if (!focus[row.name]) focus[row.name] = {};
    focus[row.name][row.stat] = {
      avg: row.avg,
      usagePct: row.usagePct,
      score,
    };
  }

  fs.writeFileSync(outputPath, `export const SEC_FOCUS = ${JSON.stringify(focus)};\n`, 'utf8');
  console.log(JSON.stringify({
    input: inputPath,
    output: outputPath,
    rowsRead: rows.length,
    characters: Object.keys(focus).length,
  }, null, 2));
}

main();
