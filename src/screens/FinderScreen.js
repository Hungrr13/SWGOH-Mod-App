import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CHARS } from '../data/chars';
import CharacterCard from '../components/CharacterCard';
import AdBanner from '../components/AdBanner';
import CustomPicker from '../components/CustomPicker';
import {
  decodeModSet, decodePrimary,
  MOD_SETS, SHAPES, SHAPE_PRIMARIES, SEC_STATS,
} from '../constants/modData';

const NONE = '';

// ── Scoring weights (matches original site logic) ────────────────────────────
// Mod set match: +2  |  Primary match: +3
// Sec priority 1: +3 | priority 2: +3 | priority 3: +2 | priority 4: +1

function parseSecs(str) {
  if (!str || str === '-') return [];
  return str.split('>').map(s => s.trim()).filter(Boolean);
}

function scoreChar(char, { modSet, primary, sec1, sec2, sec3, sec4 }) {
  let score = 0;

  // Mod set
  if (modSet) {
    const full = decodeModSet(char.modSet);
    if (full.toLowerCase().includes(modSet.toLowerCase())) score += 2;
  }

  // Primary (Arrow only – most common variable slot)
  if (primary) {
    const arr = decodePrimary(char.arrow);
    if (arr === primary) score += 3;
  }

  // Secondaries
  const secPriority = [char.secs ?? '', char.buSecs ?? '']
    .map(parseSecs)
    .flat();
  const mainSecs = parseSecs(char.secs);

  const secFilters = [sec1, sec2, sec3, sec4].filter(Boolean);
  for (const sf of secFilters) {
    const idx = mainSecs.findIndex(s => s === sf);
    if (idx === 0 || idx === 1) score += 3;
    else if (idx === 2) score += 2;
    else if (idx === 3) score += 1;
  }

  return score;
}

export default function FinderScreen() {
  const [modSet, setModSet]   = useState(NONE);
  const [shape, setShape]     = useState(NONE);
  const [primary, setPrimary] = useState(NONE);
  const [sec1, setSec1] = useState(NONE);
  const [sec2, setSec2] = useState(NONE);
  const [sec3, setSec3] = useState(NONE);
  const [sec4, setSec4] = useState(NONE);
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);

  const primOptions = shape ? SHAPE_PRIMARIES[shape] ?? [] : [];

  const handleFind = useCallback(() => {
    const params = { modSet, primary, sec1, sec2, sec3, sec4 };
    const scored = CHARS
      .map(c => ({ char: c, score: scoreChar(c, params) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
    setResults(scored);
    setSearched(true);
  }, [modSet, primary, sec1, sec2, sec3, sec4]);

  const handleReset = useCallback(() => {
    setModSet(NONE); setShape(NONE); setPrimary(NONE);
    setSec1(NONE); setSec2(NONE); setSec3(NONE); setSec4(NONE);
    setResults([]); setSearched(false);
  }, []);

  const renderHeader = () => (
    <View style={styles.formCard}>
      <Text style={styles.sectionLabel}>Mod Set</Text>
      <CustomPicker
        selectedValue={modSet}
        onValueChange={v => setModSet(v)}
        items={[
          { label: 'Any set', value: NONE },
          ...MOD_SETS.map(s => ({ label: s, value: s })),
        ]}
      />

      <Text style={styles.sectionLabel}>Mod Shape</Text>
      <CustomPicker
        selectedValue={shape}
        onValueChange={v => { setShape(v); setPrimary(NONE); }}
        items={[
          { label: 'Any shape', value: NONE },
          ...SHAPES.map(s => ({ label: s, value: s })),
        ]}
      />

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
      {[
        [sec1, setSec1, 'Sec Priority 1'],
        [sec2, setSec2, 'Sec Priority 2'],
        [sec3, setSec3, 'Sec Priority 3'],
        [sec4, setSec4, 'Sec Priority 4'],
      ].map(([val, setter, label], i) => (
        <CustomPicker
          key={i}
          selectedValue={val}
          onValueChange={setter}
          items={[
            { label: label, value: NONE },
            ...SEC_STATS.map(s => ({ label: s, value: s })),
          ]}
        />
      ))}

      <View style={styles.btnRow}>
        <TouchableOpacity style={styles.findBtn} onPress={handleFind}>
          <Text style={styles.findBtnText}>Find Characters</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
          <Text style={styles.resetBtnText}>Reset</Text>
        </TouchableOpacity>
      </View>

      {searched && (
        <Text style={styles.resultCount}>
          {results.length > 0
            ? `Top ${results.length} match${results.length !== 1 ? 'es' : ''}`
            : 'No matches found'}
        </Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>
        <FlatList
          data={results}
          keyExtractor={item => item.char.name}
          renderItem={({ item }) => (
            <CharacterCard char={item.char} score={item.score} />
          )}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        />
      </View>
      <AdBanner />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0e17' },
  container: { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
  formCard: {
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e2a3a',
  },
  sectionLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 10,
  },
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
    borderColor: '#475569',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  resetBtnText: { color: '#94a3b8', fontWeight: '600', fontSize: 14 },
  resultCount: {
    color: '#475569',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
  },
  list: { paddingBottom: 24 },
});
