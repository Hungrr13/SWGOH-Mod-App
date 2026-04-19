import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useAppTheme } from '../theme/appTheme';

// Keep ads out of development/dev-client startup so native event emitters
// from the ads package do not crash the app before JS finishes loading.
const ADS_ENABLED = !__DEV__;

let BannerAd, BannerAdSize, TestIds;
if (ADS_ENABLED) {
  ({ BannerAd, BannerAdSize, TestIds } = require('react-native-google-mobile-ads'));
}

// Use test ad units during development.
// Replace with real ad unit IDs before publishing.
const BANNER_ID = ADS_ENABLED
  ? Platform.select({
      ios:     TestIds.BANNER,
      android: TestIds.BANNER,
      default: TestIds.BANNER,
    })
  : null;

function PlaceholderBanner() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderText}>Ad placeholder (Expo Go)</Text>
    </View>
  );
}

export default function AdBanner() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (!ADS_ENABLED) {
    return <PlaceholderBanner />;
  }

  return (
    <View style={styles.wrapper}>
      <BannerAd
        unitId={BANNER_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdFailedToLoad={(err) => {
          if (__DEV__) console.log('AdBanner error:', err);
        }}
      />
    </View>
  );
}

const createStyles = colors => StyleSheet.create({
  wrapper: {
    backgroundColor: colors.background,
    alignItems: 'center',
    width: '100%',
  },
  placeholder: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 50,
  },
  placeholderText: {
    color: colors.soft,
    fontSize: 11,
  },
});
