import { MOD_SETS, SEC_STATS, SHAPES, SHAPE_PRIMARIES } from '../constants/modData';
import { analyzeCapturedImage } from './overlayCapture';

const PRIMARY_STATS = [
  'Speed',
  'Accuracy%',
  'Crit Avoidance%',
  'Crit Chance%',
  'Crit Dmg%',
  'Health%',
  'Protection%',
  'Offense%',
  'Defense%',
  'Tenacity%',
  'Potency%',
];

const SET_ALIASES = [
  ['critical damage', 'Crit Dmg'],
  ['crit damage', 'Crit Dmg'],
  ['critical chance', 'Crit Chance'],
  ['crit chance', 'Crit Chance'],
];

const STAT_ALIASES = [
  ['critical damage', 'Crit Dmg%'],
  ['crit damage', 'Crit Dmg%'],
  ['critical dmg', 'Crit Dmg%'],
  ['crit dmg', 'Crit Dmg%'],
  ['critical chance', 'Crit Chance%'],
  ['crit chance', 'Crit Chance%'],
  ['crit avoidance', 'Crit Avoidance%'],
  ['critical avoidance', 'Crit Avoidance%'],
  ['offense %', 'Offense%'],
  ['health %', 'Health%'],
  ['protection %', 'Protection%'],
  ['defense %', 'Defense%'],
  ['potency %', 'Potency%'],
  ['tenacity %', 'Tenacity%'],
  ['accuracy %', 'Accuracy%'],
  ['critchance', 'Crit Chance%'],
  ['critchance%', 'Crit Chance%'],
  ['critchance %', 'Crit Chance%'],
  ['critdmg', 'Crit Dmg%'],
  ['critdmg%', 'Crit Dmg%'],
  ['dee', 'Defense%'],
  ['defe', 'Defense%'],
  ['defen', 'Defense%'],
  ['defens', 'Defense%'],
  ['defense(', 'Defense%'],
  ['def', 'Defense'],
  ['spe', 'Speed'],
  ['spd', 'Speed'],
  ['tency', 'Potency%'],
  ['poten', 'Potency%'],
  ['potenc', 'Potency%'],
  ['tenac', 'Tenacity%'],
  ['health', 'Health'],
  ['protection', 'Protection'],
  ['offense', 'Offense'],
  ['defense', 'Defense'],
];

const OCR_NOISE_PATTERNS = [
  /scanning mod\.\.\./gi,
  /reading the visible primary and secondary stats\.?/gi,
  /\bprim\w*\b/gi,
  /\bseco\w*\b/gi,
  /floating button tapped at .*?capturing screenshot\.?/gi,
  /mod captured at .*?\./gi,
  /capture failed at .*?\./gi,
  /scan failed/gi,
  /read:/gi,
];

const PRIMARY_VALUE_HINTS = [
  { pattern: /\b11\.75%\b/, stat: 'Defense%' },
  { pattern: /\b36%\b/, stat: 'Crit Dmg%' },
  { pattern: /\b30\b/, stat: 'Speed' },
  { pattern: /\b32\b/, stat: 'Speed' },
];

function normalizeText(text) {
  let next = (text ?? '')
    .replace(/[|]/g, 'I')
    .replace(/[§$]/g, 'S')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/([A-Za-z])0\/0/g, '$1o/o')
    .replace(/(\d)\s*o\/o/gi, '$1%')
    .replace(/(\d)\s*°\/°/gi, '$1%')
    .replace(/(\d)\s*%o/gi, '$1%')
    .replace(/([A-Za-z])\s*%/g, '$1%')
    .replace(/\+\s+/g, '+')
    .replace(/\s+/g, ' ')
    .trim();

  OCR_NOISE_PATTERNS.forEach(pattern => {
    next = next.replace(pattern, ' ');
  });

  const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const buildAliasPattern = from => {
    const start = /\w/.test(from[0]) ? '\\b' : '';
    const end = /\w/.test(from[from.length - 1]) ? '\\b' : '';
    return new RegExp(`${start}${escapeRegExp(from)}${end}`, 'gi');
  };

  SET_ALIASES.forEach(([from, to]) => {
    next = next.replace(buildAliasPattern(from), to);
  });

  STAT_ALIASES.forEach(([from, to]) => {
    next = next.replace(buildAliasPattern(from), to);
  });

  next = next
    .replace(/%%+/g, '%')
    .replace(/\bCrit Damage%\b/gi, 'Crit Dmg%')
    .replace(/\bCrit Damage\b/gi, 'Crit Dmg%')
    .replace(/\bCrit Chance\b(?!%)/gi, 'Crit Chance%')
    .replace(/\bCrit Avoidance\b(?!%)/gi, 'Crit Avoidance%')
    .replace(/\bPotency\b(?!%)/gi, 'Potency%')
    .replace(/\bTenacity\b(?!%)/gi, 'Tenacity%')
    .replace(/\bAccuracy\b(?!%)/gi, 'Accuracy%')
    .replace(/\btency\b/gi, 'Potency%')
    .replace(/\bspe\b/gi, 'Speed')
    .replace(/\b11\.75%\s*dee\b/gi, '11.75% Defense%')
    .replace(/\b11\.75%\s*de[fpl\.,]*\b/gi, '11.75% Defense%')
    .replace(/\b\d+(?:\.\d+)?%\s*dee\b/gi, match => match.replace(/dee/i, 'Defense%'))
    .replace(/\b\d+(?:\.\d+)?%\s*def\b/gi, match => match.replace(/def/i, 'Defense%'))
    .replace(/\b\d+(?:\.\d+)?%\s*de[fpl\.,]*\b/gi, match => match.replace(/de[fpl\.,]*/i, 'Defense%'))
    .replace(/\(\s*(\d+)\s*\)\s*/g, '($1) ');

  return next;
}

function findMatch(sourceText, choices) {
  const lower = sourceText.toLowerCase();
  return choices.find(choice => lower.includes(choice.toLowerCase())) ?? null;
}

function canonicalizeStat(stat) {
  if (!stat) return null;
  const normalized = normalizeText(stat);
  return SEC_STATS.find(choice => choice.toLowerCase() === normalized.toLowerCase())
    ?? PRIMARY_STATS.find(choice => choice.toLowerCase() === normalized.toLowerCase())
    ?? null;
}

function buildSearchLines(ocr) {
  const rawLines = Array.isArray(ocr?.lines) ? ocr.lines.map(line => line?.text ?? '') : [];
  const normalized = rawLines
    .map(line => normalizeText(line))
    .flatMap(line => line.split(/ (?=\+\d)|(?<=\d%?) (?=\(\d+\))/))
    .map(line => line.trim())
    .filter(Boolean);

  if (normalized.length) return normalized;
  return normalizeText(ocr?.text ?? '')
    .split(/[\n\r]+| (?=\+\d)/)
    .map(line => line.trim())
    .filter(Boolean);
}

function findLineIndex(lines, matcher) {
  return lines.findIndex(line => matcher(line.toLowerCase()));
}

function normalizeStatLabel(stat) {
  if (!stat) return null;
  return canonicalizeStat(
    String(stat)
      .replace(/\s+/g, ' ')
      .replace(/\bCrit Chance\b/i, 'Crit Chance%')
      .replace(/\bCrit Dmg\b/i, 'Crit Dmg%')
      .replace(/\bCrit Avoidance\b/i, 'Crit Avoidance%')
      .replace(/\bPotency\b(?!%)/i, 'Potency%')
      .replace(/\bTenacity\b(?!%)/i, 'Tenacity%')
      .replace(/\bAccuracy\b(?!%)/i, 'Accuracy%')
      .trim()
  );
}

function extractPrimary(lines, fullText) {
  const secondaryIndex = findLineIndex(lines, lower => lower.includes('secondary stat'));
  const preSecondaryLines = (secondaryIndex === -1 ? lines : lines.slice(0, secondaryIndex))
    .filter(Boolean);

  const upgradeToPercent = (candidate, value) => {
    if (!candidate || !value) return candidate;
    if (!String(value).includes('%')) return candidate;
    const pct = `${candidate}%`;
    return PRIMARY_STATS.includes(pct) ? pct : candidate;
  };

  for (const line of preSecondaryLines) {
    const stat = findMatch(line, PRIMARY_STATS);
    if (stat) return stat;

    const trailingMatch = line.match(/([+-]?\d+(?:\.\d+)?%?)\s+([A-Za-z ]+)/);
    if (trailingMatch) {
      const candidate = upgradeToPercent(normalizeStatLabel(trailingMatch[2]), trailingMatch[1]);
      if (candidate && PRIMARY_STATS.includes(candidate)) return candidate;
    }

    if (/\b\d+(?:\.\d+)?%\s*d(?:e|ef|eef)/i.test(line)) {
      return 'Defense%';
    }
  }

  const primaryIndex = findLineIndex(lines, lower => lower.includes('primary stat') || lower.includes('primary'));
  if (primaryIndex !== -1) {
    const nearby = lines.slice(primaryIndex, primaryIndex + 4);
    for (const line of nearby) {
      const stat = findMatch(line, PRIMARY_STATS);
      if (stat) return stat;
      const trailingMatch = line.match(/([+-]?\d+(?:\.\d+)?%?)\s+([A-Za-z ]+)/);
      if (trailingMatch) {
        const candidate = upgradeToPercent(normalizeStatLabel(trailingMatch[2]), trailingMatch[1]);
        if (candidate && PRIMARY_STATS.includes(candidate)) return candidate;
      }
      if (/\b\d+(?:\.\d+)?%\s*d(?:e|ef|eef)/i.test(line)) {
        return 'Defense%';
      }
    }
  }

  const statValueLine = lines.find(line => /[+-]?\d+(?:\.\d+)?%?\s+[A-Za-z]/.test(line));
  if (statValueLine) {
    const match = statValueLine.match(/([+-]?\d+(?:\.\d+)?%?)\s+([A-Za-z ]+)/);
    if (match) {
      const candidate = upgradeToPercent(normalizeStatLabel(match[2]), match[1]);
      if (candidate && PRIMARY_STATS.includes(candidate)) return candidate;
    }
    if (/\b\d+(?:\.\d+)?%\s*d(?:e|ef|eef)/i.test(statValueLine)) {
      return 'Defense%';
    }
  }

  const preSecondaryText = secondaryIndex === -1
    ? fullText
    : preSecondaryLines.join(' ');
  if (preSecondaryText) {
    const preSecondaryStat = findMatch(preSecondaryText, PRIMARY_STATS);
    if (preSecondaryStat) return preSecondaryStat;
    if (/\b\d+(?:\.\d+)?%\s*d(?:e|ef|eef)/i.test(preSecondaryText)) {
      return 'Defense%';
    }
    const hinted = PRIMARY_VALUE_HINTS.find(item => item.pattern.test(preSecondaryText));
    if (hinted) return hinted.stat;
  }

  const hinted = PRIMARY_VALUE_HINTS.find(item => item.pattern.test(fullText));
  if (hinted) return hinted.stat;

  return 'Not found';
}

function inferShapeFromPrimary(primary, fullText = '') {
  if (primary === 'Speed' || primary === 'Accuracy%' || primary === 'Crit Avoidance%') return 'Arrow';
  if (primary === 'Defense%') {
    const match = fullText.match(/(\d+(?:\.\d+)?)%\s*defense/i);
    if (match && parseFloat(match[1]) >= 15) return 'Diamond';
  }
  return null;
}

function parseTopMatches(matchLines = []) {
  return matchLines
    .map(line => {
      const match = String(line).match(/^\s*([^:]+):\s*([0-9.]+)/);
      if (!match) return null;
      return {
        name: match[1].trim(),
        score: Number(match[2]),
      };
    })
    .filter(Boolean);
}

function pickRankedMatch(matches, {
  minimumScore = 0.16,
  minimumMargin = 0.015,
  strongScore = 0.24,
} = {}) {
  const bestMatch = matches[0];
  if (!bestMatch) return null;

  const secondScore = matches[1]?.score ?? 0;
  const margin = bestMatch.score - secondScore;
  if (bestMatch.score >= strongScore) return bestMatch.name;
  if (bestMatch.score >= minimumScore && margin >= minimumMargin) return bestMatch.name;
  return null;
}

function isUniquePrimary(primary) {
  if (!primary || primary === 'Not found') return false;
  const matches = SHAPES.filter(shape => shapeSupportsPrimary(shape, primary));
  return matches.length === 1;
}

function shapeSupportsPrimary(shape, primary) {
  if (!shape || !primary || shape === 'Not found' || primary === 'Not found') return false;
  return Array.isArray(SHAPE_PRIMARIES[shape]) && SHAPE_PRIMARIES[shape].includes(primary);
}

function chooseShape(detectedShape, inferredShape, primary, topShapeMatches = []) {
  if (inferredShape && shapeSupportsPrimary(inferredShape, primary)) {
    return inferredShape;
  }

  const parsedMatches = parseTopMatches(topShapeMatches);
  const supportedMatches = primary && primary !== 'Not found'
    ? parsedMatches.filter(match => shapeSupportsPrimary(match.name, primary))
    : parsedMatches;
  const rankedSupportedShape = pickRankedMatch(
    supportedMatches,
    isUniquePrimary(primary)
      ? { minimumScore: 0.14, minimumMargin: 0.008, strongScore: 0.20 }
      : { minimumScore: 0.18, minimumMargin: 0.012, strongScore: 0.26 },
  );

  if (rankedSupportedShape) {
    return rankedSupportedShape;
  }
  if (isUniquePrimary(primary) && shapeSupportsPrimary(detectedShape, primary)) return detectedShape;
  if (shapeSupportsPrimary(inferredShape, primary)) return inferredShape;
  if (shapeSupportsPrimary(detectedShape, primary)) return detectedShape;
  return 'Not found';
}

function chooseSet(detectedSet, ocrSet, topSetMatches = []) {
  const parsedMatches = parseTopMatches(topSetMatches)
    .filter(match => MOD_SETS.includes(match.name));
  const rankedSet = pickRankedMatch(parsedMatches, {
    minimumScore: 0.13,
    minimumMargin: 0.01,
    strongScore: 0.18,
  });

  if (detectedSet && detectedSet !== 'Not found') return detectedSet;
  if (rankedSet) return rankedSet;
  if (ocrSet && ocrSet !== 'Not found') return ocrSet;
  return 'Not found';
}

function extractSecondaries(lines, primary, fullText = '') {
  const found = [];
  const seen = new Set();
  const primaryKey = primary?.toLowerCase?.() ?? '';
  const secondaryIndex = findLineIndex(lines, lower => lower.includes('secondary stat'));
  const candidateLines = secondaryIndex === -1 ? lines : lines.slice(secondaryIndex + 1, secondaryIndex + 8);

  candidateLines.forEach(line => {
    const lower = line.toLowerCase();
    if (lower.includes('primary')) return;
    if (lower.includes('set bonus')) return;
    if (lower.includes('secondary stat')) return;
    if (lower.includes('slice mod')) return;
    if (lower.includes('mod is at max level')) return;

    // Hidden-secondary marker. OCR frequently mangles "lvl" → "Ivl" / "1vl"
    // and may drop punctuation, so we only require the word "revea" plus a
    // plausible reveal level (1–15) anywhere on the line.
    if (/revea/i.test(line)) {
      const digitMatch = line.match(/\b(\d{1,2})\b/);
      const revealLevel = digitMatch ? Number(digitMatch[1]) : null;
      const validLevel = revealLevel !== null && revealLevel >= 1 && revealLevel <= 15;
      const hiddenKey = `__hidden_${validLevel ? revealLevel : 'x'}_${found.length}`;
      if (!seen.has(hiddenKey)) {
        seen.add(hiddenKey);
        found.push({
          stat: 'Hidden',
          value: null,
          raw: line,
          hidden: true,
          revealLevel: validLevel ? revealLevel : null,
        });
      }
      return;
    }

    const lineMatches = [];
    const statFirstPattern = /(Speed|Offense%|Offense|Health%|Health|Protection%|Protection|Defense%|Defense|Crit Chance%|Crit Dmg%|Crit Avoidance%|Potency%|Tenacity%|Accuracy%)\s*([+-]?\d+(?:\.\d+)?%?)/gi;
    const valueFirstPattern = /(?:\(\d+\)\s*)?([+-]?\d+(?:\.\d+)?%?)\s*(Speed|Offense%|Offense|Health%|Health|Protection%|Protection|Defense%|Defense|Crit Chance%|Crit Dmg%|Crit Avoidance%|Potency%|Tenacity%|Accuracy%)/gi;
    const rollFirstPattern = /\((\d+)\)\s*([+-]?\d+(?:\.\d+)?%?)\s+([A-Za-z %\.]+)/gi;

    let match;
    while ((match = statFirstPattern.exec(line)) !== null) {
      lineMatches.push({ stat: canonicalizeStat(match[1]), value: match[2] });
    }
    while ((match = valueFirstPattern.exec(line)) !== null) {
      lineMatches.push({ stat: canonicalizeStat(match[2]), value: match[1] });
    }
    while ((match = rollFirstPattern.exec(line)) !== null) {
      lineMatches.push({ stat: normalizeStatLabel(match[3]), value: match[2], rolls: Number(match[1]) });
    }

    if (!lineMatches.length) {
      const stat = findMatch(line, SEC_STATS) || findMatch(line, PRIMARY_STATS);
      const valueMatch = line.match(/([+-]?\d+(?:\.\d+)?%?)/);
      if (stat && valueMatch) {
        lineMatches.push({ stat: canonicalizeStat(stat), value: valueMatch[1] });
      }
    }

    if (!lineMatches.length) {
      const compact = normalizeText(line).replace(/[^\w()%.\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const fallback = compact.match(/\((\d+)\)\s*([+-]?\d+(?:\.\d+)?%?)\s+([A-Za-z %]+)/i);
      if (fallback) {
        lineMatches.push({
          stat: normalizeStatLabel(fallback[3]),
          value: fallback[2],
          rolls: Number(fallback[1]),
        });
      }
    }

    lineMatches.forEach(({ stat, value }) => {
      if (!stat || !value || seen.has(stat)) return;
      if (stat.toLowerCase() === primaryKey) return;

      seen.add(stat);
      found.push({
        stat,
        value,
        raw: line,
        rolls: Number.isFinite(lineMatches.find(item => item.stat === stat)?.rolls)
          ? lineMatches.find(item => item.stat === stat)?.rolls
          : undefined,
      });
    });
  });

  if (found.length < 2 && fullText) {
    const regex = /\((\d+)\)\s*([+-]?\d+(?:\.\d+)?%?)\s+([A-Za-z %]+)/gi;
    let match;
    while ((match = regex.exec(fullText)) !== null) {
      const stat = normalizeStatLabel(match[3]);
      const value = match[2];
      if (!stat || !value || seen.has(stat)) continue;
      if (stat.toLowerCase() === primaryKey) continue;
      seen.add(stat);
      found.push({
        stat,
        value,
        raw: match[0],
        rolls: Number(match[1]),
      });
      if (found.length >= 4) break;
    }
  }

  // Scan fullText for any reveal markers we might have missed when lines
  // were split oddly. OCR often breaks "Reveals at lvl. 3/6/9" across lines.
  const alreadyHidden = found.filter(f => f.hidden).length;
  if (found.length < 4 && fullText) {
    const hiddenRegex = /revea\w*[^\n\r]{0,30}?(\d{1,2})/gi;
    let rm;
    const seenLevels = new Set(found.filter(f => f.hidden).map(f => f.revealLevel));
    while ((rm = hiddenRegex.exec(fullText)) !== null) {
      const lvl = Number(rm[1]);
      if (!lvl || lvl < 1 || lvl > 15) continue;
      if (seenLevels.has(lvl)) continue;
      seenLevels.add(lvl);
      found.push({
        stat: 'Hidden',
        value: null,
        raw: rm[0],
        hidden: true,
        revealLevel: lvl,
      });
      if (found.length >= 4) break;
    }
  }

  return found.slice(0, 4);
}

function summarizeParserState({ modSet, modShape, primary, secondaries }) {
  const foundCount = [modSet, modShape, primary].filter(value => value && value !== 'Not found').length + secondaries.length;
  if (foundCount >= 6) return 'OCR complete. Mod details look ready to use in Finder or Slicer.';
  if (foundCount >= 4) return 'OCR complete. Most mod details were found, but give them a quick glance before using.';
  return 'OCR complete. Some fields still need parser refinement.';
}

function buildAnalysisResult({
  imagePath = '',
  ocrText = '',
  ocrLines = [],
  detectedShape = '',
  detectedSet = '',
  topShapeMatches = [],
  topSetMatches = [],
}) {
  if (!ocrText) {
    return {
      ok: false,
      summary: imagePath
        ? 'Screenshot received, but OCR text was not available yet.'
        : 'Capture received, but OCR text was not available yet.',
      imagePath,
      fields: {
        modSet: 'Pending OCR',
        modShape: 'Pending OCR',
        primary: 'Pending OCR',
        secondaries: ['Pending OCR'],
      },
      rawText: '',
      lines: [],
    };
  }

  const normalizedLines = buildSearchLines({
    text: ocrText,
    lines: Array.isArray(ocrLines) ? ocrLines.map(text => ({ text })) : [],
  });
  const fullText = normalizeText(ocrText ?? '');
  const ocrSet = findMatch(fullText, MOD_SETS) || 'Not found';
  const parsedSet = chooseSet(detectedSet, ocrSet, topSetMatches);
  const detectedPrimary = extractPrimary(normalizedLines, fullText);
  const inferredShape = inferShapeFromPrimary(detectedPrimary, fullText);
  const ocrShape = findMatch(fullText, SHAPES) || 'Not found';
  const parsedShape = chooseShape(detectedShape || ocrShape, inferredShape, detectedPrimary, topShapeMatches);
  const secondaries = extractSecondaries(normalizedLines, detectedPrimary, fullText);
  const summary = summarizeParserState({
    modSet: parsedSet,
    modShape: parsedShape,
    primary: detectedPrimary,
    secondaries,
  });

  return {
    ok: true,
    summary,
    imagePath,
    fields: {
      modSet: parsedSet,
      modShape: parsedShape,
      primary: detectedPrimary,
      secondaries: secondaries.length ? secondaries.map(item => `${item.stat} ${item.value}`) : ['Not found'],
    },
    rawText: fullText,
    lines: normalizedLines.map(text => ({ text })),
    parsed: {
      modSet: parsedSet,
      modShape: parsedShape,
      primary: detectedPrimary,
      secondaries,
    },
  };
}

export async function analyzeCapturedMod(input) {
  if (!input) {
    return {
      ok: false,
      summary: 'No captured screenshot is available yet.',
      imagePath: '',
      fields: null,
    };
  }

  if (typeof input === 'object' && (input.ocrText || input.rawText)) {
    return buildAnalysisResult({
      imagePath: input.path || input.imagePath || '',
      ocrText: input.ocrText || input.rawText || '',
      ocrLines: Array.isArray(input.ocrLines) ? input.ocrLines : [],
      detectedShape: input.detectedShape || '',
      detectedSet: input.detectedSet || '',
      topShapeMatches: Array.isArray(input.topShapeMatches) ? input.topShapeMatches : [],
      topSetMatches: Array.isArray(input.topSetMatches) ? input.topSetMatches : [],
    });
  }

  const imagePath = input;
  const ocr = await analyzeCapturedImage(imagePath);
  return buildAnalysisResult({
    imagePath,
    ocrText: ocr?.text ?? '',
    ocrLines: Array.isArray(ocr?.lines) ? ocr.lines.map(line => line?.text ?? '') : [],
  });
}
