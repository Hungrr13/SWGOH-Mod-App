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

// Log-style noise that leaks into OCR. Keep "PRIMARY STAT" / "SECONDARY STATS"
// intact — the section headers from the actual mod card are landmarks that
// extractPrimary/extractSecondaries depend on to segment the input. Earlier
// broader \bprim\w*\b / \bseco\w*\b patterns were stripping those headers,
// which caused extractSecondaries to fall through to "scan every line" and
// mis-ingest the primary as a secondary.
const OCR_NOISE_PATTERNS = [
  /scanning mod\.\.\./gi,
  /reading the visible primary and secondary stats\.?/gi,
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

function inferShapeFromPrimary(primary) {
  // Primary stat values are determined by dot-tier, not slot — so values alone
  // can't distinguish between Arrow/Triangle/Cross/Diamond for shared primaries
  // like Defense%. Only Speed/Accuracy/Crit Avoidance are shape-unique (Arrow).
  // Everything else relies on the primary-shape compat filter in chooseShape
  // plus the icon classifier's ranked candidates.
  if (primary === 'Speed' || primary === 'Accuracy%' || primary === 'Crit Avoidance%') return 'Arrow';
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
  if (primary === 'Speed') return 'Arrow';

  // Primary-shape compatibility guard. When the OCR'd primary is only valid
  // on specific shapes, reject candidates that don't allow it.
  const allowedShapes = primary
    ? Object.entries(SHAPE_PRIMARIES)
        .filter(([, primaries]) => primaries.includes(primary))
        .map(([shape]) => shape)
    : null;
  const shapeOk = s => !allowedShapes || allowedShapes.length === 0 || allowedShapes.includes(s);

  const parsedMatches = parseTopMatches(topShapeMatches);
  const rankedShape = pickRankedMatch(parsedMatches, {
    minimumScore: 0.16,
    minimumMargin: 0.012,
    strongScore: 0.24,
  });
  if (rankedShape && shapeOk(rankedShape)) return rankedShape;

  // Classifier's top pick violated the primary constraint. Walk the ranked
  // candidates and take the best compatible one.
  if (allowedShapes && allowedShapes.length && parsedMatches.length) {
    const compatible = parsedMatches.find(m => allowedShapes.includes(m.name));
    if (compatible) return compatible.name;
  }

  if (detectedShape && detectedShape !== 'Not found' && shapeOk(detectedShape)) return detectedShape;

  // Primary allows only one shape (Square/Diamond), pick it.
  if (allowedShapes && allowedShapes.length === 1) return allowedShapes[0];

  if (detectedShape && detectedShape !== 'Not found') return detectedShape;
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

// Returns true when a parsed secondary (stat + value pair) should be
// interpreted as the % variant of the stat rather than its flat variant.
// Used both by the dedup key in extractSecondaries (so flat + % variants
// of the same base stat can coexist) and by the later promotion pass
// (which rewrites item.stat + item.value). Single source of truth.
const FLAT_MIN_PER_ROLL = { Offense: 22, Health: 200, Protection: 400 };
function willPromoteToPercent(stat, value) {
  if (!(stat in FLAT_MIN_PER_ROLL) && stat !== 'Defense') return false;
  const raw = String(value || '');
  if (raw.includes('%')) return true;
  const hasDecimal = raw.includes('.');
  const num = parseFloat(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(num)) return false;
  const flatMin = FLAT_MIN_PER_ROLL[stat];
  return hasDecimal
    || (flatMin != null && num < flatMin)
    || (stat === 'Defense' && num < 5);
}

function extractSecondaries(lines, primary, fullText = '') {
  const found = [];
  const seen = new Set();
  const primaryKey = primary?.toLowerCase?.() ?? '';
  const secondaryIndex = findLineIndex(lines, lower => lower.includes('secondary stat'));
  const candidateLines = secondaryIndex === -1 ? lines : lines.slice(secondaryIndex + 1, secondaryIndex + 8);

  candidateLines.forEach(rawLine => {
    // OCR frequently swaps a leading "0" (zero) for "O" inside stat names
    // — e.g. "(1) 27 0ffense" for Offense. Patch the two common cases
    // (0ffense, 0ffense%) so the regex alternations below can match.
    // Scoped to zeros that sit at a word boundary followed by letters, so
    // leading digits in values like "27" or "(1)" stay untouched.
    const line = String(rawLine || '').replace(/(^|\s|\()0(?=[A-Za-z])/g, '$1O');
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
      if (!stat || !value) return;

      // Dedup key accounts for the flat-to-% promotion that runs later.
      // Without this, a flat "Health 592" line consumes the "Health" slot
      // in `seen` and the next line's "1.04% Health" (which would promote
      // to Health%) gets dropped as a duplicate. Keying by the future
      // canonical name lets both variants coexist.
      const canonStat = willPromoteToPercent(stat, value) ? `${stat}%` : stat;
      if (seen.has(canonStat)) return;
      if (canonStat.toLowerCase() === primaryKey) return;

      // Prefer the entry that carries an explicit roll count — the three
      // patterns above can all match the same line, and valueFirstPattern
      // fires without rolls. Without this preference we'd drop the "(2)"
      // OCR'd from the card and force estimateRolls to guess later.
      const withRolls = lineMatches.find(
        item => item.stat === stat && Number.isFinite(item.rolls),
      );
      seen.add(canonStat);
      found.push({
        stat,
        value,
        raw: line,
        rolls: withRolls ? withRolls.rolls : undefined,
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

  // OCR often drops the trailing "%" on percentage secondaries, so a value
  // like "+1.25% Offense" comes through as "+1.25 Offense" and gets routed
  // to the flat stat. Promote back to the % variant when willPromoteToPercent
  // says the value is too small / decimal / explicitly %-suffixed.
  found.forEach(item => {
    if (item.hidden || !item.stat || !item.value) return;
    if (!willPromoteToPercent(item.stat, item.value)) return;
    const raw = String(item.value);
    item.stat = `${item.stat}%`;
    if (!raw.includes('%')) item.value = `${raw}%`;
  });

  // Drop anything that now matches the primary stat. The earlier primaryKey
  // check ran before the flat-to-% promotion, so a line like "5.88% Health"
  // on a Health%-primary mod could still sneak in as flat "Health" and then
  // get promoted to "Health%" after deduping — colliding with the primary
  // and pushing a real secondary past the 4-item cap.
  const primaryCanon = primary?.toLowerCase?.() ?? '';
  const filtered = primaryCanon
    ? found.filter(item => !item.stat || item.stat.toLowerCase() !== primaryCanon)
    : found;

  return filtered.slice(0, 4);
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
  const inferredShape = inferShapeFromPrimary(detectedPrimary);
  const ocrShape = findMatch(fullText, SHAPES) || 'Not found';
  const parsedShape = chooseShape(detectedShape || ocrShape, inferredShape, detectedPrimary, topShapeMatches);
  const secondaries = extractSecondaries(normalizedLines, detectedPrimary, fullText);
  const modLevel = extractModLevel(fullText);
  const modTier = extractModTier(fullText, normalizedLines);
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
      modLevel,
      modTier,
    },
  };
}

// In-game the tier letter (E/D/C/B/A) shows next to the mod icon as a
// compact "15 - A" or "15 A" badge (no LVL/LEVEL prefix), and also in
// some layouts alongside a LVL banner ("LVL 15 · C"). OCR output is noisy
// so we try specific patterns first and fall back to per-line matching.
// Returns '5E'..'5A' or null. 6E needs pip-count context we don't extract
// yet, so this always maps to the 5-dot tier — user taps 6E manually.
function extractModTier(text, lines) {
  if (!text) return null;
  // Standalone tier letter above the "PRIMARY STAT" header. The mod card's
  // tier frame OCRs as a bare A-E on its own line — no digit, no banner —
  // so none of the level/badge patterns fire. Scoping to lines before the
  // primary-stat landmark keeps this from false-matching on stat letters
  // that appear later in the card.
  if (Array.isArray(lines)) {
    // Tier frame OCRs as a bare A-E letter before the stat section starts.
    // Prefer searching everything up to "SECONDARY STATS" so a primary stat
    // that happens to render above the tier (rare, but seen on some icon
    // layouts) doesn't block detection.
    const secIdx = lines.findIndex(l => /secondary\s*stat/i.test(String(l || '')));
    const scanLimit = secIdx > 0 ? secIdx : lines.length;
    for (let i = 0; i < scanLimit; i++) {
      const trimmed = String(lines[i] || '').trim();
      const solo = trimmed.match(/^([A-E])$/);
      if (solo) return `5${solo[1].toUpperCase()}`;
    }
  }
  // Explicit "Tier X" label
  const tierTag = text.match(/\btier\s*([A-E])\b/i);
  if (tierTag) return `5${tierTag[1].toUpperCase()}`;
  // "LVL 15 - C" / "Level 15 A" — level banner with letter
  const lvlMatch = text.match(
    /\b(?:level|lvl|l[vil]{1,2})\s*\.?\s*(\d{1,2})\s*[-–—·:.\s]+\s*([A-E])\b/i,
  );
  if (lvlMatch) {
    const n = Number(lvlMatch[1]);
    if (n >= 1 && n <= 15) return `5${lvlMatch[2].toUpperCase()}`;
  }
  // Compact "15 - A" / "15-A" / "15A" badge. This is the common layout next
  // to the mod icon, where the level and tier appear together without any
  // "LVL" prefix. Require the digit to be 1-15 (mod level range) to avoid
  // false matches on roll counts or stat values elsewhere in the text.
  if (Array.isArray(lines)) {
    for (const rawLine of lines) {
      const line = String(rawLine || '').trim();
      const badge = line.match(/^\(?(\d{1,2})\s*[-–—]?\s*([A-E])\)?$/i);
      if (badge) {
        const n = Number(badge[1]);
        if (n >= 1 && n <= 15) return `5${badge[2].toUpperCase()}`;
      }
    }
  }
  // Fallback: scan the full text for a short "<1-15> - <A-E>" run.
  const dashMatch = text.match(/(?:^|\s|\n)(\d{1,2})\s*[-–—]\s*([A-E])(?=\s|$|\n)/);
  if (dashMatch) {
    const n = Number(dashMatch[1]);
    if (n >= 1 && n <= 15) return `5${dashMatch[2].toUpperCase()}`;
  }
  // Last resort: OCR sometimes glues the tier letter to the front of the
  // first secondary line, e.g. "C (2) 4.12% Protection". Look for a single
  // A-E letter followed by a "(n)" roll-count on any line.
  if (Array.isArray(lines)) {
    for (const rawLine of lines) {
      const line = String(rawLine || '').trim();
      const stuck = line.match(/^([A-E])\s+\(\d+\)/);
      if (stuck) return `5${stuck[1].toUpperCase()}`;
    }
  }
  return null;
}

// OCR often renders the mod-level banner as "LEVEL 15", "Level 15", or
// "Lvl. 15". Return the first 1–15 integer that follows any of those.
function extractModLevel(text) {
  if (!text) return null;
  const patterns = [
    /\blevel\s*\.?\s*(\d{1,2})\b/i,
    /\blvl\s*\.?\s*(\d{1,2})\b/i,
    /\bl[vil]{1,2}\s*\.?\s*(\d{1,2})\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 15) return n;
    }
  }
  return null;
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
