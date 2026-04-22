import { SLICE_RULES } from './sliceRules';
import { SEC_FOCUS } from '../data/secFocus';
import { rollEfficiency, SLICE_GAIN, MOD_TIERS } from '../constants/modData';

const FIXED_PRIMARY = {
  Square: "Offense%",
  Diamond: "Defense%",
};

const PRIMARY_ABBR_MAP = {
  Sp: "Speed",
  O: "Offense%",
  H: "Health%",
  P: "Protection%",
  Ac: "Accuracy%",
  CA: "Crit Avoidance%",
  T: "Tenacity%",
  CC: "Crit Chance%",
  CD: "Crit Dmg%",
  D: "Defense%",
  Po: "Potency%",
  "-": "Any",
};

const SET_NORMALIZERS = [
  [/Speed\(x4\)/i, "Speed"],
  [/Speed\(x3\)/i, "Speed"],
  [/Offense\(x4\)/i, "Offense"],
  [/Offense\(x3\)/i, "Offense"],
  [/Crit Dmg\(x4\)/i, "Crit Dmg"],
  [/Crit Dmg\(x3\)/i, "Crit Dmg"],
  [/Crit Chance\(x2\)/i, "Crit Chance"],
  [/Crit Chance\(x4\)/i, "Crit Chance"],
  [/Crit Chance\(x3\)/i, "Crit Chance"],
  [/Health\(x6\)/i, "Health"],
  [/Health\(x4\)/i, "Health"],
  [/Health\(x3\)/i, "Health"],
  [/Defense\(x6\)/i, "Defense"],
  [/Defense\(x4\)/i, "Defense"],
  [/Potency\(x6\)/i, "Potency"],
  [/Potency\(x4\)/i, "Potency"],
  [/Tenacity\(x6\)/i, "Tenacity"],
  [/Tenacity\(x4\)/i, "Tenacity"],
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function titleCaseRole(role = "") {
  const r = String(role).toLowerCase();
  if (r.includes("tank")) return "tank";
  if (r.includes("heal")) return "healer";
  if (r.includes("leader")) return "leader";
  if (r.includes("support")) return "support";
  if (r.includes("attack")) return "attacker";
  return "support";
}

function normalizeSetName(setName = "") {
  if (!setName) return "";
  let normalized = String(setName);
  for (const [pattern, replacement] of SET_NORMALIZERS) {
    normalized = normalized.replace(pattern, replacement);
  }
  if (normalized.includes("+")) {
    return normalized
      .split("+")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [normalized.trim()];
}

function canonicalizeSetLabel(setName = "") {
  return String(setName)
    .replace(/\(x\d+\)/i, "")
    .replace(/^Crit Damage$/i, "Crit Dmg")
    .trim();
}

function parseSetRequirements(setName = "") {
  const raw = String(setName || "").trim();
  if (!raw || raw === "-") return {};

  const requirements = {};
  const parenMatches = [...raw.matchAll(/([A-Za-z ]+?)\s*\(x(\d+)\)/gi)];
  if (parenMatches.length) {
    for (const [, label, count] of parenMatches) {
      requirements[canonicalizeSetLabel(label)] = Number(count);
    }
    return requirements;
  }

  const normalized = raw
    .replace(/^Triple\s+(.+)$/i, (_, label) => `${label}(x6)`)
    .replace(/^Double\s+(.+?)\s*\+\s*(.+)$/i, (_, main, side) => `${main}(x4)+${side}(x2)`)
    .replace(/^Double\s+(.+)$/i, (_, label) => `${label}(x4)`)
    .replace(/^(.+?)\s*\+\s*(.+)$/i, (_, main, side) => `${main}(x4)+${side}(x2)`);

  const reparsed = [...normalized.matchAll(/([A-Za-z ]+?)\s*\(x(\d+)\)/gi)];
  if (reparsed.length) {
    for (const [, label, count] of reparsed) {
      requirements[canonicalizeSetLabel(label)] = Number(count);
    }
    return requirements;
  }

  requirements[canonicalizeSetLabel(normalized)] = 1;
  return requirements;
}

function normalizeShapePrimary(shape, primary) {
  if (shape === "Square" || shape === "Diamond") return FIXED_PRIMARY[shape];
  return primary || "";
}

function decodeBuildPrimary(primary = "") {
  return PRIMARY_ABBR_MAP[primary] || primary || "";
}

function getBuildForShape(char, shape, variant) {
  const alt = variant === "alternate";
  const map = {
    Arrow: alt ? char.buArr || char.arrow : char.arrow,
    Triangle: alt ? char.buTri || char.triangle : char.triangle,
    Circle: alt ? char.buCir || char.circle : char.circle,
    Cross: alt ? char.buCro || char.cross : char.cross,
    Square: FIXED_PRIMARY.Square,
    Diamond: FIXED_PRIMARY.Diamond,
  };
  return decodeBuildPrimary(map[shape]);
}

function getSetForVariant(char, variant) {
  return variant === "alternate" ? (char.buSet || "") : (char.modSet || "");
}

function getSecsForVariant(char, variant) {
  if (variant !== "alternate") return char.secs || "";
  const derived = deriveAltPrioritiesFromFocus(char);
  if (derived) return derived;
  return char.buSecs || "";
}

// Derive an alternate-build priority list from the swgoh.gg usage research
// (SEC_FOCUS). Strategy: take positions #1 and #2 from the main build and
// append #5 and #6 from the full usage-sorted list, replacing #3 and #4.
// Speed is locked: if Speed is in the main top-4 at position N, it stays at
// position N in the alt. If Speed isn't in the research top-6, we respect
// that (naturally-slow character) and don't force it in.
function deriveAltPrioritiesFromFocus(char) {
  const focus = SEC_FOCUS[char.name];
  if (!focus || typeof focus !== "object") return null;

  const mainList = parsePriorityList(char.secs || "");
  if (mainList.length < 2) return null;

  // Coalesce flat + % variants: Health and Health% are the same target for
  // priority-list purposes, with % being strictly better. Keep the max
  // usagePct across both variants and always emit the % form.
  const coalesced = new Map();
  for (const [rawStat, info] of Object.entries(focus)) {
    const promoted = normalizePriorityName(rawStat);
    const usagePct = Number(info?.usagePct) || 0;
    const prev = coalesced.get(promoted) || 0;
    if (usagePct > prev) coalesced.set(promoted, usagePct);
  }
  const ranked = Array.from(coalesced.entries())
    .map(([stat, usagePct]) => ({ stat, usagePct }))
    .sort((a, b) => b.usagePct - a.usagePct);
  if (ranked.length < 4) return null;

  const normMain = mainList.map((s) => normalizePriorityName(s));
  const speedIdxInMain = normMain.findIndex((s) => s === "Speed");

  const topNames = new Set([normMain[0], normMain[1]]);
  const extras = [];
  for (const r of ranked) {
    if (extras.length >= 2) break;
    if (topNames.has(r.stat)) continue;
    if (normMain[2] === r.stat || normMain[3] === r.stat) continue;
    extras.push(r.stat);
  }
  if (extras.length < 2) {
    for (const r of ranked) {
      if (extras.length >= 2) break;
      if (topNames.has(r.stat)) continue;
      if (extras.includes(r.stat)) continue;
      extras.push(r.stat);
    }
  }
  if (extras.length < 2) return null;

  let alt = [normMain[0], normMain[1], extras[0], extras[1]];
  if (speedIdxInMain >= 0 && speedIdxInMain !== 0 && speedIdxInMain !== 1) {
    alt = alt.filter((s) => s !== "Speed");
    alt.splice(Math.min(speedIdxInMain, alt.length), 0, "Speed");
    alt = alt.slice(0, 4);
  }
  return alt.join(" > ");
}

function parsePriorityList(priorityString = "") {
  return String(priorityString)
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeFocusStatName(stat = "") {
  return String(stat)
    .replace(/\s+%$/g, "%")
    .replace(/^Critical Chance\s*%$/i, "Crit Chance%")
    .replace(/^Critical Avoidance\s*%$/i, "Crit Avoidance%")
    .replace(/^Critical Damage\s*%?$/i, "Crit Dmg%")
    .trim();
}

// Promote a flat stat to its % variant for priority-list matching. A
// character priority of "Health" (flat) is satisfied by a scanned Health%
// secondary — % is strictly better than flat, so it should always count as
// a match. Scanned flat stats already get a FLAT_TIEBREAKER_MULTIPLIER
// penalty in scoreEnteredSecondaries, so the reverse case (% priority met
// by a scanned flat) is already down-weighted.
function promoteToPercent(stat = "") {
  const s = String(stat).trim();
  if (s === "Offense") return "Offense%";
  if (s === "Health") return "Health%";
  if (s === "Protection") return "Protection%";
  if (s === "Defense") return "Defense%";
  return s;
}

function normalizePriorityName(stat = "") {
  return promoteToPercent(normalizeFocusStatName(stat));
}

function inferBuildTags(char, priorityList) {
  const tags = new Set([titleCaseRole(char.role)]);
  const p = priorityList.join(" | ");

  if (p.includes("Health%") && p.includes("Tenacity%") && titleCaseRole(char.role) === "attacker") {
    tags.add("bruiser");
  }
  if (p.includes("Potency%")) tags.add("debuffer");
  return [...tags];
}

const ROLL_RULES_5DOT = {
  Speed: { min: 3, max: 6, maxRolls: 5, sixDotGain: 1 },
  Offense: { min: 22.8, max: 45.6, maxRolls: 5, sixDotGain: 23 },
  "Offense%": { min: 0.281, max: 0.563, maxRolls: 5, sixDotGain: 5.685 },
  Health: { min: 214.3, max: 428.6, maxRolls: 5, sixDotGain: 557 },
  "Health%": { min: 0.563, max: 1.125, maxRolls: 5, sixDotGain: 4.375 },
  Protection: { min: 415.3, max: 830.6, maxRolls: 5, sixDotGain: 447 },
  "Protection%": { min: 1.125, max: 2.25, maxRolls: 5, sixDotGain: 3.75 },
  Defense: { min: 4.9, max: 9.8, maxRolls: 5, sixDotGain: 31 },
  "Defense%": { min: 0.85, max: 1.7, maxRolls: 5, sixDotGain: 11.5 },
  "Crit Chance%": { min: 1.125, max: 2.25, maxRolls: 5, sixDotGain: 0.5 },
  "Potency%": { min: 1.125, max: 2.25, maxRolls: 5, sixDotGain: 3.75 },
  "Tenacity%": { min: 1.125, max: 2.25, maxRolls: 5, sixDotGain: 3.75 },
};

function estimateRollProfile(statName, value) {
  const rule = ROLL_RULES_5DOT[statName];
  if (!rule || Number.isNaN(value) || value <= 0) {
    return null;
  }

  const possibleProfiles = [];
  for (let rolls = 1; rolls <= rule.maxRolls; rolls += 1) {
    const minTotal = rule.min * rolls;
    const maxTotal = rule.max * rolls;
    const tolerance = Math.max(0.15, rule.max * 0.08);
    if (value >= minTotal - tolerance && value <= maxTotal + tolerance) {
      const avgRoll = value / rolls;
      const rollQuality = clamp((avgRoll - rule.min) / Math.max(0.0001, rule.max - rule.min), 0, 1);
      const totalQuality = ((rollQuality * 0.6) + ((rolls / rule.maxRolls) * 0.4));
      possibleProfiles.push({
        rolls,
        avgRoll,
        rollQuality,
        totalQuality,
      });
    }
  }

  if (!possibleProfiles.length) {
    const fallbackRolls = clamp(Math.round(value / Math.max(rule.min, 0.0001)), 1, rule.maxRolls);
    const avgRoll = value / fallbackRolls;
    const rollQuality = clamp((avgRoll - rule.min) / Math.max(0.0001, rule.max - rule.min), 0, 1);
    return {
      rolls: fallbackRolls,
      avgRoll,
      rollQuality,
      totalQuality: ((rollQuality * 0.6) + ((fallbackRolls / rule.maxRolls) * 0.4)),
    };
  }

  possibleProfiles.sort((a, b) => {
    if (b.totalQuality !== a.totalQuality) return b.totalQuality - a.totalQuality;
    return b.rolls - a.rolls;
  });
  return possibleProfiles[0];
}

function secondaryQuality(refMap, statName, value) {
  const ref = refMap.get(statName);
  if (!ref || Number.isNaN(value)) {
    return {
      band: "UNKNOWN",
      pct: 0.35,
      upside: 0.35,
      sliceGainPct: 0.35,
      rollsEstimate: 0,
      rollQualityPct: 35,
    };
  }
  const v = Number(value);
  const max5 = ref.max5 || ref.m5 || 0;
  const max6 = ref.max6 || ref.m6 || ref.max5 || ref.m5 || 0;
  const good = ref.good || ref.g || 0;
  const great = ref.great || ref.gr || 0;
  const pctOfMax5 = max5 ? clamp(v / max5, 0, 1) : 0;
  const rollProfile = estimateRollProfile(statName, v);
  const rollQualityPct = rollProfile ? rollProfile.rollQuality * 100 : pctOfMax5 * 100;
  const totalRollPct = rollProfile ? (rollProfile.rolls / 5) * 100 : pctOfMax5 * 100;
  const pct = rollProfile ? ((rollQualityPct * 0.6) + (totalRollPct * 0.4)) / 100 : pctOfMax5;
  let band = "LOW";
  if (rollQualityPct >= 78 || (great && v >= great)) band = "GREAT";
  else if (rollQualityPct >= 50 || (good && v >= good)) band = "GOOD";

  // For slicer, the gain question is 5A/B -> 6E. A high-roll stat with fewer
  // total hits still has room to improve later, while 5/5-hit stats are closer
  // to "already made their money" even if the 6E jump still helps a bit.
  const sliceDelta = Math.max(0, max6 - max5);
  const rawSixDotGainPct = sliceDelta ? clamp(sliceDelta / Math.max(max6, 0.0001), 0, 1) : 0;
  const remainingRollRoom = rollProfile ? clamp((5 - rollProfile.rolls) / 4, 0, 1) : Math.max(0, 1 - pctOfMax5);
  const upside = clamp((remainingRollRoom * 0.65) + ((1 - pct) * 0.35), 0, 1);
  const sliceGainPct = clamp((rawSixDotGainPct * 0.55) + ((1 - pct) * 0.45), 0, 1);

  return {
    band,
    pct,
    upside,
    sliceGainPct,
    rollsEstimate: rollProfile?.rolls || 0,
    rollQualityPct,
  };
}

function findMatchingBuilds({ chars, shape, primary, modSet }) {
  const selectedPrimary = normalizeShapePrimary(shape, primary);
  const selectedSet = modSet || "";
  const results = [];

  for (const char of chars) {
    for (const variant of ["primary", "alternate"]) {
      const buildPrimary = getBuildForShape(char, shape, variant);
      if (!buildPrimary || buildPrimary !== selectedPrimary) continue;

      const rawSet = getSetForVariant(char, variant);
      const setPieces = normalizeSetName(rawSet);
      const setRequirements = parseSetRequirements(rawSet);
      const selectedSetCount = selectedSet ? (setRequirements[selectedSet] || 0) : 0;
      const mainSetCount = Math.max(0, ...Object.values(setRequirements));
      const setMatchType = !selectedSet
        ? "shell"
        : selectedSetCount <= 0
          ? null
          : selectedSetCount === mainSetCount
            ? "main"
            : "side";

      if (selectedSet && !setMatchType) continue;

      const priorityList = parsePriorityList(getSecsForVariant(char, variant));
      const buildTags = inferBuildTags(char, priorityList);

      results.push({
        name: char.name,
        role: char.role,
        faction: char.faction,
        variant,
        set: rawSet,
        setPieces,
        setRequirements,
        setMatchType,
        shape,
        primary: buildPrimary,
        priorityList,
        buildTags,
        fitTier: !selectedSet
          ? variant === "primary"
            ? "primaryBuildShell"
            : "alternateBuildShell"
          : setMatchType === "main"
            ? variant === "primary"
              ? "primaryBuildMainSet"
              : "alternateBuildMainSet"
            : variant === "primary"
              ? "primaryBuildSideSet"
              : "alternateBuildSideSet",
      });
    }
  }

  if (!selectedSet) return results;

  const mainMatches = results.filter((match) => match.setMatchType === "main");
  return mainMatches.length ? mainMatches : results;
}

function rankFitTier(fitTier = "") {
  if (fitTier === "primaryBuildMainSet") return 5;
  if (fitTier === "alternateBuildMainSet") return 4;
  if (fitTier === "primaryBuildShell") return 3;
  if (fitTier === "primaryBuildSideSet") return 3;
  if (fitTier === "alternateBuildShell") return 2;
  if (fitTier === "alternateBuildSideSet") return 2;
  return 0;
}

function uniqueMatchesByName(matches) {
  const byName = new Map();

  for (const match of matches) {
    const current = byName.get(match.name);
    if (!current || rankFitTier(match.fitTier) > rankFitTier(current.fitTier)) {
      byName.set(match.name, match);
    }
  }

  return [...byName.values()];
}

const PRIORITY_BAND_POINTS = [36, 28, 18, 10, 6, 4];
const PRIORITY_BAND_TAIL = 2;

function priorityBandPoints(idx) {
  if (idx < 0) return 0;
  return PRIORITY_BAND_POINTS[idx] ?? PRIORITY_BAND_TAIL;
}

function scoreMatchAgainstEnteredSecondaries(match, secondaries, selectedPrimary) {
  const focusMap = SEC_FOCUS[match.name] || {};
  const entered = secondaries
    .filter((s) => s && s.name && s.val !== "")
    .map((s) => normalizePriorityName(FLAT_TO_PERCENT[s.name] ?? s.name));

  let secondaryScore = 0;
  let alignedCount = 0;
  let strongAlignedCount = 0;
  const alignedPriorityIndices = new Set();
  const alignedStats = [];
  const offPriorityHits = [];
  for (const stat of entered) {
    const idx = match.priorityList.findIndex((priority) => normalizePriorityName(priority) === stat);
    const focus = focusMap[stat];

    if (idx !== -1) {
      alignedCount += 1;
      secondaryScore += priorityBandPoints(idx);
      alignedPriorityIndices.add(idx);
      alignedStats.push({ stat, priorityIndex: idx });

      if (focus) {
        secondaryScore += focus.score * 0.35;
        if (focus.score >= 45) strongAlignedCount += 1;
      }
      continue;
    }

    // Off-priority stats: scale contribution by meta usage (focus.score) so
    // characters with strong but uncurated stat signals still get credit. Cap
    // well below in-priority band points so background stats can't dominate.
    if (focus && focus.score > 0) {
      secondaryScore += Math.min(focus.score * 0.12, 8);
      if (focus.score >= 55) {
        strongAlignedCount += 1;
        offPriorityHits.push(stat);
      }
    }
  }

  // The mod's primary stat isn't in `secondaries`, but a character whose top
  // priority matches that primary is a great fit for the mod — give them the
  // same priority-band credit we give to aligned secondaries.
  let primaryBonus = 0;
  let primaryPriorityIndex = -1;
  if (selectedPrimary) {
    const normalizedPrimary = normalizePriorityName(selectedPrimary);
    const pidx = match.priorityList.findIndex(
      (priority) => normalizePriorityName(priority) === normalizedPrimary
    );
    if (pidx !== -1) {
      primaryBonus = priorityBandPoints(pidx);
      alignedCount += 1;
      primaryPriorityIndex = pidx;
      if (pidx <= 1) strongAlignedCount += 1;
    }
  }

  const avgSecondaryScore = entered.length ? secondaryScore / entered.length : 0;
  return {
    score: (rankFitTier(match.fitTier) * 100) + avgSecondaryScore + primaryBonus,
    alignedCount,
    strongAlignedCount,
    alignedPriorityIndices,
    alignedStats,
    offPriorityHits,
    primaryPriorityIndex,
  };
}

function buildConsensusProfile(matches) {
  const statWeights = {};
  const tagCounts = {};

  for (const match of matches) {
    const fitMult = SLICE_RULES.fitWeights[match.fitTier] || 0.6;
    for (const tag of match.buildTags) tagCounts[tag] = (tagCounts[tag] || 0) + fitMult;

    match.priorityList.forEach((stat, idx) => {
      const base = SLICE_RULES.weights[stat] || 3.0;
      const priorityMult = SLICE_RULES.priorityMultipliers[idx] || SLICE_RULES.nonPriorityMultiplier;
      let profileMult = 1.0;
      for (const tag of match.buildTags) {
        const profile = SLICE_RULES.profileMultipliers[tag];
        if (profile && profile[stat]) profileMult = Math.max(profileMult, profile[stat]);
      }
      statWeights[stat] = (statWeights[stat] || 0) + base * priorityMult * profileMult * fitMult;
    });
  }

  const sortedTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);

  const maxWeight = Math.max(1, ...Object.values(statWeights));
  const normalized = {};
  for (const [stat, val] of Object.entries(statWeights)) {
    normalized[stat] = (val / maxWeight) * 100;
  }

  return {
    statWeights: normalized,
    dominantTags: sortedTags,
  };
}

function normalizeSecondaryConsensus(statWeights, secondaries) {
  const enteredTargets = secondaries
    .filter((s) => s && s.name && s.val !== "")
    .map((s) => FLAT_TO_PERCENT[s.name] ?? s.name);

  if (!enteredTargets.length) return { ...statWeights };

  const containsSpeed = enteredTargets.includes("Speed");
  const candidateStats = Object.entries(statWeights).filter(([stat]) => containsSpeed || stat !== "Speed");
  const candidateMax = Math.max(1, ...candidateStats.map(([, weight]) => weight));

  const normalized = {};
  for (const [stat, weight] of Object.entries(statWeights)) {
    if (!containsSpeed && stat === "Speed") {
      normalized[stat] = weight;
      continue;
    }
    normalized[stat] = (weight / candidateMax) * 100;
  }

  return normalized;
}

function scoreModFit(matches) {
  if (!matches.length) {
    return { score: 0, confidence: "LOW", notes: ["No matching character builds found for this shell."] };
  }

  const uniqueMatches = uniqueMatchesByName(matches);

  const best = matches.reduce((a, b) => {
    const av = SLICE_RULES.fitWeights[a.fitTier] || 0;
    const bv = SLICE_RULES.fitWeights[b.fitTier] || 0;
    return bv > av ? b : a;
  });

  const mainSet = best.fitTier.includes("MainSet");
  const sideSet = best.fitTier.includes("SideSet");
  const primary = best.fitTier.startsWith("primary");
  const score = mainSet ? (primary ? 100 : 92) : sideSet ? (primary ? 84 : 76) : primary ? 82 : 74;

  return {
    score,
    confidence: uniqueMatches.length >= 8 ? "HIGH" : uniqueMatches.length >= 3 ? "MEDIUM" : "LOW",
    notes: [
      mainSet
        ? "Set matches a core build set."
        : sideSet
          ? "Set matches a side build set."
          : "Scoring this shell without a specific set requirement.",
      primary ? "Primary build match found." : "Only alternate build matches found.",
    ],
  };
}

const FLAT_STAT_NAMES = new Set(["Offense", "Health", "Protection", "Defense"]);
const FLAT_TO_PERCENT = {
  Offense: "Offense%",
  Health: "Health%",
  Protection: "Protection%",
  Defense: "Defense%",
};
const FLAT_TIEBREAKER_MULTIPLIER = 0.25;

// Equipping a set bonus amplifies the matching in-game stat (e.g. Speed set
// gives +10% Speed). A secondary that aligns with the worn set is therefore
// worth more on this mod than a generic version would be.
const SET_AFFINITY_STATS = {
  "Crit Dmg": ["Crit Dmg%"],
  "Crit Chance": ["Crit Chance%"],
  Offense: ["Offense", "Offense%"],
  Speed: ["Speed"],
  Health: ["Health", "Health%"],
  Defense: ["Defense", "Defense%"],
  Tenacity: ["Tenacity%"],
  Potency: ["Potency%"],
};
const SET_AFFINITY_MULTIPLIER = 1.2;

function getSetAffinityStats(modSet) {
  const affinity = new Set();
  if (!modSet) return affinity;
  const reqs = parseSetRequirements(modSet);
  for (const setName of Object.keys(reqs)) {
    const stats = SET_AFFINITY_STATS[setName];
    if (stats) stats.forEach((s) => affinity.add(s));
  }
  return affinity;
}

function scoreEnteredSecondaries({ enteredSecondaries, consensusProfile, sliceRef, modSet }) {
  const affinityStats = getSetAffinityStats(modSet);
  const refMap = new Map(sliceRef.map((r) => [r.stat || r.s, r]));
  const scored = enteredSecondaries
    .filter((s) => s && s.name && s.val !== "")
    .map((s) => {
      const matchedTarget = FLAT_TO_PERCENT[s.name] ?? s.name;
      const isFlatTieBreaker = matchedTarget !== s.name;
      // Flat stats can weakly support the matching % plan as a tie-breaker.
      const defaultWeight = isFlatTieBreaker ? 4 : 18;
      const baseWeight = consensusProfile.statWeights[matchedTarget] ?? defaultWeight;
      const preAffinityWeight = isFlatTieBreaker
        ? baseWeight * FLAT_TIEBREAKER_MULTIPLIER
        : baseWeight;
      const hasSetAffinity = affinityStats.has(s.name) || affinityStats.has(matchedTarget);
      const targetWeight = hasSetAffinity
        ? preAffinityWeight * SET_AFFINITY_MULTIPLIER
        : preAffinityWeight;
      const quality = secondaryQuality(refMap, s.name, Number(s.val));
      const normalizedQuality = quality.pct * 100;
      const score = (targetWeight * 0.65) + (normalizedQuality * 0.35);
      return {
        ...s,
        numericValue: Number(s.val),
        targetWeight,
        matchedTarget,
        isFlatTieBreaker,
        qualityBand: quality.band,
        qualityPct: normalizedQuality,
        upsidePct: quality.upside * 100,
        sliceGainPct: quality.sliceGainPct * 100,
        rollsEstimate: quality.rollsEstimate,
        rollQualityPct: quality.rollQualityPct,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { score: 0, scoredStats: [], deadCount: 0, topReasons: ["No secondaries entered."] };
  }

  const avg = scored.reduce((sum, s) => sum + s.score, 0) / scored.length;
  // A stat is "dead" if it has low target weight AND low quality, OR if it's a flat stat with low quality
  const deadCount = scored.filter(
    (s) => (s.targetWeight < 25 && s.qualityPct < 50) || (FLAT_STAT_NAMES.has(s.name) && s.qualityPct < 60)
  ).length;
  const topReasons = scored.slice(0, 2).map((s) => {
    const rollsText = s.rollsEstimate ? ` with about ${s.rollsEstimate}/5 hits` : "";
    return `${s.name} is on plan and rates ${s.qualityBand}${rollsText}.`;
  });

  return {
    score: clamp(avg, 0, 100),
    scoredStats: scored,
    deadCount,
    topReasons,
  };
}

function scoreSynergy(scoredStats, dominantTags) {
  const names = new Set(scoredStats.map((s) => s.name));
  let bonus = 0;

  for (const entry of SLICE_RULES.synergyBonuses) {
    const allPresent = entry.stats.every((stat) => names.has(stat));
    const tagHit = entry.tags.some((tag) => dominantTags.includes(tag));
    if (allPresent && tagHit) bonus += entry.bonus;
  }

  return clamp(bonus * 5, 0, 100);
}

function scoreUpside(scoredStats, { shape, primary } = {}) {
  if (!scoredStats.length) return 0;

  // qualityPct >= 60 catches a 3-roll Speed +15 (which scores ~64) — community
  // rule "3+ speed = slice" depends on this counting as strong-on-plan.
  const strongOnPlan = scoredStats.filter((s) => s.targetWeight >= 55 && s.qualityPct >= 60).length;
  const goodOnPlan = scoredStats.filter((s) => s.targetWeight >= 40 && s.qualityPct >= 60).length;
  const avgSliceGain = scoredStats.reduce((sum, s) => sum + s.sliceGainPct, 0) / scoredStats.length;

  let score = 25;
  if (strongOnPlan >= 1) score += 24;
  if (strongOnPlan >= 2) score += 18;
  if (goodOnPlan >= 3) score += 12;
  if (avgSliceGain >= 55) score += 10;
  else if (avgSliceGain >= 35) score += 6;

  // Speed arrows gain a uniquely valuable +2 primary jump when sliced to 6E.
  if (shape === "Arrow" && primary === "Speed") score += 18;

  return clamp(score, 0, 100);
}

function getDecisionLabel(finalScore) {
  return SLICE_RULES.thresholds.find((t) => finalScore >= t.min)?.label || "DO NOT SLICE";
}

function getCeilingLabel(upsideScore) {
  return upsideScore >= 65 ? "HIGH CEILING" : "LOW CEILING";
}

// Tier-gated action label. Sits on top of the main finalScore.
// Sell cases delegate to the main scoring (forcedsell / no users / low score).
// Hidden-reveal secondaries override everything — the user must level to 12.
function getTierAction({ tier, secondaries, shape, primary, finalScore, forcedsell, noBuildUse }) {
  const hiddenCount = (secondaries || []).filter((s) => s && s.hidden).length;
  if (hiddenCount > 0) {
    return {
      actionLabel: 'LEVEL TO 12',
      actionColor: '#f5a623',
      actionDesc: `${hiddenCount} hidden secondary${hiddenCount > 1 ? ' stats reveal' : ' reveals'} at lvl 3/6/9/12. Level the mod to 12 and rescan.`,
    };
  }

  if (forcedsell || noBuildUse || finalScore < 30) {
    return {
      actionLabel: 'SELL',
      actionColor: '#f87171',
      actionDesc: forcedsell
        ? '3+ flat base stats — low ceiling, not worth keeping.'
        : noBuildUse
          ? 'No characters want this shell.'
          : 'Weak rolls — not worth further investment.',
    };
  }

  const dotLevel = tier && String(tier).startsWith('6') ? 6 : 5;
  const analyzed = (secondaries || [])
    .filter((s) => s && s.name && s.val !== '' && parseInt(s.rolls, 10) > 0)
    .map((s) => {
      const eff = rollEfficiency(s.name, s.val, s.rolls, dotLevel);
      const gain = SLICE_GAIN[s.name] ?? 0;
      return { name: s.name, val: s.val, rolls: parseInt(s.rolls, 10), eff: eff ?? 0, gain };
    });

  const avgEff = analyzed.length ? analyzed.reduce((a, s) => a + s.eff, 0) / analyzed.length : 0;
  const speed = analyzed.find((s) => s.name === 'Speed');
  const highGain = analyzed.filter((s) => s.gain >= 0.5);
  const strongHighGain = highGain.filter((s) => s.eff >= 0.7);
  const isSpeedArrow = shape === 'Arrow' && primary === 'Speed';
  const isFixed = shape === 'Square' || shape === 'Diamond';

  // 5E / 5D — pre-reveal tiers; secondaries aren't all visible yet anyway.
  // If main scoring didn't force a sell, level up cheap and rescan.
  if (tier === '5E' || tier === '5D') {
    const next = tier === '5E' ? '5D' : '5C';
    return {
      actionLabel: `SLICE → ${next}`,
      actionColor: '#86efac',
      actionDesc: `Early tier — cheap to level. Continue to ${next} and rescan once more secondaries reveal.`,
    };
  }

  if (tier === '5C') {
    if (speed || highGain.length >= 1 || avgEff >= 0.4) {
      return {
        actionLabel: 'SLICE → 5B',
        actionColor: '#86efac',
        actionDesc: speed
          ? 'Speed secondary present — always worth climbing. Slice to 5B and rescan.'
          : 'Early rolls promising — continue to 5B and rescan.',
      };
    }
    if (isFixed) return { actionLabel: 'KEEP', actionColor: '#facc15', actionDesc: 'Fixed slot — keep for set completion.' };
    return { actionLabel: 'SELL', actionColor: '#f87171', actionDesc: 'Weak early rolls — cut losses before 5B.' };
  }

  if (tier === '5B') {
    const speedWorthy = speed && speed.eff >= 0.5 && speed.rolls >= 2;
    if (avgEff >= 0.55 || speedWorthy || strongHighGain.length >= 1) {
      return {
        actionLabel: 'SLICE → 5A',
        actionColor: '#86efac',
        actionDesc: speedWorthy
          ? `Speed at ${speed.val} across ${speed.rolls} rolls — finish the 5-dot climb.`
          : 'Rolls trending well — finish the 5-dot climb.',
      };
    }
    if (speed && speed.rolls === 1) {
      return {
        actionLabel: 'KEEP',
        actionColor: '#facc15',
        actionDesc: "Speed with only 1 roll — keep but don't commit to 5A yet.",
      };
    }
    if (isFixed) return { actionLabel: 'KEEP', actionColor: '#facc15', actionDesc: 'Fixed slot — keep for set completion.' };
    return { actionLabel: 'SELL', actionColor: '#f87171', actionDesc: 'Rolls too weak to justify 5A materials.' };
  }

  if (tier === '5A') {
    // All visible secondaries still only show (1) — mod hasn't been leveled
    // past the initial reveals, so rolls can't be judged yet. Auto-sell
    // already handled truly weak mods above.
    if (analyzed.length >= 1 && analyzed.every((s) => s.rolls === 1)) {
      return {
        actionLabel: 'LEVEL TO 12',
        actionColor: '#f5a623',
        actionDesc: 'Every visible secondary still at (1) roll — level the mod to 12 and rescan for 6-dot slicing advice.',
      };
    }
    if (isSpeedArrow && speed) {
      return {
        actionLabel: 'SLICE → 6E',
        actionColor: '#4ade80',
        actionDesc: 'Speed arrow with speed secondary — always worth 6-dot.',
      };
    }
    if (speed && speed.rolls >= 3) {
      return {
        actionLabel: 'SLICE → 6E',
        actionColor: '#4ade80',
        actionDesc: `Speed hit ${speed.rolls} times already (value ${speed.val}) — high chance of more on 6-dot slice.`,
      };
    }
    if (strongHighGain.length >= 1 && avgEff >= 0.55) {
      const top = strongHighGain[0];
      return {
        actionLabel: 'SLICE → 6E',
        actionColor: '#4ade80',
        actionDesc: `${top.name} at ${Math.round(top.eff * 100)}% efficiency — 6-dot multiplies the cap by ${Math.round((1 + top.gain) * 100) / 100}×.`,
      };
    }
    if (speed && speed.rolls >= 2 && speed.eff >= 0.5 && avgEff >= 0.55) {
      return {
        actionLabel: 'SLICE → 6E',
        actionColor: '#4ade80',
        actionDesc: `Speed at ${speed.val} (${speed.rolls} rolls) with solid overall efficiency — worth 6-dot.`,
      };
    }
    if (speed && speed.rolls === 1) {
      return {
        actionLabel: 'KEEP',
        actionColor: '#facc15',
        actionDesc: "Speed only hit once — 6-dot gain is just +1 speed max (+3%). Don't burn 6-dot mats.",
      };
    }
    if (avgEff >= 0.5 || isFixed) {
      return {
        actionLabel: 'KEEP',
        actionColor: '#facc15',
        actionDesc: "Solid 5A — usable, but efficiency doesn't justify 6-dot investment.",
      };
    }
    return { actionLabel: 'SELL', actionColor: '#f87171', actionDesc: 'Rolled poorly — not worth 6-dot cost.' };
  }

  if (tier === '6E') {
    if (avgEff >= 0.75) return { actionLabel: 'TOP TIER', actionColor: '#c084fc', actionDesc: 'Elite 6-dot mod — lock it on your best toon.' };
    if (avgEff >= 0.5) return { actionLabel: 'KEEP', actionColor: '#facc15', actionDesc: 'Good 6-dot mod.' };
    return { actionLabel: 'USABLE', actionColor: '#60a5fa', actionDesc: 'Average 6-dot — niche use only.' };
  }

  return { actionLabel: 'KEEP', actionColor: '#facc15', actionDesc: 'No tier selected.' };
}

function getNextHitNarrative(scoredStats) {
  if (!scoredStats.length) {
    return {
      bestCase: "No valid secondaries entered.",
      worstCase: "No valid secondaries entered.",
    };
  }

  // Best-case: stat the character wants most that still has ceiling to grow.
  // Worst-case: flat stats that don't match a character's build (isFlatTieBreaker)
  // are *always* the worst next-hit outcome because their ceiling is tiny and
  // doesn't scale with %-based character stats. Only fall back to the
  // lowest-weight secondary when no such flat stats are present.
  const score = s => s.targetWeight * s.upsidePct;
  const best = scoredStats.reduce((a, b) => (score(b) > score(a) ? b : a));
  const flatPool = scoredStats.filter(s => s.isFlatTieBreaker);
  const worstPool = flatPool.length ? flatPool : scoredStats;
  const worst = worstPool.reduce((a, b) => (score(b) < score(a) ? b : a));

  return {
    bestCase: `Next hit lands on ${best.name}.`,
    worstCase: `Next hit lands on ${worst.name}.`,
  };
}

// Tier-ladder projection: walk E -> D -> C -> B -> A -> 6E from the scanned
// mod's current tier, using the already-revealed rolls as signal about how
// the mod is trending. Returns one of five verdicts:
//   - USABLE:        worth slicing all the way to 6E (mat investment justified).
//   - CAP_AT_5A:     already at 5A — level 1→15 for money (no mats), equip.
//                    Skip 6E. Cheap climb still pays off.
//   - FILLER:        pre-5A, stats decent enough to equip but no 6-dot catalyst.
//                    Do NOT burn tier mats. Equip as-is, replace when better lands.
//   - SELLABLE:      weak across the board — sell outright.
//   - NOT_SLICEABLE: can't meaningfully walk the ladder (already 6E, no tier,
//                    no character wants this shell).
//
// The decision thresholds weigh two things differently:
//   pre-5A steps cost mats each, so any sign of wasted rolls (no priority hits,
//   priority stats at min efficiency) triggers an early bail. The 5A -> 6E
//   step also costs mats, so the bar to continue is higher — we need Speed
//   evidence or a high-SLICE_GAIN priority stat rolled well.
function buildLadderPlan({
  tier,
  finalScore,
  scoredStats,
  secondaries,
  shape,
  primary,
  forcedsell,
  noBuildUse,
}) {
  const notSliceable = (reason) => ({
    verdict: 'NOT_SLICEABLE',
    label: 'Not sliceable',
    color: '#94a3b8',
    desc: reason,
    stopAt: null,
  });
  const sellable = (at, reason) => ({
    verdict: 'SELLABLE',
    label: 'Sellable',
    color: '#f87171',
    desc: reason,
    stopAt: at,
  });
  const capAt5A = (reason) => ({
    verdict: 'CAP_AT_5A',
    label: 'Cap at 5A',
    color: '#facc15',
    desc: reason,
    stopAt: '5A',
  });
  const filler = (at, reason) => ({
    verdict: 'FILLER',
    label: 'Filler',
    color: '#60a5fa',
    desc: reason,
    stopAt: at,
  });
  const usable = (reason) => ({
    verdict: 'USABLE',
    label: 'Usable',
    color: '#4ade80',
    desc: reason,
    stopAt: '6E',
  });
  const sliceNext = (nextTier, reason) => ({
    verdict: 'SLICE_NEXT',
    label: `Slice to ${nextTier}`,
    color: '#22d3ee',
    desc: reason,
    stopAt: nextTier,
  });

  const TIER_ORDER = ['5E', '5D', '5C', '5B', '5A'];
  const currentIdx = TIER_ORDER.indexOf(tier);
  const nextTier = currentIdx >= 0 && currentIdx < TIER_ORDER.length - 1
    ? TIER_ORDER[currentIdx + 1]
    : null;

  if (noBuildUse) return notSliceable('No character build uses this shell.');
  if (!tier || !MOD_TIERS.includes(tier)) return notSliceable('No tier selected — choose the mod tier to project the slice path.');
  if (tier === '6E') return notSliceable('Already 6-dot — evaluate as a finished mod, not a slicing candidate.');
  if (forcedsell) return sellable(tier, '3+ flat base stats — low ceiling, not worth the mats.');

  const revealed = (secondaries || []).filter(
    (s) => s && s.name && s.val !== '' && parseInt(s.rolls, 10) > 0,
  );
  const speedSec = revealed.find((s) => s.name === 'Speed');
  const priorityStats = (scoredStats || []).filter((s) => s.targetWeight >= 40);
  const priorityCount = priorityStats.length;
  const avgPriorityQuality = priorityCount
    ? priorityStats.reduce((a, s) => a + s.qualityPct, 0) / priorityCount
    : 0;
  const strongUpside = priorityStats.some(
    (s) => (SLICE_GAIN[s.name] ?? 0) >= 0.3 && s.qualityPct >= 65,
  );
  const speedArrow = shape === 'Arrow' && primary === 'Speed';
  const matsAhead = tier !== '5A';

  // Pre-5A bail — mats are wasted when priority is absent and Speed hasn't hit.
  if (matsAhead && priorityCount === 0 && !speedSec) {
    return sellable(tier, 'No priority-stat hits and no Speed — next tier burns mats for nothing.');
  }
  if (
    matsAhead &&
    !speedSec &&
    avgPriorityQuality < 35 &&
    finalScore < 40
  ) {
    return sellable(
      tier,
      `Priority rolls trending minimal (${Math.round(avgPriorityQuality)}%) — cut losses before more mats.`,
    );
  }

  // 5A -> 6E decision. Speed evidence or a high-gain priority stat rolled well
  // justifies 6-dot mats; otherwise stop at 5A.
  //
  // Speed at only 2 rolls is inconclusive — the stat could stay stuck at its
  // current value through every remaining slice (each slice is ~25% to hit
  // Speed again). Don't commit to 6E on 2 rolls alone; fall through to
  // SLICE_NEXT so the user re-evaluates after each step.
  //
  // The 3+ roll gate is a proxy for the community's "Speed ≥ 15 before 6-dot"
  // rule (3 rolls avg 15). Add a value floor so unlucky 3-roll mods that
  // landed at the bottom of the 3–6 range (total 9–13) don't slip through.
  const speedRolls = speedSec ? parseInt(speedSec.rolls, 10) : 0;
  const speedVal = speedSec ? parseInt(String(speedSec.val).replace(/[^\d]/g, ''), 10) || 0 : 0;
  const speedHitHard = speedSec && speedRolls >= 3 && speedVal >= 14;

  if (speedArrow && speedSec) return usable('Speed arrow with Speed secondary — always worth 6-dot.');
  if (speedHitHard) return usable(`Speed at ${speedSec.val} over ${speedSec.rolls} rolls — 6-dot slice is a strong bet.`);
  if (strongUpside) {
    const top = priorityStats.find((s) => (SLICE_GAIN[s.name] ?? 0) >= 0.3 && s.qualityPct >= 65);
    return usable(`${top.name} rolling at ${Math.round(top.qualityPct)}% quality — 6-dot multiplies the cap.`);
  }

  // Step-by-step ladder: pre-5A mods aren't end-state decisions. Each tier
  // slice adds one random roll to an existing secondary, so a mod with
  // catalyst potential (Speed already rolling, or a priority stat that
  // benefits from 6-dot) deserves a "slice one tier, re-check" verdict
  // rather than a projection from current rolls. Community guidance: walk
  // the ladder a step at a time — only sell when the upside is genuinely
  // dead, not when current rolls merely haven't arrived yet.
  const speedMayBoost = speedSec && parseInt(speedSec.rolls, 10) < 5;
  const priorityMayBoost = priorityStats.some(
    (s) => (SLICE_GAIN[s.name] ?? 0) >= 0.3,
  );
  const hasCatalystPotential = speedMayBoost || priorityMayBoost;

  if (matsAhead && nextTier && hasCatalystPotential) {
    if (speedMayBoost) {
      const rollWord = parseInt(speedSec.rolls, 10) === 1 ? 'roll' : 'rolls';
      return sliceNext(
        nextTier,
        `Speed already rolling (${speedSec.rolls} ${rollWord} at ${speedSec.val}) — the ${tier}→${nextTier} slice has a ~25% shot at boosting it again. Take one step, then re-check. Don't pay further mats if the next roll lands elsewhere.`,
      );
    }
    const topPriority = priorityStats.find((s) => (SLICE_GAIN[s.name] ?? 0) >= 0.3);
    return sliceNext(
      nextTier,
      `${topPriority.name} on-board — the ${tier}→${nextTier} slice could upgrade it. Take one step, then re-check. Sell if the next roll lands on a dead stat.`,
    );
  }

  // Cap at 5A: only fires when the mod is ALREADY at 5A. Leveling 5A 1→15 is
  // money-only (reveals hidden rolls), so "stop at 5A" is a meaningful resting
  // place. At 5B/5C/5D/5E, reaching 5A still costs tier mats — if we've ruled
  // out 6-dot we should NOT burn mats chasing 5A. Decent stats at a lower
  // tier become Filler (equip as-is until replaced), weak stats are Sellable.
  const hasDecentFit = finalScore >= 50 || priorityCount >= 2;

  if (tier === '5A') {
    if (hasDecentFit) {
      return capAt5A(
        speedSec
          ? `Speed only at ${speedSec.rolls} roll${speedSec.rolls === 1 ? '' : 's'} — finish 5A levels for free, but 6-dot mats are a stretch.`
          : 'Decent fit but no 6-dot catalyst (Speed hits / high-gain priority) — level to 15 and equip, skip 6-dot.',
      );
    }
    return sellable(tier, 'At 5A but weak fit and no 6-dot catalyst — sell.');
  }

  if (hasDecentFit) {
    return filler(
      tier,
      `Decent stats but no 6-dot catalyst — equip as filler at ${tier}, skip the ${tier}→5A mats, replace when you find better.`,
    );
  }

  return sellable(
    tier,
    `Weak fit and no 6-dot catalyst — ${tier}→5A mats would be wasted, sell outright.`,
  );
}

export function evaluateSliceMod({
  chars,
  sliceRef,
  shape,
  primary,
  modSet,
  secondaries,
  tier,
}) {
  const selectedPrimary = normalizeShapePrimary(shape, primary);
  const matches = findMatchingBuilds({ chars, shape, primary: selectedPrimary, modSet });
  const uniqueCharacterMatches = uniqueMatchesByName(matches);
  const exactBuildMatches = matches.filter((m) => m.setMatchType === "main" || m.setMatchType === "side");
  const fit = scoreModFit(matches);

  // If the primary stat can also appear as a secondary, lightly reduce its
  // consensus weight so the shell's primary doesn't fully dominate secondary
  // evaluation. Do not penalize Speed here: on speed arrows, speed secondaries
  // are still premium and should remain a major slice driver.
  const enteredCount = secondaries.filter((s) => s && s.name && s.val !== "").length;
  const rankedMatches = uniqueCharacterMatches.map((m) => {
    const ranking = scoreMatchAgainstEnteredSecondaries(m, secondaries, selectedPrimary);
    return {
      ...m,
      matchScore: ranking.score,
      alignedCount: ranking.alignedCount,
      strongAlignedCount: ranking.strongAlignedCount,
      alignedPriorityIndices: ranking.alignedPriorityIndices,
      alignedStats: ranking.alignedStats,
      offPriorityHits: ranking.offPriorityHits,
      primaryPriorityIndex: ranking.primaryPriorityIndex,
    };
  });

  const alignedMatches = rankedMatches
    .filter((m) => {
      if (enteredCount >= 3) return m.alignedCount >= 2 || m.strongAlignedCount >= 2;
      if (enteredCount === 2) return m.alignedCount >= 1 || m.strongAlignedCount >= 1;
      return true;
    })
    .sort((a, b) => b.matchScore - a.matchScore || b.alignedCount - a.alignedCount || a.name.localeCompare(b.name));

  const consensusBaseMatches = alignedMatches.length ? alignedMatches : rankedMatches;
  const consensus = buildConsensusProfile(consensusBaseMatches);
  const secStatWeights = normalizeSecondaryConsensus(consensus.statWeights, secondaries);
  if (
    selectedPrimary &&
    selectedPrimary !== "Speed" &&
    secStatWeights[selectedPrimary] !== undefined
  ) {
    secStatWeights[selectedPrimary] = secStatWeights[selectedPrimary] * 0.55;
  }
  const secConsensus = { ...consensus, statWeights: secStatWeights };

  const secondary = scoreEnteredSecondaries({
    enteredSecondaries: secondaries,
    consensusProfile: secConsensus,
    sliceRef,
    modSet,
  });
  const upside = scoreUpside(secondary.scoredStats, { shape, primary: selectedPrimary });
  const contextRaw = scoreSynergy(secondary.scoredStats, consensus.dominantTags) - (secondary.deadCount * 12);
  const context = clamp(contextRaw, 0, 100);

  // Soft no-Speed penalty. A mod with 3+ revealed secondaries and no Speed
  // among them is worth little to the overwhelming majority of characters,
  // so knock 12 points off and surface a reason line. Shells whose users
  // genuinely don't want Speed (naturally slow characters) will still have
  // high fit.score and survive the penalty.
  const revealed = secondaries.filter(
    (s) => s && s.name && s.val !== ""
  );
  const hasSpeedSecondary = revealed.some((s) => s.name === "Speed");
  const missingSpeed = revealed.length >= 3 && !hasSpeedSecondary;
  const noSpeedPenalty = missingSpeed ? 12 : 0;

  const finalScore = clamp(
    fit.score * SLICE_RULES.scoreWeights.fit +
      secondary.score * SLICE_RULES.scoreWeights.secondaries +
      upside * SLICE_RULES.scoreWeights.upside +
      context * SLICE_RULES.scoreWeights.context -
      noSpeedPenalty,
    0,
    100
  );

  // Auto-sell: 3+ flat base stats (Speed excluded — flat Speed is always valued)
  const enteredFlats = secondaries.filter(
    (s) => s && s.name && s.val !== "" && SLICE_RULES.flatStats && SLICE_RULES.flatStats.has(s.name)
  );
  const forcedsell = enteredFlats.length >= (SLICE_RULES.flatStatSellThreshold || 3);
  const noExactShellUsers = !!modSet && exactBuildMatches.length === 0;
  const noShellUsers = !modSet && matches.length === 0;
  const noBuildUse = noExactShellUsers || noShellUsers;

  const decision = (forcedsell || noBuildUse) ? "SELL" : getDecisionLabel(Math.round(finalScore));
  const ceiling = getCeilingLabel(upside);
  const nextHit = getNextHitNarrative(secondary.scoredStats);
  const tierAction = tier
    ? getTierAction({
        tier,
        secondaries,
        shape,
        primary: selectedPrimary,
        finalScore,
        forcedsell,
        noBuildUse,
      })
    : null;
  const ladderPlan = buildLadderPlan({
    tier,
    finalScore,
    scoredStats: secondary.scoredStats,
    secondaries,
    shape,
    primary: selectedPrimary,
    forcedsell,
    noBuildUse,
  });
  const matchedCharacters = alignedMatches.map((m) => ({
    name: m.name,
    variant: m.variant,
    set: m.set,
    priorities: m.priorityList,
    fitTier: m.fitTier,
    matchScore: m.matchScore,
    alignedCount: m.alignedCount,
    strongAlignedCount: m.strongAlignedCount,
    alignedPriorityIndices: Array.from(m.alignedPriorityIndices || []),
    alignedStats: m.alignedStats || [],
    offPriorityHits: m.offPriorityHits || [],
    primaryPriorityIndex: m.primaryPriorityIndex ?? -1,
  }));

  const reasonLines = [
    ...fit.notes,
    ...secondary.topReasons,
  ];

  if (missingSpeed) {
    reasonLines.push("No Speed secondary – almost every character wants Speed first.");
  }
  if (forcedsell) {
    reasonLines.unshift("3+ flat base stats – low ceiling, not worth keeping.");
  } else if (noExactShellUsers) {
    reasonLines.unshift("No one uses this shape / primary / set combination.");
  } else if (noShellUsers) {
    reasonLines.unshift("No one uses this shape / primary combination.");
  } else if (!matches.length) {
    reasonLines.push("Scoring fell back to generic shell handling. Confidence is low.");
  } else if (consensus.dominantTags.length) {
    reasonLines.push(`Best fit profile: ${consensus.dominantTags.slice(0, 2).join(" + ")}.`);
  }
  if (shape === "Arrow" && selectedPrimary === "Speed") {
    reasonLines.push("Speed arrow gets extra 6E value from the +2 primary jump.");
  }

  return {
    finalScore: Math.round(finalScore),
    decision,
    ceiling,
    confidence: fit.confidence,
    fitScore: Math.round(fit.score),
    secondaryScore: Math.round(secondary.score),
    upsideScore: Math.round(upside),
    contextScore: Math.round(context),
    matchedCount: uniqueCharacterMatches.length,
    matchedCharacters,
    dominantTags: consensus.dominantTags,
    scoredStats: secondary.scoredStats,
    reasonLines,
    noBuildUse,
    bestCaseNextHit: nextHit.bestCase,
    worstCaseNextHit: nextHit.worstCase,
    tier: tier || null,
    tierAction,
    ladderPlan,
  };
}

// Convert a rosterService-normalized equipped mod into the {name,val,rolls}
// secondary shape used by scoreMatchAgainstEnteredSecondaries. rosterService
// already promotes "Offense" primary/secondary to "Offense%" via display_value
// inspection, so here we just pass the parsed numeric value through.
export function equippedModToScannedShape(equippedMod) {
  if (!equippedMod) return { secondaries: [], primary: null };
  const secondaries = (equippedMod.secondaries || []).map((s) => ({
    name: s.name,
    val: s.parsedValue ?? 0,
    rolls: s.rolls || 1,
    hidden: false,
  }));
  return { secondaries, primary: equippedMod.primary?.name || null };
}

// Public wrapper around the internal character-match scorer so callers outside
// evaluateSliceMod can score an arbitrary mod (scanned or equipped) against a
// character's priority list. The `match` argument accepts the shape returned
// by evaluateSliceMod().matchedCharacters: { name, priorities, fitTier }.
export function scoreModAgainstMatch({ match, secondaries, primary }) {
  if (!match || !Array.isArray(match.priorities)) return null;
  return scoreMatchAgainstEnteredSecondaries(
    { name: match.name, priorityList: match.priorities, fitTier: match.fitTier || "A" },
    secondaries || [],
    primary || null
  );
}

// Compare a scanned mod against the currently-equipped mod for a specific
// character+slot. `match` is an element of evaluateSliceMod().matchedCharacters
// and `equippedMod` is rosterService.normalizeMod's output for that character's
// current mod in the same shape. Returns null when we don't have enough data
// to make a comparison (e.g. equipped has no secondaries).
//
// Verdict thresholds are intentionally asymmetric: going from a worse to a
// better mod should be easy to flag (encourages swaps), while going the other
// way requires a bigger regression before we warn the user. "Sidegrade"
// catches the wide middle band where the two mods score similarly — swap cost
// isn't worth it.
export function compareScannedVsEquipped({
  match,
  scannedSecondaries,
  scannedPrimary,
  equippedMod,
}) {
  if (!match || !equippedMod) return null;
  if (!Array.isArray(equippedMod.secondaries) || equippedMod.secondaries.length === 0) {
    return null;
  }

  const scannedScore = scoreModAgainstMatch({
    match,
    secondaries: scannedSecondaries || [],
    primary: scannedPrimary,
  });
  const equippedShape = equippedModToScannedShape(equippedMod);
  const equippedScore = scoreModAgainstMatch({
    match,
    secondaries: equippedShape.secondaries,
    primary: equippedShape.primary,
  });
  if (!scannedScore || !equippedScore) return null;

  const rawDelta = scannedScore.score - equippedScore.score;
  const scoreDelta = Math.round(rawDelta * 10) / 10;

  let verdict;
  if (rawDelta > 4) verdict = "Upgrade";
  else if (rawDelta < -6) verdict = "Downgrade";
  else verdict = "Sidegrade";

  const statDeltas = computeKeyStatDeltas(
    scannedSecondaries || [],
    equippedMod,
    match.priorities || []
  );

  return { verdict, scoreDelta, statDeltas, scannedScore, equippedScore };
}

// Count how many of a mod's secondary stats land on a character's priority list.
// Flat/percent pairs normalize together so "Offense" flat counts the same as
// "Offense%" when the priority list calls for either. `secondaries` accepts
// either scanned shape ({ name, val }) or equipped-mod shape ({ name, parsedValue }).
export function countAlignedForMatch(match, secondaries) {
  if (!match || !Array.isArray(match.priorities)) return 0;
  const priorities = new Set(match.priorities.map(normalizePriorityName));
  let count = 0;
  for (const s of secondaries || []) {
    if (!s) continue;
    const rawName = s.name || s.stat;
    if (!rawName) continue;
    const n = normalizePriorityName(FLAT_TO_PERCENT[rawName] ?? rawName);
    if (priorities.has(n)) count++;
  }
  return count;
}

// For each priority stat the character cares about, compute the signed value
// delta between the scanned mod's secondary (or 0 if absent) and the equipped
// mod's secondary (or 0 if absent). Used to build the badge label like
// "+8 speed" / "-3 potency".
function computeKeyStatDeltas(scannedSecs, equippedMod, priorityList) {
  const equippedByName = new Map();
  for (const s of equippedMod.secondaries || []) {
    equippedByName.set(s.name, s.parsedValue || 0);
  }
  const scannedByName = new Map();
  for (const s of scannedSecs) {
    if (!s || !s.name || s.val === "" || s.val == null) continue;
    const v = parseFloat(s.val);
    if (!Number.isFinite(v)) continue;
    const name = FLAT_TO_PERCENT[s.name] ?? s.name;
    scannedByName.set(name, v);
  }
  const seen = new Set();
  const deltas = [];
  for (const raw of priorityList) {
    const stat = normalizePriorityName(raw);
    if (seen.has(stat)) continue;
    seen.add(stat);
    const a = scannedByName.get(stat) ?? 0;
    const b = equippedByName.get(stat) ?? 0;
    if (a === 0 && b === 0) continue;
    deltas.push({ stat, delta: Math.round((a - b) * 10) / 10 });
  }
  return deltas;
}
