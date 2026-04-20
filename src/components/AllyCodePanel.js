import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../theme/appTheme';
import * as rosterState from '../services/rosterState';
import * as premiumState from '../services/premiumState';
import { showRewardedAd } from '../services/rewardedAds';

const ROSTER_FEATURE = premiumState.FEATURES.ROSTER;

function formatRemaining(ms) {
  if (!ms || ms <= 0) return null;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h left`;
  const minutes = Math.max(1, Math.floor(ms / (60 * 1000)));
  return `${minutes}m left`;
}

export default function AllyCodePanel() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [snapshot, setSnapshot] = useState(() => rosterState.getSnapshot());
  const [premium, setPremium] = useState(() => premiumState.getSnapshot());

  useEffect(() => {
    setSnapshot(rosterState.getSnapshot());
    return rosterState.subscribe(setSnapshot);
  }, []);

  useEffect(() => {
    setPremium(premiumState.getSnapshot());
    return premiumState.subscribe(setPremium);
  }, []);

  const rosterUnlocked = premium.isPremium || premiumState.hasFeature(ROSTER_FEATURE);
  const unlockExpiry = premiumState.getUnlockExpiry(ROSTER_FEATURE);
  const remainingMs = unlockExpiry === Infinity ? null : unlockExpiry - Date.now();
  const remainingLabel = formatRemaining(remainingMs);

  const handleWatchAd = async () => {
    if (busy) return;
    setBusy(true);
    setStatus({ kind: 'info', text: 'Loading reward ad…' });
    try {
      const result = await showRewardedAd(ROSTER_FEATURE);
      if (result.rewarded) {
        setStatus({ kind: 'ok', text: 'Roster lookup unlocked for 24h.' });
      } else if (result.reason === 'ads-unavailable') {
        Alert.alert(
          'Ads Unavailable',
          'Reward ads are not available right now. Try again later, or upgrade to ad-free Premium for permanent access.',
        );
        setStatus(null);
      } else {
        setStatus({ kind: 'err', text: 'Ad closed before reward — unlock not granted.' });
      }
    } catch (e) {
      setStatus({ kind: 'err', text: e?.message || 'Reward ad failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleLoad = async () => {
    const digits = input.replace(/\D/g, '');
    if (digits.length !== 9) {
      setStatus({ kind: 'err', text: 'Ally code must be 9 digits.' });
      return;
    }
    setBusy(true);
    setStatus({ kind: 'info', text: 'Fetching roster…' });
    try {
      const payload = await rosterState.setAllyCode(digits, { forceRefresh: true });
      setStatus({
        kind: 'ok',
        text: `Loaded ${payload.unitCount} units for ${payload.playerName || 'player'}.`,
      });
      setInput('');
    } catch (e) {
      setStatus({ kind: 'err', text: e?.message || 'Fetch failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    try {
      await rosterState.clearAllyCode();
      setStatus({ kind: 'info', text: 'Ally code cleared.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Ally Code</Text>
      <Text style={styles.subtitle}>
        Link your roster so recommendations skip characters you don't own.
      </Text>
      {snapshot.hasRoster ? (
        <View style={styles.statusBlock}>
          <Text style={styles.statusValue}>
            {snapshot.playerName || '—'} ({snapshot.allyCode})
          </Text>
          <Text style={styles.statusSub}>
            {snapshot.ownedCount} owned · updated {new Date(snapshot.timestamp).toLocaleString()}
          </Text>
        </View>
      ) : null}
      {rosterUnlocked ? (
        <View style={styles.unlockPill}>
          <Text style={styles.unlockPillText}>
            {premium.isPremium
              ? 'Premium · roster lookup unlocked'
              : `Roster unlocked${remainingLabel ? ` · ${remainingLabel}` : ''}`}
          </Text>
        </View>
      ) : (
        <View style={styles.gateBlock}>
          <Text style={styles.gateTitle}>Roster lookup is a premium feature</Text>
          <Text style={styles.gateSubtitle}>
            Watch a short ad to unlock for 24 hours, or go ad-free with Premium.
          </Text>
          <TouchableOpacity
            style={[styles.button, styles.buttonReward, busy && styles.buttonDisabled]}
            onPress={handleWatchAd}
            disabled={busy}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>
              {busy ? 'Loading ad…' : 'Watch ad to unlock (24h)'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={[styles.inputRow, !rosterUnlocked && styles.inputRowDisabled]} pointerEvents={rosterUnlocked ? 'auto' : 'none'}>
        <TextInput
          style={styles.input}
          placeholder="e.g. 123-456-789"
          placeholderTextColor={theme.muted}
          keyboardType="number-pad"
          value={input}
          onChangeText={setInput}
          editable={!busy}
          maxLength={13}
        />
        <TouchableOpacity
          style={[styles.button, styles.buttonPrimary, busy && styles.buttonDisabled]}
          onPress={handleLoad}
          disabled={busy}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>
            {busy ? '…' : snapshot.hasRoster ? 'Refresh' : 'Load'}
          </Text>
        </TouchableOpacity>
        {snapshot.hasRoster ? (
          <TouchableOpacity
            style={[styles.button, styles.buttonSecondary]}
            onPress={handleClear}
            disabled={busy}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {status ? (
        <Text
          style={[
            styles.msg,
            status.kind === 'err' && { color: '#f87171' },
            status.kind === 'ok' && { color: '#34d399' },
          ]}
        >
          {status.text}
        </Text>
      ) : null}
    </View>
  );
}

const createStyles = colors => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  statusBlock: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  statusValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  statusSub: {
    color: colors.muted,
    fontSize: 11,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'stretch',
  },
  inputRowDisabled: {
    opacity: 0.4,
  },
  gateBlock: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    gap: 6,
  },
  gateTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  gateSubtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  buttonReward: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
    paddingVertical: 10,
    marginTop: 2,
  },
  unlockPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(34,197,94,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.45)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  unlockPillText: {
    color: '#86efac',
    fontSize: 11,
    fontWeight: '700',
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 14,
    letterSpacing: 1,
  },
  button: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    minWidth: 64,
  },
  buttonPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  msg: {
    color: colors.muted,
    fontSize: 12,
  },
});
