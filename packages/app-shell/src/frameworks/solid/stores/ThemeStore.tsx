import type { ThemeKey } from '@shared/registries/themeRegistry';
import { isValidThemeKey, themeRegistry } from '@shared/registries/themeRegistry';
import { toastService } from '@we/components/solid';
import type { ThemeData } from '@we/models';
import {
  asFileField,
  compressImageToFileData,
  decodeFileAsString,
  ImageBlock,
  modelToThemeData,
  Theme,
} from '@we/models';
import type { ThemeOverrides } from '@we/schema-shared';
import { themeToStyle } from '@we/schema-shared';
import {
  Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  ParentProps,
  untrack,
  useContext,
} from 'solid-js';

import { useDatasetStore } from './DatasetStore';
import { useSessionStore } from './SessionStore';

const THEME_KEY = 'we.theme';
const EDITING_THEME_KEY = 'we.editing-theme';

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
  operationLoading: Accessor<string | null>;
  registerHistoryCallbacks: (callbacks: { onEntry: (snapshot: EditingTheme) => void; onClear: () => void }) => void;
  applySnapshot: (snapshot: EditingTheme) => Promise<void>;

  // Actions
  setCurrentTheme: (themeId: string) => void;
  setDefaultTheme: (themeId: string) => void;
  toggleThemeInstalled: (themeId: string) => Promise<void>;
  /** What actually applies: the session preview if one is active, else the agent's preference. */
  themeScope: Accessor<'global' | 'scoped'>;
  /** The agent's persisted choice, which a preview temporarily masks. */
  themeScopePreference: Accessor<'global' | 'scoped'>;
  /** The same preference as a boolean, for a switch to bind to. */
  themeScopeGlobal: Accessor<boolean>;
  /** True while a session preview is masking the preference — worth saying so in the UI. */
  themeScopePreviewing: Accessor<boolean>;
  /** Preview a scope for this editing session without changing the preference; null drops it. */
  previewThemeScope: (scope: 'global' | 'scoped' | null) => void;
  /**
   * Persist the agent's choice, as the boolean a switch emits. Drops any active preview.
   *
   * A boolean rather than the union because a schema cannot map one to the other: `$if` in an
   * action's args is resolved at render time, where the event does not exist yet, so it would
   * silently pass whichever branch it evaluated once.
   */
  setThemeScopeGlobal: (global: boolean) => Promise<void>;
  /**
   * The theme the scoped template wrapper renders — the theme being edited if there is one, else the
   * space's. Null in global mode, where the template inherits documentElement.
   */
  activeTemplateTheme: Accessor<ThemeData | null>;
  /** Apply a theme temporarily (space default) without persisting to AgentSettings. */
  replaceTheme: (themeId: string) => void;
  /** Restore the persisted personal theme (called when leaving a space with a default theme). */
  restorePersonalTheme: () => void;
  /** Clear the scoped space theme without restoring the personal theme (used when entering a space with no default theme). */
  clearSpaceTheme: () => void;
  startEditing: (themeId?: string) => void;
  /**
   * Change the base preset while editing. Clears explicit multiplier/subtractor overrides so
   * the new preset's natural light/dark mode shows through, then repopulates them from the
   * preset's computed CSS so the Light/Dark buttons reflect reality.
   */
  changeBasePreset: (preset: string | undefined) => void;
  updateEditingOverrides: (overrides: Partial<ThemeOverrides>) => void;
  updateEditingCss: (css: string) => void;
  updateEditingMeta: (fields: { name?: string; icon?: string }) => void;
  cancelEditing: () => void;
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
  publishToMarketplace: (options: {
    name: string;
    description: string;
    icon?: string;
    slug?: string;
    screenshots: File[];
  }) => Promise<boolean>;
  publishToSpace: (perspectiveUuid: string, spaceName: string) => Promise<boolean>;
  loadInstalledThemes: () => Promise<void>;
}

const ThemeContext = createContext<ThemeStore>();

function registryToThemeData(key: string): ThemeData {
  const t = themeRegistry[key as ThemeKey] ?? { name: key, icon: 'palette', css: null, overrides: null };
  return {
    id: key,
    slug: key,
    name: t.name,
    icon: t.icon,
    origin: 'built-in',
    version: 1,
    overrides: t.overrides ? JSON.stringify(t.overrides) : null,
    css: t.css,
  };
}

function encodeToFileData(content: string, name: string, mimeType: string) {
  const bytes = new TextEncoder().encode(content);
  const base64 = btoa(String.fromCharCode(...bytes));
  return { data_base64: base64, name, file_type: mimeType };
}

function getInitialThemeId(): string {
  const saved = typeof window !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
  return saved ?? 'dark';
}

function injectCssString(id: string, css: string) {
  let styleEl = document.getElementById(id) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = id;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}

/** Custom properties the last applied theme set, so the next one removes exactly those. */
let appliedThemeVars = new Set<string>();

function applyThemeToDOM(theme: ThemeData) {
  const overrides: ThemeOverrides = theme.overrides ? JSON.parse(theme.overrides) : {};
  // Normalize legacy fontFamily: 'base' sentinel saved before the font-family fix
  if (overrides.fontFamily === 'base') delete overrides.fontFamily;

  // Set data-we-theme attribute so [data-we-theme='X'] CSS selectors match
  const baseName =
    overrides.themeName && isValidThemeKey(overrides.themeName)
      ? overrides.themeName
      : isValidThemeKey(theme.id)
        ? theme.id
        : 'light';
  document.documentElement.setAttribute('data-we-theme', baseName);

  /**
   * Clear the previous *theme's* overrides — and only those.
   *
   * This wiped `style.cssText` outright, which is a much bigger hammer than "drop the vars I set
   * last time": the root is shared, and the shell publishes layout there too. Applying a theme
   * therefore deleted `--we-dock-right` and `--we-chrome-transition` along with the old theme, so
   * every piece of chrome positioned against a docked panel snapped back to the window edge and
   * stayed there until something happened to make the dock effect run again. Starting theme editing
   * with the notes panel open put the editor underneath it; dragging the panel healed it, which is
   * the tell — a repaint fixing a value nobody had recomputed.
   */
  const styles = themeToStyle(overrides);
  for (const prop of appliedThemeVars) {
    if (!(prop in styles)) document.documentElement.style.removeProperty(prop);
  }
  appliedThemeVars = new Set(Object.keys(styles));

  // Inject CSS vars derived from overrides as inline styles (highest specificity)
  for (const [prop, value] of Object.entries(styles)) {
    document.documentElement.style.setProperty(prop, value as string);
  }

  // Inject the theme's CSS string (component-level rules + any non-parametric vars)
  injectCssString('we-custom-theme-css', theme.css ?? '');
}

const OVERRIDE_CSS_VARS: Partial<Record<keyof ThemeOverrides, string>> = {
  // Color — only independent inputs, not derived tokens (ringColor derives from primary)
  primaryHue: '--we-color-primary-hue',
  successHue: '--we-color-success-hue',
  warningHue: '--we-color-warning-hue',
  dangerHue: '--we-color-danger-hue',
  neutralHue: '--we-color-neutral-hue',
  saturation: '--we-color-saturation',
  neutralSaturation: '--we-color-neutral-saturation',
  subtractor: '--we-color-subtractor',
  multiplier: '--we-color-multiplier',
  // Typography — fontFamily intentionally omitted: the base theme CSS may set it directly,
  // causing populateMissingOverrides to store a font string the user never explicitly chose.
  letterSpacing: '--we-theme-letter-spacing',
  lineHeight: '--we-theme-line-height',
  // Shape
  controlRadius: '--we-theme-control-radius',
  surfaceRadius: '--we-theme-surface-radius',
  inputRadius: '--we-theme-input-radius',
  // Density
  controlPaddingX: '--we-theme-control-padding-x',
  controlGap: '--we-theme-control-gap',
  controlHeight: '--we-theme-control-height-offset',
  surfaceSpacing: '--we-theme-surface-spacing',
  surfaceGap: '--we-theme-surface-gap',
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
  // Every override is read back out of CSS as a string, then narrowed to a number for the
  // numeric ones. Naming that shape once keeps the writes below typed.
  const writable = result as Record<keyof ThemeOverrides, string | number>;
  // Normalize legacy fontFamily: 'base' sentinel saved before the font-family fix
  if (result.fontFamily === 'base') delete result.fontFamily;
  const styles = getComputedStyle(document.documentElement);

  for (const [key, cssVar] of Object.entries(OVERRIDE_CSS_VARS) as [keyof ThemeOverrides, string][]) {
    if (result[key] !== undefined) continue;
    let raw = styles.getPropertyValue(cssVar).trim();
    // --we-color-neutral-hue is defined as var(--we-color-primary-hue) in the token CSS —
    // getComputedStyle returns the var() reference, not the resolved number.
    // Only apply this fallback for neutralHue; other undefined vars (e.g. radius) must not
    // inherit the primary hue value, which would produce invalid CSS when used as a length.
    if (key === 'neutralHue' && (!raw || raw.startsWith('var('))) {
      raw = styles.getPropertyValue('--we-color-primary-hue').trim();
    }
    if (!raw || raw.startsWith('var(')) continue;

    if (key === 'multiplier' || (key as string).endsWith('Hue')) {
      const n = Number(raw);
      if (!isNaN(n)) writable[key] = n;
    } else {
      writable[key] = raw; // percentage string e.g. '60%'
    }
  }

  return result;
}

export function ThemeStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const datasetStore = useDatasetStore();

  const builtInThemes: Accessor<ThemeData[]> = () => Object.keys(themeRegistry).map(registryToThemeData);

  const [installedThemes, setInstalledThemes] = createSignal<ThemeData[]>([]);
  // IDs of custom themes visible in pickers (subset of installedThemes)
  const [visibleThemeIds, setVisibleThemeIds] = createSignal<Set<string>>(new Set());
  const [spaceThemes, setSpaceThemes] = createSignal<ThemeData[]>([]);
  const [currentThemeId, setCurrentThemeId] = createSignal<string>(getInitialThemeId());
  /**
   * Whether a space's theme covers the whole window, or only the space's own content.
   *
   * Three values, one derived from the other two:
   *
   * - `themeScopePreference` — the agent's persisted choice (`AgentSettings.themeScope`).
   * - `themeScopeOverride` — a session-only preview, set by the theme editor's toolbar. The globe
   *   there is a "show me" control used while authoring, and persisting a transient look would
   *   silently rewrite a preference the author would only notice days later, on a settings page
   *   that had quietly changed appearance. Cleared when editing ends.
   * - `themeScope` — what actually applies: the override if one is active, else the preference.
   *
   * Everything downstream reads the derived value, so the toolbar, the settings page and the
   * clearing of an override all take the same path rather than each doing their own DOM work.
   */
  const themeScopePreference = createMemo<'global' | 'scoped'>(() =>
    datasetStore.agentSettings()?.themeScope === 'global' ? 'global' : 'scoped',
  );
  const [themeScopeOverride, setThemeScopeOverride] = createSignal<'global' | 'scoped' | null>(null);
  const themeScope = createMemo<'global' | 'scoped'>(() => themeScopeOverride() ?? themeScopePreference());
  // Space theme data for the template content area — only populated in scoped mode.
  const [editingTheme, setEditingTheme] = createSignal<EditingTheme | null>(null);

  // ── History (delegated to the unified EditorStore history) ──
  const [operationLoading, setOperationLoading] = createSignal<string | null>(null);

  let pendingSnapshot: EditingTheme | null = null;
  let applyingHistoryOp = false;
  let historyCallbacks: { onEntry: (snapshot: EditingTheme) => void; onClear: () => void } | null = null;

  function registerHistoryCallbacks(callbacks: { onEntry: (snapshot: EditingTheme) => void; onClear: () => void }) {
    historyCallbacks = callbacks;
  }

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
    historyCallbacks?.onEntry(s);
  }

  function clearHistory() {
    pendingSnapshot = null;
    historyCallbacks?.onClear();
  }

  async function applySnapshot(snapshot: EditingTheme): Promise<void> {
    pendingSnapshot = null;
    applyingHistoryOp = true;
    setEditingTheme(snapshot);
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
    const perspective = datasetStore.currentDataset()?.handle;
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
    const perspective = datasetStore.rootDataset()?.handle;
    if (!perspective) return;
    try {
      const models = await Theme.findAll(perspective);
      for (const model of models) themeModelMap.set(model.id, model);
      setInstalledThemes(models.map(modelToThemeData));

      // Build visible set from AgentSettings.installedThemes HasMany
      const prefs = datasetStore.agentSettings();
      if (prefs) {
        const refs = prefs.installedThemes || [];
        const trackedIds = new Set<string>();
        for (const ref of refs) {
          const id = typeof ref === 'string' ? ref : (ref as { id?: string }).id;
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
    if (datasetStore.rootDataset()) loadInstalledThemes();
  });

  // Load space themes when the current space perspective changes
  createEffect(() => {
    if (datasetStore.currentDataset()) loadSpaceThemes();
    else setSpaceThemes([]);
  });

  // Apply the agent's default theme when AgentSettings first loads or when the user
  // explicitly changes their default theme. Guard against re-firing on unrelated
  // settings changes (e.g. currentTemplateId updates from template switches), which
  // would otherwise reset the theme to defaultThemeId mid-session.
  let lastAppliedDefaultThemeId: string | undefined;
  createEffect(() => {
    const prefs = datasetStore.agentSettings();
    if (!prefs?.defaultThemeId) return;
    // Don't override currentThemeId while the user is actively editing a theme —
    // agentSettings can update (e.g. when a theme save triggers AD4M subscriptions)
    // and blindly resetting currentThemeId to defaultThemeId would exit editing mode.
    if (untrack(() => editingTheme())) return;
    if (prefs.defaultThemeId === lastAppliedDefaultThemeId) return;
    lastAppliedDefaultThemeId = prefs.defaultThemeId;
    setCurrentThemeId(prefs.defaultThemeId);
  });

  // Keep localStorage in sync with the agent's default theme so the bootscreen
  // can apply it immediately on next launch without waiting for AD4M to load.
  createEffect(() => {
    const prefs = datasetStore.agentSettings();
    if (!prefs?.defaultThemeId) return;
    localStorage.setItem(THEME_KEY, prefs.defaultThemeId);
  });

  /**
   * The agent's own theme — what the shell wears in scoped mode, and what a space falls back to.
   *
   * Prefers `AgentSettings` over `localStorage` so it is reactive; localStorage is the boot answer,
   * before AD4M has loaded, and an effect above keeps the two in step.
   */
  const personalTheme = createMemo<ThemeData>(() =>
    resolveThemeData(datasetStore.agentSettings()?.defaultThemeId || getInitialThemeId()),
  );

  /**
   * Where the theme actually gets applied — two derived answers and one effect each, replacing
   * fourteen imperative `applyThemeToDOM` calls spread across six functions and three effects.
   *
   * Deriving is what fixes the flicker. The scope transition used to write a signal (which the
   * wrapper renders on Solid's next flush) *and* documentElement (immediately), so for one frame the
   * whole window wore the personal theme before the wrapper caught up — the theme visibly went
   * forward, back, and forward again. Both surfaces now read the same signals, so they change in
   * the same flush and there is no intermediate state to paint.
   *
   * It also removes the class of bug where two of those writers disagreed about what should be on
   * screen: there is one answer now, and it is computed rather than remembered.
   */
  const documentTheme = createMemo<ThemeData>(() =>
    themeScope() === 'scoped' ? personalTheme() : (editingTheme() ?? currentTheme()),
  );

  /** What the scoped wrapper renders. Null in global mode — the template inherits documentElement. */
  const activeTemplateTheme = createMemo<ThemeData | null>(() =>
    themeScope() === 'scoped' ? (editingTheme() ?? currentTheme()) : null,
  );

  createEffect(() => applyThemeToDOM(documentTheme()));

  // In scoped mode, inject the space/editing theme's component-level CSS into a separate
  // style tag so [data-we-theme='X'] selectors match inside the scoped wrapper div.
  // The rules self-scope via their attribute selector, so they don't leak into the shell.
  // Cleared when returning to global mode (we-custom-theme-css handles it there).
  createEffect(() => {
    injectCssString('we-scoped-theme-css', activeTemplateTheme()?.css ?? '');
  });

  // Apply initial theme immediately from localStorage — inject CSS string synchronously
  // so the correct theme renders before AD4M loads, without relying on a stylesheet.
  const initialId = getInitialThemeId();
  applyThemeToDOM(registryToThemeData(isValidThemeKey(initialId) ? initialId : 'light'));

  function resolveThemeData(themeId: string): ThemeData {
    return (
      allThemes().find((t) => t.id === themeId) ?? registryToThemeData(isValidThemeKey(themeId) ? themeId : 'light')
    );
  }

  const defaultThemeId: Accessor<string> = () => datasetStore.agentSettings()?.defaultThemeId || 'light';

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
  }

  /**
   * Preview a scope for this editing session without changing the agent's preference.
   *
   * `null` drops the preview and returns to whatever the preference says.
   */
  function previewThemeScope(scope: 'global' | 'scoped' | null) {
    setThemeScopeOverride(scope);
  }

  const themeScopeGlobal = createMemo(() => themeScopePreference() === 'global');
  const themeScopePreviewing = createMemo(() => themeScopeOverride() !== null);

  /** Persist the agent's choice. Any active preview is dropped, since it would mask the new value. */
  async function setThemeScopeGlobal(global: boolean) {
    setThemeScopeOverride(null);
    await datasetStore.updateAgentSettings({ themeScope: global ? 'global' : 'scoped' });
  }

  function setDefaultTheme(themeId: string) {
    localStorage.setItem(THEME_KEY, themeId);
    setCurrentThemeId(themeId);
    datasetStore.updateAgentSettings({ defaultThemeId: themeId });
  }

  async function toggleThemeInstalled(themeId: string) {
    const model = themeModelMap.get(themeId);
    const prefs = datasetStore.agentSettings();
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

  /**
   * Point the display at a space's theme.
   *
   * No longer parks an id that has not loaded yet: `currentTheme` resolves against `allThemes()`, so
   * when the space's themes arrive the memo recomputes and both surfaces follow. Until then it falls
   * back to the agent's own theme rather than a light default, so a slow load reads as "not themed
   * yet" instead of flashing white.
   */
  function replaceTheme(themeId: string) {
    // Don't disturb an editing preview — it outranks the space theme on both surfaces.
    if (untrack(() => editingTheme())) return;
    setCurrentThemeId(themeId);
  }

  function restorePersonalTheme() {
    setCurrentThemeId(datasetStore.agentSettings()?.defaultThemeId || getInitialThemeId());
  }

  function clearSpaceTheme() {
    restorePersonalTheme();
  }

  function startEditing(themeId?: string) {
    const base = themeId ? allThemes().find((t) => t.id === themeId) : currentTheme();
    if (!base) return;
    clearHistory();
    const storedOverrides: ThemeOverrides = base.overrides ? JSON.parse(base.overrides) : {};
    let initialOverrides: ThemeOverrides;
    if (themeScope() === 'scoped') {
      // documentElement has the personal theme in scoped mode, not the space theme being edited.
      // Temporarily apply the editing base so populateMissingOverrides reads the right computed
      // values. Nothing restores it here: `setEditingTheme` below moves `documentTheme`, and its
      // effect rewrites documentElement before the browser paints.
      applyThemeToDOM(base);
      initialOverrides = populateMissingOverrides(storedOverrides);
    } else {
      initialOverrides = populateMissingOverrides(storedOverrides);
    }
    setEditingTheme({ ...base, overrides: JSON.stringify(initialOverrides), isDirty: false });
    sessionStorage.setItem(EDITING_THEME_KEY, themeId ?? currentThemeId());
  }

  function changeBasePreset(preset: string | undefined) {
    const current = editingTheme();
    if (!current) return;
    captureSnapshot();

    const existing: ThemeOverrides = current.overrides ? JSON.parse(current.overrides) : {};

    // Pull mode-defining vars directly from the registry — they are no longer in the CSS
    // files so populateMissingOverrides can't read them from computed style.
    const presetEntry = preset && isValidThemeKey(preset) ? themeRegistry[preset] : null;
    const presetDefaults: ThemeOverrides = presetEntry?.overrides ?? {};

    const updated: ThemeOverrides = {
      ...existing,
      multiplier: presetDefaults.multiplier,
      subtractor: presetDefaults.subtractor,
    };
    if (preset) updated.themeName = preset;
    else delete updated.themeName;

    // Replace the CSS string with the new preset's CSS; keep current CSS if clearing the preset.
    const newCss = presetEntry ? (presetEntry.css ?? '') : (current.css ?? '');

    // Apply to DOM so getComputedStyle reflects the new preset for remaining vars.
    applyThemeToDOM({ ...current, css: newCss, overrides: JSON.stringify(updated) });

    // Repopulate any still-missing vars (radius, spacing, etc.) from computed style.
    const repopulated = populateMissingOverrides(updated);
    setEditingTheme({ ...current, css: newCss, overrides: JSON.stringify(repopulated), isDirty: true });
  }

  function updateEditingOverrides(patch: Partial<ThemeOverrides>) {
    captureSnapshot();
    setEditingTheme((prev) => {
      if (!prev) return prev;
      const existing: ThemeOverrides = prev.overrides ? JSON.parse(prev.overrides) : {};
      const merged = { ...existing, ...patch };
      return { ...prev, overrides: JSON.stringify(merged), isDirty: true };
    });
  }

  function updateEditingCss(css: string) {
    captureSnapshot();
    setEditingTheme((prev) => {
      if (!prev) return prev;
      return { ...prev, css, isDirty: true };
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
    const perspective =
      destination === 'space' ? datasetStore.currentDataset()?.handle : datasetStore.rootDataset()?.handle;
    if (!perspective) {
      toastService.error(`Cannot save theme: no ${destination} perspective available`);
      return false;
    }
    try {
      // For a fork, derive initial overrides from the source theme.
      // Built-in themes have no stored overrides, so we synthesise {themeName: sourceId} so
      // the new custom theme knows which CSS file to load. Then populate slider values from
      // the source theme's computed CSS (it is already applied to the DOM at this point).
      let initialOverrides: ThemeOverrides | null = null;
      if (source) {
        const base: ThemeOverrides = source.overrides ? JSON.parse(source.overrides) : {};
        if (source.origin === 'built-in' && sourceId) base.themeName = sourceId;
        initialOverrides = populateMissingOverrides(base);
      }
      const overridesJson = initialOverrides ? JSON.stringify(initialOverrides) : null;

      const slug = name.toLowerCase().replace(/\s+/g, '-');
      const model = await Theme.create(perspective, {
        name,
        icon,
        slug,
        origin: 'custom',
        version: 1,
        overrides: overridesJson
          ? asFileField(encodeToFileData(overridesJson, 'overrides.json', 'application/json'))
          : null,
        css: source?.css ? asFileField(encodeToFileData(source.css, 'theme.css', 'text/css')) : null,
      });
      themeModelMap.set(model.id, model);
      const data: ThemeData = {
        id: model.id,
        slug,
        name,
        icon,
        origin: 'custom',
        version: 1,
        overrides: overridesJson,
        css: source?.css ?? null,
      };
      setInstalledThemes((prev) => [...prev, data]);
      setVisibleThemeIds((prev) => new Set([...prev, model.id]));
      const prefs = datasetStore.agentSettings();
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
    // The toolbar's scope toggle is a preview for the duration of an editing session — see
    // `themeScopeOverride`. Dropped first, so the DOM restore below reads the agent's real
    // preference rather than whatever was being previewed.
    setThemeScopeOverride(null);
    const editing = editingTheme();

    // Optimistically flush the editing state into the theme signals before clearing
    // editingTheme, so currentTheme() immediately returns the correct data even when
    // the async save (triggered by ThemePanel.onCleanup) is still in-flight.
    if (editing) {
      if (spaceThemes().some((t) => t.id === editing.id)) {
        setSpaceThemes((prev) => prev.map((t) => (t.id === editing.id ? editing : t)));
      } else if (installedThemes().some((t) => t.id === editing.id)) {
        setInstalledThemes((prev) => prev.map((t) => (t.id === editing.id ? editing : t)));
      }
    }

    // Clearing `editingTheme` moves `documentTheme` and `activeTemplateTheme` back to the saved
    // theme, and their effects rewrite both surfaces. The optimistic flush above is what makes that
    // land on the right data while the async save is still in flight.
    setEditingTheme(null);
    sessionStorage.removeItem(EDITING_THEME_KEY);
  }

  async function saveEditingTheme(): Promise<ThemeData | null> {
    commitSnapshot();
    const editing = editingTheme();
    if (!editing) return null;
    const perspective = datasetStore.rootDataset()?.handle;
    if (!perspective) return null;

    try {
      const existing = themeModelMap.get(editing.id);
      if (existing && existing.origin !== 'built-in') {
        existing.name = editing.name ?? '';
        existing.icon = editing.icon ?? '';
        existing.overrides = editing.overrides
          ? asFileField(encodeToFileData(editing.overrides, 'overrides.json', 'application/json'))
          : null;
        existing.css = editing.css ? asFileField(encodeToFileData(editing.css, 'theme.css', 'text/css')) : null;
        await existing.save();
        // Use the current signal state (not the captured `editing`) to avoid overwriting
        // changes made while this async save was in flight.
        const current = editingTheme();
        const saved: ThemeData = {
          id: existing.id,
          slug: existing.slug || '',
          name: current?.name ?? editing.name,
          icon: current?.icon ?? editing.icon,
          origin: existing.origin as ThemeData['origin'],
          version: existing.version ?? 1,
          overrides: current?.overrides ?? editing.overrides,
          css: current?.css ?? editing.css,
        };
        if (spaceThemes().some((t) => t.id === saved.id)) {
          setSpaceThemes((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
        } else {
          setInstalledThemes((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
        }
        setEditingTheme((prev) => (prev ? { ...prev, isDirty: false } : prev));
        // Don't call setCurrentTheme here — the DOM is driven by the editingTheme reactive
        // effect while editing, making this call redundant. More importantly, calling it
        // after the await is unsafe: the user may have switched spaces or exited editing
        // by the time the save lands, and setCurrentTheme would apply the wrong theme.
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
    const perspective = datasetStore.rootDataset()?.handle;
    if (!perspective) return null;

    try {
      const slug = name.toLowerCase().replace(/\s+/g, '-');
      const model = await Theme.create(perspective, {
        name,
        icon,
        slug,
        origin: 'custom',
        version: 1,
        overrides: editing.overrides
          ? asFileField(encodeToFileData(editing.overrides, 'overrides.json', 'application/json'))
          : null,
        css: editing.css ? asFileField(encodeToFileData(editing.css, 'theme.css', 'text/css')) : null,
      });
      themeModelMap.set(model.id, model);
      const data: ThemeData = {
        id: model.id,
        slug,
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
    const marketplacePerspective = datasetStore.marketplaceDataset()?.handle;
    const rootPerspective = datasetStore.rootDataset()?.handle;
    if (!marketplacePerspective || !rootPerspective) return;

    setOperationLoading(`marketplace-install:${marketplaceThemeId}`);
    try {
      const source = await Theme.findOne(marketplacePerspective, { where: { id: marketplaceThemeId } });
      if (!source) {
        toastService.error('Theme not found');
        return;
      }

      const sourceSlug = source.slug || source.name.toLowerCase().replace(/\s+/g, '-');
      // source.overrides/source.css are raw file-storage fields (always resolved to
      // "data:<mime>;base64,..." strings) — decode to plain text before re-encoding,
      // otherwise the data URI itself gets wrapped as the new file's content.
      const sourceOverrides = decodeFileAsString(source.overrides) || null;
      const sourceCss = decodeFileAsString(source.css) || null;

      // Check if already installed by slug — update in place if so
      let existingModel: Theme | undefined;
      for (const model of themeModelMap.values()) {
        if (model.slug === sourceSlug) {
          existingModel = model;
          break;
        }
      }

      if (existingModel) {
        existingModel.name = source.name;
        existingModel.icon = source.icon;
        existingModel.version = source.version;
        existingModel.overrides = sourceOverrides
          ? asFileField(encodeToFileData(sourceOverrides, 'overrides.json', 'application/json'))
          : null;
        existingModel.css = sourceCss ? asFileField(encodeToFileData(sourceCss, 'theme.css', 'text/css')) : null;
        await existingModel.save();
        const updated = modelToThemeData(existingModel);
        setInstalledThemes((prev) => prev.map((t) => (t.id === existingModel!.id ? updated : t)));
        toastService.success(`Theme "${source.name}" updated to v${source.version}`);
        return;
      }

      const model = await Theme.create(rootPerspective, {
        name: source.name,
        icon: source.icon,
        slug: sourceSlug,
        origin: 'marketplace',
        version: source.version,
        overrides: sourceOverrides
          ? asFileField(encodeToFileData(sourceOverrides, 'overrides.json', 'application/json'))
          : null,
        css: sourceCss ? asFileField(encodeToFileData(sourceCss, 'theme.css', 'text/css')) : null,
      });
      themeModelMap.set(model.id, model);
      setInstalledThemes((prev) => [...prev, modelToThemeData(model)]);

      const settings = datasetStore.agentSettings();
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
    const marketplacePerspective = datasetStore.marketplaceDataset()?.handle;
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
    const settings = datasetStore.agentSettings();
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
    icon?: string;
    slug?: string;
    screenshots: File[];
  }): Promise<boolean> {
    const marketplacePerspective = datasetStore.marketplaceDataset()?.handle;
    if (!marketplacePerspective) {
      toastService.error('Marketplace not connected');
      return false;
    }

    const editing = editingTheme();
    const base = editing ?? currentTheme();
    const themeSlug = (options.slug || base.slug || options.name.toLowerCase().replace(/\s+/g, '-'))
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-');
    const themeIcon = options.icon ?? base.icon;

    const existing = await Theme.findOne(marketplacePerspective, { where: { slug: themeSlug } });
    if (existing && existing.author !== session.me()?.did) {
      toastService.error(`A theme with slug "${themeSlug}" already exists in the marketplace by a different author`);
      return false;
    }

    try {
      if (existing) {
        existing.name = options.name;
        existing.description = options.description;
        existing.icon = themeIcon;
        existing.version = (existing.version ?? 1) + 1;
        existing.overrides = base.overrides
          ? asFileField(encodeToFileData(base.overrides, 'overrides.json', 'application/json'))
          : null;
        existing.css = base.css ? asFileField(encodeToFileData(base.css, 'theme.css', 'text/css')) : null;
        await existing.save();

        await existing.setScreenshots([]);
        for (const file of options.screenshots) {
          const fileData = await compressImageToFileData(file, `screenshot-${Date.now()}`);
          const img = await ImageBlock.create(marketplacePerspective, {
            src: asFileField(fileData),
            altText: 'Screenshot',
            version: 1,
          });
          await existing.addScreenshots(img);
        }
        toastService.success(`Theme "${options.name}" updated in marketplace (v${existing.version})`);
      } else {
        const theme = await Theme.create(marketplacePerspective, {
          name: options.name,
          description: options.description,
          icon: themeIcon,
          slug: themeSlug,
          origin: 'marketplace',
          version: 1,
          overrides: base.overrides
            ? asFileField(encodeToFileData(base.overrides, 'overrides.json', 'application/json'))
            : null,
          css: base.css ? asFileField(encodeToFileData(base.css, 'theme.css', 'text/css')) : null,
        });
        for (const file of options.screenshots) {
          const fileData = await compressImageToFileData(file, `screenshot-${Date.now()}`);
          const img = await ImageBlock.create(marketplacePerspective, {
            src: asFileField(fileData),
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
    const perspective = datasetStore.datasets().find((d) => d.id === perspectiveUuid)?.handle;
    if (!perspective) {
      toastService.error('Space not found');
      return false;
    }

    const editing = editingTheme();
    if (!editing) {
      toastService.error('No theme is being edited');
      return false;
    }

    const spaceSlug = editing.slug || editing.name.toLowerCase().replace(/\s+/g, '-');
    const existing = await Theme.findOne(perspective, { where: { slug: spaceSlug } });
    if (existing) {
      toastService.error(`Theme "${editing.name}" is already in "${spaceName}"`);
      return false;
    }

    try {
      await Theme.create(perspective, {
        name: editing.name,
        icon: editing.icon,
        slug: spaceSlug,
        origin: 'shared',
        version: 1,
        overrides: editing.overrides
          ? asFileField(encodeToFileData(editing.overrides, 'overrides.json', 'application/json'))
          : null,
        css: editing.css ? asFileField(encodeToFileData(editing.css, 'theme.css', 'text/css')) : null,
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
    themeScope,
    themeScopePreference,
    themeScopeGlobal,
    themeScopePreviewing,
    previewThemeScope,
    setThemeScopeGlobal,
    activeTemplateTheme,
    themeManagementList,
    editingTheme,
    operationLoading,
    registerHistoryCallbacks,
    applySnapshot,
    setCurrentTheme,
    setDefaultTheme,
    toggleThemeInstalled,
    replaceTheme,
    restorePersonalTheme,
    clearSpaceTheme,
    startEditing,
    changeBasePreset,
    updateEditingOverrides,
    updateEditingCss,
    updateEditingMeta,
    cancelEditing,
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
