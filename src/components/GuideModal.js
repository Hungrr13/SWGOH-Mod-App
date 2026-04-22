import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../theme/appTheme';

const GUIDE_PAGES = [
  {
    key: 'lookup',
    eyebrow: 'Tab 1',
    title: 'Hero Lookup',
    icon: '🔍',
    body: 'Use this tab when you want to search a character directly or browse by role and tag. It is the fastest way to pull up a hero and see their recommended mod set, primaries, and priority secondaries.',
    tips: [
      'Type part of a name to jump straight to a character.',
      'Use the filter button to narrow by role or faction tags when you are building a full squad.',
      'Open a character card when you want a quick mod profile without comparing multiple heroes.',
    ],
  },
  {
    key: 'finder',
    eyebrow: 'Tab 2',
    title: 'Mod Finder',
    icon: '⚙',
    body: 'Use this tab when you have a mod in mind and want to know which characters fit it best. Pick a set, shape, primary, and secondaries, then the app ranks the strongest character matches for that mod profile.',
    tips: [
      'Start with set and shape first, then add primary and secondaries to tighten the matches.',
      'Use the ranked results to see best-fit characters before you commit a rare mod.',
      'Open Full Profile to compare the match against the character’s whole recommended build.',
    ],
  },
  {
    key: 'slice',
    eyebrow: 'Tab 3',
    title: 'Mod Slicer',
    icon: '⚡',
    body: 'Use this tab when you are deciding whether a mod is worth slicing further. Enter the mod shell and the current secondary values, then the screen scores the mod’s potential and walks the tier ladder a step at a time.',
    tips: [
      'Enter each secondary’s rolls and value accurately — the verdict is driven by roll counts, not just totals.',
      'Verdicts follow community rules: “slice to 6-dot” only fires when Speed has 3+ rolls and value ≥ 14, a high-gain stat is already rolling 65%+ quality, or the mod is a Speed arrow.',
      'Ambiguous pre-5A mods show Slice to {next tier} instead of a final verdict — take one tier, re-check; don’t burn mats projecting from partial rolls.',
      'Cap at 5A means finish the free 1→15 level climb but skip 6-dot mats; Filler means equip as-is and replace when better lands.',
    ],
  },
  {
    key: 'scanner',
    eyebrow: 'Tab 4',
    title: 'Mod Scanner',
    icon: '📷',
    body: 'Use this tab to scan a mod straight from the SWGOH mod inspect screen. Start the floating bubble, jump into the game, and tap the bubble while a mod is open to capture and parse its set, shape, primary, and secondaries.',
    tips: [
      'Link your ally code at the top so character recommendations only include heroes you actually own.',
      'Tap Start Scanner Bubble, grant the overlay + screen-capture prompts once, and the bubble follows you into SWGOH.',
      'After a capture, use the Use In Finder or Use In Slicer buttons to send the parsed mod straight to the right tab.',
    ],
  },
];

export default function GuideModal({ visible, onClose }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    if (visible) setPageIndex(0);
  }, [visible]);

  const page = GUIDE_PAGES[pageIndex];
  const canGoBack = pageIndex > 0;
  const canGoForward = pageIndex < GUIDE_PAGES.length - 1;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Guide Me</Text>
          <Text style={styles.pageCount}>{`${pageIndex + 1} / ${GUIDE_PAGES.length}`}</Text>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.heroCard}>
            <Text style={styles.eyebrow}>{page.eyebrow}</Text>
            <Text style={styles.icon}>{page.icon}</Text>
            <Text style={styles.title}>{page.title}</Text>
            <Text style={styles.body}>{page.body}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How To Use It</Text>
            {page.tips.map((tip, index) => (
              <View key={`${page.key}_${index}`} style={styles.tipRow}>
                <Text style={styles.tipDot}>•</Text>
                <Text style={styles.tipText}>{tip}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.navButton, !canGoBack && styles.navButtonDisabled]}
            onPress={() => canGoBack && setPageIndex(index => index - 1)}
            disabled={!canGoBack}
            activeOpacity={0.8}
          >
            <Text style={[styles.navButtonText, !canGoBack && styles.navButtonTextDisabled]}>← Back</Text>
          </TouchableOpacity>

          <View style={styles.progressRow}>
            {GUIDE_PAGES.map((item, index) => (
              <View
                key={item.key}
                style={[styles.progressDot, index === pageIndex && styles.progressDotActive]}
              />
            ))}
          </View>

          <TouchableOpacity
            style={styles.navButton}
            onPress={() => {
              if (canGoForward) {
                setPageIndex(index => index + 1);
                return;
              }
              setPageIndex(0);
              onClose();
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.navButtonText}>
              {canGoForward ? 'Next →' : 'Done'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = colors => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  closeText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  pageCount: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  content: {
    padding: 16,
    paddingBottom: 24,
    gap: 14,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  icon: {
    fontSize: 34,
    marginBottom: 8,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 10,
  },
  body: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  section: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 12,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  tipDot: {
    color: colors.primary,
    fontSize: 16,
    marginRight: 8,
    lineHeight: 20,
  },
  tipText: {
    flex: 1,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  navButton: {
    minWidth: 92,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  navButtonDisabled: {
    opacity: 0.45,
  },
  navButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  navButtonTextDisabled: {
    color: colors.soft,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.soft,
  },
  progressDotActive: {
    width: 24,
    backgroundColor: colors.primary,
  },
});
