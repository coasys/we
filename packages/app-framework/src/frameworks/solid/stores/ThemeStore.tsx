import type { ThemeKey } from '@shared/registries/themeRegistry';
import { isValidThemeKey, themeRegistry } from '@shared/registries/themeRegistry';
import { toastService } from '@we/components/solid';
import type { ThemeData } from '@we/models';
import { compressImageToFileData, ImageBlock, modelToThemeData, Theme } from '@we/models';
import type { ThemeOverrides } from '@we/schema-shared';
import { themeToStyle } from '@we/schema-shared';
import { Accessor, createContext, createEffect, createSignal, ParentProps, untrack, useContext } from 'solid-js';

import { useAdamStore } from './AdamStore';

const THEME_KEY = 'we.theme';
const EDITING_THEME_KEY = 'we.editing-theme';
const MAX_UNDO = 50;

export type ThemeManagementItem = {
  id: string;
  name: string;
  icon: string;
  isBuiltIn: boolean;
  isInstalled: boolean;
  isDefault: boolean;
};

export type EditingTheme = ThemeData & {
  isDirty: boolean;
};

export interface ThemeStore {
  // State
  builtInThemes: Accessor<ThemeData[]>;
  installedThemes: Accessor<ThemeData[]>;
  spaceThemes: Accessor<ThemeData[]>;
  allThemes: Accessor<ThemeData[]>;
  currentThemeId: Accessor<string>;
  currentTheme: Accessor<ThemeData>;
  defaultThemeId: Accessor<string>;
  themeManagementList: Accessor<ThemeManagementItem[]>;
  editingTheme: Accessor<EditingTheme | null>;
  canUndo: Accessor<boolean>;
  canRedo: Accessor<boolean>;
  operationLoading: Accessor<string | null>;

  // Actions
  setCurrentTheme: (themeId: string) => void;
  setDefaultTheme: (themeId: string) => void;
  toggleThemeInstalled: (themeId: string) => Promise<void>;
  /** Apply a theme temporarily (space default) without persisting to AgentSettings. */
  replaceTheme: (themeId: string) => void;
  /** Restore the persisted personal theme (called when leaving a space with a default theme). */
  restorePersonalTheme: () => void;
  startEditing: (themeId?: string) => void;
  updateEditingOverrides: (overrides: Partial<ThemeOverrides>) => void;
  updateEditingCss: (css: string) => void;
  updateEditingMeta: (fields: { name?: string; icon?: string }) => void;
  cancelEditing: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  createAndStartEditing: (
    name: string,
    icon: string,
    sourceId?: string,
    destination?: 'personal' | 'space',
  ) => Promise<boolean>;
  saveEditingTheme: () => Promise<ThemeData | null>;
  saveEditingThemeAs: (name: string, icon: string) => Promise<ThemeData | null>;
  deleteTheme: (themeId: string) => Promise<void>;
  installFromMarketplace: (marketplaceThemeId: string) => Promise<void>;
  uninstallTheme: (themeId: string) => Promise<void>;
  deleteMarketplaceTheme: (themeId: string) => Promise<void>;
  publishToMarketplace: (options: { name: string; description: string; screenshots: File[] }) => Promise<boolean>;
  publishToSpace: (perspectiveUuid: string, spaceName: string) => Promise<boolean>;
  loadInstalledThemes: () => Promise<void>;
}

const ThemeContext = createContext<ThemeStore>();

function registryToThemeData(key: string): ThemeData {
  const t = themeRegistry[key as ThemeKey] ?? { name: key, icon: 'palette' };
  return { id: key, name: t.name, icon: t.icon, origin: 'built-in', version: 1, overrides: null, css: null };
}

function encodeToFileData(content: string, name: string, mimeType: string) {
  const bytes = new TextEncoder().encode(content);
  const base64 = btoa(String.fromCharCode(...bytes));
  return { data_base64: base64, name, file_type: mimeType };
}

function getInitialThemeId(): string {
  const saved = typeof window !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
  const fallback = Object.keys(themeRegistry)[0];
  return saved ?? fallback;
}

function applyThemeToDOM(theme: ThemeData) {
  const overrides: ThemeOverrides = theme.overrides ? JSON.parse(theme.overrides) : {};
  const hasOverrides = Object.keys(overrides).length > 0;

  // Fast path: pure built-in theme with no overrides or custom CSS
  if (!hasOverrides && !theme.css && isValidThemeKey(theme.id)) {
    document.documentElement.setAttribute('data-we-theme', theme.id);
    clearCustomThemeCSS();
    return;
  }

  // Set base preset: prefer overrides.themeName, fall back to built-in id, then 'light'
  const baseName =
    overrides.themeName && isValidThemeKey(overrides.themeName)
      ? overrides.themeName
      : isValidThemeKey(theme.id)
        ? theme.id
        : 'light';
  document.documentElement.setAttribute('data-we-theme', baseName);

  // Clear previous inline overrides before re-applying so stale vars don't bleed through
  document.documentElement.style.cssText = '';

  // Inject CSS vars derived from overrides
  const styles = themeToStyle(overrides);
  for (const [prop, value] of Object.entries(styles)) {
    document.documentElement.style.setProperty(prop, value);
  }

  // Inject raw CSS into a dedicated style element
  let styleEl = document.getElementById('we-custom-theme-css') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'we-custom-theme-css';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = theme.css ?? '';
}

function clearCustomThemeCSS() {
  document.documentElement.style.cssText = '';
  const styleEl = document.getElementById('we-custom-theme-css');
  if (styleEl) styleEl.textContent = '';
}

const OVERRIDE_CSS_VARS: Partial<Record<keyof ThemeOverrides, string>> = {
  // Color
  primaryHue: '--we-color-primary-hue',
  successHue: '--we-color-success-hue',
  warningHue: '--we-color-warning-hue',
  dangerHue: '--we-color-danger-hue',
  neutralHue: '--we-color-neutral-hue',
  saturation: '--we-color-saturation',
  neutralSaturation: '--we-color-neutral-saturation',
  subtractor: '--we-color-subtractor',
  multiplier: '--we-color-multiplier',
  ringColor: '--we-ring-color',
  // Typography
  fontFamily: '--we-font-family',
  letterSpacing: '--we-theme-letter-spacing',
  // Shape
  controlRadius: '--we-theme-control-radius',
  surfaceRadius: '--we-theme-surface-radius',
  inputRadius: '--we-theme-input-radius',
  // Density
  controlSpacing: '--we-theme-control-spacing',
  surfaceSpacing: '--we-theme-surface-spacing',
  // Effects
  surfaceOpacity: '--we-theme-surface-opacity',
};

/**
 * For any override keys missing from `overrides`, reads their actual computed CSS values so
 * sliders initialise at the position matching what the user sees, not hardcoded defaults.
 * Must be called while the target theme is already applied to the DOM.
 */
function populateMissingOverrides(overrides: ThemeOverrides): ThemeOverrides {
  const result = { ...overrides };
  const styles = getComputedStyle(document.documentElement);

  for (const [key, cssVar] of Object.entries(OVERRIDE_CSS_VARS) as [keyof ThemeOverrides, string][]) {
    if (result[key] !== undefined) continue;
    let raw = styles.getPropertyValue(cssVar).trim();
    // neutral-hue is defined as var(--we-color-primary-hue) in the token CSS —
    // getComputedStyle returns the var() reference, not the resolved number
    if (!raw || raw.startsWith('var(')) raw = styles.getPropertyValue('--we-color-primary-hue').trim();
    if (!raw || raw.startsWith('var(')) continue;

    if (key === 'multiplier' || (key as string).endsWith('Hue')) {
      const n = Number(raw);
      if (!isNaN(n)) (result as any)[key] = n;
    } else {
      (result as any)[key] = raw; // percentage string e.g. '60%'
    }
  }

  return result;
}

export function ThemeStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();

  const builtInThemes: Accessor<ThemeData[]> = () => Object.keys(themeRegistry).map(registryToThemeData);

  const [installedThemes, setInstalledThemes] = createSignal<ThemeData[]>([]);
  // IDs of custom themes visible in pickers (subset of installedThemes)
  const [visibleThemeIds, setVisibleThemeIds] = createSignal<Set<string>>(new Set());
  const [spaceThemes, setSpaceThemes] = createSignal<ThemeData[]>([]);
  const [currentThemeId, setCurrentThemeId] = createSignal<string>(getInitialThemeId());
  // Space theme requested before loadSpaceThemes completes — held here until it can be applied.
  const [pendingSpaceThemeId, setPendingSpaceThemeId] = createSignal<string | null>(null);
  const [editingTheme, setEditingTheme] = createSignal<EditingTheme | null>(null);

  // ── Undo / redo ──
  const [operationLoading, setOperationLoading] = createSignal<string | null>(null);

  const [undoStack, setUndoStack] = createSignal<EditingTheme[]>([]);
  const [redoStack, setRedoStack] = createSignal<EditingTheme[]>([]);
  let pendingSnapshot: EditingTheme | null = null;
  let applyingHistoryOp = false;

  const canUndo: Accessor<boolean> = () => undoStack().length > 0;
  const canRedo: Accessor<boolean> = () => redoStack().length > 0;

  function captureSnapshot() {
    if (applyingHistoryOp || pendingSnapshot !== null) return;
    const current = editingTheme();
    if (!current) return;
    pendingSnapshot = { ...current };
  }

  function commitSnapshot() {
    if (applyingHistoryOp || !pendingSnapshot) return;
    const s = pendingSnapshot;
    pendingSnapshot = null;
    setUndoStack((prev) => {
      const next = [...prev, s];
      return next.length > MAX_UNDO ? next.slice(-MAX_UNDO) : next;
    });
    setRedoStack([]);
  }

  function clearHistory() {
    setUndoStack([]);
    setRedoStack([]);
    pendingSnapshot = null;
  }

  async function undo() {
    const stack = undoStack();
    if (!stack.length) return;
    const snapshot = stack[stack.length - 1];
    const current = editingTheme();
    setUndoStack((prev) => prev.slice(0, -1));
    if (current) setRedoStack((prev) => [...prev, { ...current }]);
    pendingSnapshot = null;
    applyingHistoryOp = true;
    setEditingTheme(snapshot);
    applyThemeToDOM(snapshot);
    await saveEditingTheme();
    applyingHistoryOp = false;
  }

  async function redo() {
    const stack = redoStack();
    if (!stack.length) return;
    const snapshot = stack[stack.length - 1];
    const current = editingTheme();
    setRedoStack((prev) => prev.slice(0, -1));
    if (current) setUndoStack((prev) => [...prev, { ...current }]);
    pendingSnapshot = null;
    applyingHistoryOp = true;
    setEditingTheme(snapshot);
    applyThemeToDOM(snapshot);
    await saveEditingTheme();
    applyingHistoryOp = false;
  }

  const allThemes: Accessor<ThemeData[]> = () => {
    const ids = visibleThemeIds();
    const visible = ids.size > 0 ? installedThemes().filter((t) => ids.has(t.id)) : installedThemes();
    return [...builtInThemes(), ...visible, ...spaceThemes()];
  };

  const currentTheme: Accessor<ThemeData> = () =>
    allThemes().find((t) => t.id === currentThemeId()) ?? registryToThemeData('light');

  // Map theme AD4M model UUID → model instance for save/delete
  const themeModelMap = new Map<string, Theme>();

  async function loadSpaceThemes() {
    const perspective = adamStore.currentPerspective();
    if (!perspective) {
      setSpaceThemes([]);
      return;
    }
    try {
      const models = await Theme.findAll(perspective);
      for (const model of models) themeModelMap.set(model.id, model);
      setSpaceThemes(models.map(modelToThemeData));
    } catch (e) {
      console.error('ThemeStore: failed to load space themes', e);
    }
  }

  async function loadInstalledThemes() {
    const perspective = adamStore.rootPerspective();
    if (!perspective) return;
    try {
      const models = await Theme.findAll(perspective);
      for (const model of models) themeModelMap.set(model.id, model);
      setInstalledThemes(models.map(modelToThemeData));

      // Build visible set from AgentSettings.installedThemes HasMany
      const prefs = adamStore.agentSettings();
      if (prefs) {
        const refs = prefs.installedThemes || [];
        const trackedIds = new Set<string>();
        for (const ref of refs) {
          const id = typeof ref === 'string' ? ref : (ref as any).id;
          if (id) trackedIds.add(id);
        }
        if (trackedIds.size === 0 && models.length > 0) {
          // First run: auto-register all existing themes as visible
          for (const model of models) {
            await prefs.addInstalledThemes(model).catch(() => {});
            trackedIds.add(model.id);
          }
        }
        setVisibleThemeIds(trackedIds);
      } else {
        setVisibleThemeIds(new Set(models.map((m) => m.id)));
      }
    } catch (e) {
      console.error('ThemeStore: failed to load installed themes', e);
    }
  }

  // Load installed themes when root perspective is ready
  createEffect(() => {
    if (adamStore.rootPerspective()) loadInstalledThemes();
  });

  // Load space themes when the current space perspective changes
  createEffect(() => {
    if (adamStore.currentPerspective()) loadSpaceThemes();
    else setSpaceThemes([]);
  });

  // Once spaceThemes finish loading, flush any pending space theme that replaceTheme
  // couldn't apply yet (race: SpaceStore fires before loadSpaceThemes completes).
  createEffect(() => {
    const themes = spaceThemes();
    const pending = pendingSpaceThemeId();
    if (!pending) return;
    const match = themes.find((t) => t.id === pending);
    if (match) {
      setPendingSpaceThemeId(null);
      setCurrentThemeId(pending);
      applyThemeToDOM(match);
    }
  });

  // Apply the agent's default theme when AgentSettings first loads.
  // Uses defaultThemeId so boot always starts at the user's chosen default,
  // not whatever was last active in a previous session.
  createEffect(() => {
    const prefs = adamStore.agentSettings();
    if (!prefs?.defaultThemeId) return;
    const id = prefs.defaultThemeId;
    setCurrentThemeId(id);
    // Use untrack so spaceThemes reloading between spaces doesn't re-trigger this effect
    const theme = untrack(() => allThemes().find((t) => t.id === id));
    if (theme) {
      if (theme.origin !== 'built-in') applyThemeToDOM(theme);
      else {
        clearCustomThemeCSS();
        document.documentElement.setAttribute('data-we-theme', id);
      }
    } else if (isValidThemeKey(id)) {
      document.documentElement.setAttribute('data-we-theme', id);
    }
  });

  // Keep localStorage in sync with the agent's default theme so the bootscreen
  // can apply it immediately on next launch without waiting for AD4M to load.
  createEffect(() => {
    const prefs = adamStore.agentSettings();
    if (!prefs?.defaultThemeId) return;
    localStorage.setItem(THEME_KEY, prefs.defaultThemeId);
  });

  // Apply initial theme immediately from localStorage
  const initialId = getInitialThemeId();
  if (isValidThemeKey(initialId)) {
    document.documentElement.setAttribute('data-we-theme', initialId);
  }

  function resolveThemeData(themeId: string): ThemeData {
    return (
      allThemes().find((t) => t.id === themeId) ?? registryToThemeData(isValidThemeKey(themeId) ? themeId : 'light')
    );
  }

  const defaultThemeId: Accessor<string> = () => adamStore.agentSettings()?.defaultThemeId || 'light';

  const themeManagementList: Accessor<ThemeManagementItem[]> = () => {
    const defaultId = defaultThemeId();
    const visible = visibleThemeIds();
    const builtIn = builtInThemes().map((t) => ({
      id: t.id,
      name: t.name,
      icon: t.icon,
      isBuiltIn: true,
      isInstalled: true,
      isDefault: t.id === defaultId,
    }));
    const custom = installedThemes().map((t) => ({
      id: t.id,
      name: t.name,
      icon: t.icon,
      isBuiltIn: false,
      isInstalled: visible.has(t.id),
      isDefault: t.id === defaultId,
    }));
    return [...builtIn, ...custom];
  };

  function setCurrentTheme(themeId: string) {
    setCurrentThemeId(themeId);
    applyThemeToDOM(resolveThemeData(themeId));
  }

  function setDefaultTheme(themeId: string) {
    localStorage.setItem(THEME_KEY, themeId);
    setCurrentThemeId(themeId);
    applyThemeToDOM(resolveThemeData(themeId));
    adamStore.updateAgentSettings({ defaultThemeId: themeId });
  }

  async function toggleThemeInstalled(themeId: string) {
    const model = themeModelMap.get(themeId);
    const prefs = adamStore.agentSettings();
    if (!model || !prefs) return;
    if (visibleThemeIds().has(themeId)) {
      await prefs.removeInstalledThemes(model).catch(() => {});
      setVisibleThemeIds((prev) => {
        const next = new Set(prev);
        next.delete(themeId);
        return next;
      });
    } else {
      await prefs.addInstalledThemes(model).catch(() => {});
      setVisibleThemeIds((prev) => new Set([...prev, themeId]));
    }
  }

  function replaceTheme(themeId: string) {
    const theme = allThemes().find((t) => t.id === themeId);
    if (theme) {
      // Theme already loaded — apply immediately and clear any pending state.
      setPendingSpaceThemeId(null);
      setCurrentThemeId(themeId);
      applyThemeToDOM(theme);
    } else {
      // spaceThemes not loaded yet — park the ID. The createEffect below will
      // apply it (and commit currentThemeId) once the space themes arrive.
      setPendingSpaceThemeId(themeId);
    }
  }

  function restorePersonalTheme() {
    setPendingSpaceThemeId(null);
    const id = localStorage.getItem(THEME_KEY) ?? adamStore.agentSettings()?.defaultThemeId ?? getInitialThemeId();
    setCurrentThemeId(id);
    applyThemeToDOM(resolveThemeData(id));
  }

  function startEditing(themeId?: string) {
    const base = themeId ? allThemes().find((t) => t.id === themeId) : currentTheme();
    if (!base) return;
    clearHistory();
    const storedOverrides: ThemeOverrides = base.overrides ? JSON.parse(base.overrides) : {};
    const initialOverrides = populateMissingOverrides(storedOverrides);
    setEditingTheme({ ...base, overrides: JSON.stringify(initialOverrides), isDirty: false });
    sessionStorage.setItem(EDITING_THEME_KEY, themeId ?? currentThemeId());
  }

  function updateEditingOverrides(patch: Partial<ThemeOverrides>) {
    captureSnapshot();
    setEditingTheme((prev) => {
      if (!prev) return prev;
      const existing: ThemeOverrides = prev.overrides ? JSON.parse(prev.overrides) : {};
      const merged = { ...existing, ...patch };
      const next = { ...prev, overrides: JSON.stringify(merged), isDirty: true };
      applyThemeToDOM(next);
      return next;
    });
  }

  function updateEditingCss(css: string) {
    captureSnapshot();
    setEditingTheme((prev) => {
      if (!prev) return prev;
      const next = { ...prev, css, isDirty: true };
      applyThemeToDOM(next);
      return next;
    });
  }

  function updateEditingMeta(fields: { name?: string; icon?: string }) {
    captureSnapshot();
    setEditingTheme((prev) => {
      if (!prev) return prev;
      return { ...prev, ...fields, isDirty: true };
    });
  }

  async function createAndStartEditing(
    name: string,
    icon: string,
    sourceId?: string,
    destination: 'personal' | 'space' = 'personal',
  ): Promise<boolean> {
    const source = sourceId ? allThemes().find((t) => t.id === sourceId) : null;
    const perspective = destination === 'space' ? adamStore.currentPerspective() : adamStore.rootPerspective();
    if (!perspective) {
      toastService.error(`Cannot save theme: no ${destination} perspective available`);
      return false;
    }
    try {
      const model = await Theme.create(perspective, {
        name,
        icon,
        origin: 'custom',
        version: 1,
        overrides: source?.overrides
          ? (encodeToFileData(source.overrides, 'overrides.json', 'application/json') as any)
          : null,
        css: source?.css ? (encodeToFileData(source.css, 'theme.css', 'text/css') as any) : null,
      });
      themeModelMap.set(model.id, model);
      const data: ThemeData = {
        id: model.id,
        name,
        icon,
        origin: 'custom',
        version: 1,
        overrides: source?.overrides ?? null,
        css: source?.css ?? null,
      };
      setInstalledThemes((prev) => [...prev, data]);
      setVisibleThemeIds((prev) => new Set([...prev, model.id]));
      const prefs = adamStore.agentSettings();
      if (prefs) await prefs.addInstalledThemes(model).catch(() => {});
      setCurrentTheme(data.id);
      setEditingTheme({ ...data, isDirty: false });
      sessionStorage.setItem(EDITING_THEME_KEY, data.id);
      return true;
    } catch (e) {
      console.error('ThemeStore: createAndStartEditing error', e);
      toastService.error('Failed to create theme');
      return false;
    }
  }

  function cancelEditing() {
    clearHistory();
    setEditingTheme(null);
    sessionStorage.removeItem(EDITING_THEME_KEY);
    // Restore actual current theme
    const theme = currentTheme();
    if (theme.origin !== 'built-in') applyThemeToDOM(theme);
    else {
      clearCustomThemeCSS();
      document.documentElement.setAttribute('data-we-theme', isValidThemeKey(theme.id) ? theme.id : 'light');
    }
  }

  async function saveEditingTheme(): Promise<ThemeData | null> {
    commitSnapshot();
    const editing = editingTheme();
    if (!editing) return null;
    const perspective = adamStore.rootPerspective();
    if (!perspective) return null;

    try {
      const existing = themeModelMap.get(editing.id);
      if (existing && existing.origin !== 'built-in') {
        existing.name = editing.name ?? '';
        existing.icon = editing.icon ?? '';
        existing.overrides = editing.overrides
          ? (encodeToFileData(editing.overrides, 'overrides.json', 'application/json') as any)
          : null;
        existing.css = editing.css ? (encodeToFileData(editing.css, 'theme.css', 'text/css') as any) : null;
        await existing.save();
        // Use the current signal state (not the captured `editing`) to avoid overwriting
        // changes made while this async save was in flight.
        const current = editingTheme();
        const saved: ThemeData = {
          id: existing.id,
          name: current?.name ?? editing.name,
          icon: current?.icon ?? editing.icon,
          origin: existing.origin as ThemeData['origin'],
          version: existing.version ?? 1,
          overrides: current?.overrides ?? editing.overrides,
          css: current?.css ?? editing.css,
        };
        setInstalledThemes((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
        setEditingTheme((prev) => (prev ? { ...prev, isDirty: false } : prev));
        setCurrentTheme(saved.id);
        return saved;
      } else {
        return saveEditingThemeAs(editing.name, editing.icon);
      }
    } catch (e) {
      console.error('ThemeStore: saveEditingTheme error', e);
      toastService.error('Failed to save theme');
      return null;
    }
  }

  async function saveEditingThemeAs(name: string, icon: string): Promise<ThemeData | null> {
    const editing = editingTheme();
    if (!editing) return null;
    const perspective = adamStore.rootPerspective();
    if (!perspective) return null;

    try {
      const model = await Theme.create(perspective, {
        name,
        icon,
        origin: 'custom',
        version: 1,
        overrides: editing.overrides
          ? (encodeToFileData(editing.overrides, 'overrides.json', 'application/json') as any)
          : null,
        css: editing.css ? (encodeToFileData(editing.css, 'theme.css', 'text/css') as any) : null,
      });
      themeModelMap.set(model.id, model);
      const data: ThemeData = {
        id: model.id,
        name,
        icon,
        origin: 'custom',
        version: 1,
        overrides: editing.overrides,
        css: editing.css,
      };
      setInstalledThemes((prev) => [...prev, data]);
      setEditingTheme({ ...data, isDirty: false });
      setCurrentTheme(data.id);
      toastService.success(`Theme "${name}" saved`);
      return data;
    } catch (e) {
      console.error('ThemeStore: saveEditingThemeAs error', e);
      toastService.error('Failed to save theme');
      return null;
    }
  }

  async function deleteTheme(themeId: string) {
    const model = themeModelMap.get(themeId);
    if (!model) return;
    try {
      await model.delete();
      themeModelMap.delete(themeId);
      setInstalledThemes((prev) => prev.filter((t) => t.id !== themeId));
      if (currentThemeId() === themeId) setCurrentTheme('light');
      toastService.success('Theme deleted');
    } catch (e) {
      console.error('ThemeStore: deleteTheme error', e);
      toastService.error('Failed to delete theme');
    }
  }

  async function installFromMarketplace(marketplaceThemeId: string) {
    const marketplacePerspective = adamStore.marketplacePerspective();
    const rootPerspective = adamStore.rootPerspective();
    if (!marketplacePerspective || !rootPerspective) return;

    setOperationLoading(`marketplace-install:${marketplaceThemeId}`);
    try {
      const source = await Theme.findOne(marketplacePerspective, { where: { id: marketplaceThemeId } });
      if (!source) {
        toastService.error('Theme not found');
        return;
      }

      const exists = installedThemes().some((t) => t.name === source.name);
      if (exists) {
        toastService.info(`Theme "${source.name}" already installed`);
        return;
      }

      const model = await Theme.create(rootPerspective, {
        name: source.name,
        icon: source.icon,
        origin: 'marketplace',
        version: source.version,
        overrides: source.overrides
          ? (encodeToFileData(source.overrides, 'overrides.json', 'application/json') as any)
          : null,
        css: source.css ? (encodeToFileData(source.css, 'theme.css', 'text/css') as any) : null,
      });
      themeModelMap.set(model.id, model);
      setInstalledThemes((prev) => [...prev, modelToThemeData(model)]);

      const settings = adamStore.agentSettings();
      if (settings) await settings.addInstalledThemes(model);

      toastService.success(`Theme "${source.name}" installed`);
    } catch (e) {
      console.error('ThemeStore: installFromMarketplace error', e);
      toastService.error('Failed to install theme');
    } finally {
      setOperationLoading(null);
    }
  }

  async function deleteMarketplaceTheme(themeId: string): Promise<void> {
    const marketplacePerspective = adamStore.marketplacePerspective();
    if (!marketplacePerspective) {
      toastService.error('Marketplace not connected');
      return;
    }
    setOperationLoading(`marketplace-delete:${themeId}`);
    try {
      const theme = await Theme.findOne(marketplacePerspective, { where: { id: themeId } });
      if (!theme) {
        toastService.error('Theme not found');
        return;
      }
      await theme.delete();
    } catch (error) {
      console.error('ThemeStore: deleteMarketplaceTheme error', error);
      toastService.error('Failed to delete theme');
    } finally {
      setOperationLoading(null);
    }
  }

  async function uninstallTheme(themeId: string) {
    const model = themeModelMap.get(themeId);
    const settings = adamStore.agentSettings();
    if (!model || !settings) return;
    try {
      await settings.removeInstalledThemes(model);
      await model.delete();
      themeModelMap.delete(themeId);
      setInstalledThemes((prev) => prev.filter((t) => t.id !== themeId));
      if (currentThemeId() === themeId) setCurrentTheme('light');
      toastService.success('Theme uninstalled');
    } catch (e) {
      console.error('ThemeStore: uninstallTheme error', e);
      toastService.error('Failed to uninstall theme');
    }
  }

  async function publishToMarketplace(options: {
    name: string;
    description: string;
    screenshots: File[];
  }): Promise<boolean> {
    const marketplacePerspective = adamStore.marketplacePerspective();
    if (!marketplacePerspective) {
      toastService.error('Marketplace not connected');
      return false;
    }

    const editing = editingTheme();
    const base = editing ?? currentTheme();

    const existing = await Theme.findOne(marketplacePerspective, { where: { name: options.name } });
    if (existing && existing.author !== adamStore.me()?.did) {
      toastService.error('A theme with this name already exists in the marketplace by a different author');
      return false;
    }

    try {
      if (existing) {
        existing.name = options.name;
        existing.version = (existing.version ?? 1) + 1;
        existing.overrides = base.overrides
          ? (encodeToFileData(base.overrides, 'overrides.json', 'application/json') as any)
          : null;
        existing.css = base.css ? (encodeToFileData(base.css, 'theme.css', 'text/css') as any) : null;
        await existing.save();

        await existing.setScreenshots([]);
        for (const file of options.screenshots) {
          const fileData = await compressImageToFileData(file, `screenshot-${Date.now()}`);
          const img = await ImageBlock.create(marketplacePerspective, {
            src: fileData as any,
            altText: 'Screenshot',
            version: 1,
          });
          await existing.addScreenshots(img);
        }
        toastService.success(`Theme "${options.name}" updated in marketplace (v${existing.version})`);
      } else {
        const theme = await Theme.create(marketplacePerspective, {
          name: options.name,
          icon: base.icon,
          origin: 'marketplace',
          version: 1,
          overrides: base.overrides
            ? (encodeToFileData(base.overrides, 'overrides.json', 'application/json') as any)
            : null,
          css: base.css ? (encodeToFileData(base.css, 'theme.css', 'text/css') as any) : null,
        });
        for (const file of options.screenshots) {
          const fileData = await compressImageToFileData(file, `screenshot-${Date.now()}`);
          const img = await ImageBlock.create(marketplacePerspective, {
            src: fileData as any,
            altText: 'Screenshot',
            version: 1,
          });
          await theme.addScreenshots(img);
        }
        toastService.success(`Theme "${options.name}" published to marketplace`);
      }
      return true;
    } catch (e) {
      console.error('ThemeStore: publishToMarketplace error', e);
      toastService.error('Failed to publish theme');
      return false;
    }
  }

  async function publishToSpace(perspectiveUuid: string, spaceName: string): Promise<boolean> {
    const perspective = adamStore.allPerspectives().find((p) => p.uuid === perspectiveUuid);
    if (!perspective) {
      toastService.error('Space not found');
      return false;
    }

    const editing = editingTheme();
    if (!editing) {
      toastService.error('No theme is being edited');
      return false;
    }

    const existing = await Theme.findOne(perspective, { where: { name: editing.name } });
    if (existing) {
      toastService.error(`Theme "${editing.name}" is already in "${spaceName}"`);
      return false;
    }

    try {
      await Theme.create(perspective, {
        name: editing.name,
        icon: editing.icon,
        origin: 'shared',
        version: 1,
        overrides: editing.overrides
          ? (encodeToFileData(editing.overrides, 'overrides.json', 'application/json') as any)
          : null,
        css: editing.css ? (encodeToFileData(editing.css, 'theme.css', 'text/css') as any) : null,
      });
      toastService.success(`Theme "${editing.name}" shared to space "${spaceName}"`);
      return true;
    } catch (e) {
      console.error('ThemeStore: publishToSpace error', e);
      toastService.error('Failed to share theme to space');
      return false;
    }
  }

  const store: ThemeStore = {
    builtInThemes,
    installedThemes,
    spaceThemes,
    allThemes,
    currentThemeId,
    currentTheme,
    defaultThemeId,
    themeManagementList,
    editingTheme,
    canUndo,
    canRedo,
    operationLoading,
    setCurrentTheme,
    setDefaultTheme,
    toggleThemeInstalled,
    replaceTheme,
    restorePersonalTheme,
    startEditing,
    updateEditingOverrides,
    updateEditingCss,
    updateEditingMeta,
    cancelEditing,
    undo,
    redo,
    createAndStartEditing,
    saveEditingTheme,
    saveEditingThemeAs,
    deleteTheme,
    installFromMarketplace,
    uninstallTheme,
    deleteMarketplaceTheme,
    publishToMarketplace,
    publishToSpace,
    loadInstalledThemes,
  };

  return <ThemeContext.Provider value={store}>{props.children}</ThemeContext.Provider>;
}

export function useThemeStore(): ThemeStore {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeStore must be used within ThemeStoreProvider');
  return ctx;
}

export default ThemeStoreProvider;
