import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, FlatList, StyleSheet,
} from 'react-native';

export default function CustomPicker({ selectedValue, onValueChange, items, style }) {
  const [open, setOpen] = useState(false);
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

const styles = StyleSheet.create({
  trigger: {
    height: 44,
    backgroundColor: '#0d1520',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e2a3a',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  triggerText: { color: '#e2e8f0', fontSize: 14 },
  placeholder: { color: '#475569' },
  chevron: { color: '#94a3b8', fontSize: 16 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: '#111827',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e2a3a',
    maxHeight: 420,
    overflow: 'hidden',
  },
  item: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e2a3a',
  },
  itemActive: { backgroundColor: '#1a2535' },
  itemText: { color: '#e2e8f0', fontSize: 14 },
  itemTextActive: { color: '#f5a623', fontWeight: '700' },
});
