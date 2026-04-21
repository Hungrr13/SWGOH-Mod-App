// GAC Meta screen — pulls top squads for 3v3 / 5v5 from the Cloudflare Worker
// scraper and filters/ranks them against the user's roster.
//
// Gate: premium OR GAC_META rewarded unlock. Without unlock we still show the
// global meta list (no "your coverage" filter).

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../theme/appTheme';
import * as gacMetaState from '../services/gacMetaState';
import { recommendSquads } from '../services/gacMetaService';
import * as rosterState from '../services/rosterState';
import * as premiumState from '../services/premiumState';
import { showRewardedAd } from '../services/rewardedAds';
import { CHAR_BASE_IDS } from '../data/charBaseIds';

const FEATURE = premiumState.FEATURES.GAC_META;

const BASE_ID_TO_NAME = (() => {
  const out = {};
  for (const [name, id] of Object.entries(CHAR_BASE_IDS)) {
    if (id && !out[id]) out[id] = name;
  }
  return out;
})();

function prettyMember(baseId) {
  return BASE_ID_TO_NAME[baseId] || baseId;
}

function pct(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${Math.round(x * 100)}%`;
}

export default function GacScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [bracket, setBracket] = useState('5v5');
  const [role, setRole] = useState('defense');
  const [snapshot, setSnapshot] = useState(() => gacMetaState.getSnapshot());
  const [roster, setRoster] = useState(() => rosterState.getSnapshot());
  const [premium, setPremium] = useState(() => premiumState.getSnapshot());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => gacMetaState.subscribe(setSnapshot), []);
  useEffect(() => rosterState.subscribe(setRoster), []);
  useEffect(() => premiumState.subscribe(setPremium), []);

  const unlocked = premium.isPremium || premiumState.hasFeature(FEATURE);
  const hasRoster = !!roster?.hasRoster;

  const payload = snapshot?.[bracket] || null;

  useEffect(() => {
    if (!payload && !loading) {
      load(bracket, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bracket]);

  async function load(b, force) {
    setLoading(true);
    setError(null);
    try {
      await gacMetaState.loadBracket(b, { forceRefresh: !!force });
    } catch (e) {
      setError(e?.message || 'Failed to fetch GAC meta');
    } finally {
      setLoading(false);
    }
  }

  const ownedIds = useMemo(() => {
    const set = rosterState.getCurrentOwnedIds();
    return set instanceof Set ? set : new Set(Array.from(set || []));
  }, [roster]);

  const ranked = useMemo(() => {
    if (!payload) return null;
    if (!hasRoster) return null;
    return recommendSquads(payload, ownedIds);
  }, [payload, ownedIds, hasRoster]);

  async function handleUnlock() {
    try {
      const result = await showRewardedAd(FEATURE);
      if (result.rewarded) return;
      if (result.reason === 'ads-unavailable') {
        Alert.alert('Ads Unavailable', 'Try again later, or upgrade to Premium.');
      }
    } catch (e) {
      Alert.alert('Ad Failed', e?.message || 'Reward ad failed.');
    }
  }

  const squadsToShow = (() => {
    if (!payload) return [];
    if (!hasRoster) return payload.squads.slice(0, 30);
    const bucket = role === 'offense' ? ranked?.offense : ranked?.defense;
    return (bucket || []).slice(0, 30);
  })();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>GAC Meta</Text>
        <Text style={styles.subtitle}>
          Top squads from swgoh.gg, {hasRoster ? 'ranked by your roster coverage' : 'global leaderboard'}.
        </Text>

        {!unlocked ? (
          <View style={styles.gateCard}>
            <Text style={styles.gateTitle}>Premium feature</Text>
            <Text style={styles.gateBody}>
              GAC meta recommendations are a premium feature. Watch a short ad to
              unlock for 24 hours, or upgrade to Premium for permanent ad-free access.
            </Text>
            <TouchableOpacity style={styles.unlockBtn} onPress={handleUnlock} activeOpacity={0.85}>
              <Text style={styles.unlockBtnText}>Watch ad to unlock (24h)</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.toggleRow}>
          {['3v3', '5v5'].map(b => (
            <TouchableOpacity
              key={b}
              style={[styles.toggleBtn, bracket === b && styles.toggleBtnActive]}
              onPress={() => setBracket(b)}
              activeOpacity={0.85}
            >
              <Text style={[styles.toggleText, bracket === b && styles.toggleTextActive]}>{b}</Text>
            </TouchableOpacity>
          ))}
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={[styles.toggleBtn, styles.refreshBtn]}
            onPress={() => load(bracket, true)}
            activeOpacity={0.85}
            disabled={loading}
          >
            <Text style={styles.toggleText}>{loading ? '…' : 'Refresh'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.toggleRow}>
          {['defense', 'offense'].map(r => (
            <TouchableOpacity
              key={r}
              style={[styles.toggleBtn, role === r && styles.toggleBtnActive]}
              onPress={() => setRole(r)}
              activeOpacity={0.85}
            >
              <Text style={[styles.toggleText, role === r && styles.toggleTextActive]}>
                {r === 'defense' ? 'Defense (holds)' : 'Offense (counters)'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {!hasRoster ? (
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>
              Link your ally code on the Lookup tab to filter squads to characters you own.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={[styles.infoCard, styles.errorCard]}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {loading && !payload ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={theme.primary} />
            <Text style={styles.loadingText}>Loading {bracket} meta…</Text>
          </View>
        ) : null}

        {hasRoster && ranked ? (
          <Text style={styles.summary}>
            {ranked.totalEligibleSquads} of {ranked.totalSquadsConsidered} top squads have ≥60% coverage on your roster.
          </Text>
        ) : null}

        {squadsToShow.map((item, idx) => {
          const sq = item.squad || item;
          const coverage = item.coverage != null ? pct(item.coverage) : null;
          const score = item.score;
          const rate = role === 'offense'
            ? sq.offenseWinRate
            : sq.defenseWinRate;
          const leadName = prettyMember(sq.members?.[0] || '');
          return (
            <View key={`${sq.members?.join('-')}-${idx}`} style={styles.squadCard}>
              <View style={styles.squadHeaderRow}>
                <Text style={styles.squadRank}>#{idx + 1}</Text>
                <Text style={styles.squadName}>{leadName} lead</Text>
              </View>
              <View style={styles.memberList}>
                {sq.members?.map(m => {
                  const owned = ownedIds.has(m);
                  return (
                    <View
                      key={m}
                      style={[
                        styles.memberChip,
                        !owned && hasRoster && styles.memberChipMissing,
                      ]}
                    >
                      <Text
                        style={[
                          styles.memberText,
                          !owned && hasRoster && styles.memberTextMissing,
                        ]}
                      >
                        {prettyMember(m)}
                      </Text>
                    </View>
                  );
                })}
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statText}>
                  {role === 'defense' ? 'Hold' : 'Attack'}: {pct(rate)}
                </Text>
                {sq.sampleSize ? (
                  <Text style={styles.statText}>Seen: {formatCompact(sq.sampleSize)}</Text>
                ) : null}
                {coverage ? <Text style={styles.statText}>Coverage: {coverage}</Text> : null}
                {score != null ? (
                  <Text style={styles.statText}>Score: {(score * 100).toFixed(0)}</Text>
                ) : null}
              </View>
            </View>
          );
        })}

        {!loading && payload && squadsToShow.length === 0 ? (
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>
              No squads matched. {hasRoster ? 'Try switching role or unlock more characters.' : ''}
            </Text>
          </View>
        ) : null}

        {payload?.source ? (
          <Text style={styles.source}>Source: swgoh.gg{'\n'}{payload.source}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function formatCompact(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

const createStyles = colors => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 14, gap: 10, paddingBottom: 40 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 12, lineHeight: 16, marginBottom: 4 },
  toggleRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  toggleBtn: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surfaceAlt,
  },
  toggleBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  refreshBtn: { backgroundColor: colors.surface },
  toggleText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  toggleTextActive: { color: '#fff' },
  gateCard: {
    backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1,
    borderColor: colors.border, padding: 12, gap: 8,
  },
  gateTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  gateBody: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  unlockBtn: {
    backgroundColor: '#7c3aed', borderRadius: 8, paddingVertical: 10,
    alignItems: 'center', marginTop: 4,
  },
  unlockBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  infoCard: {
    backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1,
    borderColor: colors.border, padding: 10,
  },
  infoText: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  errorCard: { borderColor: '#f87171' },
  errorText: { color: '#f87171', fontSize: 12 },
  loadingBlock: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  loadingText: { color: colors.muted, fontSize: 12 },
  summary: { color: colors.muted, fontSize: 11, fontStyle: 'italic' },
  squadCard: {
    backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1,
    borderColor: colors.border, padding: 10, gap: 6,
  },
  squadHeaderRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  squadRank: { color: colors.muted, fontSize: 12, fontWeight: '700', width: 32 },
  squadName: { color: colors.text, fontSize: 14, fontWeight: '800', flex: 1 },
  memberList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  memberChip: {
    backgroundColor: colors.surfaceAlt, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: colors.border,
  },
  memberChipMissing: {
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderColor: 'rgba(248,113,113,0.5)',
  },
  memberText: { color: colors.text, fontSize: 11, fontWeight: '600' },
  memberTextMissing: { color: '#f87171' },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 },
  statText: { color: colors.muted, fontSize: 11 },
  source: { color: colors.muted, fontSize: 10, fontStyle: 'italic', marginTop: 8 },
});
