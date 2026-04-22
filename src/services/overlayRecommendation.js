import { SLICE_REF, decodeModSet, decodePrimary, ROLL_DATA } from '../constants/modData';
import { CHARS as RAW_CHARS } from '../data/chars';
import { CHAR_BASE_IDS } from '../data/charBaseIds';
import { evaluateSliceMod } from './sliceEngine';

// Max rolls a single secondary can have at each tier. In SWGOH each tier
// slice (E→D→C→B→A) adds one random roll to an existing secondary, so
// 5E=1, 5D=2, 5C=3, 5B=4, 5A=5, 6E=5. Ignoring the tier was producing
// impossible values like "Health% at 5 rolls" on a 5C scan.
const MAX_ROLLS_BY_TIER = { '5E': 1, '5D': 2, '5C': 3, '5B': 4, '5A': 5, '6E': 5 };
export function maxRollsForTier(tier) {
  return MAX_ROLLS_BY_TIER[tier] ?? 5;
}

// Estimate a secondary's roll count from its numeric value when the (N)
// prefix was missed by OCR. Returns null when the stat isn't in ROLL_DATA,
// the value can't be parsed, or the value is so far above the stat's max
// possible that the (stat,value) pair is almost certainly an OCR misread
// (e.g. a flat-Defense value of 30 being reported as Health%).
export function estimateRolls(stat, value, dotLevel = 5, tier = null) {
  const data = ROLL_DATA[stat];
  if (!data) return null;
  const v = parseFloat(String(value ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(v) || v <= 0) return null;
  const max = dotLevel === 6 ? data.max6 : data.max5;
  const cap = tier ? maxRollsForTier(tier) : 5;
  // Reject values that exceed the tier's physical ceiling by >2% — this is
  // the OCR-misread guard. A Health% value of 30 cannot be Health% at any
  // roll count, so we prefer no estimate over a confidently wrong one.
  if (v > cap * max * 1.02) return null;
  for (let n = 1; n <= cap; n += 1) {
    if (v <= n * max * 1.02) return n;
  }
  return cap;
}

function resolveRolls(s) {
  const explicit = parseInt(s?.rolls, 10);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return estimateRolls(s?.stat, s?.value);
}

const seen = new Set();
const DECODED_CHARS = RAW_CHARS.filter(c => {
  if (seen.has(c.name)) return false;
  seen.add(c.name);
  return true;
}).map(c => ({
  ...c,
  arrow: decodePrimary(c.arrow),
  triangle: decodePrimary(c.triangle),
  circle: decodePrimary(c.circle),
  cross: decodePrimary(c.cross),
  modSet: decodeModSet(c.modSet),
  buTri: c.buTri ? decodePrimary(c.buTri) : undefined,
  buCir: c.buCir ? decodePrimary(c.buCir) : undefined,
  buCro: c.buCro ? decodePrimary(c.buCro) : undefined,
  buArr: c.buArr ? decodePrimary(c.buArr) : undefined,
  buSet: c.buSet ? decodeModSet(c.buSet) : undefined,
}));

function pickChars(ownedBaseIds) {
  if (!ownedBaseIds) return DECODED_CHARS;
  const set = ownedBaseIds instanceof Set ? ownedBaseIds : new Set(ownedBaseIds);
  if (set.size === 0) return DECODED_CHARS;
  return DECODED_CHARS.filter(c => {
    const id = CHAR_BASE_IDS[c.name];
    return id && set.has(id);
  });
}

const ENGINE_SLICE_REF = SLICE_REF.map(r => ({
  stat: r.s,
  max5: r.m5,
  max6: r.m6,
  good: r.g,
  great: r.gr,
}));

function decisionDefinition(label) {
  if (label === 'PREMIUM SLICE') return 'Top-tier slice target.';
  if (label === 'STRONG SLICE') return 'Very good slice target.';
  if (label === 'SLICE IF NEEDED') return 'Worth slicing when you need this shell.';
  if (label === 'HOLD') return 'Keep it, but save mats for better mods.';
  if (label === 'FILLER ONLY') return 'Usable now, but not worth slicing.';
  return 'Low-value shell or weak stat mix.';
}

function normalizeSecondaries(secondaries = []) {
  return secondaries
    .filter(item => item?.stat && item.stat !== 'Not found')
    .map(item => {
      const numeric = String(item.value ?? '').replace(/[^\d.]/g, '');
      return {
        name: item.stat,
        val: numeric,
      };
    })
    .filter(item => item.name && item.val !== '' && !Number.isNaN(Number(item.val)));
}

export function buildOverlayRecommendation(parsed, options = {}) {
  const rawPreview = String(options.rawText ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  const shape = parsed?.modShape;
  const primary = parsed?.primary;
  const modSet = parsed?.modSet && parsed.modSet !== 'Not found' ? parsed.modSet : '';
  const tier = parsed?.modTier || null;
  const chars = pickChars(options.ownedBaseIds);

  if (!shape || shape === 'Not found' || !primary || primary === 'Not found') {
    return {
      title: 'Capture Needs Review',
      body: 'I could not read enough of the mod cleanly. Open the app to review the capture.',
    };
  }

  const hiddenEntries = (parsed.secondaries || []).filter(s => s?.hidden);
  const visibleWithRolls = (parsed.secondaries || [])
    .filter(s => s && !s.hidden && s.stat && s.stat !== 'Not found')
    .map(s => ({ ...s, _rolls: resolveRolls(s) }))
    .filter(s => Number.isFinite(s._rolls) && s._rolls > 0);
  const allSingleRoll = visibleWithRolls.length >= 1
    && visibleWithRolls.every(s => s._rolls === 1);
  const secondaries = normalizeSecondaries(parsed.secondaries);
  const hiddenLevels = [...new Set(hiddenEntries.map(h => h.revealLevel).filter(Boolean))].sort((a, b) => a - b);
  const hiddenNote = hiddenEntries.length
    ? 'Level this mod to 12 and rescan for slice advice.'
    : null;
  // If the OCR saw a mod level >= 13, the mod has upgrade rolls even if the
  // (N) prefix was missed — don't force a "needs leveling" verdict.
  const modLevel = Number(parsed?.modLevel) || 0;
  const treatAsMaxed = modLevel >= 13;
  const needsLeveling = hiddenEntries.length > 0 || (!treatAsMaxed && allSingleRoll);

  if (needsLeveling) {
    const shellOnly = evaluateSliceMod({
      chars,
      sliceRef: ENGINE_SLICE_REF,
      shape,
      primary,
      modSet,
      secondaries: [],
      tier,
    });
    const likelyUsers = shellOnly.matchedCharacters
      .slice(0, 4)
      .map(item => item.name)
      .join(', ');
    const shell = [modSet || null, shape, primary].filter(Boolean).join(' • ');

    const note = hiddenNote
      || 'Every visible secondary still at (1) — level the mod to 12 and rescan for slice advice.';

    return {
      title: 'Level Mod First',
      body: [
        shell,
        likelyUsers ? `Likely users: ${likelyUsers}` : null,
        note,
        rawPreview ? `Read: ${rawPreview}` : null,
      ].filter(Boolean).join('\n'),
    };
  }

  if (secondaries.length < 2) {
    const shellOnly = evaluateSliceMod({
      chars,
      sliceRef: ENGINE_SLICE_REF,
      shape,
      primary,
      modSet,
      secondaries: [],
      tier,
    });
    const likelyUsers = shellOnly.matchedCharacters
      .slice(0, 4)
      .map(item => item.name)
      .join(', ');
    const shell = [modSet || null, shape, primary].filter(Boolean).join(' • ');

    return {
      title: 'Shell Match Found',
      body: [
        shell,
        likelyUsers ? `Likely users: ${likelyUsers}` : 'No strong shell users found yet.',
        'Need at least 2 clear secondaries for slice value.',
        rawPreview ? `Read: ${rawPreview}` : null,
      ].filter(Boolean).join('\n'),
    };
  }

  const result = evaluateSliceMod({
    chars,
    sliceRef: ENGINE_SLICE_REF,
    shape,
    primary,
    modSet,
    secondaries,
    tier,
  });

  const topNames = result.matchedCharacters
    .slice(0, 3)
    .map(item => item.name)
    .join(', ');

  const shell = [modSet || null, shape, primary]
    .filter(Boolean)
    .join(' • ');

  const plan = result.ladderPlan;
  const title = plan?.label
    ? `${plan.label} · ${result.finalScore}/100`
    : `${result.decision} ${result.finalScore}/100`;
  const verdictLine = plan?.desc || decisionDefinition(result.decision);

  return {
    title,
    body: [
      shell,
      topNames ? `Best: ${topNames}` : null,
      verdictLine,
    ].filter(Boolean).join('\n'),
  };
}

function charLine(match, index, options = {}) {
  const setMatch = match?.fitTier && match.fitTier.includes('MainSet') ? ' • Set Match' : '';
  const altBuild = match?.variant === 'alternate' ? ' (alt)' : '';
  const status = options.modStatusFor && match?.name
    ? options.modStatusFor(match.name)
    : null;
  let badge = '';
  if (status) {
    if (status.owned === false) {
      badge = ' · Not unlocked';
    } else if (status.hasModData && status.slotShape) {
      // Slot-specific: only talk about the slot the scanned mod would fill.
      if (status.slotEmpty) {
        badge = ` · Empty ${status.slotShape}`;
      } else if (status.slotUpgradeable) {
        badge = ` · Upgrade ${status.slotShape}`;
      } else {
        badge = ` · ${status.slotShape} maxed`;
      }
    } else if (status.owned === true) {
      badge = ' · Owned';
    }
  }
  return `${index + 1}. ${match.name}${altBuild}${setMatch}${badge}`;
}

export function buildOverlayRecommendations(parsed, options = {}) {
  const shape = parsed?.modShape;
  const primary = parsed?.primary;
  const modSet = parsed?.modSet && parsed.modSet !== 'Not found' ? parsed.modSet : '';
  const tier = parsed?.modTier || null;
  const chars = pickChars(options.ownedBaseIds);

  if (!shape || shape === 'Not found' || !primary || primary === 'Not found') {
    return {
      slice: {
        title: 'Capture Needs Review',
        body: 'Shape or primary did not read cleanly. Open the app to review.',
      },
      characters: {
        title: 'No Match',
        body: 'Rescan or enter manually.',
      },
    };
  }

  const hiddenEntries = (parsed.secondaries || []).filter(s => s?.hidden);
  const secondaries = normalizeSecondaries(parsed.secondaries);
  const shell = `Set: ${modSet || 'Unknown'} • Shape: ${shape} • Primary Stat: ${primary}`;
  const result = evaluateSliceMod({
    chars,
    sliceRef: ENGINE_SLICE_REF,
    shape,
    primary,
    modSet,
    secondaries,
    tier,
  });

  const topMatches = result.matchedCharacters.slice(0, 20);
  const noUsers = topMatches.length === 0;
  const hasHidden = hiddenEntries.length > 0;
  const visibleWithRollsDual = (parsed.secondaries || [])
    .filter(s => s && !s.hidden && s.stat && s.stat !== 'Not found')
    .map(s => ({ ...s, _rolls: resolveRolls(s) }))
    .filter(s => Number.isFinite(s._rolls) && s._rolls > 0);
  const allSingleRollDual = visibleWithRollsDual.length >= 1
    && visibleWithRollsDual.every(s => s._rolls === 1);
  const modLevelDual = Number(parsed?.modLevel) || 0;
  const treatAsMaxedDual = modLevelDual >= 13;
  const needsLevel = hasHidden || (!treatAsMaxedDual && allSingleRollDual);
  const levelBody = hasHidden
    ? 'Level this mod to 12 and rescan for slice advice.'
    : 'Every visible secondary still at (1) — level the mod to 12 and rescan for slice advice.';

  const plan = result.ladderPlan;
  const sliceTitle = noUsers
    ? 'SELL'
    : needsLevel
      ? 'Level Mod First'
      : secondaries.length < 2
        ? 'Shell Match'
        : plan?.label
          ? `${plan.label} · ${result.finalScore}/100`
          : `${result.decision} ${result.finalScore}/100`;
  const sliceBody = noUsers
    ? [shell, 'No characters want this shell.'].filter(Boolean).join('\n')
    : needsLevel
      ? [shell, levelBody].filter(Boolean).join('\n')
      : secondaries.length < 2
        ? [shell, 'Need 2+ clear secondaries for slice value.'].filter(Boolean).join('\n')
        : [
            shell,
            plan?.desc || decisionDefinition(result.decision),
          ].filter(Boolean).join('\n');

  const charBody = topMatches.length
    ? topMatches.map((m, i) => charLine(m, i, { modStatusFor: options.modStatusFor })).join('\n')
    : 'Sell — no users.';
  const charTitle = topMatches.length
    ? `Top ${Math.min(topMatches.length, 20)} Users`
    : 'SELL';

  return {
    slice: { title: sliceTitle, body: sliceBody },
    characters: { title: charTitle, body: charBody },
  };
}
