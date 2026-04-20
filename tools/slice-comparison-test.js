// Test harness — compares ModForge slice engine output against the
// community rules-of-thumb for slicing in SWGOH. Not a unit test;
// a calibration tool. Run: `node tools/slice-comparison-test.js`.

const { evaluateSliceMod } = require('../src/services/sliceEngine');
const { CHARS: RAW_CHARS } = require('../src/data/chars');
const { SLICE_REF, decodePrimary, decodeModSet } = require('../src/constants/modData');

// Decode chars the same way SliceScreen does
const _seen = new Set();
const CHARS = RAW_CHARS.filter(c => {
  if (_seen.has(c.name)) return false;
  _seen.add(c.name);
  return true;
}).map(c => ({
  ...c,
  arrow:    decodePrimary(c.arrow),
  triangle: decodePrimary(c.triangle),
  circle:   decodePrimary(c.circle),
  cross:    decodePrimary(c.cross),
  modSet:   decodeModSet(c.modSet),
  buTri:    c.buTri ? decodePrimary(c.buTri) : undefined,
  buCir:    c.buCir ? decodePrimary(c.buCir) : undefined,
  buCro:    c.buCro ? decodePrimary(c.buCro) : undefined,
  buArr:    c.buArr ? decodePrimary(c.buArr) : undefined,
  buSet:    c.buSet ? decodeModSet(c.buSet) : undefined,
}));

const ENGINE_SLICE_REF = SLICE_REF.map(r => ({
  stat: r.s, max5: r.m5, max6: r.m6, good: r.g, great: r.gr,
}));

function run(label, communityVerdict, communityRule, input) {
  const result = evaluateSliceMod({
    chars: CHARS,
    sliceRef: ENGINE_SLICE_REF,
    ...input,
  });
  // 6E mods aren't slice candidates — grade against tierAction.actionLabel.
  const evaluated = input.tier === '6E'
    ? (result.tierAction?.actionLabel || result.decision)
    : result.decision;
  const acceptable = communityVerdict.includes(evaluated);
  const status = acceptable ? '✅' : '❌';
  return {
    label, status, communityRule, communityVerdict,
    actual: evaluated,
    score: result.finalScore,
    confidence: result.confidence,
    matched: result.matchedCount,
    fit: result.fitScore,
    sec: result.secondaryScore,
    upside: result.upsideScore,
    context: result.contextScore,
    topReason: result.reasonLines[0] || '',
  };
}

const cases = [
  {
    label: '1. Premium Speed arrow (Sp +15 with 3 rolls)',
    communityRule: 'Speed arrow with strong speed roll = always slice',
    communityVerdict: ['PREMIUM SLICE', 'STRONG SLICE'],
    input: {
      shape: 'Arrow',
      primary: 'Speed',
      modSet: 'Offense',
      tier: '5A',
      secondaries: [
        { name: 'Speed',         val: '15',  rolls: '3', hidden: false },
        { name: 'Offense%',      val: '1.8', rolls: '1', hidden: false },
        { name: 'Crit Chance%',  val: '4.5', rolls: '1', hidden: false },
        { name: 'Health%',       val: '2.5', rolls: '1', hidden: false },
      ],
    },
  },
  {
    label: '2. Garbage arrow with 4 flat secs',
    communityRule: '3+ flat base secondaries = auto-sell',
    communityVerdict: ['SELL'],
    input: {
      shape: 'Arrow',
      primary: 'Tenacity%',
      modSet: 'Defense',
      tier: '5A',
      secondaries: [
        { name: 'Defense',     val: '49',   rolls: '1', hidden: false },
        { name: 'Health',      val: '2143', rolls: '1', hidden: false },
        { name: 'Offense',     val: '228',  rolls: '1', hidden: false },
        { name: 'Protection',  val: '4153', rolls: '1', hidden: false },
      ],
    },
  },
  {
    label: '3. CD triangle with mid speed (Sp +10 with 3 rolls)',
    communityRule: 'Speed >=10 with 3 rolls = strong slice',
    communityVerdict: ['STRONG SLICE', 'PREMIUM SLICE', 'SLICE IF NEEDED'],
    input: {
      shape: 'Triangle',
      primary: 'Crit Dmg%',
      modSet: 'Crit Dmg',
      tier: '5A',
      secondaries: [
        { name: 'Speed',         val: '10',  rolls: '3', hidden: false },
        { name: 'Offense%',      val: '1.5', rolls: '1', hidden: false },
        { name: 'Crit Chance%',  val: '4.5', rolls: '1', hidden: false },
        { name: 'Health%',       val: '2',   rolls: '1', hidden: false },
      ],
    },
  },
  {
    label: '4. Potency cross for support/debuffer',
    communityRule: 'Potency cross with potency% sec is rare and slice-worthy',
    communityVerdict: ['STRONG SLICE', 'SLICE IF NEEDED', 'PREMIUM SLICE'],
    input: {
      shape: 'Cross',
      primary: 'Potency%',
      modSet: 'Potency',
      tier: '5A',
      secondaries: [
        { name: 'Speed',     val: '8',   rolls: '2', hidden: false },
        { name: 'Potency%',  val: '8.5', rolls: '2', hidden: false },
        { name: 'Tenacity%', val: '5',   rolls: '1', hidden: false },
        { name: 'Health%',   val: '2.5', rolls: '1', hidden: false },
      ],
    },
  },
  {
    label: '5. Health circle for tank',
    communityRule: 'Health primary circle with strong protection sec = tank slice',
    communityVerdict: ['STRONG SLICE', 'SLICE IF NEEDED', 'PREMIUM SLICE'],
    input: {
      shape: 'Circle',
      primary: 'Health%',
      modSet: 'Health',
      tier: '5A',
      secondaries: [
        { name: 'Speed',       val: '6',   rolls: '2', hidden: false },
        { name: 'Health%',     val: '4.5', rolls: '1', hidden: false },
        { name: 'Protection%', val: '8.5', rolls: '2', hidden: false },
        { name: 'Defense%',    val: '5.9', rolls: '2', hidden: false },
      ],
    },
  },
  {
    label: '6. No-speed mid CD triangle',
    communityRule: 'No speed in secs on a non-speed-mandatory shell = HOLD/FILLER',
    communityVerdict: ['HOLD', 'FILLER ONLY', 'SLICE IF NEEDED'],
    input: {
      shape: 'Triangle',
      primary: 'Crit Dmg%',
      modSet: 'Crit Dmg',
      tier: '5A',
      secondaries: [
        { name: 'Offense%',      val: '1.5', rolls: '1', hidden: false },
        { name: 'Crit Chance%',  val: '5',   rolls: '1', hidden: false },
        { name: 'Tenacity%',     val: '5',   rolls: '1', hidden: false },
        { name: 'Health%',       val: '3',   rolls: '1', hidden: false },
      ],
    },
  },
  {
    label: '7. 6E speed arrow already sliced (Sp +22 4 rolls)',
    communityRule: 'Already at 6E and rolled premium = no further slicing',
    communityVerdict: ['TOP TIER', 'KEEP'],
    input: {
      shape: 'Arrow',
      primary: 'Speed',
      modSet: 'Speed',
      tier: '6E',
      secondaries: [
        { name: 'Speed',         val: '22',  rolls: '4', hidden: false },
        { name: 'Offense%',      val: '2',   rolls: '1', hidden: false },
        { name: 'Crit Chance%',  val: '8',   rolls: '2', hidden: false },
        { name: 'Health%',       val: '4',   rolls: '1', hidden: false },
      ],
    },
  },
  {
    label: '9. Premium speed + decent supporting % secs (the real slice)',
    communityRule: 'Sp+15 (3 rolls) plus 2-roll % secs all around = slice from 5A',
    communityVerdict: ['STRONG SLICE', 'PREMIUM SLICE', 'SLICE IF NEEDED'],
    input: {
      shape: 'Arrow',
      primary: 'Speed',
      modSet: 'Offense',
      tier: '5A',
      secondaries: [
        { name: 'Speed',         val: '15',  rolls: '3', hidden: false },
        { name: 'Offense%',      val: '4',   rolls: '2', hidden: false },
        { name: 'Crit Chance%',  val: '4',   rolls: '2', hidden: false },
        { name: 'Health%',       val: '4',   rolls: '2', hidden: false },
      ],
    },
  },
  {
    label: '8. Weak filler triangle (no speed, all minimums)',
    communityRule: 'No speed + all minimum rolls = filler/sell',
    communityVerdict: ['FILLER ONLY', 'SELL', 'HOLD'],
    input: {
      shape: 'Triangle',
      primary: 'Crit Dmg%',
      modSet: 'Crit Dmg',
      tier: '5A',
      secondaries: [
        { name: 'Defense%',      val: '4',   rolls: '1', hidden: false },
        { name: 'Tenacity%',     val: '4',   rolls: '1', hidden: false },
        { name: 'Health%',       val: '2',   rolls: '1', hidden: false },
        { name: 'Crit Chance%',  val: '2',   rolls: '1', hidden: false },
      ],
    },
  },
];

const results = cases.map(c => run(c.label, c.communityVerdict, c.communityRule, c.input));

console.log('\n=== Slice Engine vs. Community Rules ===\n');
let pass = 0;
for (const r of results) {
  if (r.status === '✅') pass++;
  console.log(`${r.status} ${r.label}`);
  console.log(`     Rule:     ${r.communityRule}`);
  console.log(`     Expected: ${r.communityVerdict.join(' OR ')}`);
  console.log(`     Got:      ${r.actual}  (score=${r.score}, conf=${r.confidence}, matches=${r.matched})`);
  console.log(`     Subs:     fit=${r.fit}  sec=${r.sec}  upside=${r.upside}  context=${r.context}`);
  if (r.topReason) console.log(`     Reason:   ${r.topReason}`);
  console.log('');
}
console.log(`Result: ${pass}/${results.length} pass\n`);
