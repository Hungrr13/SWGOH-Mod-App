import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, ScrollView, StyleSheet, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CHARS as _RAW_CHARS_F } from '../data/chars';
const _seenFinder = new Set();
const CHARS = _RAW_CHARS_F.filter(c => {
  if (_seenFinder.has(c.name)) return false;
  _seenFinder.add(c.name);
  return true;
});
import CharacterCard from '../components/CharacterCard';  // used in full profile view
import CustomPicker from '../components/CustomPicker';
import StatPickerModal from '../components/StatPickerModal';
import ModShapeIcon, { SHAPE_COLORS } from '../components/ModShapeIcon';
import { useAppTheme } from '../theme/appTheme';
import {
  decodeModSet, decodePrimary,
  MOD_SETS, SHAPES, SHAPE_PRIMARIES,
} from '../constants/modData';
import * as premiumState from '../services/premiumState';
import { showRewardedAd } from '../services/rewardedAds';

const FINDER_FULL_FEATURE = premiumState.FEATURES.FINDER_FULL;
const FREE_TIER_KEYS = new Set(['best']);

const NONE = '';

// ── Stat normalization ───────────────────────────────────────────────────────
// Character sec data may list flat stats (Offense, Health, etc.).
// We treat these as equivalent to their % counterpart for matching purposes.
// Entering the % version of a mod stat = full score.
// Entering the flat version = partial score (the mod is weaker).

const TO_PERCENT = {
  'Offense':    'Offense%',
  'Health':     'Health%',
  'Protection': 'Protection%',
  'Defense':    'Defense%',
};

const TO_FLAT = {
  'Offense%':    'Offense',
  'Health%':     'Health',
  'Protection%': 'Protection',
  'Defense%':    'Defense',
};
const FLAT_TIEBREAKER_SCORE = 0.5;

const SET_COLORS = {
  Speed: '#38bdf8',
  Offense: '#fb923c',
  'Crit Dmg': '#f87171',
  'Crit Chance': '#facc15',
  Health: '#4ade80',
  Defense: '#94a3b8',
  Potency: '#c084fc',
  Tenacity: '#2dd4bf',
};

const ROLE_TAG_ORDER = ['Attacker', 'Tank', 'Support', 'Healer', 'Leader', 'Tank/Leader', 'Support/Attacker'];

function splitTags(tags) {
  const safeTags = Array.isArray(tags) ? tags : [];
  const roleTags = ROLE_TAG_ORDER.filter(tag => safeTags.includes(tag));
  const otherTags = safeTags.filter(tag => !ROLE_TAG_ORDER.includes(tag));
  return {
    roleLine: roleTags.join(', '),
    categoryLine: otherTags.join(', '),
  };
}

function autoPrimaryForShape(shape) {
  if (shape === 'Square' || shape === 'Diamond') {
    return SHAPE_PRIMARIES[shape]?.[0] ?? NONE;
  }
  return NONE;
}

function parseSecs(str) {
  if (!str || str === '-') return [];
  return str.split('>').map(s => s.trim()).filter(Boolean);
}

function getPrimaryForShape(char, shape) {
  if (shape === 'Arrow') return decodePrimary(char.arrow);
  if (shape === 'Triangle') return decodePrimary(char.triangle);
  if (shape === 'Circle') return decodePrimary(char.circle);
  if (shape === 'Cross') return decodePrimary(char.cross);
  if (shape === 'Square') return 'Offense%';
  if (shape === 'Diamond') return 'Defense%';
  return NONE;
}

function canonicalizeSetLabel(setName = '') {
  return String(setName)
    .replace(/\(x\d+\)/i, '')
    .replace(/^Crit Damage$/i, 'Crit Dmg')
    .trim();
}

function parseSetRequirements(setName = '') {
  const raw = String(setName || '').trim();
  if (!raw || raw === '-') return {};

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

// Normalize a character's sec list — upgrade any flat wants to their % form
function normalizeSecs(secs) {
  return secs.map(s => TO_PERCENT[s] ?? s);
}

// Returns { score, matchedSet, matchedPrimary, matchedShape, secMatches }
function scoreChar(char, { modSet, primary, shape, sec1, sec2, sec3, sec4 }) {
  let score = 0;
  let matchedSet     = null;
  let matchedPrimary = null;
  let matchedShape   = null;
  const secMatches   = [];

  if (modSet) {
    const full = decodeModSet(char.modSet);
    const setRequirements = parseSetRequirements(full);
    const selectedSetCount = setRequirements[modSet] || 0;
    const mainSetCount = Math.max(0, ...Object.values(setRequirements));
    if (selectedSetCount > 0) {
      score += selectedSetCount === mainSetCount ? 2.5 : 1.5;
      matchedSet = full;
    }
  }

  const buildPrimary = getPrimaryForShape(char, shape);

  if (shape && primary) {
    if (buildPrimary === primary) {
      score += 3;
      matchedPrimary = primary;
      matchedShape   = shape;
    }
  } else if (shape && buildPrimary) {
    score += 1.5;
    matchedPrimary = buildPrimary;
    matchedShape = shape;
  }

  const rawSecs  = parseSecs(char.secs);
  const normSecs = normalizeSecs(rawSecs);
  const secFilters = [sec1, sec2, sec3, sec4].filter(Boolean);

  for (const sf of secFilters) {
    const sfNorm = TO_PERCENT[sf] ?? sf;
    const isFlat = sfNorm !== sf;

    const idx = normSecs.findIndex(s => s === sfNorm);
    if (idx === -1) continue;

    const positionScore = idx === 0 || idx === 1 ? 3 : idx === 2 ? 2 : 1;
    score += isFlat ? FLAT_TIEBREAKER_SCORE : positionScore;
    secMatches.push({ searched: sf, isFlat, position: idx });
  }

  return { score, matchedSet, matchedPrimary, matchedShape, secMatches };
}

function getMatchPresentation(score, topScore, rank) {
  const ratio = topScore > 0 ? score / topScore : 0;

  if (rank === 0) {
    return { label: 'Best Match', tone: '#f5a623', track: '#3a2a12' };
  }
  if (ratio >= 0.85) {
    return { label: 'Strong Match', tone: '#38bdf8', track: '#122c3f' };
  }
  if (ratio >= 0.65) {
    return { label: 'Good Match', tone: '#4ade80', track: '#123124' };
  }
  return { label: 'Possible Match', tone: '#94a3b8', track: '#243244' };
}

function classifyFinderTier(result) {
  const hasPrimary = !!result.matchedPrimary;
  const secCount = result.secMatches.length;

  if (result.score >= 9 && hasPrimary && secCount >= 2) return 'best';
  return 'good';
}

function isUsableFinderResult(result) {
  const hasPrimary = !!result.matchedPrimary;
  const hasSet = !!result.matchedSet;
  const secCount = result.secMatches.length;

  if (hasPrimary && secCount >= 1) return true;
  if (hasPrimary && hasSet) return true;
  if (hasSet && secCount >= 2) return true;
  if (secCount >= 3) return true;
  return false;
}

const FINDER_SECTIONS = [
  { key: 'best', title: 'Best Fits', hint: 'Strong shell match and good secondary alignment.' },
  { key: 'good', title: 'Good Fits', hint: 'Good users for this mod, just not the very best.' },
];

function FinderResultCard({ char, score, rank, topScore, matchedSet, matchedPrimary, matchedShape, secMatches, onFullProfile, expanded, onToggle }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const matchMeta = getMatchPresentation(score, topScore, rank);
  const fillWidth = topScore > 0 ? `${Math.max(16, Math.round((score / topScore) * 100))}%` : '16%';
  const { roleLine, categoryLine } = splitTags(char.tags);

  return (
    <View style={styles.resultCard}>
      <TouchableOpacity style={styles.resultNameRow} onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.resultNameLeft}>
          <Text style={styles.resultName}>{char.name}</Text>
          <View style={[styles.rankBadge, { borderColor: matchMeta.tone }]}>
            <Text style={[styles.rankBadgeText, { color: matchMeta.tone }]}>{`#${rank + 1}`}</Text>
          </View>
        </View>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.resultBody}>
          {!!roleLine && <Text style={styles.resultSub}>{roleLine}</Text>}
          {!!categoryLine && <Text style={styles.resultTagsLine}>{categoryLine}</Text>}

          <View style={styles.matchSummary}>
            <View style={styles.matchSummaryRow}>
              <Text style={[styles.matchSummaryText, { color: matchMeta.tone }]}>{matchMeta.label}</Text>
              <Text style={styles.matchSummaryRank}>{`Rank ${rank + 1}`}</Text>
            </View>
            <View style={[styles.matchMeter, { backgroundColor: matchMeta.track }]}>
              <View style={[styles.matchMeterFill, { width: fillWidth, backgroundColor: matchMeta.tone }]} />
            </View>
          </View>

          {/* Matched shell — set + primary/shape in one block */}
          {(matchedSet || matchedPrimary) && (
            <View style={styles.matchBlock}>
              {matchedSet && (
                <View style={[styles.matchRow, { borderLeftColor: '#f5a623' }]}>
                  <Text style={styles.matchRowLabel}>Set</Text>
                  <Text style={[styles.matchStat, { color: '#f5a623', flex: 1 }]}>{matchedSet}</Text>
                </View>
              )}
              {matchedPrimary && (
                <View style={[styles.matchRow, { borderLeftColor: '#38bdf8' }]}>
                  <Text style={styles.matchRowLabel}>Primary</Text>
                  <View style={styles.matchPrimaryContent}>
                    <Text style={[styles.matchStat, { color: '#38bdf8' }]}>{matchedPrimary}</Text>
                    {matchedShape && (
                      <View style={styles.matchShapeGroup}>
                        <Text style={styles.matchShapeTag}>{matchedShape}</Text>
                        <ModShapeIcon shape={matchedShape} size={13} />
                      </View>
                    )}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Matched secondaries — sorted by character priority */}
          {secMatches.length > 0 && (
            <>
              <Text style={styles.matchLabel}>Secondaries</Text>
              {[...secMatches].sort((a, b) => a.position - b.position).map((m, i) => {
                const color = m.isFlat ? '#475569' : m.position === 0 ? '#c084fc' : m.position === 1 ? '#60a5fa' : '#4ade80';
                const tag = m.isFlat ? 'flat (weak)' : `priority ${m.position + 1}`;
                return (
                  <View key={i} style={[styles.matchRow, { borderLeftColor: color }]}>
                    <Text style={[styles.matchStat, { color }]}>{m.searched}</Text>
                    <Text style={styles.matchTag}>{tag}</Text>
                  </View>
                );
              })}
            </>
          )}

          <TouchableOpacity style={styles.fullProfileBtn} onPress={onFullProfile}>
            <Text style={styles.fullProfileText}>Full Profile →</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function FinderScreen({ isActive = true, overlayPrefill = null, onOverlayPrefillConsumed }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [modSet, setModSet]   = useState(NONE);
  const [shape, setShape]     = useState(NONE);
  const [primary, setPrimary] = useState(NONE);
  const [sec1, setSec1] = useState(NONE);
  const [sec2, setSec2] = useState(NONE);
  const [sec3, setSec3] = useState(NONE);
  const [sec4, setSec4] = useState(NONE);
  const [results, setResults] = useState(null); // null = form, array = results view
  const [fullProfileName, setFullProfileName] = useState(null);
  const [statModal, setStatModal] = useState(null);
  const [expandedResultName, setExpandedResultName] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    best: true,
    good: false,
  });
  const [premium, setPremium] = useState(() => premiumState.getSnapshot());
  const [unlockBusy, setUnlockBusy] = useState(false);

  useEffect(() => {
    setPremium(premiumState.getSnapshot());
    return premiumState.subscribe(setPremium);
  }, []);

  const finderUnlocked = premium.isPremium || premiumState.hasFeature(FINDER_FULL_FEATURE);

  const handleUnlockFullList = useCallback(async () => {
    if (unlockBusy) return;
    setUnlockBusy(true);
    try {
      const result = await showRewardedAd(FINDER_FULL_FEATURE);
      if (!result.rewarded && result.reason === 'ads-unavailable') {
        // No-op: button stays, premium gating remains.
      }
    } finally {
      setUnlockBusy(false);
    }
  }, [unlockBusy]);

  const secSetters = [setSec1, setSec2, setSec3, setSec4];
  const secValues  = [sec1, sec2, sec3, sec4];
  const primOptions = shape ? SHAPE_PRIMARIES[shape] ?? [] : [];

  const handleReset = useCallback(() => {
    setModSet(NONE); setShape(NONE); setPrimary(NONE);
    setSec1(NONE); setSec2(NONE); setSec3(NONE); setSec4(NONE);
    setResults(null);
    setFullProfileName(null);
    setExpandedResultName(null);
  }, []);

  const runFinderSearch = useCallback((params) => {
    const seen = new Set();
    const scored = CHARS
      .map(c => ({ char: c, ...scoreChar(c, params) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .filter(({ char }) => {
        if (seen.has(char.name)) return false;
        seen.add(char.name);
        return true;
      })
      .filter(isUsableFinderResult);
    setResults(scored);
    setExpandedResultName(scored[0]?.char?.name ?? null);
    setExpandedSections({
      best: true,
      good: false,
    });
  }, []);

  const handleFind = useCallback(() => {
    runFinderSearch({ modSet, primary, shape, sec1, sec2, sec3, sec4 });
  }, [modSet, primary, shape, sec1, sec2, sec3, sec4, runFinderSearch]);

  useEffect(() => {
    if (isActive) return;
    setStatModal(null);
  }, [isActive]);

  useEffect(() => {
    if (!overlayPrefill?.token) return;

    const nextShape = overlayPrefill.shape || NONE;
    const nextPrimary = overlayPrefill.primary || autoPrimaryForShape(nextShape);
    const secondaries = Array.isArray(overlayPrefill.secondaries) ? overlayPrefill.secondaries : [];

    setModSet(overlayPrefill.modSet || NONE);
    setShape(nextShape);
    setPrimary(nextPrimary || NONE);
    setSec1(secondaries[0]?.stat || NONE);
    setSec2(secondaries[1]?.stat || NONE);
    setSec3(secondaries[2]?.stat || NONE);
    setSec4(secondaries[3]?.stat || NONE);
    setResults(null);
    setFullProfileName(null);
    setExpandedResultName(null);

    runFinderSearch({
      modSet: overlayPrefill.modSet || NONE,
      shape: nextShape,
      primary: nextPrimary || NONE,
      sec1: secondaries[0]?.stat || NONE,
      sec2: secondaries[1]?.stat || NONE,
      sec3: secondaries[2]?.stat || NONE,
      sec4: secondaries[3]?.stat || NONE,
    });

    onOverlayPrefillConsumed?.();
  }, [overlayPrefill, onOverlayPrefillConsumed, runFinderSearch]);

  // ── Results screen ─────────────────────────────────────────────────────────
  if (results !== null) {
    const resultsByName = new Map(results.map(item => [item.char.name, item]));
    const allGroupedResults = FINDER_SECTIONS.map(section => ({
      ...section,
      items: results.filter(item => classifyFinderTier(item) === section.key),
    })).filter(section => section.items.length > 0);
    const groupedResults = finderUnlocked
      ? allGroupedResults
      : allGroupedResults.filter(section => FREE_TIER_KEYS.has(section.key));
    const hiddenSections = finderUnlocked
      ? []
      : allGroupedResults.filter(section => !FREE_TIER_KEYS.has(section.key));
    const hiddenCount = hiddenSections.reduce((acc, s) => acc + s.items.length, 0);

    // Full profile view — one card, all others hidden
    if (fullProfileName !== null) {
      const item = resultsByName.get(fullProfileName);
      if (item) {
      return (
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.resultsHeader}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setFullProfileName(null)}>
              <Text style={styles.backArrow}>←</Text>
              <Text style={styles.backLabel}>Back to results</Text>
            </TouchableOpacity>
            <Text style={styles.resultsTitle}>{item.char.name}</Text>
            <View style={{ width: 60 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 24 }}>
            <CharacterCard char={item.char} score={item.score} />
          </ScrollView>
        </SafeAreaView>
      );
      }
    }

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.resultsHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setResults(null)}>
            <Text style={styles.backArrow}>←</Text>
            <Text style={styles.backLabel}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.resultsTitle}>
            {results.length > 0 ? `${results.length} suitable character${results.length !== 1 ? 's' : ''}` : 'No matches'}
          </Text>
          <TouchableOpacity style={styles.resetSmall} onPress={handleReset}>
            <Text style={styles.resetSmallText}>Reset</Text>
          </TouchableOpacity>
        </View>
        {results.length === 0 ? (
          <View style={styles.noResults}>
            <Text style={styles.noResultsText}>No characters match those mod stats.</Text>
            <Text style={styles.noResultsHint}>Try removing a secondary filter.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {groupedResults.map(section => (
              <View key={section.key} style={styles.resultSection}>
                <TouchableOpacity
                  style={styles.sectionHeader}
                  onPress={() => setExpandedSections(prev => ({ ...prev, [section.key]: !prev[section.key] }))}
                  activeOpacity={0.7}
                >
                  <View style={styles.sectionHeaderTextWrap}>
                    <Text style={styles.sectionTitle}>
                      {section.title} ({section.items.length})
                    </Text>
                    <Text style={styles.sectionHint}>{section.hint}</Text>
                  </View>
                  <Text style={styles.chevron}>{expandedSections[section.key] ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {expandedSections[section.key] && section.items.map(item => {
                  const rank = results.findIndex(r => r.char.name === item.char.name);
                  return (
                    <FinderResultCard
                      key={item.char.name}
                      char={item.char}
                      score={item.score}
                      rank={rank}
                      topScore={results[0]?.score ?? item.score}
                      matchedSet={item.matchedSet}
                      matchedPrimary={item.matchedPrimary}
                      matchedShape={item.matchedShape}
                      secMatches={item.secMatches}
                      expanded={expandedResultName === item.char.name}
                      onToggle={() => setExpandedResultName(prev => prev === item.char.name ? null : item.char.name)}
                      onFullProfile={() => setFullProfileName(item.char.name)}
                    />
                  );
                })}
              </View>
            ))}
            {hiddenCount > 0 ? (
              <View style={styles.paywallCard}>
                <Text style={styles.paywallTitle}>
                  {hiddenCount} more match{hiddenCount === 1 ? '' : 'es'} hidden
                </Text>
                <Text style={styles.paywallBody}>
                  Premium unlocks the full list of every character that can use this mod —
                  not just the strongest fits. Watch a short ad to unlock for 24 hours.
                </Text>
                <TouchableOpacity
                  style={[styles.paywallButton, unlockBusy && { opacity: 0.55 }]}
                  onPress={handleUnlockFullList}
                  disabled={unlockBusy}
                  activeOpacity={0.8}
                >
                  <Text style={styles.paywallButtonText}>
                    {unlockBusy ? 'Loading ad…' : 'Watch ad to show all (24h)'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  // ── Form screen ────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>Mod Finder</Text>
        <Text style={styles.subheading}>Match a mod shell to the heroes who use it best</Text>

        <View style={styles.formCard}>
          <Text style={styles.sectionLabel}>Mod Set</Text>
          <View style={styles.setGrid}>
            {MOD_SETS.map(s => {
              const active = modSet === s;
              const color = SET_COLORS[s] ?? theme.text;
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.setCell, active && { borderColor: color, backgroundColor: theme.surfaceAlt }]}
                  onPress={() => setModSet(active ? NONE : s)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.setCellText, active && { color, fontWeight: '700' }]}>{s}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>Mod Shape</Text>
          <View style={styles.shapeGrid}>
            {SHAPES.map(s => {
              const active = shape === s;
              const color = SHAPE_COLORS[s];
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.shapeCell, active && { borderColor: color, backgroundColor: theme.surfaceAlt }]}
                  onPress={() => {
                    setShape(s);
                    setPrimary(autoPrimaryForShape(s));
                  }}
                  activeOpacity={0.7}
                >
                  <ModShapeIcon shape={s} size={22} />
                  <Text style={[styles.shapeCellText, active && { color }]}>{s}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {shape !== NONE && (
            <>
              <Text style={styles.sectionLabel}>Primary Stat</Text>
              <CustomPicker
                selectedValue={primary}
                onValueChange={setPrimary}
                items={[
                  { label: 'Any primary', value: NONE },
                  ...primOptions.map(p => ({ label: p, value: p })),
                ]}
              />
            </>
          )}

          <Text style={styles.sectionLabel}>Secondary Stats</Text>
          {['Stat 1','Stat 2','Stat 3','Stat 4'].map((label, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.statTrigger, secValues[i] && styles.statTriggerActive]}
              onPress={() => setStatModal(i)}
              activeOpacity={0.7}
            >
              <Text style={[styles.statTriggerText, secValues[i] && styles.statTriggerTextActive]}>
                {secValues[i] || label}
              </Text>
            </TouchableOpacity>
          ))}

          <StatPickerModal
            visible={statModal !== null}
            selected={statModal !== null ? secValues[statModal] : ''}
            onSelect={v => statModal !== null && secSetters[statModal](v)}
            onClose={() => setStatModal(null)}
          />

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.findBtn} onPress={handleFind}>
              <Text style={styles.findBtnText}>Find Characters</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
              <Text style={styles.resetBtnText}>Reset</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = colors => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  formContent: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 24 },
  heading: {
    color: '#f5a623',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 4,
  },
  subheading: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 10,
  },

  // Results header
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backArrow: { color: '#f5a623', fontSize: 20, fontWeight: 'bold' },
  backLabel: { color: '#f5a623', fontSize: 14, fontWeight: '600' },
  resultsTitle: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  resetSmall: {
    borderWidth: 1,
    borderColor: colors.soft,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  resetSmallText: { color: colors.muted, fontSize: 12 },
  noResults: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  noResultsText: { color: colors.muted, fontSize: 15, fontWeight: '600', marginBottom: 6 },
  noResultsHint: { color: colors.soft, fontSize: 12 },

  formCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 10,
  },
  shapeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  setGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  setCell: {
    width: '23%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 7,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setCellText: { color: colors.soft, fontSize: 12, textAlign: 'center' },
  shapeCell: {
    width: '30%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.background,
  },
  shapeCellText: {
    color: colors.soft,
    fontSize: 11,
    fontWeight: '600',
  },
  statTrigger: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 6,
  },
  statTriggerActive: { borderColor: '#f5a623' },
  statTriggerText: { color: colors.soft, fontSize: 13 },
  statTriggerTextActive: { color: '#f5a623', fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  findBtn: {
    flex: 1,
    backgroundColor: '#f5a623',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  findBtnText: { color: '#0a0e17', fontWeight: 'bold', fontSize: 15 },
  resetBtn: {
    borderWidth: 1,
    borderColor: colors.soft,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  resetBtnText: { color: colors.muted, fontWeight: '600', fontSize: 14 },
  resultCount: {
    color: colors.soft,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
  },
  list: { paddingBottom: 24, paddingHorizontal: 12 },
  resultSection: {
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  sectionHeaderTextWrap: {
    flex: 1,
    paddingRight: 8,
  },
  sectionTitle: {
    color: '#f5a623',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  sectionHint: {
    color: colors.soft,
    fontSize: 11,
  },
  paywallCard: {
    marginTop: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.55)',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  paywallTitle: {
    color: '#c4b5fd',
    fontSize: 14,
    fontWeight: '800',
  },
  paywallBody: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  paywallButton: {
    backgroundColor: '#7c3aed',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  paywallButtonText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '800',
  },

  // FinderResultCard
  resultCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  resultNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  resultNameLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultName: { color: '#f5a623', fontSize: 14, fontWeight: 'bold' },
  rankBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: colors.surfaceAlt,
  },
  rankBadgeText: { fontSize: 11, fontWeight: '800' },
  chevron: { color: colors.soft, fontSize: 12 },
  resultBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  resultSub: { color: colors.soft, fontSize: 11, marginBottom: 2 },
  resultTagsLine: { color: colors.text, fontSize: 11, marginBottom: 10 },
  matchSummary: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  matchSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  matchSummaryText: { fontSize: 12, fontWeight: '800' },
  matchSummaryRank: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  matchMeter: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  matchMeterFill: {
    height: '100%',
    borderRadius: 999,
  },
  matchLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  matchBlock: {
    gap: 4,
    marginBottom: 8,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 6,
    marginBottom: 4,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 4,
  },
  matchRowLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    width: 56,
  },
  matchPrimaryContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  matchShapeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  matchStat: { fontSize: 13, fontWeight: '700' },
  matchShapeTag: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  matchTag: { color: colors.soft, fontSize: 11 },
  fullProfileBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.soft,
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
  },
  fullProfileText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  backToResult: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backToResultText: { color: '#f5a623', fontSize: 13, fontWeight: '600' },
});
