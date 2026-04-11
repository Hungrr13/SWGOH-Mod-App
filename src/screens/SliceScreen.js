import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Picker } from '@react-native-picker/picker';
import AdBanner from '../components/AdBanner';
import {
  SHAPES, SHAPE_PRIMARIES, SEC_STATS,
  SLICE_REF, secQualityColor, calcSliceVerdict,
} from '../constants/modData';

const NONE = '';

const EMPTY_SECS = [
  { stat: NONE, value: '' },
  { stat: NONE, value: '' },
  { stat: NONE, value: '' },
  { stat: NONE, value: '' },
];

export default function SliceScreen() {
  const [shape, setShape]     = useState(NONE);
  const [primary, setPrimary] = useState(NONE);
  const [secs, setSecs]       = useState(EMPTY_SECS);

  const primOptions = shape ? SHAPE_PRIMARIES[shape] ?? [] : [];

  function updateSec(index, field, value) {
    setSecs(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  const verdict = useMemo(() => calcSliceVerdict(shape, secs), [shape, secs]);

  const reset = () => {
    setShape(NONE);
    setPrimary(NONE);
    setSecs(EMPTY_SECS);
  };

  // Build per-secondary stat quality rows
  const secRows = secs.map((sec, i) => {
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>Mod Slicer</Text>
        <Text style={styles.subheading}>Enter your mod's stats to see slice potential</Text>

        {/* Shape + Primary */}
        <View style={styles.card}>
          <Text style={styles.label}>Mod Shape</Text>
          <View style={styles.pickerWrap}>
            <Picker
              selectedValue={shape}
              onValueChange={v => { setShape(v); setPrimary(NONE); }}
              style={styles.picker}
              dropdownIconColor="#94a3b8"
            >
              <Picker.Item label="Select shape…" value={NONE} color="#e2e8f0" />
              {SHAPES.map(s => (
                <Picker.Item key={s} label={s} value={s} color="#e2e8f0" />
              ))}
            </Picker>
          </View>

          {shape !== NONE && (
            <>
              <Text style={styles.label}>Primary Stat</Text>
              <View style={styles.pickerWrap}>
                <Picker
                  selectedValue={primary}
                  onValueChange={setPrimary}
                  style={styles.picker}
                  dropdownIconColor="#94a3b8"
                >
                  <Picker.Item label="Select primary…" value={NONE} color="#e2e8f0" />
                  {primOptions.map(p => (
                    <Picker.Item key={p} label={p} value={p} color="#e2e8f0" />
                  ))}
                </Picker>
              </View>
            </>
          )}
        </View>

        {/* Secondary stats */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Secondary Stats</Text>
          {secs.map((sec, i) => (
            <View key={i} style={styles.secRow}>
              <View style={[styles.pickerWrap, { flex: 1, marginRight: 8 }]}>
                <Picker
                  selectedValue={sec.stat}
                  onValueChange={v => updateSec(i, 'stat', v)}
                  style={styles.picker}
                  dropdownIconColor="#94a3b8"
                >
                  <Picker.Item label={`Stat ${i + 1}`} value={NONE} color="#e2e8f0" />
                  {SEC_STATS.map(s => (
                    <Picker.Item key={s} label={s} value={s} color="#e2e8f0" />
                  ))}
                </Picker>
              </View>
              <TextInput
                style={styles.valueInput}
                placeholder="Value"
                placeholderTextColor="#475569"
                value={sec.value}
                onChangeText={v => updateSec(i, 'value', v)}
                keyboardType="decimal-pad"
              />
            </View>
          ))}
        </View>

        {/* Verdict */}
        {(shape !== NONE || secs.some(s => s.stat)) && (
          <View style={[styles.verdictCard, { borderColor: verdict.color }]}>
            <Text style={[styles.verdictLabel, { color: verdict.color }]}>
              {verdict.label}
            </Text>
            <Text style={styles.verdictDesc}>{verdict.desc}</Text>
          </View>
        )}

        {/* Per-stat quality breakdown */}
        {secRows.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Stat Quality</Text>
            {secRows.map((row, i) => (
              <View key={i} style={styles.statQualityRow}>
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

        {/* Reference table */}
        <View style={styles.card}>
          <TouchableOpacity onPress={() => {}}>
            <Text style={styles.cardTitle}>Slice Reference</Text>
          </TouchableOpacity>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCell, styles.tableHead, { flex: 2 }]}>Stat</Text>
            <Text style={[styles.tableCell, styles.tableHead]}>Good</Text>
            <Text style={[styles.tableCell, styles.tableHead]}>Great</Text>
            <Text style={[styles.tableCell, styles.tableHead]}>Max 5★</Text>
          </View>
          {SLICE_REF.map(ref => (
            <View key={ref.s} style={styles.tableRow}>
              <Text style={[styles.tableCell, { flex: 2, color: '#e2e8f0' }]}>{ref.s}</Text>
              <Text style={[styles.tableCell, { color: '#4ade80' }]}>{ref.g}</Text>
              <Text style={[styles.tableCell, { color: '#c084fc' }]}>{ref.gr}</Text>
              <Text style={[styles.tableCell, { color: '#60a5fa' }]}>{ref.m5}</Text>
            </View>
          ))}
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
  pickerWrap: {
    backgroundColor: '#0d1520',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e2a3a',
    overflow: 'hidden',
    marginBottom: 4,
  },
  picker: { color: '#e2e8f0', height: 44, paddingLeft: 8 },
  secRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  valueInput: {
    width: 80,
    backgroundColor: '#0d1520',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e2a3a',
    color: '#e2e8f0',
    paddingHorizontal: 10,
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
    fontSize: 26,
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
  statName: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', marginBottom: 4 },
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
  threshold: { color: '#475569', fontSize: 11 },
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
