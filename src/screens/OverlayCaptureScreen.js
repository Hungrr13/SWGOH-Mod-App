import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAppTheme } from '../theme/appTheme';
import { analyzeCapturedMod } from '../services/modCaptureParser';
import { getModTemplateLibraryStatus } from '../services/modTemplateLibrary';
import {
  getOverlayCaptureStatus,
  launchSwgoh,
  openAppSettings,
  confirmArrowBurstSet,
  confirmOuterShape,
  saveArrowTrainingSample,
  requestNotificationPermission,
  requestOverlayPermission,
  requestScreenCapture,
  startFloatingButton,
  stopFloatingButton,
  subscribeToOverlayCapture,
  warmScanner,
} from '../services/overlayCapture';

const STEPS = [
  {
    title: '1. Allow Overlay',
    body: 'Give Android permission to draw over other apps so a floating capture button can appear on top of SWGOH.',
  },
  {
    title: '2. Allow Screen Capture',
    body: 'Approve Android screen capture so the app can grab the mod card you are looking at and send it back for analysis.',
  },
  {
    title: '3. Analyze The Mod',
    body: 'Tap the floating button while viewing a mod. We will read the screenshot, identify the set, shape, primary, and secondaries, then open Finder or Slicer with that mod filled in.',
  },
];

const BURST_SET_OPTIONS = ['Crit Chance', 'Crit Dmg', 'Offense'];
const ARROW_TRAINING_SETS = [
  'Speed', 'Health', 'Defense', 'Offense',
  'Crit Chance', 'Crit Dmg', 'Tenacity', 'Potency',
];
const SHAPE_OPTIONS = ['Arrow', 'Triangle', 'Circle', 'Cross', 'Diamond', 'Square'];

export default function OverlayCaptureScreen({ onBack, onUseInFinder, onUseInSlicer }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isAndroid = Platform.OS === 'android';
  const [status, setStatus] = useState({
    platformSupported: isAndroid,
    nativeModuleReady: false,
    overlayPermissionGranted: false,
    screenCaptureReady: false,
    floatingButtonRunning: false,
  });
  const [busyAction, setBusyAction] = useState('');
  const [lastCaptureMessage, setLastCaptureMessage] = useState('');
  const [lastCapturePath, setLastCapturePath] = useState('');
  const [lastCaptureInput, setLastCaptureInput] = useState(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [learningBusySet, setLearningBusySet] = useState('');
  const [learningMessage, setLearningMessage] = useState('');
  const [shapeLearningBusy, setShapeLearningBusy] = useState('');
  const [shapeLearningMessage, setShapeLearningMessage] = useState('');
  const [arrowTrainBusy, setArrowTrainBusy] = useState('');
  const [arrowTrainMessage, setArrowTrainMessage] = useState('');
  const [templateStatus, setTemplateStatus] = useState(null);
  const autoSetupStarted = useRef(false);
  const swgohLaunchRetryRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    let mounted = true;

    const loadStatus = async () => {
      const nextStatus = await getOverlayCaptureStatus();
      const nextTemplateStatus = await getModTemplateLibraryStatus();
      if (mounted) {
        setStatus(nextStatus);
        setTemplateStatus(nextTemplateStatus);
      }

      if (isAndroid) {
        const warmedStatus = await warmScanner();
        if (mounted) {
          setStatus(currentStatus => ({
            ...currentStatus,
            ...warmedStatus,
          }));
        }
      }
    };

    loadStatus();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const refreshStatus = async () => {
      const nextStatus = await getOverlayCaptureStatus();
      setStatus(nextStatus);
      if (isAndroid) {
        const warmedStatus = await warmScanner();
        setStatus(currentStatus => ({
          ...currentStatus,
          ...warmedStatus,
        }));
      }
    };

    const subscription = AppState.addEventListener('change', nextAppState => {
      const wasBackgrounded = appStateRef.current === 'background' || appStateRef.current === 'inactive';
      appStateRef.current = nextAppState;
      if (nextAppState === 'active' && wasBackgrounded) {
        refreshStatus();
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isAndroid || autoSetupStarted.current) return;
    autoSetupStarted.current = true;

    const runAutoSetup = async () => {
      let nextStatus = await getOverlayCaptureStatus();
      setStatus(nextStatus);

      if (!nextStatus.overlayPermissionGranted) {
        nextStatus = await requestOverlayPermission();
        setStatus(nextStatus);
        return;
      }

      if (!nextStatus.notificationPermissionGranted) {
        nextStatus = await requestNotificationPermission();
        setStatus(nextStatus);
      }
    };

    runAutoSetup();
  }, [isAndroid]);

  useEffect(() => {
    if (!lastCaptureInput) return;

    analyzeLatestCapture();
  }, [lastCaptureInput]);

  useEffect(() => {
    return () => {
      if (swgohLaunchRetryRef.current) {
        clearTimeout(swgohLaunchRetryRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToOverlayCapture(async event => {
      const timeLabel = event?.timestamp
        ? new Date(event.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : 'just now';

      if (event?.type === 'captureSuccess') {
        setLastCaptureMessage(`Mod captured at ${timeLabel}.`);
        setLastCapturePath(event.path ?? '');
        setLearningMessage('');
        setLearningBusySet('');
        setShapeLearningMessage('');
        setShapeLearningBusy('');
        setLastCaptureInput({
          path: event.path ?? '',
          ocrText: event.ocrText ?? '',
          ocrLines: Array.isArray(event.ocrLines) ? event.ocrLines : [],
          detectedShape: event.detectedShape ?? '',
          detectedSet: event.detectedSet ?? '',
          debugCrops: {
            focused: event.focusedCropPath ?? '',
            stats: event.statsCropPath ?? '',
            shape: event.shapeCropPath ?? '',
            icon: event.iconCropPath ?? '',
            set: event.setCropPath ?? '',
          },
          topShapeMatches: Array.isArray(event.topShapeMatches) ? event.topShapeMatches : [],
          topSetMatches: Array.isArray(event.topSetMatches) ? event.topSetMatches : [],
        });
        setAnalysisResult(null);
      } else if (event?.type === 'captureError') {
        setLastCaptureMessage(event.message ? `Capture failed at ${timeLabel}: ${event.message}` : `Capture failed at ${timeLabel}.`);
        setLastCapturePath('');
        setLearningMessage('');
        setLearningBusySet('');
        setShapeLearningMessage('');
        setShapeLearningBusy('');
        setLastCaptureInput(null);
        setAnalysisResult(null);
      } else {
        setLastCaptureMessage(`Floating button tapped at ${timeLabel}. Capturing screenshot...`);
      }

      const nextStatus = await getOverlayCaptureStatus();
      setStatus(nextStatus);
    });

    return unsubscribe;
  }, []);

  const runAction = async (actionKey, actionFn) => {
    setBusyAction(actionKey);
    const nextStatus = await actionFn();
    setStatus(nextStatus);
    setBusyAction('');
  };

  const toggleFloatingButton = async () => {
    if (status.floatingButtonRunning) {
      return runAction('floating', stopFloatingButton);
    }

    setBusyAction('floating');
    let nextStatus = await getOverlayCaptureStatus();

    if (!nextStatus.overlayPermissionGranted) {
      nextStatus = await requestOverlayPermission();
      setStatus(nextStatus);
      setBusyAction('');
      return;
    }

    if (!nextStatus.screenCaptureReady) {
      nextStatus = await requestScreenCapture();
      setStatus(nextStatus);
      if (!nextStatus.screenCaptureReady) {
        setBusyAction('');
        return;
      }
    }

    nextStatus = await startFloatingButton();
    if (
      nextStatus.screenCaptureReady &&
      !nextStatus.floatingButtonRunning
    ) {
      await new Promise(resolve => setTimeout(resolve, 450));
      nextStatus = await startFloatingButton();
    }
    setStatus(nextStatus);
    setBusyAction('');

    await launchSwgoh();
    swgohLaunchRetryRef.current = setTimeout(() => {
      launchSwgoh();
    }, 900);
  };

  const analyzeLatestCapture = async () => {
    if (!lastCaptureInput || analysisBusy) return;
    setAnalysisBusy(true);
    const result = await analyzeCapturedMod(lastCaptureInput);
    setAnalysisResult(result);
    setAnalysisBusy(false);
  };

  const burstLearningVisible = useMemo(() => {
    if (!lastCaptureInput) return false;
    if (BURST_SET_OPTIONS.includes(lastCaptureInput.detectedSet)) return true;
    return (lastCaptureInput.topSetMatches ?? []).some(match =>
      BURST_SET_OPTIONS.some(setName => String(match).includes(setName))
    );
  }, [lastCaptureInput]);

  const confirmBurstLearning = async setName => {
    if (!lastCaptureInput || learningBusySet) return;
    setLearningBusySet(setName);
    const saved = await confirmArrowBurstSet(setName);
    if (saved) {
      setLearningMessage(`Saved this scan as ${setName}. Future burst matches can learn from it once enough confirmed samples accumulate.`);
    }
    setLearningBusySet('');
  };

  const saveArrowTraining = async setName => {
    if (!lastCaptureInput || arrowTrainBusy) return;
    setArrowTrainBusy(setName);
    const saved = await saveArrowTrainingSample(setName);
    if (saved) {
      setArrowTrainMessage(`Saved last scan as arrow ${setName}.`);
    }
    setArrowTrainBusy('');
  };

  const confirmShapeLearning = async shapeName => {
    if (!lastCaptureInput || shapeLearningBusy) return;
    setShapeLearningBusy(shapeName);
    const saved = await confirmOuterShape(shapeName);
    if (saved) {
      setShapeLearningMessage(`Saved this scan as ${shapeName}. Future outer-shape matches can learn from confirmed examples.`);
    }
    setShapeLearningBusy('');
  };

  const statusRows = [
    {
      label: 'Android support',
      value: status.platformSupported ? 'Ready' : 'Unsupported',
    },
    {
      label: 'Native overlay module',
      value: status.nativeModuleReady ? 'Connected' : 'Not wired yet',
    },
    {
      label: 'Notification access',
      value: status.notificationPermissionGranted ? 'Granted' : 'Not granted',
    },
    {
      label: 'Overlay permission',
      value: status.overlayPermissionGranted ? 'Granted' : 'Not granted',
    },
    {
      label: 'Screen capture',
      value: status.screenCaptureReady ? 'Ready' : 'Not approved',
    },
  ];

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>‹ Back</Text>
          </Pressable>
        ) : (
          <View style={styles.backButtonPlaceholder} />
        )}
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>Mod Scanner</Text>
          <Text style={styles.title}>Scan a mod while viewing it in-game</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>Fast Android scan flow</Text>
          <Text style={styles.heroBody}>
            Turn on the floating scanner, view a mod in SWGOH, tap the bubble, and get a quick recommendation
            without leaving the game. You can still send the same capture into Finder or Slicer here when needed.
          </Text>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, isAndroid ? styles.readyBadge : styles.pendingBadge]}>
              <Text style={styles.badgeText}>{isAndroid ? 'Android target' : 'Android only'}</Text>
            </View>
            <View style={[styles.badge, styles.pendingBadge]}>
              <Text style={styles.badgeText}>Native feature in progress</Text>
            </View>
          </View>
          {lastCaptureMessage ? (
            <View style={styles.captureNotice}>
              <Text style={styles.captureNoticeText}>{lastCaptureMessage}</Text>
              {lastCapturePath ? (
                <Text style={styles.capturePathText}>{lastCapturePath}</Text>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What to expect</Text>
          <View style={styles.analysisCard}>
            <Text style={styles.noteBody}>
              The scanner is designed for a quick loop: capture, read the overlay recommendation, tap it away,
              and move straight to the next mod.
            </Text>
            <Text style={styles.noteBody}>
              If the capture needs a closer look, use the same result in Finder or Slicer from this tab.
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Setup Flow</Text>
          {STEPS.map(step => (
            <View key={step.title} style={styles.stepCard}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepBody}>{step.body}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Permissions</Text>
          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>What we need</Text>
            <Text style={styles.noteBody}>
              Android overlay and MediaProjection permissions are both required for the floating
              capture button workflow. iPhone does not support the same persistent overlay behavior.
            </Text>
          </View>
          <View style={styles.statusCard}>
            {statusRows.map(row => (
              <View key={row.label} style={styles.statusRow}>
                <Text style={styles.statusLabel}>{row.label}</Text>
                <Text style={styles.statusValue}>{row.value}</Text>
              </View>
            ))}
          </View>
          <Pressable style={styles.actionButton} onPress={toggleFloatingButton}>
            <View style={styles.actionText}>
              <Text style={styles.actionTitle}>
                {status.floatingButtonRunning ? 'Stop Scanner Bubble' : 'Start Scanner Bubble'}
              </Text>
              <Text style={styles.actionDetail}>
                {status.floatingButtonRunning
                  ? 'Turn off the Android overlay bubble.'
                  : 'Starts the floating button and jumps back into SWGOH.'}
              </Text>
            </View>
            {busyAction === 'floating' ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <Text style={styles.actionState}>{status.floatingButtonRunning ? 'Running' : 'Ready'}</Text>
            )}
          </Pressable>
          <Pressable style={styles.settingsButton} onPress={openAppSettings}>
            <Text style={styles.settingsButtonText}>Open App Settings</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What gets analyzed</Text>
          <View style={styles.analysisCard}>
            <Text style={styles.analysisLine}>Mod set and shape</Text>
            <Text style={styles.analysisLine}>Primary stat</Text>
            <Text style={styles.analysisLine}>All visible secondary stats and values</Text>
            <Text style={styles.analysisLine}>Recommended use in Finder or slice value in Slicer</Text>
          </View>
        </View>

        {templateStatus ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Template Library</Text>
            <View style={styles.analysisCard}>
              <Text style={styles.analysisLine}>
                Source: {templateStatus.source === 'bundled' ? 'Bundled PNG library' : templateStatus.source}
              </Text>
              <Text style={styles.analysisLine}>
                Assets ready: {templateStatus.counts.total} templates
              </Text>
              <Text style={styles.noteBody}>
                This library is now structured so we can swap these bundled PNGs for database-hosted template URLs later without rewriting the scanner pipeline.
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Example Captures</Text>
          <Text style={styles.noteBody}>
            We can drop a few real scanner examples here later so this tab shows what a good capture looks like.
          </Text>
          <View style={styles.exampleRow}>
            <View style={styles.exampleCard}>
              <Text style={styles.exampleTitle}>Coming Soon</Text>
              <Text style={styles.exampleBody}>Clean full mod card screenshot</Text>
            </View>
            <View style={styles.exampleCard}>
              <Text style={styles.exampleTitle}>Coming Soon</Text>
              <Text style={styles.exampleBody}>Overlay recommendation result</Text>
            </View>
          </View>
        </View>

        {lastCaptureInput ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Latest Capture</Text>
            <View style={styles.previewCard}>
              {lastCapturePath ? (
                <>
                  <Image
                    source={{ uri: `file://${lastCapturePath}` }}
                    style={styles.previewImage}
                    resizeMode="cover"
                  />
                  <Text style={styles.previewPath}>{lastCapturePath}</Text>
                </>
              ) : null}
              <Pressable style={styles.analyzeButton} onPress={analyzeLatestCapture}>
                {analysisBusy ? (
                  <ActivityIndicator size="small" color={theme.background} />
                ) : (
                  <Text style={styles.analyzeButtonText}>{analysisResult ? 'Re-Analyze Capture' : 'Analyze Latest Capture'}</Text>
                )}
              </Pressable>
              <View style={styles.analysisResultCard}>
                <Text style={styles.analysisResultTitle}>Scanner Result</Text>
                <Text style={styles.analysisResultSummary}>
                  Native overlay classifier output from the capture event.
                </Text>
                <Text style={styles.analysisField}>Set: {lastCaptureInput.detectedSet || 'Unknown'}</Text>
                <Text style={styles.analysisField}>Shape: {lastCaptureInput.detectedShape || 'Unknown'}</Text>
                <Text style={styles.analysisField}>Top Set Matches:</Text>
                {(lastCaptureInput.topSetMatches?.length ? lastCaptureInput.topSetMatches : ['No set scores yet.']).map((line, index) => (
                  <Text key={`scanner-set-${index}-${line}`} style={styles.analysisSecondaryLine}>{line}</Text>
                ))}
              </View>
              <View style={styles.learningCard}>
                <Text style={styles.learningTitle}>Teach Outer Shape</Text>
                <Text style={styles.learningBody}>
                  Confirm the true outer mod shape for this scan. The app will use these explicit labels to train shape prototypes.
                </Text>
                <View style={styles.learningButtonRow}>
                  {SHAPE_OPTIONS.map(shapeName => (
                    <Pressable
                      key={shapeName}
                      style={[
                        styles.learningButton,
                        lastCaptureInput?.detectedShape === shapeName ? styles.learningButtonSuggested : null,
                      ]}
                      onPress={() => confirmShapeLearning(shapeName)}
                      disabled={Boolean(shapeLearningBusy)}
                    >
                      {shapeLearningBusy === shapeName ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : (
                        <Text style={styles.learningButtonText}>{shapeName}</Text>
                      )}
                    </Pressable>
                  ))}
                </View>
                {shapeLearningMessage ? (
                  <Text style={styles.learningMessage}>{shapeLearningMessage}</Text>
                ) : null}
              </View>
              {analysisResult?.parsed ? (
                <View style={styles.handoffRow}>
                  <Pressable style={styles.handoffButton} onPress={() => onUseInFinder?.(analysisResult.parsed)}>
                    <Text style={styles.handoffButtonText}>Use In Finder</Text>
                  </Pressable>
                  <Pressable style={styles.handoffButton} onPress={() => onUseInSlicer?.(analysisResult.parsed)}>
                    <Text style={styles.handoffButtonText}>Use In Slicer</Text>
                  </Pressable>
                </View>
              ) : null}
              {analysisResult ? (
                <View style={styles.analysisResultCard}>
                  <Text style={styles.analysisResultTitle}>Parser Status</Text>
                  <Text style={styles.analysisResultSummary}>{analysisResult.summary}</Text>
                  <Text style={styles.noteBody}>
                    This parser is OCR-based and can disagree with the native scanner result above.
                  </Text>
                  {analysisResult.fields ? (
                    <>
                      <Text style={styles.analysisField}>Set: {analysisResult.fields.modSet}</Text>
                      <Text style={styles.analysisField}>Shape: {analysisResult.fields.modShape}</Text>
                      <Text style={styles.analysisField}>Primary: {analysisResult.fields.primary}</Text>
                      <Text style={styles.analysisField}>Secondaries:</Text>
                      {analysisResult.fields.secondaries.map(line => (
                        <Text key={line} style={styles.analysisSecondaryLine}>{line}</Text>
                      ))}
                    </>
                  ) : null}
                  {analysisResult.rawText ? (
                    <View style={styles.rawTextCard}>
                      <Text style={styles.rawTextTitle}>Recognized Text</Text>
                      <Text style={styles.rawTextValue}>{analysisResult.rawText}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
              {burstLearningVisible ? (
                <View style={styles.learningCard}>
                  <Text style={styles.learningTitle}>Teach Burst Scanner</Text>
                  <Text style={styles.learningBody}>
                    Confirm the true burst set for this scan. The app will only learn from these explicit labels.
                  </Text>
                  <View style={styles.learningButtonRow}>
                    {BURST_SET_OPTIONS.map(setName => (
                      <Pressable
                        key={setName}
                        style={[
                          styles.learningButton,
                          lastCaptureInput?.detectedSet === setName ? styles.learningButtonSuggested : null,
                        ]}
                        onPress={() => confirmBurstLearning(setName)}
                        disabled={Boolean(learningBusySet)}
                      >
                        {learningBusySet === setName ? (
                          <ActivityIndicator size="small" color={theme.primary} />
                        ) : (
                          <Text style={styles.learningButtonText}>{setName}</Text>
                        )}
                      </Pressable>
                    ))}
                  </View>
                  {learningMessage ? (
                    <Text style={styles.learningMessage}>{learningMessage}</Text>
                  ) : null}
                </View>
              ) : null}
              {lastCaptureInput?.debugCrops ? (
                <View style={styles.learningCard}>
                  <Text style={styles.learningTitle}>Arrow Training (Debug)</Text>
                  <Text style={styles.learningBody}>
                    Label the last scan's arrow set. Saves the cropped icon to device-side training folder.
                  </Text>
                  <View style={styles.learningButtonRow}>
                    {ARROW_TRAINING_SETS.map(setName => (
                      <Pressable
                        key={setName}
                        style={styles.learningButton}
                        onPress={() => saveArrowTraining(setName)}
                        disabled={Boolean(arrowTrainBusy)}
                      >
                        {arrowTrainBusy === setName ? (
                          <ActivityIndicator size="small" color={theme.primary} />
                        ) : (
                          <Text style={styles.learningButtonText}>{setName}</Text>
                        )}
                      </Pressable>
                    ))}
                  </View>
                  {arrowTrainMessage ? (
                    <Text style={styles.learningMessage}>{arrowTrainMessage}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {lastCaptureInput?.debugCrops ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Scanner Debug</Text>
            <View style={styles.previewCard}>
              <Text style={styles.debugCaption}>
                These are the exact native crops used for calibration, so we can see whether the set/shape/stat areas are being cropped correctly.
              </Text>
              <View style={styles.debugGrid}>
                {[
                  { label: 'Focused Crop', path: lastCaptureInput.debugCrops.focused },
                  { label: 'Stats Crop', path: lastCaptureInput.debugCrops.stats },
                  { label: 'Shape Crop', path: lastCaptureInput.debugCrops.shape },
                  { label: 'Icon Crop', path: lastCaptureInput.debugCrops.icon },
                  { label: 'Set Crop', path: lastCaptureInput.debugCrops.set },
                ].map(item => (
                  <View key={item.label} style={styles.debugCard}>
                    <Text style={styles.debugTitle}>{item.label}</Text>
                    {item.path ? (
                      <>
                        <Image
                          source={{ uri: `file://${item.path}` }}
                          style={styles.debugImage}
                          resizeMode="contain"
                        />
                        <Text style={styles.debugPath}>{item.path}</Text>
                      </>
                    ) : (
                      <Text style={styles.debugMissing}>No crop saved yet.</Text>
                    )}
                  </View>
                ))}
              </View>
              <View style={styles.rawTextCard}>
                <Text style={styles.rawTextTitle}>OCR Lines</Text>
                {(lastCaptureInput.ocrLines?.length ? lastCaptureInput.ocrLines : [lastCaptureInput.ocrText || 'No OCR text yet.']).map((line, index) => (
                  <Text key={`${index}-${line}`} style={styles.rawTextValue}>{line}</Text>
                ))}
              </View>
              <View style={styles.rawTextCard}>
                <Text style={styles.rawTextTitle}>Top Shape Matches</Text>
                {(lastCaptureInput.topShapeMatches?.length ? lastCaptureInput.topShapeMatches : ['No shape scores yet.']).map((line, index) => (
                  <Text key={`shape-${index}-${line}`} style={styles.rawTextValue}>{line}</Text>
                ))}
              </View>
              <View style={styles.rawTextCard}>
                <Text style={styles.rawTextTitle}>Top Set Matches</Text>
                {(lastCaptureInput.topSetMatches?.length ? lastCaptureInput.topSetMatches : ['No set scores yet.']).map((line, index) => (
                  <Text key={`set-${index}-${line}`} style={styles.rawTextValue}>{line}</Text>
                ))}
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const createStyles = colors => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  backButton: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backButtonPlaceholder: {
    width: 60,
  },
  backButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  headerCopy: {
    flex: 1,
    paddingTop: 2,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    gap: 16,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  heroBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  readyBadge: {
    backgroundColor: colors.infoSurface,
  },
  pendingBadge: {
    backgroundColor: colors.warmSurface,
  },
  badgeText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  captureNotice: {
    backgroundColor: colors.infoSurface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  captureNoticeText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  capturePathText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    marginTop: 6,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  stepCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  stepTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  stepBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  noteCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  noteTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  noteBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    gap: 12,
  },
  statusLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  statusValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  actionText: {
    flex: 1,
    gap: 3,
  },
  actionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  actionDetail: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  actionState: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  settingsButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
  },
  settingsButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  analysisCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  exampleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  exampleCard: {
    flex: 1,
    minHeight: 120,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    justifyContent: 'space-between',
  },
  exampleTitle: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  exampleBody: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  analysisLine: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  previewCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  previewImage: {
    width: '100%',
    height: 240,
    borderRadius: 12,
    backgroundColor: colors.surfaceAlt,
  },
  previewPath: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  analyzeButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  analyzeButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '800',
  },
  handoffRow: {
    flexDirection: 'row',
    gap: 10,
  },
  handoffButton: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  handoffButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  analysisResultCard: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  analysisResultTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  analysisResultSummary: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  analysisField: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  analysisSecondaryLine: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: -2,
  },
  learningCard: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  learningTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  learningBody: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  learningButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  learningButton: {
    minWidth: 96,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  learningButtonSuggested: {
    borderColor: colors.primary,
  },
  learningButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  learningMessage: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  rawTextCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
    gap: 4,
  },
  rawTextTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  rawTextValue: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  debugCaption: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  debugGrid: {
    gap: 10,
  },
  debugCard: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  debugTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  debugImage: {
    width: '100%',
    height: 140,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  debugPath: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  debugMissing: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
});
