import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AdBanner from '../components/AdBanner';
import CustomPicker from '../components/CustomPicker';
import CharacterCard from '../components/CharacterCard';
import { CHARS } from '../data/chars';
import {
  SHAPES, SHAPE_PRIMARIES, SEC_STATS, MOD_SETS, MOD_TIERS,
  SLICE_REF, ROLL_DATA, SLICE_GAIN,
  calcSliceVerdict, rollEfficiency, efficiencyColor, efficiencyLabel,
  matchCharactersForMod,
} from '../constants/modData';

const NONE = '';
const ROLL_OPTIONS = [1, 2, 3, 4, 5];

const EMPTY_SECS = [
  { stat: NONE, value: '', rolls: '1', hidden: false },
  { stat: NONE, value: '', rolls: '1', hidden: false },
  { stat: NONE, value: '', rolls: '1', hidden: false },
  { stat: NONE, value: '', rolls: '1', hidden: false },
];

export default function SliceScreen() {
  const [tier, setTier]       = useState('5A');
  const [shape, setShape]     = useState(NONE);
  const [primary, setPrimary] = useState(NONE);
  const [modSet, setModSet]   = useState(NONE);
  const [secs, setSecs]       = useState(EMPTY_SECS);

  const dotLevel = tier.startsWith('6') ? 6 : 5;
  const primOptions = shape ? SHAPE_PRIMARIES[shape] ?? [] : [];

  function updateSec(index, field, value) {
    setSecs(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function statCap(stat) {
    const ref = ROLL_DATA[stat];
    if (!ref) return null;
    return dotLevel === 6 ? ref.cap6 : ref.cap5;
  }

  function clampSecValue(stat, rawValue) {
    const cap = statCap(stat);
    if (cap == null) return rawValue;
    const v = parseFloat(rawValue);
    if (isNaN(v)) return rawValue;
    const clamped = Math.min(cap, Math.max(0, v));
    return String(parseFloat(clamped.toFixed(3)));
  }

  const verdict = useMemo(
    () => calcSliceVerdict(shape, secs, tier),
    [shape, secs, tier]
  );

  const charMatches = useMemo(
    () => matchCharactersForMod(CHARS, { shape, primary, secs, modSet }).slice(0, 8),
    [shape, primary, secs, modSet]
  );

  const reset = () => {
    setTier('5A');
    setShape(NONE);
    setPrimary(NONE);
    setModSet(NONE);
    setSecs(EMPTY_SECS);
  };

  // Per-secondary efficiency rows
  const secRows = secs.map((sec) => {
    if (!sec.stat || sec.value === '') return null;
    const eff = rollEfficiency(sec.stat, sec.value, sec.rolls, dotLevel);
    if (eff === null) return null;
    const gain = SLICE_GAIN[sec.stat] ?? 0;
    const cap = statCap(sec.stat);
    return {
      stat: sec.stat,
      value: sec.value,
      rolls: sec.rolls,
      eff,
      effPct: Math.round(eff * 100),
      color: efficiencyColor(eff),
      label: efficiencyLabel(eff),
      gain,
      cap,
    };
  }).filter(Boolean);

  const anyInput = shape !== NONE || secs.some(s => s.stat);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>Mod Slicer</Text>
        <Text style={styles.subheading}>Enter your mod's tier, stats, and roll counts</Text>

        {/* Tier selector */}
        <View style={styles.card}>
          <Text style={styles.label}>Current Tier</Text>
          <View style={styles.pillRow}>
            {MOD_TIERS.map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.pill, tier === t && styles.pillActive]}
                onPress={() => setTier(t)}
              >
                <Text style={[styles.pillText, tier === t && styles.pillTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hint}>
            {tier === '5C' && '5C → Should you slice to 5B? Cheap tier, forgiving rules.'}
            {tier === '5B' && '5B → Should you slice to 5A? Last 5-dot commitment.'}
            {tier === '5A' && '5A → Ready to commit materials for 6-dot?'}
            {tier === '6E' && '6E → Rate your finished mod.'}
          </Text>
        </View>

        {/* Shape + Primary + Set */}
        <View style={styles.card}>
          <Text style={styles.label}>Mod Shape</Text>
          <CustomPicker
            selectedValue={shape}
            onValueChange={v => { setShape(v); setPrimary(NONE); }}
            items={[
              { label: 'Select shape…', value: NONE },
              ...SHAPES.map(s => ({ label: s, value: s })),
            ]}
          />

          {shape !== NONE && (
            <>
              <Text style={styles.label}>Primary Stat</Text>
              <CustomPicker
                selectedValue={primary}
                onValueChange={setPrimary}
                items={[
                  { label: 'Select primary…', value: NONE },
                  ...primOptions.map(p => ({ label: p, value: p })),
                ]}
              />
            </>
          )}

          <Text style={styles.label}>Mod Set (optional)</Text>
          <CustomPicker
            selectedValue={modSet}
            onValueChange={setModSet}
            items={[
              { label: 'Any', value: NONE },
              ...MOD_SETS.map(s => ({ label: s, value: s })),
            ]}
          />
        </View>

        {/* Secondary stats */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Secondary Stats</Text>
          <Text style={styles.microHint}>
            # = roll count from scan. Tap 👁 if scan shows "Reveals at level 3/6/9/12".
          </Text>
          {secs.map((sec, i) => (
            <View key={i}>
              <View style={styles.secRow}>
                <TouchableOpacity
                  style={[styles.hideBtn, sec.hidden && styles.hideBtnActive]}
                  onPress={() => updateSec(i, 'hidden', !sec.hidden)}
                >
                  <Text style={[styles.hideBtnText, sec.hidden && styles.hideBtnTextActive]}>
                    {sec.hidden ? '🚫' : '👁'}
                  </Text>
                </TouchableOpacity>
                <CustomPicker
                  selectedValue={sec.stat}
                  onValueChange={v => updateSec(i, 'stat', v)}
                  items={[
                    { label: `Stat ${i + 1}`, value: NONE },
                    ...SEC_STATS.map(s => ({ label: s, value: s })),
                  ]}
                  style={{ flex: 1, marginRight: 6 }}
                />
                {!sec.hidden && (
                  <>
                    <View style={styles.rollsCol}>
                      <Text style={styles.miniLabel}>#</Text>
                      <CustomPicker
                        selectedValue={sec.rolls}
                        onValueChange={v => updateSec(i, 'rolls', v)}
                        items={ROLL_OPTIONS.map(n => ({ label: String(n), value: String(n) }))}
                        style={styles.rollsPicker}
                      />
                    </View>
                    <View style={styles.valueCol}>
                      <Text style={styles.rangeHint}>
                        {sec.stat ? '0 – ' + (statCap(sec.stat) ?? '—') : ' '}
                      </Text>
                      <TextInput
                        style={styles.valueInput}
                        placeholder="Value"
                        placeholderTextColor="#475569"
                        value={sec.value}
                        onChangeText={v => updateSec(i, 'value', v)}
                        onBlur={() => {
                          if (sec.stat && sec.value !== '') {
                            updateSec(i, 'value', clampSecValue(sec.stat, sec.value));
                          }
                        }}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  </>
                )}
              </View>
              {sec.hidden && (
                <Text style={styles.hiddenNote}>
                  Hidden — reveals at level 3/6/9/12. Level mod to 12 first.
                </Text>
              )}
            </View>
          ))}
        </View>

        {/* Verdict */}
        {anyInput && (
          <View style={[styles.verdictCard, { borderColor: verdict.color }]}>
            <Text style={[styles.verdictLabel, { color: verdict.color }]}>
              {verdict.label}
            </Text>
            <Text style={styles.verdictDesc}>{verdict.desc}</Text>
          </View>
        )}

        {/* Per-stat efficiency breakdown */}
        {secRows.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Roll Efficiency</Text>
            {secRows.map((row, i) => (
              <View key={i} style={styles.statQualityRow}>
                <View style={styles.statHeader}>
                  <Text style={styles.statName}>
                    {row.stat} <Text style={styles.statRolls}>×{row.rolls}</Text>
                  </Text>
                  <View style={[styles.qualityBadge, { borderColor: row.color }]}>
                    <Text style={[styles.qualityText, { color: row.color }]}>
                      {row.label} {row.effPct}%
                    </Text>
                  </View>
                </View>
                <View style={styles.effBar}>
                  <View style={[styles.effFill, { width: `${row.effPct}%`, backgroundColor: row.color }]} />
                </View>
                <View style={styles.thresholdRow}>
                  <Text style={styles.threshold}>Value: {row.value} / {row.cap}</Text>
                  {row.gain > 0 && (
                    <Text style={styles.threshold}>
                      5A→6E gain: +{Math.round(row.gain * 100)}%
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Character recommendations */}
        {charMatches.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Recommended Characters</Text>
            <Text style={styles.microHint}>Best matches for this mod's primary + secondaries</Text>
            {charMatches.map(({ char, score }, i) => (
              <CharacterCard key={char.name + i} char={char} score={score} />
            ))}
          </View>
        )}

        {/* Roll reference table */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Roll Reference ({dotLevel}-dot)</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCell, styles.tableHead, { flex: 2 }]}>Stat</Text>
            <Text style={[styles.tableCell, styles.tableHead]}>Min</Text>
            <Text style={[styles.tableCell, styles.tableHead]}>Max</Text>
            <Text style={[styles.tableCell, styles.tableHead]}>Cap (×5)</Text>
          </View>
          {SEC_STATS.map(s => {
            const r = ROLL_DATA[s];
            if (!r) return null;
            const min = dotLevel === 6 ? r.min6 : r.min5;
            const max = dotLevel === 6 ? r.max6 : r.max5;
            const cap = dotLevel === 6 ? r.cap6 : r.cap5;
            return (
              <View key={s} style={styles.tableRow}>
                <Text style={[styles.tableCell, { flex: 2, color: '#e2e8f0' }]}>{s}</Text>
                <Text style={[styles.tableCell, { color: '#94a3b8' }]}>{min}</Text>
                <Text style={[styles.tableCell, { color: '#60a5fa' }]}>{max}</Text>
                <Text style={[styles.tableCell, { color: '#c084fc' }]}>{cap}</Text>
              </View>
            );
          })}
        </View>

        {/* Reset */}
        <TouchableOpacity style={styles.resetBtn} onPress={reset}>
          <Text style={styles.resetText}>Reset</Text>
        </TouchableOpacity>

        <View style={{ height: 24 }} />
      </ScrollView>

      <AdBanner />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0e17' },
  scroll: { flex: 1 },
  container: { padding: 12 },
  heading: {
    color: '#f5a623',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 4,
  },
  subheading: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 14,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e2a3a',
  },
  cardTitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  label: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 8,
  },
  hint: { color: '#64748b', fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  microHint: { color: '#475569', fontSize: 11, marginBottom: 8 },
  pillRow: { flexDirection: 'row', gap: 6 },
  pill: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#1e2a3a',
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#0d1520',
  },
  pillActive: {
    borderColor: '#f5a623',
    backgroundColor: '#1a1408',
  },
  pillText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  pillTextActive: { color: '#f5a623', fontWeight: '700' },
  secRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4 },
  hideBtn: {
    width: 32,
    height: 38,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e2a3a',
    backgroundColor: '#0d1520',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  hideBtnActive: { borderColor: '#f5a623', backgroundColor: '#1a1408' },
  hideBtnText: { fontSize: 14 },
  hideBtnTextActive: { fontSize: 14 },
  hiddenNote: {
    color: '#f5a623',
    fontSize: 11,
    marginLeft: 40,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  rollsCol: { alignItems: 'center', marginRight: 6 },
  rollsPicker: { width: 54 },
  miniLabel: { color: '#475569', fontSize: 10, marginBottom: 2 },
  valueCol: { alignItems: 'center' },
  rangeHint: { color: '#475569', fontSize: 10, marginBottom: 2 },
  valueInput: {
    width: 76,
    backgroundColor: '#0d1520',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e2a3a',
    color: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 10,
    fontSize: 14,
    textAlign: 'center',
  },
  verdictCard: {
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    alignItems: 'center',
    backgroundColor: '#111827',
  },
  verdictLabel: {
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  verdictDesc: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
  },
  statQualityRow: {
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e2a3a',
  },
  statHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  statName: { color: '#e2e8f0', fontSize: 13, fontWeight: '600' },
  statRolls: { color: '#64748b', fontWeight: '400' },
  qualityBadge: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  qualityText: { fontSize: 11, fontWeight: '700' },
  effBar: {
    height: 6,
    backgroundColor: '#0d1520',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  effFill: { height: '100%' },
  thresholdRow: { flexDirection: 'row', gap: 12 },
  threshold: { color: '#64748b', fontSize: 11 },
  tableHeader: {
    flexDirection: 'row',
    marginBottom: 4,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1e2a3a',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#0d1520',
  },
  tableCell: { flex: 1, fontSize: 12, textAlign: 'center' },
  tableHead: { color: '#94a3b8', fontWeight: '700', fontSize: 11 },
  resetBtn: {
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginBottom: 4,
  },
  resetText: { color: '#94a3b8', fontWeight: '600', fontSize: 14 },
});
