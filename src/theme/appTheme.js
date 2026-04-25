import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

// Lazy-require AsyncStorage so this module can still be imported in unit
// tests / Node tooling that doesn't have the native bridge wired up.
let AsyncStorage = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch (e) {
  AsyncStorage = null;
}

const THEME_KEY = '@modforge/themeIsDark';

// Module-level cache so the provider's lazy useState initializer can read
// the persisted choice synchronously once hydrateTheme() has resolved.
// Default is true (dark) — same as a fresh install with nothing stored.
let cachedIsDark = true;
let hydratePromise = null;

export function hydrateTheme() {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    if (!AsyncStorage) return cachedIsDark;
    try {
      const raw = await AsyncStorage.getItem(THEME_KEY);
      if (raw === 'true') cachedIsDark = true;
      else if (raw === 'false') cachedIsDark = false;
    } catch (e) {
      // best-effort — keep default
    }
    return cachedIsDark;
  })();
  return hydratePromise;
}

const palettes = {
  dark: {
    mode: 'dark',
    background: '#0a0e17',
    surface: '#111827',
    surfaceAlt: '#0d1520',
    border: '#1e2a3a',
    text: '#e2e8f0',
    muted: '#94a3b8',
    soft: '#475569',
    overlay: 'rgba(0,0,0,0.7)',
    warmSurface: '#1a1200',
    infoSurface: '#1e3a5f',
    primary: '#f5a623',
  },
  light: {
    mode: 'light',
    background: '#f4f7fb',
    surface: '#ffffff',
    surfaceAlt: '#eef3f9',
    border: '#cbd5e1',
    text: '#0f172a',
    muted: '#475569',
    soft: '#64748b',
    overlay: 'rgba(15,23,42,0.22)',
    warmSurface: '#fff1dc',
    infoSurface: '#dbeafe',
    primary: '#f5a623',
  },
};

const AppThemeContext = createContext({
  theme: palettes.dark,
  isDark: true,
  toggleTheme: () => {},
});

export function AppThemeProvider({ children }) {
  // Lazy initializer reads the cached value. App.js awaits hydrateTheme()
  // during the warm-up sequence before dismissing the LoadingScreen, so by
  // the time AppShell mounts cachedIsDark already reflects the persisted
  // choice — no flash. The useEffect below is a safety net for any code
  // path that mounts the provider before hydrateTheme() has resolved
  // (e.g. tests or unexpected entry points).
  const [isDark, setIsDark] = useState(() => cachedIsDark);

  useEffect(() => {
    let cancelled = false;
    hydrateTheme().then(value => {
      if (!cancelled) setIsDark(value);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const value = useMemo(() => ({
    theme: isDark ? palettes.dark : palettes.light,
    isDark,
    toggleTheme: () => {
      setIsDark(prev => {
        const next = !prev;
        cachedIsDark = next;
        if (AsyncStorage) {
          AsyncStorage.setItem(THEME_KEY, next ? 'true' : 'false').catch(() => {});
        }
        return next;
      });
    },
  }), [isDark]);

  return (
    <AppThemeContext.Provider value={value}>
      {children}
    </AppThemeContext.Provider>
  );
}

export function useAppTheme() {
  return useContext(AppThemeContext).theme;
}

export function useThemeControls() {
  return useContext(AppThemeContext);
}
