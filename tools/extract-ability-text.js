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
  return String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseFile(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const name = decodeHtml(titleMatch ? titleMatch[1] : path.basename(filePath).replace(/.htm$/i, ''));

  const abilityRegex = /<div class="unit-ability__name">[\s\S]*?<a[^>]*class="text-white"[^>]*>\s*([\s\S]*?)\s*<\/a>[\s\S]*?<div class="unit-ability__ability-level">[\s\S]*?<\/div>[\s\S]*?<div class="unit-ability__description">([\s\S]*?)<\/div>/gi;
  const abilities = [];
  let match;
  while ((match = abilityRegex.exec(html))) {
    const abilityName = normalizeWhitespace(decodeHtml(match[1]));
    const description = normalizeWhitespace(decodeHtml(match[2]));
    if (!abilityName || !description || abilityName === 'EMPTY' || description === 'EMPTY') continue;
    abilities.push({ name: abilityName, description });
  }

  const classesMatch = html.match(/<h4[^>]*>Ability Classes<\/h4>[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i);
  const abilityClasses = [];
  if (classesMatch) {
    const linkRegex = /<a [^>]*>([\s\S]*?)<\/a>/gi;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(classesMatch[1]))) {
      const label = normalizeWhitespace(decodeHtml(linkMatch[1]));
      if (label) abilityClasses.push(label);
    }
  }

  return {
    name,
    abilityClasses,
    abilities,
    fullText: normalizeWhitespace(abilities.map((ability) => `${ability.name}\n${ability.description}`).join('\n\n')),
  };
}

function main() {
  const args = parseArgs(process.argv);
  const root = process.cwd();
  const dirPath = path.resolve(root, args.dir || 'references/mod-source-html/Abilities');
  const outPath = path.resolve(root, args.out || 'references/character-data/ability_text.json');

  if (!fs.existsSync(dirPath)) {
    console.error(`Input directory not found: ${dirPath}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dirPath)
    .filter((file) => /\.htm(l)?$/i.test(file))
    .sort((a, b) => a.localeCompare(b));

  const parsed = files.map((file) => parseFile(path.join(dirPath, file)));
  fs.writeFileSync(outPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    inputDir: dirPath,
    output: outPath,
    filesRead: files.length,
    parsed: parsed.length,
  }, null, 2));
}

main();
