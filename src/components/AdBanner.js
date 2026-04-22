import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '../theme/appTheme';
import { getAdUnitId } from '../config/adsConfig';
import * as premiumState from '../services/premiumState';

// Keep ads out of development/dev-client startup so native event emitters
// from the ads package do not crash the app before JS finishes loading.
const ADS_ENABLED = !__DEV__;

let nativeMod = null;
let BannerAd, BannerAdSize;
if (ADS_ENABLED) {
  nativeMod = require('react-native-google-mobile-ads');
  ({ BannerAd, BannerAdSize } = nativeMod);
}

const BANNER_ID = getAdUnitId('banner', nativeMod);

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
  const [premium, setPremium] = useState(() => premiumState.getSnapshot());

  useEffect(() => {
    setPremium(premiumState.getSnapshot());
    return premiumState.subscribe(setPremium);
  }, []);

  if (premium.isPremium) return null;

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
