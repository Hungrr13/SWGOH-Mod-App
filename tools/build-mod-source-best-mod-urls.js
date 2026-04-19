#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const SLUG_OVERRIDES = {
  '0-0-0': '0-0-0',
  '4-LOM': '4-lom',
  '50R-T': '50r-t',
  'Ahsoka Tano': 'commander-ahsoka-tano',
  'Ahsoka Tano (Fulcrum)': 'ahsoka-tano-fulcrum',
  'Ahsoka Tano (Snips)': 'ahsoka-tano',
  'Asajj Ventress (Dark Disciple)': 'asajj-ventress-dark-disciple',
  'Boba Fett, Scion of Jango': 'boba-fett-scion-of-jango',
  'Bo-Katan (Mand\'alor)': 'bo-katan-mandalor',
  'Boushh (Leia Organa)': 'boushh-leia-organa',
  'CC-1119 "Appo"': 'cc-1119-appo',
  'CC-2224 "Cody"': 'cc-2224-cody',
  'CT-21-0408 "Echo"': 'ct-21-0408-echo',
  'CT-5555 "Fives"': 'ct-5555-fives',
  'CT-7567 "Rex"': 'ct-7567-rex',
  'Chirrut Îmwe': 'chirrut-imwe',
  'Commander Luke Skywalker': 'commander-luke-skywalker',
  'Darth Vader (Duel\'s End)': 'darth-vader-duels-end',
  'Echo': 'echo',
  'Echo (Bad Batch)': 'echo-bad-batch',
  'Hunter (Mercenary)': 'hunter-mercenary',
  'Jedi Master Luke Skywalker': 'jedi-master-luke-skywalker',
  'Jocasta Nu': 'jocasta-nu',
  'Ki-Adi-Mundi': 'ki-adi-mundi',
  'Luke Skywalker (Farmboy)': 'luke-skywalker-farmboy',
  'Mara Jade, The Emperor\'s Hand': 'mara-jade-the-emperors-hand',
  'Princess Leia': 'princess-leia',
  'Qi\'ra': 'qira',
  'RC-1262 "Scorch"': 'rc-1262-scorch',
  'Sith Eternal Emperor': 'sith-eternal-emperor',
  'Skiff Guard (Lando Calrissian)': 'skiff-guard-lando-calrissian',
  'Stormtrooper Han': 'stormtrooper-han',
  'The Mandalorian (Beskar Armor)': 'the-mandalorian-beskar-armor',
  'The Stranger': 'the-stranger',
  'URoRRuR\'R\'R': 'urorrurr-r-r',
};

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

function slugify(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['".,]/g, '')
    .replace(/[()]/g, ' ')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function main() {
  const args = parseArgs(process.argv);
  const root = process.cwd();
  const charsPath = path.resolve(root, args.chars || 'src/data/chars.js');
  const outputPath = path.resolve(root, args.out || 'references/mod-source/mod_source_best_mods_urls.txt');

  const text = fs.readFileSync(charsPath, 'utf8');
  const start = text.indexOf('[');
  const end = text.lastIndexOf('];');
  const chars = JSON.parse(text.slice(start, end + 1));

  const urls = chars.map((char) => {
    const slug = SLUG_OVERRIDES[char.name] || slugify(char.name);
    return `https://swgoh.gg/units/${slug}/best-mods/`;
  });

  const lines = [
    '# Auto-generated from src/data/chars.js',
    '# One SWGOH.GG best-mods URL per line',
    ...urls,
  ];
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');

  console.log(JSON.stringify({
    chars: chars.length,
    output: outputPath,
    overrides: Object.keys(SLUG_OVERRIDES).length,
  }, null, 2));
}

main();
