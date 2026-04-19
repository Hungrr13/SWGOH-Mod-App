import { SLICE_REF, decodeModSet, decodePrimary } from '../constants/modData';
import { CHARS as RAW_CHARS } from '../data/chars';
import { evaluateSliceMod } from './sliceEngine';

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

  if (!shape || shape === 'Not found' || !primary || primary === 'Not found') {
    return {
      title: 'Capture Needs Review',
      body: 'I could not read enough of the mod cleanly. Open the app to review the capture.',
    };
  }

  const hiddenEntries = (parsed.secondaries || []).filter(s => s?.hidden);
  const secondaries = normalizeSecondaries(parsed.secondaries);
  const hiddenLevels = [...new Set(hiddenEntries.map(h => h.revealLevel).filter(Boolean))].sort((a, b) => a - b);
  const hiddenNote = hiddenEntries.length
    ? `Level this mod to 12 and rescan for slice advice.${hiddenLevels.length ? ` (${hiddenEntries.length} hidden secondary reveals at lvl ${hiddenLevels.join('/')}.)` : ''}`
    : null;

  if (hiddenEntries.length) {
    const shellOnly = evaluateSliceMod({
      chars: DECODED_CHARS,
      sliceRef: ENGINE_SLICE_REF,
      shape,
      primary,
      modSet,
      secondaries: [],
    });
    const likelyUsers = shellOnly.matchedCharacters
      .slice(0, 4)
      .map(item => item.name)
      .join(', ');
    const shell = [modSet || null, shape, primary].filter(Boolean).join(' • ');

    return {
      title: 'Level Mod First',
      body: [
        shell,
        likelyUsers ? `Likely users: ${likelyUsers}` : null,
        hiddenNote,
        rawPreview ? `Read: ${rawPreview}` : null,
      ].filter(Boolean).join('\n'),
    };
  }

  if (secondaries.length < 2) {
    const shellOnly = evaluateSliceMod({
      chars: DECODED_CHARS,
      sliceRef: ENGINE_SLICE_REF,
      shape,
      primary,
      modSet,
      secondaries: [],
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
    chars: DECODED_CHARS,
    sliceRef: ENGINE_SLICE_REF,
    shape,
    primary,
    modSet,
    secondaries,
  });

  const topNames = result.matchedCharacters
    .slice(0, 3)
    .map(item => item.name)
    .join(', ');

  const shell = [modSet || null, shape, primary]
    .filter(Boolean)
    .join(' • ');

  return {
    title: `${result.decision} ${result.finalScore}/100`,
    body: [
      shell,
      topNames ? `Best: ${topNames}` : null,
      decisionDefinition(result.decision),
    ].filter(Boolean).join('\n'),
  };
}

function charLine(match, index) {
  const setMatch = match?.fitTier && match.fitTier.includes('MainSet') ? ' • Set Match' : '';
  return `${index + 1}. ${match.name}${setMatch}`;
}

export function buildOverlayRecommendations(parsed, options = {}) {
  const shape = parsed?.modShape;
  const primary = parsed?.primary;
  const modSet = parsed?.modSet && parsed.modSet !== 'Not found' ? parsed.modSet : '';

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
    chars: DECODED_CHARS,
    sliceRef: ENGINE_SLICE_REF,
    shape,
    primary,
    modSet,
    secondaries,
  });

  const topMatches = result.matchedCharacters.slice(0, 6);
  const noUsers = topMatches.length === 0;
  const hasHidden = hiddenEntries.length > 0;
  const maxReveal = hasHidden ? Math.max(...hiddenEntries.map(h => h.revealLevel || 12)) : 12;

  const sliceTitle = noUsers
    ? 'SELL'
    : hasHidden
      ? 'Level Mod First'
      : secondaries.length < 2
        ? 'Shell Match'
        : `${result.decision} ${result.finalScore}/100`;
  const sliceBody = noUsers
    ? [shell, 'No characters want this shell.'].filter(Boolean).join('\n')
    : hasHidden
      ? [shell, `Level this mod to 12 and rescan for slice advice. (${hiddenEntries.length} secondary${hiddenEntries.length > 1 ? ' stats reveal' : ' reveals'} at lvl ${[...new Set(hiddenEntries.map(h => h.revealLevel).filter(Boolean))].sort((a,b)=>a-b).join('/')}.)`].filter(Boolean).join('\n')
      : secondaries.length < 2
        ? [shell, 'Need 2+ clear secondaries for slice value.'].filter(Boolean).join('\n')
        : [
            shell,
            decisionDefinition(result.decision),
          ].filter(Boolean).join('\n');

  const charBody = topMatches.length
    ? topMatches.map((m, i) => charLine(m, i)).join('\n')
    : 'Sell — no users.';
  const charTitle = topMatches.length
    ? `Top ${Math.min(topMatches.length, 6)} Users`
    : 'SELL';

  return {
    slice: { title: sliceTitle, body: sliceBody },
    characters: { title: charTitle, body: charBody },
  };
}
