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
  TouchableOpacity,
  View,
} from 'react-native';

LogBox.ignoreAllLogs();
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppThemeProvider, useAppTheme, useThemeControls, hydrateTheme } from './src/theme/appTheme';
import * as rosterState from './src/services/rosterState';
import * as premiumState from './src/services/premiumState';
import AdBanner from './src/components/AdBanner';
import { maybeShowColdStartInterstitial } from './src/services/interstitialAds';

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

function renderGacScreen(props) {
  let Screen = null;
  try {
    const mod = require('./src/screens/GacScreen');
    Screen = mod?.default ?? mod ?? null;
  } catch (error) {
    Screen = null;
  }
  return Screen ? <Screen {...props} /> : <MissingScreen label="GAC Meta" />;
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

function PremiumModalHost(props) {
  let Screen = null;
  try {
    const mod = require('./src/components/PremiumModal');
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
  { key: 'Gac', title: 'GAC Meta', label: 'GAC', icon: '⚔', component: renderGacScreen },
];

function AppMenu({ visible, onClose, onOpenGuide, onOpenPremium, onToggleTheme, isDark, isPremium }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createMenuStyles(theme), [theme]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.menuCard}>
          <Text style={styles.menuTitle}>Options</Text>
          <TouchableOpacity
            style={[styles.menuButton, styles.premiumButton]}
            onPress={() => {
              onClose();
              onOpenPremium();
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.premiumButtonIcon}>⭐</Text>
            <Text style={styles.premiumButtonText}>
              {isPremium ? 'Premium · Active' : 'Upgrade to Premium'}
            </Text>
          </TouchableOpacity>
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
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [premiumSnap, setPremiumSnap] = useState(() => premiumState.getSnapshot());

  useEffect(() => {
    setPremiumSnap(premiumState.getSnapshot());
    return premiumState.subscribe(setPremiumSnap);
  }, []);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [finderPrefill, setFinderPrefill] = useState(null);
  const [slicePrefill, setSlicePrefill] = useState(null);
  const [isWarmingUp, setIsWarmingUp] = useState(true);
  const sceneHostRef = useRef(null);

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
      // Read the persisted theme choice BEFORE we let the loading screen
      // dismiss — otherwise the home UI flashes in dark default for one frame
      // before flipping to the user's saved light mode.
      try {
        await hydrateTheme();
      } catch (error) {
        // best-effort — falls back to dark default
      }
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
      try {
        await premiumState.hydrate();
      } catch (error) {
        // premium hydration is best-effort — defaults to locked
      }
      // Anti-tamper: after loading the cached value, re-derive from
      // Google Play. Google is the source of truth — this overwrites
      // the cache if a user flipped the AsyncStorage flag, or if a
      // refund / chargeback revoked the purchase. If Play is offline
      // or the query times out, we leave the cache alone so a flaky
      // connection doesn't lock paying users out.
      try {
        const iap = require('./src/services/iap');
        if (iap.isAvailable && iap.isAvailable()) {
          await iap.reconcileWithPlay({ timeoutMs: 3000 });
        }
      } catch (error) {
        // never block startup on Play reconciliation
      }
      // Cold-start interstitial: capped to once per 6h. Awaited here so the
      // ad shows OVER the loading screen rather than jumping in after the
      // home UI has already rendered (which felt jarring). Hard-cap at 4s
      // so a slow ad load never traps the user on the splash.
      try {
        await Promise.race([
          maybeShowColdStartInterstitial(),
          new Promise(resolve => setTimeout(resolve, 4000)),
        ]);
      } catch (_e) {
        // ignore — never block startup on an ad failure
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
          variantShapeMatchesJson: typeof event.variantShapeMatchesJson === 'string' ? event.variantShapeMatchesJson : '',
          detectedTier: typeof event.detectedTier === 'string' ? event.detectedTier : '',
          detectedTierLetter: typeof event.detectedTierLetter === 'string' ? event.detectedTierLetter : '',
          detectedTierDots: Number.isFinite(event.detectedTierDots) ? event.detectedTierDots : 0,
          detectedTierScore: Number.isFinite(event.detectedTierScore) ? event.detectedTierScore : 0,
          detectedPipScore: Number.isFinite(event.detectedPipScore) ? event.detectedPipScore : 0,
          topTierMatches: Array.isArray(event.topTierMatches) ? event.topTierMatches : [],
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

        const ownedNow = rosterState.getCurrentOwnedIds();
        const charBaseIds = require('./src/data/charBaseIds').CHAR_BASE_IDS;
        // Ownership + mod badges only fire when a roster is actually loaded.
        // The roster only loads when the user has unlocked ROSTER access
        // (via ad-reward or premium), so a truly free / un-unlocked user
        // has `ownedNow.size === 0` and sees no badges — they get the
        // general all-character recommendation list as before.
        const scannedShape = analysis.parsed.modShape && analysis.parsed.modShape !== 'Not found'
          ? analysis.parsed.modShape
          : null;
        const modStatusFor = (ownedNow && ownedNow.size > 0)
          ? (name) => {
              const baseId = charBaseIds[name];
              if (!baseId) return null;
              const owned = ownedNow.has(baseId);
              const summary = rosterState.getModSummary(baseId, scannedShape);
              return summary ? { ...summary, owned } : { owned, hasModData: false };
            }
          : null;
        // Roster-aware EV resolver for the slice engine. Same contract as
        // SliceScreen's getEquippedMod: undefined when not owned, null when
        // owned without a mod in this slot, or the equipped mod object.
        const getEquippedMod = (ownedNow && ownedNow.size > 0)
          ? (charName, slotShape) => {
              const baseId = charBaseIds[charName];
              if (!baseId) return undefined;
              if (!ownedNow.has(baseId)) return undefined;
              const summary = rosterState.getModSummary(baseId, slotShape);
              if (!summary || !summary.hasModData) return undefined;
              if (summary.slotEmpty) return null;
              return summary.slotMod || null;
            }
          : null;
        const dual = overlayRecommendation.buildOverlayRecommendations(analysis.parsed, {
          rawText: analysis?.rawText ?? '',
          ownedBaseIds: ownedNow,
          modStatusFor,
          getEquippedMod,
        });

        const parsedShape = analysis.parsed.modShape;
        if (parsedShape && parsedShape !== 'Not found') {
          const scannedTier = analysis.parsed.modTier || '';
          const rollCap = overlayRecommendation.maxRollsForTier(scannedTier);
          const prefillSecs = (analysis.parsed.secondaries || []).slice(0, 4).map(s => {
            if (s?.hidden) {
              return { stat: '', value: '', rolls: '', hidden: true };
            }
            const rawVal = String(s?.value ?? '').replace(/[+%]/g, '').trim();
            const stat = s?.stat && s.stat !== 'Not found' ? s.stat : '';
            let rolls = s?.rolls != null && s.rolls > 0 ? String(s.rolls) : '';
            // Clamp any explicit roll count to the tier's physical ceiling
            // (5E=1, 5D=2, ..., 5A=5). Prevents impossible OCR reads like
            // "Health% at 5 rolls" on a 5C mod.
            if (rolls && scannedTier) {
              const n = parseInt(rolls, 10);
              if (Number.isFinite(n) && n > rollCap) rolls = String(rollCap);
            }
            // If OCR missed the "(N)" prefix, estimate rolls from the value
            // so the slice-tab roll pills populate instead of staying blank.
            // Pass the scanned tier so the estimate respects the ceiling
            // and rejects stat/value pairs that can't possibly fit.
            if (!rolls && stat && rawVal) {
              const est = overlayRecommendation.estimateRolls(stat, rawVal, 5, scannedTier);
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
            tier: scannedTier,
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
        // Character recommendations are a premium feature — gated behind the
        // same ROSTER unlock (ad-reward or premium). Free users haven't linked
        // a roster, so we can't meaningfully score mods against their owned
        // characters and the top-6 list would be misleading — show a pitch
        // on the characters panel instead.
        const premiumNow = premiumState.getSnapshot();
        const rosterUnlocked = premiumNow.isPremium
          || premiumState.hasFeature(premiumState.FEATURES.ROSTER);
        const charactersPanel = rosterUnlocked
          ? dual.characters
          : {
              title: 'Top Characters — Premium',
              body: 'Unlock Premium or watch an ad in the app to see the best characters for this mod, filtered to your roster.',
            };
        console.log('[overlay] calling showDualOverlayRecommendation title=' + dual.slice.title);
        await overlayCapture.showDualOverlayRecommendation(
          dual.slice.title,
          sliceBody,
          charactersPanel.title,
          charactersPanel.body,
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

        {TABS[activeTabIndex]?.key !== 'Scanner' ? <AdBanner /> : null}

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
          onOpenPremium={() => setPremiumOpen(true)}
          onToggleTheme={toggleTheme}
          isDark={isDark}
          isPremium={premiumSnap.isPremium}
        />
        {guideOpen ? <GuideModalHost visible={guideOpen} onClose={() => setGuideOpen(false)} /> : null}
        <PremiumModalHost visible={premiumOpen} onClose={() => setPremiumOpen(false)} />
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
  premiumButton: {
    backgroundColor: 'rgba(245,185,66,0.10)',
    borderColor: '#f5b942',
    flexDirection: 'row',
    gap: 8,
  },
  premiumButtonIcon: {
    fontSize: 16,
  },
  premiumButtonText: {
    color: '#f5b942',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
});

