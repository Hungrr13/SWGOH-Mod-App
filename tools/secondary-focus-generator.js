#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROLE_TAGS = new Set([
  'Attacker',
  'Support',
  'Tank',
  'Healer',
  'Leader',
  'Tank/Leader',
  'Support/Attacker',
]);

const FLAT_TO_PERCENT = {
  Offense: 'Offense%',
  Health: 'Health%',
  Protection: 'Protection%',
  Defense: 'Defense%',
};

const FAMILY_KEY = {
  Offense: 'Offense',
  'Offense%': 'Offense',
  Health: 'Health',
  'Health%': 'Health',
  Protection: 'Protection',
  'Protection%': 'Protection',
  Defense: 'Defense',
  'Defense%': 'Defense',
};

const FAMILY_ROLE_BONUS = {
  Attacker: {
    Speed: 1.03,
    Offense: 1.08,
    'Crit Chance%': 1.03,
    Protection: 0.97,
    Defense: 0.95,
    Health: 0.96,
  },
  Support: {
    Speed: 1.05,
    Potency: 1.05,
    Tenacity: 1.04,
    Protection: 1.01,
    Offense: 0.97,
  },
  Tank: {
    Speed: 1.02,
    Protection: 1.05,
    Defense: 1.05,
    Health: 1.04,
    Tenacity: 1.03,
    Offense: 0.94,
    'Crit Chance%': 0.95,
  },
  Healer: {
    Health: 1.06,
    Protection: 1.03,
    Speed: 1.03,
    Offense: 0.95,
  },
};

function normalizeStatName(stat) {
  return String(stat || '')
    .replace(/\s+%$/g, '%')
    .replace(/^Critical Damage$/i, 'Crit Dmg%')
    .replace(/^Critical Damage%$/i, 'Crit Dmg%')
    .replace(/^Critical Chance\s*%$/i, 'Crit Chance%')
    .replace(/^Critical Avoidance\s*%$/i, 'Crit Avoidance%')
    .trim();
}

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

function loadChars(charsPath) {
  const charsText = fs.readFileSync(charsPath, 'utf8');
  const start = charsText.indexOf('[');
  const end = charsText.lastIndexOf('];');
  return JSON.parse(charsText.slice(start, end + 1));
}

function loadExportedObject(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, 'utf8');
  const eq = text.indexOf('=');
  const end = text.lastIndexOf(';');
  if (eq === -1 || end === -1) return null;
  return JSON.parse(text.slice(eq + 1, end).trim());
}

function buildFocusMap(rows) {
  const usable = rows
    .map((row) => ({
      name: row.name,
      stat: normalizeStatName(row.stat),
      avg: Number(String(row.avg || '').replace(/%/g, '').replace(/,/g, '')),
      usagePct: Number(row.usage_pct),
    }))
    .filter((row) => row.name && row.stat && !Number.isNaN(row.avg) && !Number.isNaN(row.usagePct));

  const maxByStat = new Map();
  for (const row of usable) {
    const current = maxByStat.get(row.stat) || { avg: 0, usagePct: 0 };
    current.avg = Math.max(current.avg, row.avg);
    current.usagePct = Math.max(current.usagePct, row.usagePct);
    maxByStat.set(row.stat, current);
  }

  const focus = {};
  for (const row of usable) {
    const maxima = maxByStat.get(row.stat) || { avg: row.avg || 1, usagePct: row.usagePct || 1 };
    const avgScore = maxima.avg > 0 ? (row.avg / maxima.avg) * 60 : 0;
    const usageScore = maxima.usagePct > 0 ? (row.usagePct / maxima.usagePct) * 40 : 0;
    const score = Number((avgScore + usageScore).toFixed(2));
    if (!focus[row.name]) focus[row.name] = {};
    focus[row.name][row.stat] = { avg: row.avg, usagePct: row.usagePct, score };
  }
  return focus;
}

function loadAppliedOverrides(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
  const overrides = new Map();
  for (const row of rows) {
    if (row.confidence === 'applied' && row.name && row.suggested_secs) {
      overrides.set(row.name, row.suggested_secs);
    }
  }
  return overrides;
}

function chooseBestStat(members) {
  const percentRow = members
    .filter((member) => member.stat.endsWith('%'))
    .sort((a, b) => b.score - a.score)[0];
  if (percentRow) return percentRow.stat;

  const best = [...members].sort((a, b) => b.score - a.score)[0];
  return FLAT_TO_PERCENT[best.stat] || best.stat;
}

function scoreRows(rows, options = {}) {
  const charsPath = path.resolve(process.cwd(), options.charsPath || 'src/data/chars.js');
  const secFocusPath = path.resolve(process.cwd(), options.secFocusPath || 'src/data/secFocus.js');
  const kitOverridesPath = path.resolve(
    process.cwd(),
    options.kitOverridesPath || 'references/character-data/kit_caveat_suggestions.csv'
  );

  const chars = loadChars(charsPath);
  const roleByName = new Map(chars.map((char) => [char.name, ROLE_TAGS.has(char.role) ? char.role : ({
    A: 'Attacker',
    S: 'Support',
    K: 'Tank',
    He: 'Healer',
    Leader: 'Leader',
    'Tank/Leader': 'Tank',
    'Support/Attacker': 'Support',
  }[char.role] || '')]));

  const focusMap = loadExportedObject(secFocusPath) || buildFocusMap(rows);
  const overrides = loadAppliedOverrides(kitOverridesPath);
  const suggestions = [];

  for (const [name, statMap] of Object.entries(focusMap)) {
    const role = roleByName.get(name) || '';
    const roleBonus = FAMILY_ROLE_BONUS[role] || {};
    const members = Object.entries(statMap).map(([stat, values]) => ({
      name,
      stat: normalizeStatName(stat),
      avg: values.avg,
      usagePct: values.usagePct,
      score: Number(values.score || 0),
      family: FAMILY_KEY[normalizeStatName(stat)] || normalizeStatName(stat),
    }));

    const byFamily = new Map();
    for (const row of members) {
      if (!byFamily.has(row.family)) {
        byFamily.set(row.family, { family: row.family, members: [], contributions: [] });
      }
      const family = byFamily.get(row.family);
      family.members.push(row);

      const hasPercentSibling = Boolean(FLAT_TO_PERCENT[row.stat] && members.some((member) => member.stat === FLAT_TO_PERCENT[row.stat]));
      const isFlatFallback = Boolean(FLAT_TO_PERCENT[row.stat]);
      let contribution = row.score;
      if (isFlatFallback) {
        contribution *= hasPercentSibling ? (row.family === 'Offense' ? 0.22 : 0.14) : (row.family === 'Offense' ? 0.35 : 0.2);
      }
      family.contributions.push(contribution);
    }

    const ranked = [...byFamily.values()]
      .map((family) => {
        const ordered = [...family.contributions].sort((a, b) => b - a);
        const familyScore = ordered[0] + ordered.slice(1).reduce((sum, value) => sum + (value * 0.18), 0);
        return {
          family: family.family,
          bestStat: chooseBestStat(family.members),
          familyScore: familyScore * (roleBonus[family.family] || 1),
        };
      })
      .sort((a, b) => b.familyScore - a.familyScore);

    const suggested = ranked.slice(0, 4).map((row) => row.bestStat).join(' > ');
    suggestions.push({
      name,
      suggested_secs: overrides.get(name) || suggested,
      source_stat_count: members.length,
    });
  }

  return suggestions.sort((a, b) => a.name.localeCompare(b.name));
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(filePath, rows) {
  const headers = ['name', 'suggested_secs', 'source_stat_count'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function applyToChars(charsPath, suggestions) {
  const chars = loadChars(charsPath);
  const byName = new Map(suggestions.map((row) => [row.name, row.suggested_secs]));

  let updated = 0;
  for (const char of chars) {
    const next = byName.get(char.name);
    if (next && char.secs !== next) {
      char.secs = next;
      updated += 1;
    }
  }

  fs.writeFileSync(charsPath, `export const CHARS = ${JSON.stringify(chars)};\n`, 'utf8');
  return updated;
}

function main() {
  const args = parseArgs(process.argv);
  const root = process.cwd();
  const inputPath = path.resolve(root, args.input || 'references/mod-source/secondary_focus_import.csv');
  const outPath = path.resolve(root, args.out || 'references/mod-source/secondary_focus_suggestions.csv');
  const charsPath = path.resolve(root, args.chars || 'src/data/chars.js');

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(inputPath, 'utf8'));
  const suggestions = scoreRows(rows, { charsPath });
  writeCsv(outPath, suggestions);

  let applied = 0;
  if (args.apply) {
    applied = applyToChars(charsPath, suggestions);
  }

  console.log(JSON.stringify({
    input: inputPath,
    output: outPath,
    rowsRead: rows.length,
    charactersScored: suggestions.length,
    applied,
  }, null, 2));
}

main();
