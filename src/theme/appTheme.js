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
  // Default to dark on cold start. First-launch users always open in dark
  // mode; we hydrate the persisted choice (if any) on mount so a returning
  // light-mode user sees a brief flash of dark before swapping. That flash
  // is acceptable — same trade-off premiumState / rosterState make.
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    if (!AsyncStorage) return;
    let cancelled = false;
    AsyncStorage.getItem(THEME_KEY)
      .then(raw => {
        if (cancelled || raw == null) return;
        // Stored value is the JSON literal "true" / "false".
        const stored = raw === 'true' ? true : raw === 'false' ? false : null;
        if (stored !== null) setIsDark(stored);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const value = useMemo(() => ({
    theme: isDark ? palettes.dark : palettes.light,
    isDark,
    toggleTheme: () => {
      setIsDark(prev => {
        const next = !prev;
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
