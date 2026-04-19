import { Alert, Linking, NativeEventEmitter, NativeModules, Platform } from 'react-native';

const nativeOverlayModule = NativeModules.ModOverlayCapture ?? null;
const CAPTURE_TAPPED_EVENT = 'overlayCaptureTapped';

function getOverlayEventEmitter() {
  if (!nativeOverlayModule) {
    return null;
  }

  if (typeof NativeEventEmitter !== 'function') {
    return null;
  }

  try {
    return new NativeEventEmitter(nativeOverlayModule);
  } catch (error) {
    return null;
  }
}

function defaultStatus() {
  return {
    platformSupported: Platform.OS === 'android',
    nativeModuleReady: Boolean(nativeOverlayModule),
    notificationPermissionGranted: false,
    overlayPermissionGranted: false,
    screenCaptureReady: false,
    floatingButtonRunning: false,
  };
}

export async function getOverlayCaptureStatus() {
  if (!nativeOverlayModule?.getStatus) {
    return defaultStatus();
  }

  try {
    const status = await nativeOverlayModule.getStatus();
    return {
      ...defaultStatus(),
      ...status,
      nativeModuleReady: true,
    };
  } catch (error) {
    return defaultStatus();
  }
}

function showUnavailableAlert(actionLabel) {
  Alert.alert(
    actionLabel,
    Platform.OS === 'android'
      ? 'The Android native overlay service is not wired in yet. This screen is ready for the next native step.'
      : 'Overlay capture is planned for Android only.',
  );
}

export async function requestOverlayPermission() {
  if (Platform.OS !== 'android') {
    showUnavailableAlert('Overlay Permission');
    return defaultStatus();
  }

  if (!nativeOverlayModule?.requestOverlayPermission) {
    showUnavailableAlert('Overlay Permission');
    return defaultStatus();
  }

  try {
    await nativeOverlayModule.requestOverlayPermission();
  } catch (error) {
    Alert.alert('Overlay Permission', 'Unable to open the Android overlay permission screen right now.');
  }

  return getOverlayCaptureStatus();
}

export async function requestNotificationPermission() {
  if (Platform.OS !== 'android') {
    showUnavailableAlert('Notifications');
    return defaultStatus();
  }

  if (!nativeOverlayModule?.requestNotificationPermission) {
    showUnavailableAlert('Notifications');
    return defaultStatus();
  }

  try {
    await nativeOverlayModule.requestNotificationPermission();
  } catch (error) {
    Alert.alert('Notifications', 'Unable to request Android notification permission right now.');
  }

  return getOverlayCaptureStatus();
}

export async function requestScreenCapture() {
  if (Platform.OS !== 'android') {
    showUnavailableAlert('Screen Capture');
    return defaultStatus();
  }

  if (!nativeOverlayModule?.requestScreenCapture) {
    showUnavailableAlert('Screen Capture');
    return defaultStatus();
  }

  try {
    await nativeOverlayModule.requestScreenCapture();
  } catch (error) {
    Alert.alert('Screen Capture', 'Unable to start the Android screen capture request right now.');
  }

  return getOverlayCaptureStatus();
}

export async function startFloatingButton() {
  if (Platform.OS !== 'android') {
    showUnavailableAlert('Floating Button');
    return defaultStatus();
  }

  if (!nativeOverlayModule?.startFloatingButton) {
    showUnavailableAlert('Floating Button');
    return defaultStatus();
  }

  try {
    await nativeOverlayModule.startFloatingButton();
  } catch (error) {
    Alert.alert('Floating Button', 'Unable to start the floating capture button right now.');
  }

  return getOverlayCaptureStatus();
}

export async function warmScanner() {
  if (Platform.OS !== 'android') {
    return defaultStatus();
  }

  if (!nativeOverlayModule?.warmScanner) {
    return defaultStatus();
  }

  try {
    await nativeOverlayModule.warmScanner();
  } catch (error) {
    return defaultStatus();
  }

  return getOverlayCaptureStatus();
}

export async function stopFloatingButton() {
  if (Platform.OS !== 'android') {
    showUnavailableAlert('Floating Button');
    return defaultStatus();
  }

  if (!nativeOverlayModule?.stopFloatingButton) {
    showUnavailableAlert('Floating Button');
    return defaultStatus();
  }

  try {
    await nativeOverlayModule.stopFloatingButton();
  } catch (error) {
    Alert.alert('Floating Button', 'Unable to stop the floating capture button right now.');
  }

  return getOverlayCaptureStatus();
}

export async function launchSwgoh() {
  if (Platform.OS !== 'android') {
    return false;
  }

  if (!nativeOverlayModule?.launchSwgoh) {
    return false;
  }

  try {
    await nativeOverlayModule.launchSwgoh();
    return true;
  } catch (error) {
    Alert.alert('Open SWGOH', 'Unable to open Star Wars: Galaxy of Heroes right now.');
    return false;
  }
}

export async function openAppSettings() {
  try {
    await Linking.openSettings();
  } catch (error) {
    Alert.alert('Settings', 'Could not open app settings on this device.');
  }
}

export function subscribeToOverlayCapture(handler) {
  const overlayEventEmitter = getOverlayEventEmitter();
  if (!overlayEventEmitter) {
    return () => {};
  }

  const subscription = overlayEventEmitter.addListener(CAPTURE_TAPPED_EVENT, handler);
  return () => subscription.remove();
}

export async function analyzeCapturedImage(imagePath) {
  if (!nativeOverlayModule?.analyzeCapturedImage) {
    return null;
  }

  try {
    return await nativeOverlayModule.analyzeCapturedImage(imagePath);
  } catch (error) {
    return null;
  }
}

export async function showOverlayRecommendation(title, body) {
  if (!nativeOverlayModule?.showRecommendationOverlay) {
    return defaultStatus();
  }

  try {
    await nativeOverlayModule.showRecommendationOverlay(title ?? '', body ?? '');
  } catch (error) {
    return defaultStatus();
  }

  return getOverlayCaptureStatus();
}

export async function showDualOverlayRecommendation(sliceTitle, sliceBody, charTitle, charBody) {
  if (!nativeOverlayModule?.showDualRecommendationOverlay) {
    // Fallback: show only slice verdict on the single legacy overlay.
    return showOverlayRecommendation(sliceTitle, sliceBody);
  }

  try {
    await nativeOverlayModule.showDualRecommendationOverlay(
      sliceTitle ?? '',
      sliceBody ?? '',
      charTitle ?? '',
      charBody ?? '',
    );
  } catch (error) {
    return defaultStatus();
  }

  return getOverlayCaptureStatus();
}

export async function hideOverlayRecommendation() {
  if (!nativeOverlayModule?.hideRecommendationOverlay) {
    return defaultStatus();
  }

  try {
    await nativeOverlayModule.hideRecommendationOverlay();
  } catch (error) {
    return defaultStatus();
  }

  return getOverlayCaptureStatus();
}

export async function confirmArrowBurstSet(setName) {
  if (!nativeOverlayModule?.confirmArrowBurstSet) {
    return false;
  }

  try {
    await nativeOverlayModule.confirmArrowBurstSet(setName ?? '');
    return true;
  } catch (error) {
    Alert.alert('Teach Burst Scanner', 'Unable to save that confirmed burst set right now.');
    return false;
  }
}

export async function saveArrowTrainingSample(setName) {
  if (!nativeOverlayModule?.saveArrowTrainingSample) {
    return false;
  }

  try {
    await nativeOverlayModule.saveArrowTrainingSample(setName ?? '');
    return true;
  } catch (error) {
    Alert.alert('Arrow Training', `Could not save: ${error?.message || 'unknown error'}`);
    return false;
  }
}

export async function confirmOuterShape(shapeName) {
  if (!nativeOverlayModule?.confirmOuterShape) {
    return false;
  }

  try {
    await nativeOverlayModule.confirmOuterShape(shapeName ?? '');
    return true;
  } catch (error) {
    Alert.alert('Teach Outer Shape', 'Unable to save that confirmed outer shape right now.');
    return false;
  }
}
