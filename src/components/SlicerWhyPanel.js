// Premium "Why" panel for the Slicer.
// Free users see the headline decision (already in the verdict card upstream).
// Premium / rewarded-ad-unlocked users see the score breakdown and per-secondary
// scoring detail behind it. Mirrors the gate pattern in AllyCodePanel.

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../theme/appTheme';
import * as premiumState from '../services/premiumState';
import { showRewardedAd } from '../services/rewardedAds';

const SLICER_WHY_FEATURE = premiumState.FEATURES.SLICER_WHY;

function formatRemaining(ms) {
  if (!ms || ms <= 0) return null;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h left`;
  const minutes = Math.max(1, Math.floor(ms / (60 * 1000)));
  return `${minutes}m left`;
}

function bandColor(band) {
  if (band === 'GREAT') return '#c084fc';
  if (band === 'GOOD') return '#60a5fa';
  return '#94a3b8';
}

export default function SlicerWhyPanel({ result, secRows = [] }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [premium, setPremium] = useState(() => premiumState.getSnapshot());
  const [busy, setBusy] = useState(false);
  const [perSecOpen, setPerSecOpen] = useState(false);

  useEffect(() => {
    setPremium(premiumState.getSnapshot());
    return premiumState.subscribe(setPremium);
  }, []);

  const unlocked = premium.isPremium || premiumState.hasFeature(SLICER_WHY_FEATURE);
  const expiry = premiumState.getUnlockExpiry(SLICER_WHY_FEATURE);
  const remainingMs = expiry === Infinity ? null : expiry - Date.now();
  const remainingLabel = formatRemaining(remainingMs);

  const handleWatchAd = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await showRewardedAd(SLICER_WHY_FEATURE);
      if (!r.rewarded && r.reason === 'ads-unavailable') {
        Alert.alert(
          'Ads Unavailable',
          'Reward ads are not available right now. Try again later, or upgrade to ad-free Premium.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  if (!result) return null;

  if (!unlocked) {
    return (
      <View style={styles.gateCard}>
        <Text style={styles.gateTitle}>Why this verdict?</Text>
        <Text style={styles.gateBody}>
          Unlock the full breakdown — component scores, per-secondary quality, and
          slice-gain estimates — to see exactly why the engine landed on{' '}
          <Text style={styles.gateBodyEm}>{result.decision}</Text>.
        </Text>
        <TouchableOpacity
          style={[styles.adBtn, busy && styles.adBtnDisabled]}
          onPress={handleWatchAd}
          disabled={busy}
          activeOpacity={0.85}
        >
          <Text style={styles.adBtnText}>
            {busy ? 'Loading ad…' : 'Watch ad to unlock (24h)'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const subs = [
    { key: 'fit', label: 'Shell fit', value: result.fitScore },
    { key: 'sec', label: 'Secondaries', value: result.secondaryScore },
    { key: 'upside', label: 'Upside', value: result.upsideScore },
    { key: 'context', label: 'Context', value: result.contextScore },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.cardTitle}>Why · Score Breakdown</Text>
        <View style={styles.unlockPill}>
          <Text style={styles.unlockPillText}>
            {premium.isPremium
              ? 'Premium'
              : `Unlocked${remainingLabel ? ` · ${remainingLabel}` : ''}`}
          </Text>
        </View>
      </View>

      {subs.map(s => (
        <View key={s.key} style={styles.subRow}>
          <Text style={styles.subLabel}>{s.label}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.max(2, Math.min(100, s.value))}%` }]} />
          </View>
          <Text style={styles.subVal}>{Math.round(s.value)}</Text>
        </View>
      ))}

      {result.scoredStats?.length ? (
        <>
          <TouchableOpacity
            style={styles.perSecHeader}
            onPress={() => setPerSecOpen(v => !v)}
            activeOpacity={0.7}
          >
            <Text style={styles.cardTitle}>Per-Secondary</Text>
            <Text style={styles.perSecChevron}>{perSecOpen ? '▾' : '▸'}</Text>
          </TouchableOpacity>
          {perSecOpen && result.scoredStats.map((s, i) => {
            const row = secRows.find(r => r.stat === s.name);
            return (
              <View key={i} style={styles.statRow}>
                <View style={styles.statRowHead}>
                  <Text style={styles.statName}>{s.name}</Text>
                  {row?.value ? <Text style={styles.statValue}>{row.value}</Text> : null}
                  <Text style={[styles.statBand, { color: bandColor(s.qualityBand) }]}>
                    {s.qualityBand}
                  </Text>
                </View>
                <Text style={styles.statMeta}>
                  Q {Math.round(s.qualityPct)}% · weight {Math.round(s.targetWeight)} · slice +{Math.round(s.sliceGainPct)}%
                </Text>
                {row?.ref ? (
                  <Text style={styles.statThresholds}>
                    Good: {row.ref.g} · Great: {row.ref.gr} · Max: {row.ref.m5}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

const createStyles = colors => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  subLabel: {
    color: colors.muted,
    fontSize: 12,
    width: 92,
  },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#7c3aed',
  },
  subVal: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    width: 32,
    textAlign: 'right',
  },
  statRow: {
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  perSecHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingVertical: 4,
  },
  perSecChevron: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  statRowHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  statName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  statValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  statBand: {
    fontSize: 11,
    fontWeight: '800',
  },
  statMeta: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2,
  },
  statThresholds: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 2,
  },
  gateCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 8,
  },
  gateTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  gateBody: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  gateBodyEm: {
    color: colors.text,
    fontWeight: '700',
  },
  adBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  adBtnDisabled: {
    opacity: 0.55,
  },
  adBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  unlockPill: {
    backgroundColor: 'rgba(34,197,94,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.45)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  unlockPillText: {
    color: '#86efac',
    fontSize: 10,
    fontWeight: '800',
  },
});
