import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { decodePrimary, decodeModSet, decodeRole, setColor, secPriorityColor } from '../constants/modData';

export default function CharacterCard({ char, score }) {
  const [expanded, setExpanded] = useState(false);

  const modSetFull    = decodeModSet(char.modSet);
  const buModSetFull  = decodeModSet(char.buSet);
  const mainColor     = setColor(modSetFull);
  const buColor       = setColor(buModSetFull);

  const secsArr  = parseSecs(char.secs);
  const buSecsArr = parseSecs(char.buSecs);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => setExpanded(e => !e)}
      activeOpacity={0.85}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{char.name}</Text>
          {score !== undefined && (
            <View style={styles.scoreBadge}>
              <Text style={styles.scoreText}>{score}</Text>
            </View>
          )}
        </View>
        <Text style={styles.sub}>
          {char.faction} · {decodeRole(char.role)}
        </Text>
      </View>

      {/* Mod set pill */}
      <View style={[styles.setPill, { borderColor: mainColor }]}>
        <Text style={[styles.setLabel, { color: mainColor }]}>{modSetFull}</Text>
      </View>

      {/* Primaries row */}
      <View style={styles.primRow}>
        {[
          { label: '▲', key: 'arrow' },
          { label: '△', key: 'triangle' },
          { label: '○', key: 'circle' },
          { label: '✚', key: 'cross' },
        ].map(({ label, key }) => (
          <View key={key} style={styles.primBox}>
            <Text style={styles.primShape}>{label}</Text>
            <Text style={styles.primStat}>{decodePrimary(char[key])}</Text>
          </View>
        ))}
      </View>

      {/* Secondaries */}
      <View style={styles.secsRow}>
        {secsArr.map((sec, i) => (
          <View
            key={i}
            style={[styles.secChip, { borderColor: secPriorityColor(i) }]}
          >
            <Text style={[styles.secText, { color: secPriorityColor(i) }]}>
              {sec}
            </Text>
          </View>
        ))}
      </View>

      {/* Expanded backup build */}
      {expanded && (
        <View style={styles.backup}>
          <Text style={styles.backupTitle}>Backup Build</Text>

          <View style={[styles.setPill, { borderColor: buColor }]}>
            <Text style={[styles.setLabel, { color: buColor }]}>{buModSetFull}</Text>
          </View>

          <View style={styles.primRow}>
            {[
              { label: '△', val: char.buTri },
              { label: '○', val: char.buCir },
              { label: '✚', val: char.buCro },
            ].map(({ label, val }) => (
              <View key={label} style={styles.primBox}>
                <Text style={styles.primShape}>{label}</Text>
                <Text style={styles.primStat}>{decodePrimary(val)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.secsRow}>
            {buSecsArr.map((sec, i) => (
              <View
                key={i}
                style={[styles.secChip, { borderColor: secPriorityColor(i) }]}
              >
                <Text style={[styles.secText, { color: secPriorityColor(i) }]}>
                  {sec}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <Text style={styles.expand}>{expanded ? '▲ less' : '▼ backup build'}</Text>
    </TouchableOpacity>
  );
}

// Parse "Speed > Offense > Crit Chance%" → ["Speed","Offense","Crit Chance%"]
function parseSecs(str) {
  if (!str || str === '-') return [];
  return str.split('>').map(s => s.trim()).filter(Boolean);
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1e2a3a',
  },
  header: {
    marginBottom: 6,
  },
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
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  scoreBadge: {
    backgroundColor: '#1e3a5f',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  scoreText: {
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: 'bold',
  },
  setPill: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginBottom: 8,
    marginTop: 2,
  },
  setLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  primRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  primBox: {
    backgroundColor: '#1e2a3a',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
    minWidth: 60,
  },
  primShape: {
    color: '#94a3b8',
    fontSize: 11,
  },
  primStat: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '600',
  },
  secsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 4,
  },
  secChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  secText: {
    fontSize: 11,
    fontWeight: '600',
  },
  backup: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1e2a3a',
  },
  backupTitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  expand: {
    color: '#475569',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 6,
  },
});
