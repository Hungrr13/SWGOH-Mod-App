#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

function openUrl(url) {
  // Windows default browser
  const result = spawnSync('cmd', ['/c', 'start', '', url], {
    stdio: 'ignore',
    shell: false,
  });
  return result.status === 0;
}

function main() {
  const args = parseArgs(process.argv);
  const root = process.cwd();
  const inputPath = path.resolve(root, args.input || 'references/mod-source/mod_source_best_mods_urls.txt');
  const batchSize = Math.max(1, Number(args.batch || 10));
  const startIndex = Math.max(0, Number(args.start || 0));

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const urls = fs.readFileSync(inputPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const batch = urls.slice(startIndex, startIndex + batchSize);
  if (!batch.length) {
    console.error(`No URLs to open from start index ${startIndex}.`);
    process.exit(1);
  }

  let opened = 0;
  for (const url of batch) {
    if (openUrl(url)) opened += 1;
  }

  console.log(JSON.stringify({
    input: inputPath,
    totalUrls: urls.length,
    opened,
    start: startIndex,
    endExclusive: startIndex + batch.length,
    nextStart: startIndex + batch.length,
  }, null, 2));
}

main();
