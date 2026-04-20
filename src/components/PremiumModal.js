// Premium upgrade modal. Two real CTAs in production:
//   1. Upgrade — one-time IAP, removes ads, unlocks every gated feature.
//   2. Restore Purchase — for users reinstalling on a new device.
// IAP isn't wired yet; the Upgrade button shows "Coming Soon" and a
// dev-only Toggle button below lets us preview the unlocked experience.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useAppTheme } from '../theme/appTheme';
import * as premiumState from '../services/premiumState';
import * as iap from '../services/iap';

const BENEFITS = [
  { icon: '⭐', text: 'Remove all ads' },
  { icon: '🔍', text: 'Roster lookup — link your ally code without a 24h ad' },
  { icon: '⚙', text: 'Mod Finder — see every matching mod, not just the top match' },
  { icon: '⚡', text: 'Slicer breakdown — score components, per-secondary quality, slice-gain estimates' },
];

export default function PremiumModal({ visible, onClose }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [premium, setPremium] = useState(() => premiumState.getSnapshot());
  const [product, setProduct] = useState(null);
  const [busy, setBusy] = useState(null); // 'upgrade' | 'restore' | null

  useEffect(() => {
    setPremium(premiumState.getSnapshot());
    return premiumState.subscribe(setPremium);
  }, []);

  // Fetch localized price the first time the modal becomes visible.
  useEffect(() => {
    if (!visible || product) return;
    let cancelled = false;
    (async () => {
      const p = await iap.getPremiumProduct();
      if (!cancelled) setProduct(p);
    })();
    return () => { cancelled = true; };
  }, [visible, product]);

  const isPremium = premium.isPremium;

  const handleToggleTest = async () => {
    await premiumState.setPremium(!isPremium);
  };

  const handleUpgrade = async () => {
    if (busy) return;
    setBusy('upgrade');
    try {
      const result = await iap.purchasePremium();
      if (!result.ok) {
        if (result.reason === 'iap-unavailable') {
          Alert.alert('Store Unavailable', 'In-app purchases are not available right now. Try again in a few minutes.');
        } else if (result.reason !== 'cancelled') {
          Alert.alert('Purchase Failed', `Could not complete purchase (${result.reason}). Please try again.`);
        }
      }
      // Success path: the purchase listener flips premiumState; the modal
      // updates via its subscription and shows the active banner.
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async () => {
    if (busy) return;
    setBusy('restore');
    try {
      const result = await iap.restorePurchases();
      if (!result.ok) {
        Alert.alert('Restore Failed', 'Could not check past purchases. Make sure you are signed in to the same account that bought Premium.');
      } else if (!result.restored) {
        Alert.alert('No Purchase Found', 'No previous Premium purchase was found on this account.');
      }
    } finally {
      setBusy(null);
    }
  };

  const upgradeLabel = isPremium
    ? 'Already Unlocked'
    : busy === 'upgrade'
      ? 'Processing…'
      : product?.localizedPrice
        ? `Upgrade — ${product.localizedPrice}`
        : 'Upgrade to Premium';
  const upgradeDisabled = isPremium || busy != null || !iap.isAvailable();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.crown}>⭐</Text>
            <Text style={styles.title}>ModForge Premium</Text>
            <Text style={styles.subtitle}>One purchase. Everything unlocked. No ads.</Text>
          </View>

          {isPremium ? (
            <View style={styles.activeBanner}>
              <Text style={styles.activeBannerText}>Premium Active</Text>
            </View>
          ) : null}

          <View style={styles.benefitList}>
            {BENEFITS.map((b, i) => (
              <View key={i} style={styles.benefitRow}>
                <Text style={styles.benefitIcon}>{b.icon}</Text>
                <Text style={styles.benefitText}>{b.text}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.upgradeBtn, styles.upgradeBtnDisabled]}
            disabled
            activeOpacity={0.85}
          >
            <Text style={styles.upgradeBtnText}>Upgrade — Coming Soon</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.restoreBtn}
            onPress={() => {}}
            activeOpacity={0.7}
          >
            <Text style={styles.restoreBtnText}>Restore Purchase</Text>
          </TouchableOpacity>

          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.devBtn}
            onPress={handleToggleTest}
            activeOpacity={0.8}
          >
            <Text style={styles.devBtnText}>
              {isPremium ? 'Disable Premium (test)' : 'Enable Premium (test)'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.devNote}>
            Dev-only toggle for previewing the unlocked experience. Will be removed at launch.
          </Text>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const GOLD = '#f5b942';

const createStyles = colors => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 12,
  },
  header: {
    alignItems: 'center',
    gap: 4,
  },
  crown: {
    fontSize: 28,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
  activeBanner: {
    alignSelf: 'center',
    backgroundColor: 'rgba(34,197,94,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.45)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  activeBannerText: {
    color: '#86efac',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  benefitList: {
    gap: 8,
    paddingVertical: 4,
  },
  benefitRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  benefitIcon: {
    fontSize: 16,
    width: 22,
    textAlign: 'center',
  },
  benefitText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  upgradeBtn: {
    backgroundColor: GOLD,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  upgradeBtnDisabled: {
    opacity: 0.55,
  },
  upgradeBtnText: {
    color: '#1a1a1a',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  restoreBtn: {
    paddingVertical: 6,
    alignItems: 'center',
  },
  restoreBtnText: {
    color: colors.muted,
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  devBtn: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  devBtnText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  devNote: {
    color: colors.muted,
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 14,
    marginTop: -4,
  },
  closeBtn: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  closeBtnText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
});
