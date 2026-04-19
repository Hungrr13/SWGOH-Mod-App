const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const classifierRoot = path.join(projectRoot, 'tools', 'set-classifier');
const labelsPath = path.join(classifierRoot, 'debug-crops', 'set-labels.json');
const sourceDir = path.join(classifierRoot, 'debug-crops');
const outputRoot = path.join(classifierRoot, 'training-data');
const learnedAssetRoots = [
  path.join(projectRoot, 'assets', 'mod-templates', 'learned-sets'),
  path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets', 'mod-templates', 'learned-sets'),
];

const PROFILE_ALIASES = {
  generic: 'generic',
  default: 'generic',
  normal: 'generic',
  arrow: 'arrow',
  triangle: 'triangle',
};

const SET_ALIASES = {
  health: 'Health',
  hp: 'Health',
  defense: 'Defense',
  def: 'Defense',
  speed: 'Speed',
  spd: 'Speed',
  critdmg: 'Crit Dmg',
  'crit dmg': 'Crit Dmg',
  'crit-dmg': 'Crit Dmg',
  critdamage: 'Crit Dmg',
  'crit damage': 'Crit Dmg',
  critchance: 'Crit Chance',
  'crit chance': 'Crit Chance',
  'crit-chance': 'Crit Chance',
  potency: 'Potency',
  pot: 'Potency',
  tenacity: 'Tenacity',
  tenc: 'Tenacity',
  offense: 'Offense',
  offence: 'Offense',
  off: 'Offense',
};

const VALID_PROFILES = new Set(Object.values(PROFILE_ALIASES));
const VALID_SETS = new Set([
  'Health',
  'Defense',
  'Speed',
  'Crit Dmg',
  'Crit Chance',
  'Potency',
  'Tenacity',
  'Offense',
]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  ensureDir(dirPath);
}

function copyDirContents(source, destination) {
  ensureDir(destination);
  fs.readdirSync(source, { withFileTypes: true }).forEach((entry) => {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirContents(sourcePath, destinationPath);
      return;
    }
    fs.copyFileSync(sourcePath, destinationPath);
  });
}

function slugifySet(setName) {
  return setName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeProfile(profile, index) {
  if (!profile || typeof profile !== 'string') {
    return 'generic';
  }

  const normalized = PROFILE_ALIASES[profile.trim().toLowerCase()];
  if (!normalized) {
    throw new Error(`Sample ${index} has invalid profile "${profile}".`);
  }

  return normalized;
}

function normalizeSet(set, index) {
  if (!set || typeof set !== 'string') {
    throw new Error(`Sample ${index} is missing "set".`);
  }

  const trimmed = set.trim();
  if (VALID_SETS.has(trimmed)) {
    return trimmed;
  }

  const normalized = SET_ALIASES[trimmed.toLowerCase()];
  if (!normalized) {
    throw new Error(`Sample ${index} has invalid set "${set}".`);
  }

  return normalized;
}

function resolveSourcePath(file) {
  const directPath = path.join(sourceDir, file);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  const matches = [];
  const queue = [sourceDir];
  while (queue.length > 0) {
    const current = queue.shift();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    entries.forEach((entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        return;
      }

      if (entry.name === file) {
        matches.push(fullPath);
      }
    });
  }

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw new Error(
      `Multiple files named "${file}" were found under debug-crops. Use a relative path like "Arrow Sets/${file}".`
    );
  }

  throw new Error(`File not found under debug-crops: ${file}`);
}

function readLabels() {
  if (!fs.existsSync(labelsPath)) {
    throw new Error(
      `Missing labels file at ${labelsPath}. Copy debug crops first, then create set-labels.json.`
    );
  }

  const parsed = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));
  if (!Array.isArray(parsed.samples)) {
    throw new Error('set-labels.json must contain a top-level "samples" array.');
  }

  return parsed.samples.map((sample, index) => {
    if (!sample || typeof sample !== 'object') {
      throw new Error(`Sample ${index} is not an object.`);
    }

    const { file, set, profile = 'generic', notes = '' } = sample;
    if (!file || typeof file !== 'string') {
      throw new Error(`Sample ${index} is missing "file".`);
    }
    const normalizedSet = normalizeSet(set, index);
    const normalizedProfile = normalizeProfile(profile, index);
    const sourcePath = resolveSourcePath(file);

    return {
      file,
      set: normalizedSet,
      profile: normalizedProfile,
      notes,
      sourcePath,
      relativeSourcePath: path.relative(sourceDir, sourcePath).replace(/\\/g, '/'),
    };
  });
}

function copySamples(samples) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceDir: path.relative(projectRoot, sourceDir),
    labelsPath: path.relative(projectRoot, labelsPath),
    samples: [],
  };

  samples.forEach((sample) => {
    const profileDir = path.join(outputRoot, sample.profile);
    const setDir = path.join(profileDir, slugifySet(sample.set));
    ensureDir(setDir);

    const destinationPath = path.join(setDir, path.basename(sample.file));
    fs.copyFileSync(sample.sourcePath, destinationPath);

    manifest.samples.push({
      file: sample.file,
      set: sample.set,
      profile: sample.profile,
      notes: sample.notes,
      source: sample.relativeSourcePath,
      relativePath: path.relative(outputRoot, destinationPath).replace(/\\/g, '/'),
    });
  });

  return manifest;
}

function writeManifest(manifest) {
  const manifestPath = path.join(outputRoot, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

function writeReadme() {
  const readmePath = path.join(outputRoot, 'README.md');
  const contents = `# Set Classifier Dataset

This folder is generated by \`npm run export:set-dataset\`.

Inputs:
- Raw crops in \`tools/set-classifier/debug-crops/\`
- Labels in \`tools/set-classifier/debug-crops/set-labels.json\`

Profiles:
- \`generic\`
- \`arrow\`
- \`triangle\`

Valid sets:
- \`Health\`
- \`Defense\`
- \`Speed\`
- \`Crit Dmg\`
- \`Crit Chance\`
- \`Potency\`
- \`Tenacity\`
- \`Offense\`
`;
  fs.writeFileSync(readmePath, contents, 'utf8');
}

function syncLearnedAssets() {
  learnedAssetRoots.forEach((assetRoot) => {
    cleanDir(assetRoot);
    copyDirContents(outputRoot, assetRoot);
  });
}

function main() {
  const samples = readLabels();
  cleanDir(outputRoot);
  const manifest = copySamples(samples);
  const manifestPath = writeManifest(manifest);
  writeReadme();
  syncLearnedAssets();

  const summary = samples.reduce((acc, sample) => {
    const key = `${sample.profile}:${sample.set}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.log(`Exported ${samples.length} labeled set crops.`);
  console.log(`Manifest: ${manifestPath}`);
  learnedAssetRoots.forEach((assetRoot) => {
    console.log(`Synced learned assets: ${assetRoot}`);
  });
  Object.keys(summary)
    .sort()
    .forEach((key) => {
      console.log(`${key} -> ${summary[key]}`);
    });

  const outputByProfile = samples.reduce((acc, sample) => {
    acc[sample.profile] = (acc[sample.profile] || 0) + 1;
    return acc;
  }, {});

  Object.keys(outputByProfile)
    .sort()
    .forEach((profile) => {
      console.log(`profile:${profile} -> ${outputByProfile[profile]}`);
    });
}

main();
