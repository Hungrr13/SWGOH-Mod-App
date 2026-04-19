import React, { createContext, useContext, useMemo, useState } from 'react';

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
  const [isDark, setIsDark] = useState(true);

  const value = useMemo(() => ({
    theme: isDark ? palettes.dark : palettes.light,
    isDark,
    toggleTheme: () => setIsDark(prev => !prev),
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
