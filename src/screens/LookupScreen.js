import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet,
  TouchableOpacity, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Picker } from '@react-native-picker/picker';
import { CHARS } from '../data/chars';
import CharacterCard from '../components/CharacterCard';
import AdBanner from '../components/AdBanner';
import {
  decodeModSet, decodePrimary,
  MOD_SETS, SHAPES, SHAPE_PRIMARIES, SEC_STATS,
} from '../constants/modData';

const ALL = 'All';

export default function LookupScreen() {
  const [query, setQuery]       = useState('');
  const [setFilter, setSetFilter]       = useState(ALL);
  const [shapeFilter, setShapeFilter]   = useState(ALL);
  const [primaryFilter, setPrimaryFilter] = useState(ALL);
  const [sec1, setSec1] = useState(ALL);
  const [sec2, setSec2] = useState(ALL);
  const [sec3, setSec3] = useState(ALL);
  const [sec4, setSec4] = useState(ALL);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const primOptions = shapeFilter !== ALL ? [ALL, ...SHAPE_PRIMARIES[shapeFilter]] : [ALL];

  const results = useMemo(() => {
    let filtered = CHARS;

    // Text search
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      filtered = filtered.filter(
        c => c.name.toLowerCase().includes(q) || c.faction.toLowerCase().includes(q),
      );
    }

    // Mod set filter
    if (setFilter !== ALL) {
      filtered = filtered.filter(c => {
        const full = decodeModSet(c.modSet);
        return full.toLowerCase().includes(setFilter.toLowerCase());
      });
    }

    // Shape / primary filter  (Arrow is the only shape with a meaningful primary variation)
    if (primaryFilter !== ALL) {
      filtered = filtered.filter(c => {
        const decoded = decodePrimary(c.arrow);
        return decoded === primaryFilter;
      });
    }

    // Secondary stats filters
    const secFilters = [sec1, sec2, sec3, sec4].filter(s => s !== ALL);
    if (secFilters.length > 0) {
      filtered = filtered.filter(c => {
        const secs = c.secs ?? '';
        return secFilters.every(sf => secs.includes(sf));
      });
    }

    return filtered.slice(0, 40);
  }, [query, setFilter, primaryFilter, sec1, sec2, sec3, sec4]);

  const clearFilters = useCallback(() => {
    setSetFilter(ALL);
    setShapeFilter(ALL);
    setPrimaryFilter(ALL);
    setSec1(ALL); setSec2(ALL); setSec3(ALL); setSec4(ALL);
  }, []);

  const hasFilters = setFilter !== ALL || primaryFilter !== ALL ||
    sec1 !== ALL || sec2 !== ALL || sec3 !== ALL || sec4 !== ALL;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>
        {/* Search bar */}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.input}
            placeholder="Search by name or faction…"
            placeholderTextColor="#475569"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[styles.filterBtn, hasFilters && styles.filterBtnActive]}
            onPress={() => setFiltersOpen(o => !o)}
          >
            <Text style={styles.filterBtnText}>⚙</Text>
          </TouchableOpacity>
        </View>

        {/* Filter panel */}
        {filtersOpen && (
          <View style={styles.filterPanel}>
            <Text style={styles.filterLabel}>Mod Set</Text>
            <View style={styles.pickerWrap}>
              <Picker
                selectedValue={setFilter}
                onValueChange={setSetFilter}
                style={styles.picker}
                dropdownIconColor="#94a3b8"
              >
                <Picker.Item label="All Sets" value={ALL} color="#e2e8f0" />
                {MOD_SETS.map(s => (
                  <Picker.Item key={s} label={s} value={s} color="#e2e8f0" />
                ))}
              </Picker>
            </View>

            <Text style={styles.filterLabel}>Arrow Primary</Text>
            <View style={styles.pickerWrap}>
              <Picker
                selectedValue={primaryFilter}
                onValueChange={setPrimaryFilter}
                style={styles.picker}
                dropdownIconColor="#94a3b8"
              >
                <Picker.Item label="Any Primary" value={ALL} color="#e2e8f0" />
                {['Speed','Offense%','Health%','Protection%','Accuracy%','Crit Avoidance%','Tenacity%'].map(p => (
                  <Picker.Item key={p} label={p} value={p} color="#e2e8f0" />
                ))}
              </Picker>
            </View>

            <Text style={styles.filterLabel}>Secondary Stats</Text>
            {[
              [sec1, setSec1, 'Sec 1'],
              [sec2, setSec2, 'Sec 2'],
              [sec3, setSec3, 'Sec 3'],
              [sec4, setSec4, 'Sec 4'],
            ].map(([val, setter, label], i) => (
              <View key={i} style={styles.pickerWrap}>
                <Picker
                  selectedValue={val}
                  onValueChange={setter}
                  style={styles.picker}
                  dropdownIconColor="#94a3b8"
                >
                  <Picker.Item label={label} value={ALL} color="#e2e8f0" />
                  {SEC_STATS.map(s => (
                    <Picker.Item key={s} label={s} value={s} color="#e2e8f0" />
                  ))}
                </Picker>
              </View>
            ))}

            <TouchableOpacity style={styles.clearBtn} onPress={clearFilters}>
              <Text style={styles.clearBtnText}>Clear Filters</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Result count */}
        <Text style={styles.count}>
          {results.length} result{results.length !== 1 ? 's' : ''}
          {CHARS.length > results.length ? ` (of ${CHARS.length})` : ''}
        </Text>

        {/* Results list */}
        <FlatList
          data={results}
          keyExtractor={(item) => item.name}
          renderItem={({ item }) => <CharacterCard char={item} />}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={styles.empty}>No characters match your search.</Text>
          }
        />
      </View>

      <AdBanner />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0e17' },
  container: { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1e2a3a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#e2e8f0',
    fontSize: 14,
  },
  filterBtn: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1e2a3a',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  filterBtnActive: { borderColor: '#f5a623' },
  filterBtnText: { color: '#94a3b8', fontSize: 16 },
  filterPanel: {
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e2a3a',
  },
  filterLabel: {
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
    marginBottom: 4,
    overflow: 'hidden',
  },
  picker: { color: '#e2e8f0', height: 44 },
  clearBtn: {
    marginTop: 10,
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#f5a623',
  },
  clearBtnText: { color: '#f5a623', fontWeight: '600', fontSize: 13 },
  count: {
    color: '#475569',
    fontSize: 12,
    marginBottom: 6,
    textAlign: 'right',
  },
  list: { paddingBottom: 16 },
  empty: { color: '#475569', textAlign: 'center', marginTop: 40, fontSize: 14 },
});
