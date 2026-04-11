import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as NavigationBar from 'expo-navigation-bar';

const IS_EXPO_GO = Constants.appOwnership === 'expo';
const mobileAds = IS_EXPO_GO ? null : require('react-native-google-mobile-ads').default;

import LookupScreen from './src/screens/LookupScreen';
import FinderScreen from './src/screens/FinderScreen';
import SliceScreen  from './src/screens/SliceScreen';

const Tab = createBottomTabNavigator();

const NAV_THEME = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#0a0e17',
    card: '#0d1520',
    text: '#e2e8f0',
    border: '#1e2a3a',
    primary: '#f5a623',
    notification: '#f5a623',
  },
};

function TabIcon({ label, focused }) {
  const icons = { Lookup: '🔍', Finder: '⚙', Slice: '⚡' };
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 18 }}>{icons[label]}</Text>
    </View>
  );
}

export default function App() {
  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden');
    }
  }, []);

  useEffect(() => {
    if (IS_EXPO_GO || !mobileAds) return;
    mobileAds()
      .initialize()
      .then(() => {
        if (__DEV__) console.log('AdMob initialized');
      })
      .catch(err => {
        if (__DEV__) console.log('AdMob init error:', err);
      });
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={NAV_THEME}>
        <StatusBar style="light" />
        <Tab.Navigator
          screenOptions={({ route }) => ({
            tabBarIcon: ({ focused }) => (
              <TabIcon label={route.name} focused={focused} />
            ),
            tabBarActiveTintColor: '#f5a623',
            tabBarInactiveTintColor: '#475569',
            tabBarStyle: {
              backgroundColor: '#0d1520',
              borderTopColor: '#1e2a3a',
              borderTopWidth: 1,
              paddingBottom: 4,
            },
            tabBarLabelStyle: {
              fontSize: 12,
              fontWeight: '600',
            },
            headerStyle: {
              backgroundColor: '#0d1520',
              borderBottomColor: '#1e2a3a',
              borderBottomWidth: 1,
              elevation: 0,
              shadowOpacity: 0,
            },
            headerTintColor: '#f5a623',
            headerTitleStyle: {
              fontWeight: 'bold',
              fontSize: 17,
            },
            headerRight: () => (
              <Text style={{ color: '#475569', fontSize: 11, marginRight: 12 }}>
                318 chars · Kyber GAC
              </Text>
            ),
          })}
        >
          <Tab.Screen
            name="Lookup"
            component={LookupScreen}
            options={{ title: '🔍 Lookup', headerTitle: 'Mod Lookup' }}
          />
          <Tab.Screen
            name="Finder"
            component={FinderScreen}
            options={{ title: '⚙ Finder', headerTitle: 'Mod Finder' }}
          />
          <Tab.Screen
            name="Slice"
            component={SliceScreen}
            options={{ title: '⚡ Slice', headerTitle: 'Mod Slicer' }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
