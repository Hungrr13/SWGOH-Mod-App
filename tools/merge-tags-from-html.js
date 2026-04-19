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

function extractUnitHeader(html, sourceLabel) {
  const match = html.match(/<div class="unit-header">[\s\S]*?<div role="tablist"/i);
  if (!match) {
    throw new Error(`Could not find unit header in ${sourceLabel}`);
  }
  return match[0];
}

function parseNameFromHtml(html, fileName) {
  const match = html.match(/<h1[^>]*>\s*Best Mods for ([\s\S]*?)\s*\(GAC/i);
  if (match) {
    return match[1].replace(/\s+/g, ' ').trim();
  }
  return path.basename(fileName, path.extname(fileName))
    .replace(/^Best Mods for /i, '')
    .replace(/\s+-\s+Star Wars Galaxy of Heroes\s+-\s+SWGOH\.GG$/i, '')
    .trim();
}

function parseMeta(unitHeaderHtml) {
  const meta = {
    alignment: '',
    isGalacticLegend: false,
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
    meta.isGalacticLegend = true;
  }

  return meta;
}

const NAME_ALIASES = new Map();
const MANUAL_TAGS = new Map([
  ['Ahsoka Tano (Snips)', { alignment: 'Light Side', isGalacticLegend: false }],
]);

function walkHtmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkHtmlFiles(full));
    } else if (/\.(html|htm)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function main() {
  const args = parseArgs(process.argv);
  const root = process.cwd();
  const dirPath = path.resolve(root, args.dir || 'references/mod-source-html');
  const charsPath = path.resolve(root, args.chars || 'src/data/chars.js');

  if (!fs.existsSync(dirPath)) {
    console.error(`Directory not found: ${dirPath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(charsPath, 'utf8');
  const match = source.match(/^export const CHARS = (\[[\s\S]*\]);\s*$/);
  if (!match) {
    console.error(`Could not parse CHARS array from ${charsPath}`);
    process.exit(1);
  }

  const chars = JSON.parse(match[1]);
  const metaByName = new Map();
  const failures = [];

  for (const file of walkHtmlFiles(dirPath)) {
    try {
      const html = fs.readFileSync(file, 'utf8');
      const parsedName = parseNameFromHtml(html, file);
      const name = NAME_ALIASES.get(parsedName) || parsedName;
      const meta = parseMeta(extractUnitHeader(html, file));
      metaByName.set(name, meta);
    } catch (error) {
      failures.push({ file, error: error.message });
    }
  }

  let updated = 0;
  let missing = 0;

  const nextChars = chars.map((char) => {
    const parsedMeta = metaByName.get(char.name) || MANUAL_TAGS.get(char.name);
    if (!parsedMeta) {
      missing += 1;
      return char;
    }

    const baseTags = (char.tags || []).filter(
      (tag) => !['Light Side', 'Dark Side', 'Neutral', 'Galactic Legend'].includes(tag)
    );
    const nextTags = unique([
      ...baseTags,
      parsedMeta.alignment,
      parsedMeta.isGalacticLegend ? 'Galactic Legend' : '',
    ]);
    if (JSON.stringify(nextTags) !== JSON.stringify(char.tags || [])) {
      updated += 1;
      return { ...char, tags: nextTags };
    }
    return char;
  });

  fs.writeFileSync(charsPath, `export const CHARS = ${JSON.stringify(nextChars)};\n`, 'utf8');

  console.log(JSON.stringify({
    dir: dirPath,
    chars: charsPath,
    htmlFiles: metaByName.size,
    updated,
    missing,
    failures,
  }, null, 2));
}

main();
