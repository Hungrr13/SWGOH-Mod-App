import { evaluateSliceMod } from '../../src/services/sliceEngine.js';
import { CHARS } from '../../src/data/chars.js';
import { SLICE_REF } from '../../src/constants/modData.js';
const result = evaluateSliceMod({
  chars: CHARS,
  sliceRef: SLICE_REF,
  shape: 'Arrow',
  primary: 'Speed',
  modSet: 'Health',
  secondaries: [
    { name: 'Health%', val: '2.26' },
    { name: 'Offense%', val: '1.09' },
    { name: 'Crit Chance%', val: '1.66' },
    { name: 'Defense', val: '8' },
  ],
});
console.log(JSON.stringify({
  finalScore: result.finalScore,
  decision: result.decision,
  fitScore: result.fitScore,
  secondaryScore: result.secondaryScore,
  upsideScore: result.upsideScore,
  contextScore: result.contextScore,
  confidence: result.confidence,
  reasons: result.reasonLines,
  topMatches: result.matchedCharacters.slice(0,10).map(m => ({name:m.name, fitTier:m.fitTier, aligned:m.alignedCount, score:Math.round(m.matchScore), priorities:m.priorities})),
  scoredStats: result.scoredStats.map(s => ({name:s.name,target:s.matchedTarget,targetWeight:Math.round(s.targetWeight),qualityBand:s.qualityBand,qualityPct:Math.round(s.qualityPct),sliceGainPct:Math.round(s.sliceGainPct),score:Math.round(s.score)})),
}, null, 2));
