import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CustomPicker from '../components/CustomPicker';
import StatPickerModal from '../components/StatPickerModal';
import ModShapeIcon, { SHAPE_COLORS } from '../components/ModShapeIcon';
import { useAppTheme } from '../theme/appTheme';
import {
  SHAPES, SHAPE_PRIMARIES, MOD_SETS,
  SLICE_REF, secQualityColor,
  decodePrimary, decodeModSet,
  MOD_TIERS, rollEfficiency, efficiencyColor, efficiencyLabel,
} from '../constants/modData';
import { CHARS as RAW_CHARS } from '../data/chars';
import { evaluateSliceMod } from '../services/sliceEngine';
import SlicerWhyPanel from '../components/SlicerWhyPanel';
import * as premiumState from '../services/premiumState';
import * as rosterState from '../services/rosterState';
import { CHAR_BASE_IDS } from '../data/charBaseIds';

// ── Decode chars once, deduplicate by name ───────────────────────────────────
const _seen = new Set();
const DECODED_CHARS = RAW_CHARS.filter(c => {
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

// ── Map SLICE_REF to format sliceEngine expects ──────────────────────────────
const ENGINE_SLICE_REF = SLICE_REF.map(r => ({
  stat: r.s, max5: r.m5, max6: r.m6, good: r.g, great: r.gr,
}));

// ── Decision colour helpers ──────────────────────────────────────────────────
function decisionColor(label) {
  if (label === 'PREMIUM SLICE')   return '#4ade80';
  if (label === 'STRONG SLICE')    return '#86efac';
  if (label === 'SLICE IF NEEDED') return '#facc15';
  if (label === 'HOLD')            return '#fb923c';
  if (label === 'FILLER ONLY')     return '#94a3b8';
  return '#f87171'; // SELL
}

function confidenceColor(c) {
  if (c === 'HIGH')   return '#4ade80';
  if (c === 'MEDIUM') return '#facc15';
  return '#f87171';
}

function bandColor(band) {
  if (band === 'GREAT') return '#c084fc';
  if (band === 'GOOD')  return '#60a5fa';
  return '#4ade80';
}

function decisionDefinition(label) {
  if (label === 'PREMIUM SLICE') return 'Top-tier mod. Spend slice mats confidently.';
  if (label === 'STRONG SLICE') return 'Very good slice target with strong value.';
  if (label === 'SLICE IF NEEDED') return 'Worth slicing when you need this exact mod type.';
  if (label === 'HOLD') return 'Keep and use it, but save slice mats for better mods.';
  if (label === 'FILLER ONLY') return 'Usable for now, but not worth slicing.';
  return 'Low-value mod shell or weak stat mix.';
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

// ── Set accent colours (matches setColor in modData) ─────────────────────────
const SET_COLORS = {
  Speed:        '#38bdf8',
  Offense:      '#fb923c',
  'Crit Dmg':   '#f87171',
  'Crit Chance':'#facc15',
  Health:       '#4ade80',
  Defense:      '#94a3b8',
  Potency:      '#c084fc',
  Tenacity:     '#2dd4bf',
};

const NONE = '';

const EMPTY_SECS = [
  { stat: NONE, value: '', rolls: '', hidden: false },
  { stat: NONE, value: '', rolls: '', hidden: false },
  { stat: NONE, value: '', rolls: '', hidden: false },
  { stat: NONE, value: '', rolls: '', hidden: false },
];

function autoPrimaryForShape(shape) {
  if (shape === 'Square' || shape === 'Diamond') {
    return SHAPE_PRIMARIES[shape]?.[0] ?? NONE;
  }
  return NONE;
}

export default function SliceScreen({ isActive = true, overlayPrefill = null, onOverlayPrefillConsumed }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [shape, setShape]     = useState(NONE);
  const [primary, setPrimary] = useState(NONE);
  const [modSet, setModSet]   = useState(NONE);
  const [secs, setSecs]       = useState(EMPTY_SECS);
  const [tier, setTier]       = useState('5A');
  const [statModal, setStatModal] = useState(null);
  const [charsExpanded, setCharsExpanded] = useState(false);
  const [premium, setPremium] = useState(() => premiumState.getSnapshot());
  const [rosterSnap, setRosterSnap] = useState(() => rosterState.getSnapshot());
  const [ownedIds, setOwnedIds] = useState(() => rosterState.getCurrentOwnedIds());

  useEffect(() => {
    setPremium(premiumState.getSnapshot());
    return premiumState.subscribe(setPremium);
  }, []);

  useEffect(() => {
    setRosterSnap(rosterState.getSnapshot());
    setOwnedIds(rosterState.getCurrentOwnedIds());
    return rosterState.subscribe(snap => {
      setRosterSnap(snap);
      setOwnedIds(rosterState.getCurrentOwnedIds());
    });
  }, []);

  const whyUnlocked = premium.isPremium || premiumState.hasFeature(premiumState.FEATURES.SLICER_WHY);
  const hasRoster = !!rosterSnap.hasRoster;
  const showYours = premium.isPremium && hasRoster;

  const isOwnedChar = (name) => {
    if (!ownedIds) return false;
    const baseId = CHAR_BASE_IDS[name];
    return baseId ? ownedIds.has(baseId) : false;
  };

  const modStatusFor = (name) => {
    const baseId = CHAR_BASE_IDS[name];
    if (!baseId) return null;
    return rosterState.getModSummary(baseId);
  };

  const primOptions = shape ? SHAPE_PRIMARIES[shape] ?? [] : [];

  function updateSec(index, field, value) {
    setSecs(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function clampSecValue(stat, rawValue) {
    const ref = SLICE_REF.find(r => r.s === stat);
    if (!ref) return rawValue;
    const v = parseFloat(rawValue);
    if (isNaN(v)) return rawValue;
    const clamped = Math.min(ref.m5, Math.max(0, v));
    return String(parseFloat(clamped.toFixed(3)));
  }

  // ── Engine result ──────────────────────────────────────────────────────────
  const result = useMemo(() => {
    if (shape === NONE) return null;
    return evaluateSliceMod({
      chars:       DECODED_CHARS,
      sliceRef:    ENGINE_SLICE_REF,
      shape,
      primary,
      modSet:      modSet || '',
      secondaries: secs.map(s => ({
        name: s.stat,
        val: s.value,
        rolls: s.rolls,
        hidden: s.hidden,
      })),
      tier,
    });
  }, [shape, primary, modSet, secs, tier]);

  const dotLevel = tier && String(tier).startsWith('6') ? 6 : 5;

  // ── Per-stat quality rows (local, always available) ───────────────────────
  const secRows = secs.map((sec) => {
    if (!sec.stat || sec.value === '') return null;
    const v = parseFloat(sec.value);
    if (isNaN(v)) return null;
    const ref = SLICE_REF.find(r => r.s === sec.stat);
    if (!ref) return null;
    const color = secQualityColor(sec.stat, v);
    let quality = 'Partial';
    if (v >= ref.gr) quality = 'Strong';
    else if (v >= ref.g) quality = 'Good';
    return { stat: sec.stat, value: sec.value, color, quality, ref };
  }).filter(Boolean);

  const reset = () => {
    setShape(NONE);
    setPrimary(NONE);
    setModSet(NONE);
    setSecs(EMPTY_SECS);
    setTier('5A');
    setCharsExpanded(false);
  };

  useEffect(() => {
    if (isActive) return;
    setStatModal(null);
  }, [isActive]);

  useEffect(() => {
    if (!overlayPrefill?.token) return;

    const nextShape = overlayPrefill.shape || NONE;
    const nextPrimary = overlayPrefill.primary || autoPrimaryForShape(nextShape);
    const nextSecs = EMPTY_SECS.map((slot, index) => {
      const incoming = overlayPrefill.secondaries?.[index];
      if (!incoming) return slot;
      return {
        stat: incoming.stat || NONE,
        value: incoming.value || '',
        rolls: incoming.rolls ? String(incoming.rolls) : '',
        hidden: !!incoming.hidden,
      };
    });

    setShape(nextShape);
    setPrimary(nextPrimary || NONE);
    setModSet(overlayPrefill.modSet || NONE);
    setSecs(nextSecs);
    setCharsExpanded(false);

    onOverlayPrefillConsumed?.();
  }, [overlayPrefill, onOverlayPrefillConsumed]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>Mod Slicer</Text>
        <Text style={styles.subheading}>Enter your mod's stats to see slice potential</Text>

        {/* ── Shell: Mod Set + Shape + Primary + Stats ── */}
        <View style={styles.card}>
          <Text style={styles.label}>Mod Set</Text>
          <View style={styles.setGrid}>
            {MOD_SETS.map(s => {
              const active = modSet === s;
              const color = SET_COLORS[s] ?? '#e2e8f0';
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

          <Text style={styles.label}>Mod Shape</Text>
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
                  <ModShapeIcon shape={s} size={28} />
                  <Text style={[styles.shapeCellText, active && { color }]}>{s}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {shape !== NONE && (
            <>
              <Text style={styles.label}>Primary Stat</Text>
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

          <Text style={styles.label}>Current Tier</Text>
          <View style={styles.tierRow}>
            {MOD_TIERS.map(t => {
              const active = tier === t;
              return (
                <TouchableOpacity
                  key={t}
                  style={[styles.tierPill, active && styles.tierPillActive]}
                  onPress={() => setTier(t)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.tierPillText, active && styles.tierPillTextActive]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.label, styles.secondaryLabel]}>Secondary Stats</Text>
          {secs.map((sec, i) => (
            <React.Fragment key={i}>
            <View style={styles.secRow}>
              <TouchableOpacity
                style={[
                  styles.statTrigger,
                  sec.stat && styles.statTriggerActive,
                  result?.noBuildUse && styles.statTriggerBlocked,
                ]}
                onPress={() => {
                  if (result?.noBuildUse) return;
                  setStatModal(i);
                }}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.statTriggerText,
                    sec.stat && styles.statTriggerTextActive,
                    result?.noBuildUse && styles.statTriggerTextBlocked,
                  ]}
                >
                  {result?.noBuildUse ? 'No Builds Sell' : (sec.stat || `Stat ${i + 1}`)}
                </Text>
              </TouchableOpacity>
              <View style={styles.valueCol}>
                {result?.noBuildUse ? (
                  <Text style={[styles.rangeHint, styles.rangeHintBlocked]}>Skip stats</Text>
                ) : sec.stat ? (
                  <Text style={styles.rangeHint}>
                    {'0 – ' + (SLICE_REF.find(r => r.s === sec.stat)?.m5 ?? '—')}
                  </Text>
                ) : (
                  <Text style={styles.rangeHint}> </Text>
                )}
                <TextInput
                  style={[styles.valueInput, result?.noBuildUse && styles.valueInputBlocked]}
                  placeholder="Value"
                  placeholderTextColor={result?.noBuildUse ? '#fca5a5' : theme.soft}
                  value={result?.noBuildUse ? '' : sec.value}
                  onChangeText={v => updateSec(i, 'value', v)}
                  onBlur={() => {
                    if (result?.noBuildUse) return;
                    if (sec.stat && sec.value !== '') {
                      updateSec(i, 'value', clampSecValue(sec.stat, sec.value));
                    }
                  }}
                  editable={!result?.noBuildUse}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            {!result?.noBuildUse && (sec.stat || sec.hidden) && (
              <View style={styles.secMetaRow}>
                <Text style={styles.secMetaLabel}>Rolls</Text>
                <View style={styles.rollPills}>
                  {[1, 2, 3, 4, 5].map(n => {
                    const active = String(sec.rolls) === String(n);
                    return (
                      <TouchableOpacity
                        key={n}
                        style={[styles.rollPill, active && styles.rollPillActive]}
                        onPress={() => updateSec(i, 'rolls', active ? '' : String(n))}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.rollPillText, active && styles.rollPillTextActive]}>{n}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TouchableOpacity
                  style={[styles.hiddenToggle, sec.hidden && styles.hiddenToggleActive]}
                  onPress={() => updateSec(i, 'hidden', !sec.hidden)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.hiddenToggleText, sec.hidden && styles.hiddenToggleTextActive]}>
                    {sec.hidden ? 'Hidden' : 'Reveal?'}
                  </Text>
                </TouchableOpacity>
                {sec.stat && sec.value !== '' && sec.rolls && (() => {
                  const eff = rollEfficiency(sec.stat, sec.value, sec.rolls, dotLevel);
                  if (eff === null) return null;
                  return (
                    <Text style={[styles.effText, { color: efficiencyColor(eff) }]}>
                      {efficiencyLabel(eff)} {Math.round(eff * 100)}%
                    </Text>
                  );
                })()}
              </View>
            )}
          </React.Fragment>
          ))}
        </View>

        <StatPickerModal
          visible={statModal !== null}
          selected={statModal !== null ? secs[statModal].stat : ''}
          onSelect={v => statModal !== null && updateSec(statModal, 'stat', v)}
          onClose={() => setStatModal(null)}
        />

        {/* ── Engine Analysis ── */}
        {result && (
          <>
            {/* Tier action card intentionally removed — the Decision card below is the single verdict. */}

            {/* Decision */}
            <View style={[styles.verdictCard, { borderColor: decisionColor(result.decision) }]}>
              <Text style={[styles.verdictLabel, { color: decisionColor(result.decision) }]}>
                {result.decision}
              </Text>
              <Text style={styles.verdictScore}>Score: {result.finalScore} / 100</Text>
              <Text style={styles.verdictMeaning}>
                {decisionDefinition(result.decision)}
              </Text>
              {result.reasonLines[0] ? (
                <Text style={styles.verdictReason}>{result.reasonLines[0]}</Text>
              ) : null}
            </View>

            {/* Why · Premium / rewarded-ad gated breakdown */}
            <SlicerWhyPanel result={result} />

            {/* Next hit */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Next Roll Potential</Text>
              <View style={styles.metaRow}>
                <Text style={[styles.metaKey, { color: '#4ade80' }]}>Best case </Text>
                <Text style={[styles.metaVal, { flex: 2 }]}>{result.bestCaseNextHit}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={[styles.metaKey, { color: '#f87171' }]}>Worst case </Text>
                <Text style={[styles.metaVal, { flex: 2 }]}>{result.worstCaseNextHit}</Text>
              </View>
            </View>

            {/* Reason lines — premium-gated (free users see headline in verdict card) */}
            {whyUnlocked && result.reasonLines.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Analysis</Text>
                {result.reasonLines.map((line, i) => (
                  <View key={i} style={styles.reasonRow}>
                    <Text style={styles.reasonDot}>·</Text>
                    <Text style={styles.reasonText}>{line}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Best matching characters */}
            {result.matchedCharacters.length > 0 && (() => {
              const topScore = result.matchedCharacters[0]?.matchScore ?? 0;
              const ownedMatches = result.matchedCharacters.filter(c => isOwnedChar(c.name));
              const renderCharRow = (c, i, { compact = false } = {}) => {
                const matchMeta = getMatchPresentation(c.matchScore, topScore, i);
                const fillWidth = topScore > 0 ? `${Math.max(16, Math.round((c.matchScore / topScore) * 100))}%` : '16%';
                const owned = isOwnedChar(c.name);
                return (
                  <View key={`${c.name}-${i}`} style={styles.charRow}>
                    <View style={styles.charHeader}>
                      <View style={styles.charTitleWrap}>
                        <Text style={styles.charName} numberOfLines={1}>{c.name}</Text>
                        <View style={[styles.rankBadge, { borderColor: matchMeta.tone }]}>
                          <Text style={[styles.rankBadgeText, { color: matchMeta.tone }]}>{`#${i + 1}`}</Text>
                        </View>
                      </View>
                      {!compact && (
                        <Text style={styles.charVariant}>
                          {c.variant === 'alternate' ? 'Alt build' : 'Main build'}
                        </Text>
                      )}
                    </View>
                    {hasRoster && (() => {
                      const badges = [];
                      if (!owned) {
                        badges.push(
                          <View key="own" style={[styles.miniBadge, styles.badgeNotOwned]}>
                            <Text style={[styles.miniBadgeText, { color: '#fca5a5' }]}>Not unlocked</Text>
                          </View>
                        );
                      } else {
                        const mods = modStatusFor(c.name);
                        if (!mods?.hasModData) {
                          badges.push(
                            <View key="mod" style={[styles.miniBadge, styles.badgeUnknown]}>
                              <Text style={[styles.miniBadgeText, { color: '#cbd5e1' }]}>Mods: unknown</Text>
                            </View>
                          );
                        } else {
                          const filled = 6 - (mods.missingSlots || 0);
                          const fullyModded = mods.missingSlots === 0;
                          badges.push(
                            <View
                              key="mod"
                              style={[styles.miniBadge, fullyModded ? styles.badgeOwned : styles.badgeEmptySlot]}
                            >
                              <Text
                                style={[styles.miniBadgeText, { color: fullyModded ? '#86efac' : '#fde047' }]}
                              >
                                {`${filled}/6 mods`}
                              </Text>
                            </View>
                          );
                          if (mods.upgradeable > 0) {
                            badges.push(
                              <View key="up" style={[styles.miniBadge, styles.badgeUpgrade]}>
                                <Text style={[styles.miniBadgeText, { color: '#93c5fd' }]}>
                                  {`${mods.upgradeable} to upgrade`}
                                </Text>
                              </View>
                            );
                          }
                        }
                      }
                      return badges.length ? <View style={styles.badgeRow}>{badges}</View> : null;
                    })()}
                    <View style={styles.matchSummary}>
                      <View style={styles.matchSummaryRow}>
                        <Text style={[styles.matchSummaryText, { color: matchMeta.tone }]}>{matchMeta.label}</Text>
                        {!compact && (
                          <Text style={styles.matchSummaryRank}>{`${c.alignedCount} stat${c.alignedCount === 1 ? '' : 's'} aligned`}</Text>
                        )}
                      </View>
                      <View style={[styles.matchMeter, { backgroundColor: matchMeta.track }]}>
                        <View style={[styles.matchMeterFill, { width: fillWidth, backgroundColor: matchMeta.tone }]} />
                      </View>
                    </View>
                    {!compact && (
                      <Text style={styles.charPriorities}>{c.priorities.join(' › ')}</Text>
                    )}
                  </View>
                );
              };

              if (showYours) {
                return (
                  <View style={styles.splitRow}>
                    <View style={[styles.card, styles.splitCard]}>
                      <TouchableOpacity
                        style={styles.cardTitleRow}
                        onPress={() => setCharsExpanded(e => !e)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.cardTitle} numberOfLines={1}>
                          Your Roster ({ownedMatches.length})
                        </Text>
                        <Text style={styles.chevron}>{charsExpanded ? '▲' : '▼'}</Text>
                      </TouchableOpacity>
                      {charsExpanded && (ownedMatches.length === 0 ? (
                        <Text style={styles.emptyHint}>No owned characters match this mod.</Text>
                      ) : (
                        ownedMatches.map((c) => renderCharRow(c, result.matchedCharacters.indexOf(c), { compact: true }))
                      ))}
                    </View>
                    <View style={[styles.card, styles.splitCard]}>
                      <TouchableOpacity
                        style={styles.cardTitleRow}
                        onPress={() => setCharsExpanded(e => !e)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.cardTitle} numberOfLines={1}>
                          Best Fit ({result.matchedCount})
                        </Text>
                        <Text style={styles.chevron}>{charsExpanded ? '▲' : '▼'}</Text>
                      </TouchableOpacity>
                      {charsExpanded && result.matchedCharacters.map((c, i) => renderCharRow(c, i, { compact: true }))}
                    </View>
                  </View>
                );
              }

              return (
                <View style={styles.card}>
                  <TouchableOpacity
                    style={styles.cardTitleRow}
                    onPress={() => setCharsExpanded(e => !e)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.cardTitle}>
                      Best Characters ({result.matchedCount})
                    </Text>
                    <Text style={styles.chevron}>{charsExpanded ? '▲' : '▼'}</Text>
                  </TouchableOpacity>
                  {charsExpanded && result.matchedCharacters.map((c, i) => renderCharRow(c, i))}
                </View>
              );
            })()}
          </>
        )}

        {/* ── Per-stat quality breakdown — premium-gated ── */}
        {whyUnlocked && secRows.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Stat Quality</Text>
            {secRows.map((row, i) => (
              <View key={i} style={[styles.statQualityRow, i === secRows.length - 1 && { borderBottomWidth: 0, marginBottom: 0, paddingBottom: 0 }]}>
                <Text style={styles.statName}>{row.stat}</Text>
                <View style={styles.statValues}>
                  <Text style={styles.statVal}>{row.value}</Text>
                  <View style={[styles.qualityBadge, { borderColor: row.color }]}>
                    <Text style={[styles.qualityText, { color: row.color }]}>
                      {row.quality}
                    </Text>
                  </View>
                </View>
                <View style={styles.thresholdRow}>
                  <Text style={styles.threshold}>Good: {row.ref.g}</Text>
                  <Text style={styles.threshold}>Great: {row.ref.gr}</Text>
                  <Text style={styles.threshold}>Max: {row.ref.m5}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Reset */}
        <TouchableOpacity style={styles.resetBtn} onPress={reset}>
          <Text style={styles.resetText}>Reset</Text>
        </TouchableOpacity>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = colors => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  container: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 12 },
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  cardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  chevron: { color: colors.soft, fontSize: 12 },
  shapeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
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
  setGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
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
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 8,
  },
  secondaryLabel: {
    marginBottom: 2,
  },
  tierRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  tierPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  tierPillActive: {
    borderColor: '#f5a623',
    backgroundColor: '#3a2a12',
  },
  tierPillText: { color: colors.soft, fontSize: 12, fontWeight: '600' },
  tierPillTextActive: { color: '#f5a623' },
  secRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 2 },
  secMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  secMetaLabel: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  rollPills: { flexDirection: 'row', gap: 4 },
  rollPill: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  rollPillActive: { borderColor: '#60a5fa', backgroundColor: '#122c3f' },
  rollPillText: { color: colors.soft, fontSize: 11, fontWeight: '600' },
  rollPillTextActive: { color: '#60a5fa' },
  hiddenToggle: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  hiddenToggleActive: { borderColor: '#f5a623', backgroundColor: '#3a2a12' },
  hiddenToggleText: { color: colors.soft, fontSize: 11, fontWeight: '600' },
  hiddenToggleTextActive: { color: '#f5a623' },
  effText: { fontSize: 11, fontWeight: '700', marginLeft: 'auto' },
  statTrigger: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  statTriggerActive: { borderColor: '#f5a623' },
  statTriggerBlocked: {
    borderColor: '#ef4444',
    backgroundColor: '#2a1116',
  },
  statTriggerText: { color: colors.soft, fontSize: 13 },
  statTriggerTextActive: { color: '#f5a623', fontWeight: '700' },
  statTriggerTextBlocked: { color: '#fca5a5', fontWeight: '700' },
  valueCol: { alignItems: 'center', marginLeft: 8 },
  rangeHint: { color: colors.soft, fontSize: 10, marginBottom: 0 },
  rangeHintBlocked: { color: '#fca5a5' },
  valueInput: {
    width: 80,
    height: 42,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 10,
    fontSize: 14,
    textAlign: 'center',
  },
  valueInputBlocked: {
    borderColor: '#ef4444',
    backgroundColor: '#2a1116',
    color: '#fca5a5',
  },
  // ── Verdict ──
  verdictCard: {
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  verdictLabel: {
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  verdictScore: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 4,
  },
  verdictMeaning: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'center',
    color: colors.soft,
    lineHeight: 18,
  },
  verdictReason: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },
  // ── Score grid ──
  scoreGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  scoreCell: { alignItems: 'center', flex: 1 },
  scoreCellVal: { fontSize: 24, fontWeight: 'bold' },
  scoreCellLabel: { color: colors.soft, fontSize: 10, fontWeight: '600', marginTop: 2 },
  // ── Meta rows ──
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceAlt,
  },
  metaKey: { color: colors.soft, fontSize: 12 },
  metaVal: { color: colors.text, fontSize: 12, fontWeight: '600' },
  // ── Reason lines ──
  reasonRow: { flexDirection: 'row', marginBottom: 4 },
  reasonDot: { color: colors.soft, marginRight: 6, fontSize: 13 },
  reasonText: { color: colors.muted, fontSize: 13, flex: 1 },
  // ── Matched chars ──
  charRow: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  charHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  charTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, paddingRight: 8 },
  charName: { color: colors.text, fontSize: 13, fontWeight: '700' },
  charVariant: { color: colors.soft, fontSize: 11 },
  rankBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: colors.surfaceAlt,
  },
  rankBadgeText: { fontSize: 11, fontWeight: '800' },
  matchSummary: { marginTop: 6, marginBottom: 6 },
  matchSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
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
  charPriorities: { color: '#60a5fa', fontSize: 12 },
  splitRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  splitCard: {
    flex: 1,
    marginBottom: 0,
    padding: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  miniBadge: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  miniBadgeText: { fontSize: 10, fontWeight: '700' },
  badgeNotOwned: { borderColor: '#f87171', backgroundColor: '#2a1116' },
  badgeOwned: { borderColor: '#4ade80', backgroundColor: '#11251a' },
  badgeEmptySlot: { borderColor: '#facc15', backgroundColor: '#2a2410' },
  badgeUpgrade: { borderColor: '#60a5fa', backgroundColor: '#122c3f' },
  badgeUnknown: { borderColor: '#64748b', backgroundColor: '#1e293b' },
  emptyHint: { color: colors.soft, fontSize: 12, fontStyle: 'italic', paddingVertical: 4 },
  // ── Stat quality ──
  statQualityRow: {
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statName: { color: colors.text, fontSize: 13, fontWeight: '600', marginBottom: 4 },
  statValues: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  statVal: { color: '#f5a623', fontSize: 16, fontWeight: 'bold' },
  qualityBadge: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  qualityText: { fontSize: 12, fontWeight: '700' },
  thresholdRow: { flexDirection: 'row', gap: 12 },
  threshold: { color: colors.soft, fontSize: 11 },
  // ── Reference table ──
  tableHeader: {
    flexDirection: 'row',
    marginBottom: 4,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceAlt,
  },
  tableCell: { flex: 1, fontSize: 12, textAlign: 'center' },
  tableHead: { color: colors.muted, fontWeight: '700', fontSize: 11 },
  // ── Reset ──
  resetBtn: {
    borderWidth: 1,
    borderColor: colors.soft,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginBottom: 4,
  },
  resetText: { color: colors.muted, fontWeight: '600', fontSize: 14 },
});
