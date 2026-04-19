import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { decodePrimary, decodeModSet, setColor, secPriorityColor } from '../constants/modData';
import ModShapeIcon, { SHAPE_COLORS } from './ModShapeIcon';
import { useAppTheme } from '../theme/appTheme';

// Official mod slot names
const SLOT_NAMES = {
  Square:   'Transmitter',
  Arrow:    'Receiver',
  Diamond:  'Processor',
  Triangle: 'Holo-Array',
  Circle:   'Data-Bus',
  Cross:    'Multiplexer',
};

// All 6 slots for main build — Square & Diamond are always fixed
const MAIN_PRIMARIES = [
  { shape: 'Square',   key: null,       fixed: 'Offense%' },
  { shape: 'Arrow',    key: 'arrow',    fixed: null },
  { shape: 'Diamond',  key: null,       fixed: 'Defense%' },
  { shape: 'Triangle', key: 'triangle', fixed: null },
  { shape: 'Circle',   key: 'circle',   fixed: null },
  { shape: 'Cross',    key: 'cross',    fixed: null },
];

// All 6 slots for backup build
const BU_PRIMARIES = [
  { shape: 'Square',   key: null,    fixed: 'Offense%' },
  { shape: 'Arrow',    key: 'buArr', fixed: null, fallback: 'arrow' },
  { shape: 'Diamond',  key: null,    fixed: 'Defense%' },
  { shape: 'Triangle', key: 'buTri', fixed: null },
  { shape: 'Circle',   key: 'buCir', fixed: null },
  { shape: 'Cross',    key: 'buCro', fixed: null },
];

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

function PrimariesGrid({ char, slots, styles }) {
  return (
    <View style={styles.primGrid}>
      {slots.map(({ shape, key, fixed, fallback }) => {
        const color = SHAPE_COLORS[shape];
        const rawVal = key ? (char[key] ?? (fallback ? char[fallback] : '')) : '';
        const stat = fixed ?? decodePrimary(rawVal);
        const isFixed = !!fixed;
        return (
          <View key={shape} style={[styles.primRow, { borderColor: color + '55' }]}>
            <View style={styles.primLeft}>
              <ModShapeIcon shape={shape} size={18} />
              <Text style={[styles.primSlotName, { color }]}>{SLOT_NAMES[shape]}</Text>
            </View>
            <View style={styles.primRight}>
              {isFixed && <Text style={styles.fixedTag}>fixed</Text>}
              <Text style={styles.primStat}>{stat}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SecsRow({ secsArr, styles }) {
  return (
    <View style={styles.secsRow}>
      {secsArr.map((sec, i) => {
        const color = secPriorityColor(i, sec);
        return (
          <View key={i} style={styles.secItem}>
            <Text style={[styles.secNum, { color }]}>{i + 1}</Text>
            <Text style={[styles.secText, { color }]}>{sec}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function CharacterCard({ char, score, startCollapsed = false, onExpand }) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const [backupOpen, setBackupOpen] = useState(false);
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const modSetFull   = decodeModSet(char.modSet);
  const buModSetFull = decodeModSet(char.buSet);
  const mainColor    = setColor(modSetFull);
  const buColor      = setColor(buModSetFull);
  const secsArr      = parseSecs(char.secs);
  const buSecsArr    = parseSecs(char.buSecs);
  const hasPendingModData =
    char.modSet === '-' &&
    char.buSet === '-' &&
    (!char.secs || char.secs === '—') &&
    (!char.buSecs || char.buSecs === '—');
  const { roleLine, categoryLine } = splitTags(char.tags);

  // Collapsed view — name only
  if (collapsed) {
    return (
      <TouchableOpacity
        style={styles.cardCollapsed}
        onPress={() => {
          onExpand?.();
          setCollapsed(false);
        }}
        activeOpacity={0.7}
      >
        <Text style={styles.name} numberOfLines={1}>{char.name}</Text>
        <Text style={styles.chevron}>▼</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.card}>
      {/* Header — tap to re-collapse if startCollapsed mode */}
      <TouchableOpacity
        onPress={() => { if (startCollapsed) { setCollapsed(true); setBackupOpen(false); } }}
        activeOpacity={startCollapsed ? 0.7 : 1}
      >
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{char.name}</Text>
          {score !== undefined && (
            <View style={styles.scoreBadge}>
              <Text style={styles.scoreText}>{score}</Text>
            </View>
          )}
          {startCollapsed && <Text style={styles.chevron}>▲</Text>}
        </View>
        {!!roleLine && <Text style={styles.sub}>{roleLine}</Text>}
        {!!categoryLine && <Text style={styles.tagsLine}>{categoryLine}</Text>}
      </TouchableOpacity>

      <View style={styles.divider} />

      {hasPendingModData && (
        <View style={styles.pendingNote}>
          <Text style={styles.pendingNoteText}>New Era character data coming soon.</Text>
        </View>
      )}

      {!hasPendingModData && (
        <>
          <Text style={styles.sectionLabel}>Mod Set</Text>
          <View style={[styles.setPill, { borderColor: mainColor }]}>
            <Text style={[styles.setLabel, { color: mainColor }]}>{modSetFull}</Text>
          </View>

          <Text style={styles.sectionLabel}>Primaries</Text>
          <PrimariesGrid char={char} slots={MAIN_PRIMARIES} styles={styles} />

          <Text style={styles.sectionLabel}>Secondaries</Text>
          <SecsRow secsArr={secsArr} styles={styles} />

          {backupOpen && (
            <View style={styles.backup}>
              <Text style={styles.backupTitle}>— Backup Build —</Text>

              <Text style={styles.sectionLabel}>Mod Set</Text>
              <View style={[styles.setPill, { borderColor: buColor }]}>
                <Text style={[styles.setLabel, { color: buColor }]}>{buModSetFull}</Text>
              </View>

              <Text style={styles.sectionLabel}>Primaries</Text>
              <PrimariesGrid char={char} slots={BU_PRIMARIES} styles={styles} />

              <Text style={styles.sectionLabel}>Secondaries</Text>
              <SecsRow secsArr={buSecsArr} styles={styles} />
            </View>
          )}

          <TouchableOpacity onPress={() => setBackupOpen(o => !o)}>
            <Text style={styles.expand}>{backupOpen ? '▲ less' : '▼ backup build'}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

function parseSecs(str) {
  if (!str || str === '-') return [];
  return str.split('>').map(s => s.trim()).filter(Boolean);
}

const createStyles = colors => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardCollapsed: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chevron: { color: colors.soft, fontSize: 11 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  name: {
    color: '#f5a623',
    fontSize: 15,
    fontWeight: 'bold',
    flexShrink: 1,
    marginRight: 8,
  },
  sub: {
    color: colors.soft,
    fontSize: 11,
    marginTop: 2,
    marginBottom: 2,
  },
  tagsLine: {
    color: colors.text,
    fontSize: 11,
    marginBottom: 8,
  },
  scoreBadge: {
    backgroundColor: colors.infoSurface,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  scoreText: { color: '#60a5fa', fontSize: 12, fontWeight: 'bold' },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: 10 },
  pendingNote: {
    backgroundColor: colors.infoSurface,
    borderWidth: 1,
    borderColor: '#60a5fa55',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 2,
  },
  pendingNoteText: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  sectionLabel: {
    color: colors.soft,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 5,
    marginTop: 8,
  },
  setPill: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  setLabel: { fontSize: 12, fontWeight: '600' },

  // Primaries
  primGrid: { gap: 5 },
  primRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  primLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  primSlotName: { fontSize: 12, fontWeight: '700' },
  primStat: { color: colors.text, fontSize: 12, fontWeight: '600' },
  fixedTag: { color: colors.soft, fontSize: 10, fontStyle: 'italic' },

  // Secondaries
  secsRow: { gap: 4 },
  secItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3,
  },
  secNum: {
    fontSize: 12,
    fontWeight: '800',
    width: 16,
    textAlign: 'center',
  },
  secText: { color: colors.text, fontSize: 12 },

  // Backup
  backup: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  backupTitle: {
    color: colors.soft,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 4,
  },
  expand: {
    color: colors.soft,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 10,
  },
});
