import type { ThemeKey } from '@shared/registries/themeRegistry';
import { isValidThemeKey, themeRegistry } from '@shared/registries/themeRegistry';
import { toastService } from '@we/components/solid';
import { compressImageToFileData, decodeFileAsString, ImageBlock, Theme } from '@we/models';
import type { ThemeOverrides } from '@we/schema-shared';
import { themeToStyle } from '@we/schema-shared';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';

import { useAdamStore } from './AdamStore';

const THEME_KEY = 'we.theme';
const EDITING_THEME_KEY = 'we.editing-theme';
const MAX_UNDO = 50;

/** Unified theme representation covering registry presets and custom AD4M-stored themes. */
export type ThemeData = {
  id: string;
  name: string;
  icon: string;
  origin: 'built-in' | 'custom' | 'marketplace';
  overrides: string | null;
  css: string | null;
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
  editingTheme: Accessor<EditingTheme | null>;
  canUndo: Accessor<boolean>;
  canRedo: Accessor<boolean>;

  // Actions
  setCurrentTheme: (themeId: string) => void;
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
  createAndStartEditing: (name: string, icon: string, sourceId?: string, destination?: 'personal' | 'space') => Promise<boolean>;
  saveEditingTheme: () => Promise<ThemeData | null>;
  saveEditingThemeAs: (name: string, icon: string) => Promise<ThemeData | null>;
  deleteTheme: (themeId: string) => Promise<void>;
  installFromMarketplace: (marketplaceThemeId: string) => Promise<void>;
  uninstallTheme: (themeId: string) => Promise<void>;
  publishToMarketplace: (options: { name: string; description: string; screenshots: File[] }) => Promise<boolean>;
  loadInstalledThemes: () => Promise<void>;
}

const ThemeContext = createContext<ThemeStore>();

function registryToThemeData(key: string): ThemeData {
  const t = themeRegistry[key as ThemeKey] ?? { name: key, icon: 'palette' };
  return { id: key, name: t.name, icon: t.icon, origin: 'built-in', overrides: null, css: null };
}

function encodeToFileData(content: string, name: string, mimeType: string) {
  const bytes = new TextEncoder().encode(content);
  const base64 = btoa(String.fromCharCode(...bytes));
  return { data_base64: base64, name, file_type: mimeType };
}

function modelToThemeData(model: Theme): ThemeData {
  return {
    id: model.id,
    name: model.name || 'Untitled Theme',
    icon: model.icon || 'palette',
    origin: (model.origin as ThemeData['origin']) || 'custom',
    overrides: decodeFileAsString(model.overrides) || null,
    css: decodeFileAsString(model.css) || null,
  };
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

export function ThemeStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();

  const builtInThemes: Accessor<ThemeData[]> = () => Object.keys(themeRegistry).map(registryToThemeData);

  const [installedThemes, setInstalledThemes] = createSignal<ThemeData[]>([]);
  const [spaceThemes, setSpaceThemes] = createSignal<ThemeData[]>([]);
  const [currentThemeId, setCurrentThemeId] = createSignal<string>(getInitialThemeId());
  const [editingTheme, setEditingTheme] = createSignal<EditingTheme | null>(null);

  // ── Undo / redo ──
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

  const allThemes: Accessor<ThemeData[]> = () => [...builtInThemes(), ...installedThemes(), ...spaceThemes()];

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

  // Apply persisted theme from AgentSettings when available
  createEffect(() => {
    const prefs = adamStore.agentSettings();
    if (!prefs?.currentThemeId) return;
    const id = prefs.currentThemeId;
    setCurrentThemeId(id);
    localStorage.setItem(THEME_KEY, id);
    // Defer apply until installedThemes are loaded if it's a custom theme
    const theme = allThemes().find((t) => t.id === id);
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

  function setCurrentTheme(themeId: string) {
    setCurrentThemeId(themeId);
    localStorage.setItem(THEME_KEY, themeId);
    adamStore.updateAgentSettings({ currentThemeId: themeId });
    applyThemeToDOM(resolveThemeData(themeId));
  }

  function replaceTheme(themeId: string) {
    setCurrentThemeId(themeId);
    applyThemeToDOM(resolveThemeData(themeId));
  }

  function restorePersonalTheme() {
    const id = localStorage.getItem(THEME_KEY) ?? adamStore.agentSettings()?.currentThemeId ?? getInitialThemeId();
    setCurrentThemeId(id);
    applyThemeToDOM(resolveThemeData(id));
  }

  function startEditing(themeId?: string) {
    const base = themeId ? allThemes().find((t) => t.id === themeId) : currentTheme();
    if (!base) return;
    clearHistory();
    setEditingTheme({ ...base, isDirty: false });
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
        css: source?.css
          ? (encodeToFileData(source.css, 'theme.css', 'text/css') as any)
          : null,
      });
      themeModelMap.set(model.id, model);
      const data = modelToThemeData(model);
      setInstalledThemes((prev) => [...prev, data]);
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
        existing.css = editing.css
          ? (encodeToFileData(editing.css, 'theme.css', 'text/css') as any)
          : null;
        await existing.save();
        const updated = modelToThemeData(existing);
        setInstalledThemes((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setEditingTheme({ ...updated, isDirty: false });
        setCurrentTheme(updated.id);
        return updated;
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
        css: editing.css
          ? (encodeToFileData(editing.css, 'theme.css', 'text/css') as any)
          : null,
      });
      themeModelMap.set(model.id, model);
      const data = modelToThemeData(model);
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
        css: source.css
          ? (encodeToFileData(source.css, 'theme.css', 'text/css') as any)
          : null,
      });
      themeModelMap.set(model.id, model);
      setInstalledThemes((prev) => [...prev, modelToThemeData(model)]);

      const settings = adamStore.agentSettings();
      if (settings) await settings.addInstalledThemes(model);

      toastService.success(`Theme "${source.name}" installed`);
    } catch (e) {
      console.error('ThemeStore: installFromMarketplace error', e);
      toastService.error('Failed to install theme');
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
        existing.css = base.css
          ? (encodeToFileData(base.css, 'theme.css', 'text/css') as any)
          : null;
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
          css: base.css
            ? (encodeToFileData(base.css, 'theme.css', 'text/css') as any)
            : null,
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

  const store: ThemeStore = {
    builtInThemes,
    installedThemes,
    spaceThemes,
    allThemes,
    currentThemeId,
    currentTheme,
    editingTheme,
    canUndo,
    canRedo,
    setCurrentTheme,
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
    publishToMarketplace,
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
