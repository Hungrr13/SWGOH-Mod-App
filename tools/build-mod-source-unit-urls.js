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

function toUnitUrl(url) {
  return String(url || '').replace(/\/best-mods\/?$/i, '/');
}

function main() {
  const args = parseArgs(process.argv);
  const root = process.cwd();
  const inputPath = path.resolve(root, args.input || 'references/mod-source/mod_source_best_mods_urls.txt');
  const outputPath = path.resolve(root, args.out || 'references/mod-source/mod_source_unit_urls.txt');

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(inputPath, 'utf8')
    .split(/\r?\n/);

  const output = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    return toUnitUrl(trimmed);
  });

  fs.writeFileSync(outputPath, `${output.join('\n').replace(/\n?$/, '\n')}`, 'utf8');

  const totalUrls = output.filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('#');
  }).length;

  console.log(JSON.stringify({
    input: inputPath,
    output: outputPath,
    totalUrls,
  }, null, 2));
}

main();
