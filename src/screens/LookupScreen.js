import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet,
  TouchableOpacity, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CHARS } from '../data/chars';
import CharacterCard from '../components/CharacterCard';
import AdBanner from '../components/AdBanner';
import CustomPicker from '../components/CustomPicker';

const ALL = 'All';

const ROLES = ['Attacker', 'Support', 'Tank', 'Healer', 'Leader'];

function matchesRole(char, role) {
  if (role === ALL) return true;
  const r = char.role;
  if (role === 'Attacker') return r === 'A' || r === 'Support/Attacker';
  if (role === 'Support')  return r === 'S' || r === 'Support/Attacker';
  if (role === 'Tank')     return r === 'K' || r === 'Tank/Leader';
  if (role === 'Healer')   return r === 'He';
  if (role === 'Leader')   return r === 'Leader' || r === 'Tank/Leader';
  return false;
}

// Clean faction labels mapped to the substring present in the raw faction string
const FACTIONS = [
  { label: 'Bad Batch',          match: 'BAD BATCH' },
  { label: 'Bounty Hunters',     match: 'BOUNTY HUNTERS' },
  { label: 'Clone Troopers',     match: 'CLONE TROOPERS' },
  { label: 'Empire / Sith',      match: 'EMPIRE / SITH' },
  { label: 'Ewoks',              match: 'EWOKS' },
  { label: 'First Order',        match: 'FIRST ORDER' },
  { label: 'Galactic Republic',  match: 'GALACTIC REPUBLIC' },
  { label: 'Geonosians',         match: 'GEONOSIANS' },
  { label: 'Gungans',            match: 'GUNGANS' },
  { label: 'Hutt Cartel / ISB',  match: 'HUTT CARTEL' },
  { label: 'Imperial Troopers',  match: 'IMPERIAL TROOPERS' },
  { label: 'Inquisitorius',      match: 'INQUISITORIUS' },
  { label: 'Jawas',              match: 'JAWAS' },
  { label: 'Jedi',               match: 'JEDI' },
  { label: 'Mandalorians',       match: 'MANDALORIANS' },
  { label: 'Miscellaneous',      match: 'MISCELLANEOUS' },
  { label: 'Nightsisters',       match: 'NIGHTSISTERS' },
  { label: 'Old Republic',       match: 'OLD REPUBLIC' },
  { label: 'Phoenix Squadron',   match: 'PHOENIX' },
  { label: 'Pirates',            match: 'PIRATES' },
  { label: 'Rebel Fighters',     match: 'REBEL' },
  { label: 'Resistance',         match: 'RESISTANCE' },
  { label: 'Rogue One',          match: 'ROGUE ONE' },
  { label: 'Separatists',        match: 'SEPARATISTS' },
  { label: 'Sith Empire',        match: 'SITH EMPIRE' },
  { label: 'Tuskens',            match: 'TUSKENS' },
  { label: 'Wookiees',           match: 'WOOKIEES' },
];

export default function LookupScreen() {
  const [query, setQuery]             = useState('');
  const [roleFilter, setRoleFilter]   = useState(ALL);
  const [factionFilter, setFactionFilter] = useState(ALL);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const results = useMemo(() => {
    let filtered = CHARS;

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      filtered = filtered.filter(
        c => c.name.toLowerCase().includes(q) || c.faction.toLowerCase().includes(q),
      );
    }

    if (roleFilter !== ALL) {
      filtered = filtered.filter(c => matchesRole(c, roleFilter));
    }

    if (factionFilter !== ALL) {
      const entry = FACTIONS.find(f => f.label === factionFilter);
      if (entry) {
        filtered = filtered.filter(c => c.faction.includes(entry.match));
      }
    }

    return filtered.slice(0, 60);
  }, [query, roleFilter, factionFilter]);

  const clearFilters = useCallback(() => {
    setRoleFilter(ALL);
    setFactionFilter(ALL);
  }, []);

  const hasFilters = roleFilter !== ALL || factionFilter !== ALL;

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
            {/* Role pills */}
            <Text style={styles.filterLabel}>Role</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow}>
              {[ALL, ...ROLES].map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.pill, roleFilter === r && styles.pillActive]}
                  onPress={() => setRoleFilter(r)}
                >
                  <Text style={[styles.pillText, roleFilter === r && styles.pillTextActive]}>
                    {r}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Faction picker */}
            <Text style={styles.filterLabel}>Faction</Text>
            <CustomPicker
              selectedValue={factionFilter}
              onValueChange={setFactionFilter}
              items={[
                { label: 'All Factions', value: ALL },
                ...FACTIONS.map(f => ({ label: f.label, value: f.label })),
              ]}
            />

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
    marginBottom: 6,
    marginTop: 8,
  },
  pillRow: { flexDirection: 'row', marginBottom: 4 },
  pill: {
    borderWidth: 1,
    borderColor: '#1e2a3a',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 6,
    backgroundColor: '#0d1520',
  },
  pillActive: { borderColor: '#f5a623', backgroundColor: '#1a1200' },
  pillText: { color: '#94a3b8', fontSize: 13 },
  pillTextActive: { color: '#f5a623', fontWeight: '700' },
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
