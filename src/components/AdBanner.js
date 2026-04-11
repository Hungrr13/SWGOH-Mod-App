import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import Constants from 'expo-constants';

// AdMob native modules are not available in Expo Go — only load them in
// production builds (standalone / bare workflow).
const IS_EXPO_GO = Constants.appOwnership === 'expo';

let BannerAd, BannerAdSize, TestIds;
if (!IS_EXPO_GO) {
  ({ BannerAd, BannerAdSize, TestIds } = require('react-native-google-mobile-ads'));
}

// Use test ad units during development.
// Replace with real ad unit IDs before publishing.
const BANNER_ID = !IS_EXPO_GO
  ? Platform.select({
      ios:     TestIds.BANNER,
      android: TestIds.BANNER,
      default: TestIds.BANNER,
    })
  : null;

function PlaceholderBanner() {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderText}>Ad placeholder (Expo Go)</Text>
    </View>
  );
}

export default function AdBanner() {
  if (IS_EXPO_GO) {
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

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#0a0e17',
    alignItems: 'center',
    width: '100%',
  },
  placeholder: {
    backgroundColor: '#0d1520',
    borderColor: '#1e2a3a',
    borderWidth: 1,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 50,
  },
  placeholderText: {
    color: '#475569',
    fontSize: 11,
  },
});
