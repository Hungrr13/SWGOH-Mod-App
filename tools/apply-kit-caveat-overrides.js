#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const overrides = {
  Bossk: 'Protection% > Defense% > Speed > Tenacity%',
  'Darth Malgus': 'Health% > Speed > Protection% > Defense%',
  'Darth Traya': 'Speed > Health% > Protection% > Defense%',
  'General Kenobi': 'Health% > Defense% > Protection% > Speed',
  'Jedi Knight Luke Skywalker': 'Offense% > Protection% > Crit Chance% > Tenacity%',
  'General Grievous': 'Health% > Protection% > Speed > Potency%',
  'Enfys Nest': 'Protection% > Tenacity% > Health% > Speed',
  Krrsantan: 'Speed > Health% > Tenacity% > Defense%',
  'Padmé Amidala': 'Protection% > Health% > Speed > Defense%',
  'Royal Guard': 'Health% > Protection% > Defense% > Speed',
  Shoretrooper: 'Health% > Protection% > Speed > Defense%',
  'Sun Fac': 'Protection% > Speed > Tenacity% > Health%',
  Tarfful: 'Defense% > Protection% > Health% > Tenacity%',
  Wampa: 'Tenacity% > Offense% > Health% > Speed',
};

function main() {
  const charsPath = path.resolve(process.cwd(), 'src/data/chars.js');
  const text = fs.readFileSync(charsPath, 'utf8');
  const start = text.indexOf('[');
  const end = text.lastIndexOf('];');
  const chars = JSON.parse(text.slice(start, end + 1));

  let updated = 0;
  for (const char of chars) {
    if (overrides[char.name] && char.secs !== overrides[char.name]) {
      char.secs = overrides[char.name];
      updated += 1;
    }
  }

  fs.writeFileSync(charsPath, `export const CHARS = ${JSON.stringify(chars)};\n`, 'utf8');
  console.log(JSON.stringify({ updated }, null, 2));
}

main();
