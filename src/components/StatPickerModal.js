import React, { useMemo } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { SEC_STATS } from '../constants/modData';
import { useAppTheme } from '../theme/appTheme';

const COLS = 3;
const ITEMS = [{ label: 'None', value: '' }, ...SEC_STATS.map(s => ({ label: s, value: s }))];

// Pad to full rows
const GRID = [...ITEMS];
while (GRID.length % COLS !== 0) GRID.push(null);

export default function StatPickerModal({ visible, selected, onSelect, onClose }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <Text style={styles.title}>Select Stat</Text>
          <View style={styles.grid}>
            {GRID.map((item, idx) =>
              item ? (
                <TouchableOpacity
                  key={item.value || '__none__'}
                  style={styles.cell}
                  onPress={() => { onSelect(item.value); onClose(); }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.cellInner, selected === item.value && styles.cellInnerActive]}>
                    <Text
                      style={[styles.cellText, selected === item.value && styles.cellTextActive]}
                      numberOfLines={2}
                      adjustsFontSizeToFit
                    >
                      {item.label}
                    </Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <View key={`e${idx}`} style={styles.cell} />
              )
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const createStyles = colors => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  title: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 12,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / COLS}%`, padding: 4 },
  cellInner: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  cellInnerActive: {
    backgroundColor: colors.warmSurface,
    borderColor: colors.primary,
  },
  cellText: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
  cellTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
});
