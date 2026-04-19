const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withStringsXml,
} = require('expo/config-plugins');

const PLUGIN_NAME = 'with-overlay-capture';
const PLUGIN_VERSION = '1.0.0';

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function ensurePermission(manifest, permissionName) {
  const usesPermissions = ensureArray(manifest.manifest['uses-permission']);
  const alreadyPresent = usesPermissions.some(
    permission => permission?.$?.['android:name'] === permissionName,
  );

  if (!alreadyPresent) {
    usesPermissions.push({
      $: {
        'android:name': permissionName,
      },
    });
  }

  manifest.manifest['uses-permission'] = usesPermissions;
}

function ensureService(androidManifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  const services = ensureArray(app.service);
  const serviceName = '.overlay.ModOverlayCaptureService';
  const existing = services.find(service => service?.$?.['android:name'] === serviceName);

  if (!existing) {
    services.push({
      $: {
        'android:name': serviceName,
        'android:enabled': 'true',
        'android:exported': 'false',
        'android:foregroundServiceType': 'specialUse|mediaProjection',
        'android:stopWithTask': 'false',
      },
      property: [
        {
          $: {
            'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
            'android:value': 'overlay_capture_mod_scanner',
          },
        },
      ],
    });
  } else {
    existing.$['android:foregroundServiceType'] = 'specialUse|mediaProjection';
    existing.property = [
      {
        $: {
          'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
          'android:value': 'overlay_capture_mod_scanner',
        },
      },
    ];
  }

  app.service = services;
}

function ensureString(items, name, value) {
  const resources = ensureArray(items.resources?.string);
  const existing = resources.find(item => item?.$?.name === name);

  if (existing) {
    existing._ = value;
  } else {
    resources.push({
      $: { name },
      _: value,
    });
  }

  items.resources = items.resources || {};
  items.resources.string = resources;
  return items;
}

const withOverlayCapture = config => {
  config = withAndroidManifest(config, mod => {
    ensurePermission(mod.modResults, 'android.permission.SYSTEM_ALERT_WINDOW');
    ensurePermission(mod.modResults, 'android.permission.FOREGROUND_SERVICE');
    ensurePermission(mod.modResults, 'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION');
    ensurePermission(mod.modResults, 'android.permission.FOREGROUND_SERVICE_SPECIAL_USE');
    ensurePermission(mod.modResults, 'android.permission.POST_NOTIFICATIONS');
    ensureService(mod.modResults);
    return mod;
  });

  config = withStringsXml(config, mod => {
    let updated = mod.modResults;
    updated = ensureString(updated, 'mod_overlay_notification_channel_name', 'Overlay Capture');
    updated = ensureString(
      updated,
      'mod_overlay_notification_channel_description',
      'Allows a floating capture button to stay active while reading mods in SWGOH.',
    );
    updated = ensureString(updated, 'mod_overlay_notification_title', 'Overlay Capture Active');
    updated = ensureString(
      updated,
      'mod_overlay_notification_text',
      'Tap the floating button while viewing a mod to analyze it.',
    );
    updated = ensureString(updated, 'mod_overlay_notification_stop_action', 'Turn Off');
    updated = ensureString(updated, 'mod_overlay_recommendation_title_default', 'Capture Ready');
    updated = ensureString(updated, 'mod_overlay_recommendation_body_default', 'Tap again to capture another mod, or open the app for more details.');
    mod.modResults = updated;
    return mod;
  });

  return config;
};

module.exports = createRunOncePlugin(withOverlayCapture, PLUGIN_NAME, PLUGIN_VERSION);
