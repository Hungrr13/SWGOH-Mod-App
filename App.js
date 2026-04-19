import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  LogBox,
  Modal,
  PanResponder,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

LogBox.ignoreAllLogs();
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppThemeProvider, useAppTheme, useThemeControls } from './src/theme/appTheme';
import * as rosterState from './src/services/rosterState';

const SCREEN_WIDTH = Dimensions.get('window').width;

function MissingScreen({ label }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: '#f87171', fontSize: 18, fontWeight: '700', marginBottom: 8 }}>
        Screen Load Error
      </Text>
      <Text style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center' }}>
        {label} could not be loaded in this build.
      </Text>
    </View>
  );
}

function renderLookupScreen(props) {
  let Screen = null;
  try {
    const mod = require('./src/screens/LookupScreen');
    Screen = mod?.default ?? mod ?? null;
  } catch (error) {
    Screen = null;
  }
  return Screen ? <Screen {...props} /> : <MissingScreen label="Hero Lookup" />;
}

function renderFinderScreen(props) {
  let Screen = null;
  try {
    const mod = require('./src/screens/FinderScreen');
    Screen = mod?.default ?? mod ?? null;
  } catch (error) {
    Screen = null;
  }
  return Screen ? <Screen {...props} /> : <MissingScreen label="Mod Finder" />;
}

function renderSliceScreen(props) {
  let Screen = null;
  try {
    const mod = require('./src/screens/SliceScreen');
    Screen = mod?.default ?? mod ?? null;
  } catch (error) {
    Screen = null;
  }
  return Screen ? <Screen {...props} /> : <MissingScreen label="Mod Slicer" />;
}

function renderOverlayCaptureScreen(props) {
  let Screen = null;
  try {
    const mod = require('./src/screens/OverlayCaptureScreen');
    Screen = mod?.default ?? mod ?? null;
  } catch (error) {
    Screen = null;
  }
  return Screen ? <Screen {...props} /> : <MissingScreen label="Scanner" />;
}

function GuideModalHost(props) {
  let Screen = null;
  try {
    const mod = require('./src/components/GuideModal');
    Screen = mod?.default ?? mod ?? null;
  } catch (error) {
    Screen = null;
  }
  return Screen ? <Screen {...props} /> : null;
}

const TABS = [
  { key: 'Lookup', title: 'Hero Lookup', label: 'Lookup', icon: '🔍', component: renderLookupScreen },
  { key: 'Finder', title: 'Mod Finder', label: 'Finder', icon: '⚙', component: renderFinderScreen },
  { key: 'Slice', title: 'Mod Slicer', label: 'Slice', icon: '⚡', component: renderSliceScreen },
  { key: 'Scanner', title: 'Mod Scanner', label: 'Scanner', icon: '📸', component: renderOverlayCaptureScreen },
];

function AppMenu({ visible, onClose, onOpenGuide, onOpenScanner, onOpenAllyCode, onToggleTheme, isDark }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createMenuStyles(theme), [theme]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.menuCard}>
          <Text style={styles.menuTitle}>Options</Text>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => {
              onClose();
              onOpenGuide();
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.menuButtonText}>Guide Me</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => {
              onClose();
              onOpenScanner();
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.menuButtonText}>Open Scanner Tab</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => {
              onClose();
              onOpenAllyCode();
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.menuButtonText}>Set Ally Code</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => {
              onToggleTheme();
              onClose();
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.menuButtonText}>{isDark ? 'Light Mode' : 'Dark Mode'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => {
              onClose();
              BackHandler.exitApp();
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.menuButtonText}>Quit App</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
}

function AllyCodeModal({ visible, onClose }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createAllyCodeStyles(theme), [theme]);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [snapshot, setSnapshot] = useState(() => rosterState.getSnapshot());

  useEffect(() => {
    if (!visible) return;
    setSnapshot(rosterState.getSnapshot());
    setStatus(null);
    const unsub = rosterState.subscribe(setSnapshot);
    return unsub;
  }, [visible]);

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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>Ally Code</Text>
          <Text style={styles.subtitle}>
            Link your roster so mod recommendations skip characters you don't own.
          </Text>
          {snapshot.hasRoster ? (
            <View style={styles.statusBlock}>
              <Text style={styles.statusLabel}>Current</Text>
              <Text style={styles.statusValue}>
                {snapshot.playerName || '—'} ({snapshot.allyCode})
              </Text>
              <Text style={styles.statusSub}>
                {snapshot.ownedCount} owned · updated{' '}
                {new Date(snapshot.timestamp).toLocaleString()}
              </Text>
            </View>
          ) : (
            <Text style={styles.statusSub}>No roster linked yet.</Text>
          )}
          <TextInput
            style={styles.input}
            placeholder="e.g. 489-758-819"
            placeholderTextColor={theme.muted}
            keyboardType="number-pad"
            value={input}
            onChangeText={setInput}
            editable={!busy}
            maxLength={13}
          />
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
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.buttonPrimary, busy && styles.buttonDisabled]}
              onPress={handleLoad}
              disabled={busy}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>{busy ? 'Working…' : snapshot.hasRoster ? 'Refresh Roster' : 'Load Roster'}</Text>
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
            <TouchableOpacity
              style={[styles.button, styles.buttonSecondary]}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const TabSceneHost = forwardRef(function TabSceneHost({
  activeIndex,
  onChangeTab,
  finderPrefill,
  slicePrefill,
  onConsumeFinderPrefill,
  onConsumeSlicePrefill,
}, ref) {
  const theme = useAppTheme();
  const styles = useMemo(() => createShellStyles(theme), [theme]);
  const translateX = useRef(new Animated.Value(-activeIndex * SCREEN_WIDTH)).current;
  const activeIndexRef = useRef(activeIndex);
  const isAnimating = useRef(false);
  const [mountedTabs, setMountedTabs] = useState(() => new Set([activeIndex]));

  useEffect(() => {
    activeIndexRef.current = activeIndex;
    setMountedTabs(prev => {
      if (prev.has(activeIndex)) return prev;
      const next = new Set(prev);
      next.add(activeIndex);
      return next;
    });
  }, [activeIndex]);

  useEffect(() => {
    if (isAnimating.current) return;
    translateX.stopAnimation();
    translateX.setValue(-activeIndex * SCREEN_WIDTH);
  }, [activeIndex, translateX]);

  const animateToIndex = index => {
    if (index < 0 || index >= TABS.length || index === activeIndexRef.current || isAnimating.current) {
      return;
    }

    isAnimating.current = true;
    Animated.timing(translateX, {
      toValue: -index * SCREEN_WIDTH,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      isAnimating.current = false;
      onChangeTab(index);
    });
  };

  useImperativeHandle(ref, () => ({
    goTo: animateToIndex,
  }), []);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => (
      !isAnimating.current &&
      Math.abs(gesture.dx) > 14 &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35
    ),
    onPanResponderMove: (_, gesture) => {
      if (isAnimating.current) return;

      const baseX = -activeIndexRef.current * SCREEN_WIDTH;
      const atFirstTab = activeIndexRef.current === 0 && gesture.dx > 0;
      const atLastTab = activeIndexRef.current === TABS.length - 1 && gesture.dx < 0;
      const resistance = atFirstTab || atLastTab ? 0.18 : 1;

      translateX.setValue(baseX + gesture.dx * resistance);
    },
    onPanResponderRelease: (_, gesture) => {
      if (isAnimating.current) return;

      const currentIndex = activeIndexRef.current;
      const movedEnough = Math.abs(gesture.dx) > SCREEN_WIDTH * 0.16 || Math.abs(gesture.vx) > 0.28;

      if (!movedEnough) {
        Animated.spring(translateX, {
          toValue: -currentIndex * SCREEN_WIDTH,
          damping: 24,
          stiffness: 220,
          mass: 0.9,
          useNativeDriver: true,
        }).start();
        return;
      }

      if (gesture.dx < 0 && currentIndex < TABS.length - 1) {
        animateToIndex(currentIndex + 1);
        return;
      }

      if (gesture.dx > 0 && currentIndex > 0) {
        animateToIndex(currentIndex - 1);
        return;
      }

      Animated.spring(translateX, {
        toValue: -currentIndex * SCREEN_WIDTH,
        damping: 24,
        stiffness: 220,
        mass: 0.9,
        useNativeDriver: true,
      }).start();
    },
    onPanResponderTerminate: () => {
      if (isAnimating.current) return;

      Animated.spring(translateX, {
        toValue: -activeIndexRef.current * SCREEN_WIDTH,
        damping: 24,
        stiffness: 220,
        mass: 0.9,
        useNativeDriver: true,
      }).start();
    },
  }), [onChangeTab, translateX]);

  return (
    <View style={styles.sceneViewport} {...panResponder.panHandlers}>
      <Animated.View
        style={[
          styles.sceneTrack,
          {
            width: SCREEN_WIDTH * TABS.length,
            transform: [{ translateX }],
          },
        ]}
      >
        {TABS.map((tab, index) => {
          const Screen = tab.component;
          const isFocused = index === activeIndex;
          const hasMounted = mountedTabs.has(index);
          const extraProps =
            tab.key === 'Finder'
              ? { overlayPrefill: finderPrefill, onOverlayPrefillConsumed: onConsumeFinderPrefill }
              : tab.key === 'Slice'
                ? { overlayPrefill: slicePrefill, onOverlayPrefillConsumed: onConsumeSlicePrefill }
                : {};
          return (
            <View key={tab.key} style={styles.scenePage}>
              {hasMounted ? <Screen isActive={isFocused} {...extraProps} /> : null}
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
});

function AppShell() {
  const theme = useAppTheme();
  const { isDark, toggleTheme } = useThemeControls();
  const styles = useMemo(() => createShellStyles(theme), [theme]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [allyCodeOpen, setAllyCodeOpen] = useState(false);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [finderPrefill, setFinderPrefill] = useState(null);
  const [slicePrefill, setSlicePrefill] = useState(null);
  const [isWarmingUp, setIsWarmingUp] = useState(true);
  const sceneHostRef = useRef(null);
  const scannerTabIndex = TABS.findIndex(tab => tab.key === 'Scanner');

  useEffect(() => {
    setMenuOpen(false);
    setGuideOpen(false);
  }, [activeTabIndex]);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    const MIN_DURATION_MS = 1200;

    const finish = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, MIN_DURATION_MS - elapsed);
      setTimeout(() => {
        if (!cancelled) setIsWarmingUp(false);
      }, remaining);
    };

    (async () => {
      try {
        const overlayCapture = require('./src/services/overlayCapture');
        if (overlayCapture?.warmScanner) {
          await Promise.race([
            overlayCapture.warmScanner(),
            new Promise(resolve => setTimeout(resolve, 15000)),
          ]);
        }
      } catch (error) {
        // ignore warm-up errors, still drop the loading screen
      }
      try {
        await rosterState.hydrate();
      } catch (error) {
        // roster hydration is best-effort — overlay still works without it
      }
      finish();
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unsubscribe = () => {};

    try {
      const overlayCapture = require('./src/services/overlayCapture');
      const modCaptureParser = require('./src/services/modCaptureParser');
      const overlayRecommendation = require('./src/services/overlayRecommendation');

      unsubscribe = overlayCapture.subscribeToOverlayCapture(async event => {
        console.log('[overlay] event received type=' + event?.type);
        if (event?.type !== 'captureSuccess') {
          return;
        }

        try {
        const analysis = await modCaptureParser.analyzeCapturedMod({
          ocrText: event.ocrText ?? '',
          ocrLines: Array.isArray(event.ocrLines) ? event.ocrLines : [],
          path: event.path ?? '',
          detectedShape: event.detectedShape ?? '',
          detectedSet: event.detectedSet ?? '',
          topShapeMatches: Array.isArray(event.topShapeMatches) ? event.topShapeMatches : [],
        });

        const rawPreview = String(analysis?.rawText ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180);
        const parsedSummary = [
          analysis?.parsed?.modSet && analysis.parsed.modSet !== 'Not found' ? `Set: ${analysis.parsed.modSet}` : null,
          analysis?.parsed?.modShape && analysis.parsed.modShape !== 'Not found' ? `Shape: ${analysis.parsed.modShape}` : null,
          analysis?.parsed?.primary && analysis.parsed.primary !== 'Not found' ? `Primary: ${analysis.parsed.primary}` : null,
        ].filter(Boolean).join(' • ');

        if (!analysis?.parsed) {
          await overlayCapture.showOverlayRecommendation(
            'Capture Needs Review',
            [analysis?.summary ?? 'I could not read enough of the mod cleanly.', rawPreview ? `Read: ${rawPreview}` : null]
              .filter(Boolean)
              .join('\n'),
          );
          return;
        }

        const dual = overlayRecommendation.buildOverlayRecommendations(analysis.parsed, {
          rawText: analysis?.rawText ?? '',
          ownedBaseIds: rosterState.getCurrentOwnedIds(),
        });

        const parsedShape = analysis.parsed.modShape;
        if (parsedShape && parsedShape !== 'Not found') {
          const prefillSecs = (analysis.parsed.secondaries || []).slice(0, 4).map(s => {
            if (s?.hidden) {
              return { stat: '', value: '', rolls: '', hidden: true };
            }
            const rawVal = String(s?.value ?? '').replace(/[+%]/g, '').trim();
            const stat = s?.stat && s.stat !== 'Not found' ? s.stat : '';
            let rolls = s?.rolls != null && s.rolls > 0 ? String(s.rolls) : '';
            // If OCR missed the "(N)" prefix, estimate rolls from the value
            // so the slice-tab roll pills populate instead of staying blank.
            if (!rolls && stat && rawVal) {
              const est = overlayRecommendation.estimateRolls(stat, rawVal);
              if (est) rolls = String(est);
            }
            return { stat, value: rawVal, rolls, hidden: false };
          });
          setSlicePrefill({
            token: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            shape: parsedShape,
            primary: analysis.parsed.primary && analysis.parsed.primary !== 'Not found' ? analysis.parsed.primary : '',
            modSet: analysis.parsed.modSet && analysis.parsed.modSet !== 'Not found' ? analysis.parsed.modSet : '',
            secondaries: prefillSecs,
          });
        }
        const needsReview = dual.slice.title === 'Capture Needs Review';
        const sliceBody = needsReview
          ? [
              dual.slice.body,
              parsedSummary || null,
              rawPreview ? `Read: ${rawPreview}` : null,
            ].filter(Boolean).join('\n')
          : dual.slice.body;
        console.log('[overlay] calling showDualOverlayRecommendation title=' + dual.slice.title);
        await overlayCapture.showDualOverlayRecommendation(
          dual.slice.title,
          sliceBody,
          dual.characters.title,
          dual.characters.body,
        );
        console.log('[overlay] showDualOverlayRecommendation done');
        } catch (err) {
          console.log('[overlay] handler error: ' + (err?.message || err));
        }
      });
    } catch (error) {
      unsubscribe = () => {};
    }

    return () => unsubscribe();
  }, []);

  const headerTitle = 'Mod Helper for SWGOH';

  if (isWarmingUp) {
    const LoadingScreen = require('./src/components/LoadingScreen').default;
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#070b14" />
        <LoadingScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.surfaceAlt} />

        <View style={styles.header}>
          <View style={styles.headerSide} />
          <Text style={styles.headerTitle}>{headerTitle}</Text>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setMenuOpen(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.headerButtonIcon}>≡</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <TabSceneHost
            ref={sceneHostRef}
            activeIndex={activeTabIndex}
            onChangeTab={setActiveTabIndex}
            finderPrefill={finderPrefill}
            slicePrefill={slicePrefill}
            onConsumeFinderPrefill={() => setFinderPrefill(null)}
            onConsumeSlicePrefill={() => setSlicePrefill(null)}
          />
        </View>

        <View style={styles.tabBar}>
          {TABS.map((tab, index) => {
            const focused = index === activeTabIndex;
            const color = focused ? theme.primary : theme.soft;

            return (
              <TouchableOpacity
                key={tab.key}
                style={styles.tabButton}
                onPress={() => {
                  if (index === activeTabIndex) return;
                  sceneHostRef.current?.goTo(index);
                }}
                activeOpacity={0.8}
              >
                <Text style={[styles.tabIcon, { color }]}>{tab.icon}</Text>
                <Text style={[styles.tabLabel, { color }]}>{tab.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <AppMenu
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          onOpenGuide={() => setGuideOpen(true)}
          onOpenScanner={() => setActiveTabIndex(scannerTabIndex)}
          onOpenAllyCode={() => setAllyCodeOpen(true)}
          onToggleTheme={toggleTheme}
          isDark={isDark}
        />
        <AllyCodeModal visible={allyCodeOpen} onClose={() => setAllyCodeOpen(false)} />
        {guideOpen ? <GuideModalHost visible={guideOpen} onClose={() => setGuideOpen(false)} /> : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <AppThemeProvider>
      <AppShell />
    </AppThemeProvider>
  );
}

const createShellStyles = colors => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerSide: {
    width: 38,
  },
  headerTitle: {
    color: colors.primary,
    fontSize: 17,
    fontWeight: 'bold',
  },
  headerButton: {
    width: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  headerButtonIcon: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    overflow: 'hidden',
  },
  sceneViewport: {
    flex: 1,
    overflow: 'hidden',
  },
  sceneTrack: {
    flex: 1,
    flexDirection: 'row',
  },
  scenePage: {
    width: SCREEN_WIDTH,
    flex: 1,
    backgroundColor: colors.background,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 4,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 6,
  },
  tabIcon: {
    fontSize: 18,
    marginBottom: 2,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
});

const createMenuStyles = colors => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  menuCard: {
    width: 180,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    gap: 8,
  },
  menuTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    textAlign: 'center',
    marginBottom: 2,
  },
  menuButton: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  menuButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
});

const createAllyCodeStyles = colors => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 10,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  statusBlock: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    padding: 10,
    gap: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  statusValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  statusSub: {
    color: colors.muted,
    fontSize: 11,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 16,
    letterSpacing: 1,
    textAlign: 'center',
  },
  msg: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  button: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
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
    fontSize: 13,
    fontWeight: '700',
  },
});
