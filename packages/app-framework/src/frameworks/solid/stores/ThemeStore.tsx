import type { Theme, ThemeKey } from '@shared/registries/themeRegistry';
import { isValidThemeKey, themeRegistry } from '@shared/registries/themeRegistry';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';

import { useAdamStore } from './AdamStore';

const THEME_KEY = 'we.theme';

type ThemeWithId = Theme & { id: ThemeKey };

export interface ThemeStore {
  // State
  themes: Accessor<ThemeWithId[]>;
  currentTheme: Accessor<ThemeWithId>;

  // Setters
  setThemes: (themes: ThemeWithId[]) => void;
  setCurrentTheme: (themeId: ThemeKey) => void;
}

const ThemeContext = createContext<ThemeStore>();

// Map registry entries to include id
function mapTheme(key: ThemeKey, theme: Theme): ThemeWithId {
  return { id: key, ...theme };
}

// Get all themes from the registry with their ids
function getMappedThemes(): ThemeWithId[] {
  return Object.entries(themeRegistry).map(([key, theme]) => mapTheme(key as ThemeKey, theme));
}

// Get initial theme key from localStorage if available otherwise fall back to the first key in the registry
function getInitialThemeKey(): ThemeKey {
  const saved = typeof window !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
  const fallback = Object.keys(themeRegistry)[0] as ThemeKey;
  return isValidThemeKey(saved) ? saved : fallback;
}

export function ThemeStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();

  const [themes, setThemes] = createSignal<ThemeWithId[]>(getMappedThemes());
  const [currentThemeKey, setCurrentThemeKey] = createSignal<ThemeKey>(getInitialThemeKey());

  // Derive the current theme based on the currentThemeKey
  const currentTheme: Accessor<ThemeWithId> = () =>
    themes().find((t) => t.id === currentThemeKey()) ?? mapTheme('light', themeRegistry.light);

  // Update the current theme, persist to Ad4m and apply to DOM
  function setCurrentTheme(themeId: ThemeKey) {
    if (isValidThemeKey(themeId)) {
      setCurrentThemeKey(themeId);
      document.documentElement.setAttribute('data-we-theme', themeId);
      // Keep localStorage as fast fallback for initial render and bootscreen before AgentSettings is loaded
      localStorage.setItem(THEME_KEY, themeId);
      // Persist to Ad4m
      adamStore.updateAgentSettings({ currentThemeId: themeId });
    }
  }

  // Apply persisted theme from AgentSettings when available
  createEffect(() => {
    const prefs = adamStore.agentSettings();
    if (prefs?.currentThemeId && isValidThemeKey(prefs.currentThemeId)) {
      setCurrentThemeKey(prefs.currentThemeId as ThemeKey);
      document.documentElement.setAttribute('data-we-theme', prefs.currentThemeId);
      localStorage.setItem(THEME_KEY, prefs.currentThemeId);
    }
  });

  setCurrentTheme(currentTheme().id);

  const store: ThemeStore = {
    // State
    themes,
    currentTheme,

    // Setters
    setThemes,
    setCurrentTheme,
  };

  return <ThemeContext.Provider value={store}>{props.children}</ThemeContext.Provider>;
}

export function useThemeStore(): ThemeStore {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeStore must be used within ThemeProvider');
  return ctx;
}

export default ThemeStoreProvider;
