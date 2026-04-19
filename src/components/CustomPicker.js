import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, FlatList, StyleSheet,
} from 'react-native';
import { useAppTheme } from '../theme/appTheme';

export default function CustomPicker({ selectedValue, onValueChange, items, style }) {
  const [open, setOpen] = useState(false);
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const selected = items.find(i => i.value === selectedValue);

  return (
    <View style={style}>
      <TouchableOpacity style={styles.trigger} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={[styles.triggerText, !selected && styles.placeholder]}>
          {selected ? selected.label : items[0]?.label ?? 'Select…'}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.sheet}>
            <FlatList
              data={items}
              keyExtractor={item => String(item.value ?? '__none__')}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.item, item.value === selectedValue && styles.itemActive]}
                  onPress={() => { onValueChange(item.value); setOpen(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.itemText, item.value === selectedValue && styles.itemTextActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const createStyles = colors => StyleSheet.create({
  trigger: {
    height: 44,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  triggerText: { color: colors.text, fontSize: 14 },
  placeholder: { color: colors.soft },
  chevron: { color: colors.muted, fontSize: 16 },
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 420,
    overflow: 'hidden',
  },
  item: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemActive: { backgroundColor: colors.surfaceAlt },
  itemText: { color: colors.text, fontSize: 14 },
  itemTextActive: { color: colors.primary, fontWeight: '700' },
});
