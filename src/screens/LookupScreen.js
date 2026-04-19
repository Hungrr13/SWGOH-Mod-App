import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet,
  TouchableOpacity, ScrollView, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CHARS as _RAW_CHARS } from '../data/chars';
const _seenLookup = new Set();
const CHARS = _RAW_CHARS.filter(c => {
  if (_seenLookup.has(c.name)) return false;
  _seenLookup.add(c.name);
  return true;
});
import CharacterCard from '../components/CharacterCard';
import AdBanner from '../components/AdBanner';
import { useAppTheme } from '../theme/appTheme';

const ALL = 'All';
const COLS = 3;

const ROLES = ['Attacker', 'Support', 'Tank', 'Healer', 'Leader'];

const ROLE_TAGS = new Set([...ROLES, 'Tank/Leader', 'Support/Attacker']);
const AFFIL_TAGS = Array.from(
  new Set(
    CHARS.flatMap(char => Array.isArray(char.tags) ? char.tags : [])
      .filter(tag => !ROLE_TAGS.has(tag))
  )
).sort((a, b) => a.localeCompare(b));

function matchesRole(char, role) {
  if (role === ALL) return true;
  return Array.isArray(char.tags) && char.tags.includes(role);
}


export default function LookupScreen({ isActive = true }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [query, setQuery]                       = useState('');
  const [selectedChar, setSelectedChar]         = useState(null); // locked-in character
  const [showSuggestions, setShowSuggestions]   = useState(false);
  const [roleFilter, setRoleFilter]             = useState(ALL);
  const [tagFilters, setTagFilters]             = useState([]);
  const [filtersOpen, setFiltersOpen]           = useState(false);
  const [factionModalOpen, setFactionModalOpen] = useState(false);
  const inputRef = useRef(null);

  const hasFilters = roleFilter !== ALL || tagFilters.length > 0;
  const hasSearch  = selectedChar !== null;
  const showResults = hasSearch || hasFilters;

  // Autocomplete suggestions — name-only, top 8
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.length < 1) return [];
    return CHARS
      .filter(c => c.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query]);

  const baseFiltered = useMemo(() => {
    let filtered = CHARS;

    if (selectedChar) {
      filtered = filtered.filter(c => c.name === selectedChar);
    }

    if (roleFilter !== ALL) {
      filtered = filtered.filter(c => matchesRole(c, roleFilter));
    }

    return filtered;
  }, [selectedChar, roleFilter]);

  const availableTags = useMemo(() => {
    const pool = baseFiltered.filter(c =>
      tagFilters.every(tag => Array.isArray(c.tags) && c.tags.includes(tag))
    );
    const nextTags = new Set(tagFilters);

    pool.forEach(char => {
      if (!Array.isArray(char.tags)) return;
      char.tags.forEach(tag => {
        if (AFFIL_TAGS.includes(tag)) nextTags.add(tag);
      });
    });

    return AFFIL_TAGS.filter(tag => nextTags.has(tag));
  }, [baseFiltered, tagFilters]);

  const gridItems = useMemo(() => {
    const items = [...availableTags];
    while (items.length % COLS !== 0) items.push(null);
    return items;
  }, [availableTags]);

  // Main results — only shown when a char is selected or filters are set
  const results = useMemo(() => {
    if (!showResults) return [];
    let filtered = baseFiltered;

    if (tagFilters.length > 0) {
      filtered = filtered.filter(c =>
        tagFilters.every(tag => Array.isArray(c.tags) && c.tags.includes(tag))
      );
    }

    // Deduplicate by name — a character may appear in multiple faction groups
    const seen = new Set();
    filtered = filtered.filter(c => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    });

    return filtered.slice(0, 60);
  }, [showResults, baseFiltered, tagFilters]);

  function selectChar(char) {
    setSelectedChar(char.name);
    setQuery(char.name);
    setRoleFilter(ALL);
    setTagFilters([]);
    setShowSuggestions(false);
    setFiltersOpen(false);
    setFactionModalOpen(false);
    inputRef.current?.blur();
  }

  function handleQueryChange(text) {
    setQuery(text);
    setSelectedChar(null); // clear lock when typing
    setShowSuggestions(true);
  }

  function handleQueryBlur() {
    // small delay so tap on suggestion registers first
    setTimeout(() => setShowSuggestions(false), 150);
  }

  const clearAll = useCallback(() => {
    setQuery('');
    setSelectedChar(null);
    setRoleFilter(ALL);
    setTagFilters([]);
    setShowSuggestions(false);
  }, []);

  const clearFilters = useCallback(() => {
    setQuery('');
    setSelectedChar(null);
    setRoleFilter(ALL);
    setTagFilters([]);
    setShowSuggestions(false);
    inputRef.current?.blur();
  }, []);

  useEffect(() => {
    if (isActive) return;
    setShowSuggestions(false);
    setFiltersOpen(false);
    setFactionModalOpen(false);
    inputRef.current?.blur();
  }, [isActive]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>
        <Text style={styles.heading}>Hero Lookup</Text>
        <Text style={styles.subheading}>Search a hero and pull up their recommended mod build</Text>

        {/* Search bar row */}
        <View style={styles.searchRow}>
          <View style={styles.inputWrap}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Search character name…"
              placeholderTextColor={theme.soft}
              value={query}
              onChangeText={handleQueryChange}
              onFocus={() => { if (query.trim()) setShowSuggestions(true); }}
              onBlur={handleQueryBlur}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 && (
              <TouchableOpacity style={styles.clearX} onPress={clearAll}>
                <Text style={styles.clearXText}>✕</Text>
              </TouchableOpacity>
            )}

            {/* Autocomplete dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <View style={styles.suggestions}>
                {suggestions.map(c => (
                  <TouchableOpacity
                    key={c.name}
                    style={styles.suggestion}
                    onPress={() => selectChar(c)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.suggestionName}>{c.name}</Text>
                    <Text style={styles.suggestionSub}>{Array.isArray(c.tags) ? c.tags.slice(0, 3).join(', ') : c.faction}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.filterBtn, (hasFilters || filtersOpen) && styles.filterBtnActive]}
            onPress={() => setFiltersOpen(o => !o)}
          >
            <Text style={styles.filterBtnText}>☰</Text>
          </TouchableOpacity>
        </View>

        {/* Filter panel */}
        {filtersOpen && (
          <View style={styles.filterPanel}>
            <Text style={styles.filterLabel}>Role</Text>
            <View style={styles.pillWrap}>
              {[ALL, ...ROLES].map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.pill, styles.rolePill, roleFilter === r && styles.pillActive]}
                  onPress={() => setRoleFilter(r)}
                >
                  <Text style={[styles.pillText, roleFilter === r && styles.pillTextActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.filterLabel}>Tag</Text>
            <TouchableOpacity
              style={[styles.factionTrigger, tagFilters.length > 0 && styles.factionTriggerActive]}
              onPress={() => setFactionModalOpen(true)}
            >
              <Text style={[styles.factionTriggerText, tagFilters.length > 0 && styles.factionTriggerTextActive]}>
                {tagFilters.length === 0 ? 'All Tags  ▾' : `${tagFilters.join(' + ')}  ▾`}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.clearBtn} onPress={clearFilters}>
              <Text style={styles.clearBtnText}>Clear Filters</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Empty state */}
        {!showResults ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔍</Text>
            <Text style={styles.emptyTitle}>Search or filter to find characters</Text>
            <Text style={styles.emptyHint}>Type a name above or use ☰ to filter by role or tag</Text>
          </View>
        ) : (
          <>
            <Text style={styles.count}>
              {results.length} result{results.length !== 1 ? 's' : ''}
            </Text>
            <FlatList
              data={results}
              keyExtractor={item => item.name}
              renderItem={({ item }) => (
                <CharacterCard
                  char={item}
                  startCollapsed={!selectedChar}
                  onExpand={() => setFiltersOpen(false)}
                />
              )}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={styles.empty}>No characters match.</Text>
              }
            />
          </>
        )}
      </View>

      {/* Faction grid modal */}
      <Modal
        visible={factionModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFactionModalOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setFactionModalOpen(false)}
        >
          <View style={styles.modalSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Select Tags</Text>
            <Text style={styles.modalHint}>Swipe up and down to see more tags</Text>
            <View style={styles.modalScrollWrap}>
              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                showsVerticalScrollIndicator
                indicatorStyle={theme.background === '#0b1220' ? 'white' : 'black'}
                persistentScrollbar
              >
                <View style={styles.grid}>
                  {gridItems.map((tag, idx) =>
                    tag ? (
                      <TouchableOpacity
                        key={tag}
                        style={styles.gridCell}
                        onPress={() => {
                          setTagFilters(prev =>
                            prev.includes(tag) ? prev.filter(item => item !== tag) : [...prev, tag]
                          );
                        }}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[styles.gridCellText, tagFilters.includes(tag) && styles.gridCellTextActive]}
                          numberOfLines={2}
                          adjustsFontSizeToFit
                        >
                          {tag}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <View key={`e${idx}`} style={styles.gridCell} />
                    )
                  )}
                </View>
                <TouchableOpacity style={styles.modalDoneBtn} onPress={() => setFactionModalOpen(false)}>
                  <Text style={styles.modalDoneText}>Done</Text>
                </TouchableOpacity>
              </ScrollView>
              <View pointerEvents="none" style={styles.modalScrollRail}>
                <View style={styles.modalScrollThumb} />
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      <AdBanner />
    </SafeAreaView>
  );
}

const createStyles = colors => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, paddingHorizontal: 12, paddingTop: 4 },
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

  // Search
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 8, zIndex: 10 },
  inputWrap: { flex: 1, position: 'relative' },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingRight: 36,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
  },
  clearX: {
    position: 'absolute',
    right: 10,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  clearXText: { color: colors.soft, fontSize: 14 },

  // Autocomplete
  suggestions: {
    position: 'absolute',
    top: 46,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    zIndex: 100,
    elevation: 10,
    overflow: 'hidden',
  },
  suggestion: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  suggestionName: { color: colors.text, fontSize: 13, fontWeight: '600' },
  suggestionSub: { color: colors.soft, fontSize: 11, marginTop: 1 },

  filterBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  filterBtnActive: { borderColor: '#f5a623' },
  filterBtnText: { color: colors.muted, fontSize: 16 },

  // Filter panel
  filterPanel: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 8,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colors.surfaceAlt,
  },
  rolePill: {
    marginRight: 6,
    marginBottom: 6,
  },
  pillActive: { borderColor: '#f5a623', backgroundColor: colors.warmSurface },
  pillText: { color: colors.muted, fontSize: 13 },
  pillTextActive: { color: '#f5a623', fontWeight: '700' },
  factionTrigger: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  factionTriggerActive: { borderColor: '#f5a623' },
  factionTriggerText: { color: colors.soft, fontSize: 14 },
  factionTriggerTextActive: { color: '#f5a623', fontWeight: '700' },
  clearBtn: {
    marginTop: 10,
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  clearBtnText: { color: colors.muted, fontWeight: '600', fontSize: 13 },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 60,
  },
  emptyIcon: { fontSize: 36, marginBottom: 12 },
  emptyTitle: { color: colors.muted, fontSize: 15, fontWeight: '600', marginBottom: 6 },
  emptyHint: { color: colors.soft, fontSize: 12, textAlign: 'center', paddingHorizontal: 24 },

  count: { color: colors.soft, fontSize: 12, marginBottom: 6, textAlign: 'right' },
  list: { paddingBottom: 16 },
  empty: { color: colors.soft, textAlign: 'center', marginTop: 40, fontSize: 14 },

  // Faction modal
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: 20,
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    maxHeight: '85%',
  },
  modalTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 6,
  },
  modalHint: {
    color: colors.soft,
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 10,
  },
  modalScrollWrap: {
    position: 'relative',
  },
  modalScroll: {
    paddingRight: 4,
  },
  modalScrollContent: {
    paddingRight: 12,
  },
  modalScrollRail: {
    position: 'absolute',
    top: 6,
    right: 1,
    bottom: 6,
    width: 4,
    borderRadius: 999,
    backgroundColor: colors.border,
    opacity: 0.9,
  },
  modalScrollThumb: {
    width: '100%',
    height: 44,
    borderRadius: 999,
    backgroundColor: '#f5a623',
    opacity: 0.9,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridCell: { width: `${100 / COLS}%`, padding: 4 },
  gridCellText: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 6,
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    overflow: 'hidden',
  },
  gridCellTextActive: {
    color: '#f5a623',
    fontWeight: '700',
    backgroundColor: colors.warmSurface,
    borderColor: '#f5a623',
  },
  modalDoneBtn: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f5a623',
  },
  modalDoneText: {
    color: '#f5a623',
    fontSize: 13,
    fontWeight: '700',
  },
});
