#!/usr/bin/env node
const { spawnSync } = require('child_process');
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

function runStep(label, scriptPath, extraArgs = []) {
  console.log(`\n[${label}] ${path.basename(scriptPath)} ${extraArgs.join(' ')}`.trim());
  const result = spawnSync(process.execPath, [scriptPath, ...extraArgs], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const root = process.cwd();
  const toolsDir = path.join(root, 'tools');

  const urlsPath = path.resolve(root, args.urls || 'references/mod-source/mod_source_best_mods_urls.txt');
  const importPath = path.resolve(root, args.import || 'references/mod-source/secondary_focus_import.csv');
  const suggestionsPath = path.resolve(root, args.out || 'references/mod-source/secondary_focus_suggestions.csv');

  runStep(
    '1/3 Build URL List',
    path.join(toolsDir, 'build-mod-source-best-mod-urls.js'),
    ['--out', urlsPath]
  );

  runStep(
    '2/4 Import Mod Source Secondary Focus',
    path.join(toolsDir, 'mod-source-secondary-import.js'),
    ['--input', urlsPath, '--out', importPath]
  );

  runStep(
    '3/4 Build Focus Map',
    path.join(toolsDir, 'build-sec-focus.js'),
    ['--input', importPath, '--out', path.join(root, 'src', 'data', 'secFocus.js')]
  );

  const generatorArgs = ['--input', importPath, '--out', suggestionsPath];
  if (args.apply !== false) generatorArgs.push('--apply');

  runStep(
    '4/4 Generate Suggested Secondaries',
    path.join(toolsDir, 'secondary-focus-generator.js'),
    generatorArgs
  );

  console.log('\nDone.');
  console.log(`URLs: ${urlsPath}`);
  console.log(`Import: ${importPath}`);
  console.log(`Suggestions: ${suggestionsPath}`);
  console.log('Applied to src/data/chars.js: only if import succeeded and produced rows');
}

main();
