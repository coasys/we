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
import { applyThemeVars, parseOverrides, reconcileSurfaces, THEME_SCHEMA_VERSION } from '@we/schema-shared';
import type { SanitiseCssOptions } from '@we/themes/sanitiseCss';
import { sanitiseCss } from '@we/themes/sanitiseCss';
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
  /**
   * Show or hide a custom theme in the pickers. Does not delete it.
   *
   * Takes the value rather than toggling, so a `we-switch` can pass `$event.detail` straight
   * through — the rule `setModuleVisible` documents and this violated: a toggle discards what the
   * switch actually emitted, so the two disagree the moment anything else changes the state.
   */
  setThemeInstalled: (themeId: string, visible: boolean) => Promise<void>;
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
   * Whether a template may bring the theme it was designed for. Defaults on.
   *
   * The suggestion is resolved, never written (see `spaceStore`'s theme precedence), so this flag
   * is one condition in the resolver rather than a setting that has to be unwound — turning it off
   * restores whatever the theme would otherwise have been, immediately.
   */
  useTemplateTheme: Accessor<boolean>;
  /** Persist that choice. Boolean, so a switch can pass `$event.detail` bare. */
  setUseTemplateTheme: (enabled: boolean) => Promise<void>;
  /**
   * The theme the scoped template wrapper renders — the theme being edited if there is one, else the
   * space's. Null in global mode, where the template inherits documentElement.
   */
  activeTemplateTheme: Accessor<ThemeData | null>;
  /**
   * Apply a theme temporarily (space default) without persisting to AgentSettings.
   *
   * `explicit` marks a choice somebody made, as opposed to a recompute — only the former may end an
   * editing session on a different theme. See the implementation for why the difference matters.
   */
  replaceTheme: (themeId: string, opts?: { explicit?: boolean }) => void;
  /** Restore the persisted personal theme (called when leaving a space with a default theme). */
  restorePersonalTheme: () => void;
  /** Clear the scoped space theme without restoring the personal theme (used when entering a space with no default theme). */
  clearSpaceTheme: () => void;
  startEditing: (themeId?: string) => void;
  /**
   * Change the base preset while editing. Takes the new preset's polarity and lightness range so
   * its natural light/dark mode shows through, then repopulates the rest from the preset's computed
   * CSS so the panel's controls reflect reality.
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
  /**
   * Copy a marketplace theme into the current space, so every member gets it — as opposed to
   * installing it for yourself. The counterpart to `templateStore.installToSpace`.
   */
  installToSpace: (marketplaceThemeId: string) => Promise<void>;
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
  refreshSpaceThemes: () => Promise<void>;
  /**
   * Make sure any theme a schema names by `theme: { themeName }` has its stylesheet in the document.
   *
   * Call with a schema before rendering it; idempotent, and safe to call repeatedly.
   */
  requestNamedThemes: (schema: unknown) => void;
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

/**
 * Every theme a schema names, deduplicated.
 *
 * Structural rather than typed on `SchemaNode`, for the same reason `inspectTemplateSurface` walks
 * structurally: a `theme` can sit on any node, including inside routes, slots and `$each` bodies,
 * and a walk that knew the node shape would need revising for every container added. The failure
 * mode of missing one is a section that renders with an attribute and no rules — which is exactly
 * the bug this exists to fix.
 */
function collectThemeNames(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectThemeNames(entry, into);
    return into;
  }
  if (!value || typeof value !== 'object') return into;

  const node = value as { theme?: { themeName?: unknown } };
  const name = node.theme?.themeName;
  if (typeof name === 'string' && name) into.add(name);

  for (const entry of Object.values(value as Record<string, unknown>)) collectThemeNames(entry, into);
  return into;
}

/**
 * Theme ids that can be written into a DOM id and an attribute selector without escaping.
 *
 * A theme installed from a marketplace carries whatever id its author gave it. Rather than work out
 * the CSS escaping rules for the rest, anything outside this set simply does not get injected — the
 * section renders unthemed, which is the failure this feature already had and not a worse one.
 */
const SAFE_THEME_ID = /^[A-Za-z0-9_-]+$/;

function getInitialThemeId(): string {
  const saved = typeof window !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
  return saved ?? 'dark';
}

/**
 * The id meaning "whichever of light and dark the operating system is asking for".
 *
 * Stored like any other theme id, so a preference, a space pin and a share link all carry it
 * without knowing it is special — it is resolved at the point of use rather than at the point of
 * choice, which is the whole difference between following the system and copying it once.
 */
export const SYSTEM_THEME_ID = 'system';

/** Tracks `prefers-color-scheme` for as long as the app is open, not just at boot. */
function createSystemScheme(): Accessor<'light' | 'dark'> {
  if (typeof window === 'undefined' || !window.matchMedia) return () => 'light';
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const [scheme, setScheme] = createSignal<'light' | 'dark'>(query.matches ? 'dark' : 'light');
  const onChange = (e: MediaQueryListEvent) => setScheme(e.matches ? 'dark' : 'light');
  query.addEventListener('change', onChange);
  // Never removed: the store lives for the life of the document, and dropping it on an HMR pass
  // would leave the app pinned to whatever the scheme was when the module reloaded.
  return scheme;
}

/**
 * The attribute marking the element a scoped theme is confined to — the template content wrapper in
 * `TemplateLayout`, which is also the element carrying `data-we-theme` and painting the page.
 *
 * It is a mark of its own rather than a reuse of `data-we-theme`, because the two answer different
 * questions: `data-we-theme` says *which* theme, and changes with it; this says *where the boundary
 * is*, and must be there even for a theme with no name at all.
 */
export const THEME_SCOPE_ATTRIBUTE = 'data-we-theme-scope';
export const THEME_SCOPE_SELECTOR = `[${THEME_SCOPE_ATTRIBUTE}]`;

/**
 * A CSS-identifier-safe prefix for a theme's `@keyframes`, so two themes cannot silently redefine
 * each other's animations — the document theme and a space's scoped theme are both live at once.
 */
function cssNamespace(theme: ThemeData): string {
  return `we-t-${String(theme.id ?? 'anon').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

/**
 * The one door a theme's CSS gets through, and so the one place it is filtered.
 *
 * Sanitising here rather than at install is deliberate. Themes arrive by more routes than the
 * install dialog: they sync in through a shared perspective, so a peer can write a `Theme` model
 * straight into a space and every member wears it without anybody clicking anything. Install is one
 * door; injection is the choke point.
 *
 * `scope` confines the sheet to a container. Passed for a space's theme in scoped mode, so a
 * community's theme cannot restyle the shell around it; omitted for the document theme, which is
 * the agent's own choice about their own window. See `sanitiseCss` for what is removed and why.
 *
 * Built-in themes go through this too. They pass — that is the point of testing them against the
 * same rule rather than exempting them, and it is why the retro theme now carries VT323 instead of
 * importing it.
 */
function injectCssString(id: string, css: string, options: SanitiseCssOptions = {}) {
  let styleEl = document.getElementById(id) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = id;
    document.head.appendChild(styleEl);
  }
  const { css: safe, removed } = css ? sanitiseCss(css, options) : { css: '', removed: [] };
  if (removed.length && import.meta.env?.DEV) {
    console.warn(`[theme] removed from ${id}:`, removed.join('; '));
  }
  styleEl.textContent = safe;
}

/**
 * The last theme written to the document, so an *edit* can be told from a *switch*.
 *
 * Editing keeps the theme's id and changes its parameters; switching changes the id. Only the
 * second is a cross-fade — see `ApplyThemeOptions.crossFade`. Without the distinction every frame
 * of a slider drag re-armed a 250ms fade and the primary button spent the whole drag catching up.
 */
let lastAppliedThemeId: string | null = null;

function applyThemeToDOM(theme: ThemeData) {
  const overrides: ThemeOverrides = parseOverrides(theme.overrides);
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

  /*
    Writing the variables — and clearing exactly the previous theme's — now lives in
    `applyThemeVars`, so a second host gets the same behaviour without re-deriving it. The hazard it
    guards against is documented there: clearing `style.cssText` outright also deletes the layout
    variables the shell publishes on the same root.
  */
  const isSwitch = theme.id !== lastAppliedThemeId;
  lastAppliedThemeId = theme.id;
  applyThemeVars(document.documentElement, overrides, { crossFade: isSwitch });

  // Inject the theme's CSS string (component-level rules + any non-parametric vars). Unscoped: this
  // is the whole window, which is what the document theme is for. Namespaced all the same, so the
  // document theme and a scoped space theme cannot redefine each other's animations.
  injectCssString('we-custom-theme-css', theme.css ?? '', { namespace: cssNamespace(theme) });
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
  lightnessFloor: '--we-color-lightness-floor',
  lightnessCeiling: '--we-color-lightness-ceiling',
  // Typography — fontFamily intentionally omitted: the base theme CSS may set it directly,
  // causing populateMissingOverrides to store a font string the user never explicitly chose.
  letterSpacing: '--we-theme-letter-spacing',
  lineHeight: '--we-theme-line-height',
  // Shape
  controlRadius: '--we-theme-control-radius',
  surfaceRadius: '--we-theme-surface-radius',
  inputRadius: '--we-theme-input-radius',
  avatarRadius: '--we-theme-avatar-radius',
  // Density
  controlPaddingX: '--we-theme-control-padding-x',
  controlGap: '--we-theme-control-gap',
  controlHeightOffset: '--we-theme-control-height-offset',
  surfacePadding: '--we-theme-surface-padding',
  surfaceGap: '--we-theme-surface-gap',
  inputPadding: '--we-theme-input-padding',
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

    // Hues and saturations are plain numbers; a lightness bound is a percentage string.
    if ((key as string).endsWith('Hue') || (key as string).toLowerCase().includes('saturation')) {
      const n = Number(raw);
      if (!isNaN(n)) writable[key] = n;
    } else {
      writable[key] = raw;
    }
  }

  return result;
}

export function ThemeStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const datasetStore = useDatasetStore();

  /*
    "Follow system" is offered as a theme because that is how somebody thinks of it — one more row
    in the same list, chosen the same way. It carries no parameters of its own; `resolveThemeData`
    answers it at the point of use, so the app tracks the OS while it is open rather than copying
    the setting once at the moment of the click.
  */
  const systemThemeEntry = (): ThemeData => ({
    id: SYSTEM_THEME_ID,
    slug: SYSTEM_THEME_ID,
    name: 'Follow system',
    icon: 'circle-half',
    origin: 'built-in',
    version: 1,
    overrides: null,
    css: null,
  });

  const builtInThemes: Accessor<ThemeData[]> = () => [
    systemThemeEntry(),
    ...Object.keys(themeRegistry).map(registryToThemeData),
  ];

  const [installedThemes, setInstalledThemes] = createSignal<ThemeData[]>([]);
  // IDs of custom themes visible in pickers (subset of installedThemes)
  const [visibleThemeIds, setVisibleThemeIds] = createSignal<Set<string>>(new Set());
  const [spaceThemes, setSpaceThemes] = createSignal<ThemeData[]>([]);
  const systemScheme = createSystemScheme();
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

  /*
    In scoped mode, the space/editing theme's component-level CSS goes into its own style tag,
    confined to the template wrapper by `THEME_SCOPE_SELECTOR`.

    That confinement used to be incidental: the rules were left as written and happened to begin
    `[data-we-theme='X']`, which only the wrapper carries — so a theme that simply omitted the
    attribute selector styled the whole window, shell included. Scoping is now enforced rather than
    relied upon, which is what makes a space theme safe to accept from a peer.

    Cleared when returning to global mode (we-custom-theme-css handles it there).
  */
  createEffect(() => {
    const theme = activeTemplateTheme();
    injectCssString('we-scoped-theme-css', theme?.css ?? '', {
      scope: THEME_SCOPE_SELECTOR,
      namespace: theme ? cssNamespace(theme) : undefined,
    });
  });

  /*
    Named themes, injected on demand.

    A schema node carrying `theme: { themeName: 'cyberpunk' }` gets `data-we-theme="cyberpunk"`
    stamped on its wrapper and its colour formulas re-declared — but until now *nothing put that
    theme's stylesheet in the document*. Only two were ever injected: the active theme and the
    space's. So unless the app already happened to be on cyberpunk, the wrapper carried an attribute
    that zero rules in the document matched, and the section came out with the right colours and
    none of the shape — no monospace, no clipped buttons. `CONVENTIONS` lists scoped
    `theme.themeName` as supported, so it was unfinished rather than deliberate.

    One `<style>` per named theme rather than all five at boot, which is what the audit's note ruled
    out: `@keyframes` are global by name (two themes both defining `glitched` would silently
    redefine each other), and a custom marketplace theme could never be handled that way at all.
    Both objections are answered by going through the same sanitiser as everything else — it
    namespaces keyframes per theme and confines the sheet to the elements carrying that attribute.

    Reactive rather than one-shot because `allThemes()` fills in over time: a space's themes arrive
    after the space does, so a name that resolves to nothing on the first pass resolves later.
  */
  const [requestedThemeNames, setRequestedThemeNames] = createSignal<string[]>([]);

  function requestNamedThemes(schema: unknown) {
    const names = collectThemeNames(schema);
    if (!names.size) return;
    setRequestedThemeNames((previous) => {
      const next = new Set(previous);
      const before = next.size;
      for (const name of names) if (SAFE_THEME_ID.test(name)) next.add(name);
      return next.size === before ? previous : [...next];
    });
  }

  createEffect(() => {
    const themes = allThemes();
    for (const name of requestedThemeNames()) {
      const theme = themes.find((candidate) => candidate.id === name || candidate.slug === name);
      // Scoped to the attribute the renderer stamps, so a named theme reaches its own section and
      // nothing else — including when the template naming it is a stranger's.
      injectCssString(`we-named-theme-css-${name}`, theme?.css ?? '', {
        scope: `[data-we-theme='${name}']`,
        namespace: `we-t-${name}`,
      });
    }
  });

  // Apply initial theme immediately from localStorage — inject CSS string synchronously
  // so the correct theme renders before AD4M loads, without relying on a stylesheet.
  const initialId = getInitialThemeId();
  applyThemeToDOM(registryToThemeData(isValidThemeKey(initialId) ? initialId : 'light'));

  function resolveThemeData(themeId: string): ThemeData {
    // `system` is not a theme, it is a question — asked here rather than remembered, so the answer
    // follows the OS while the app is open instead of being fixed at whatever it was on the click.
    const id = themeId === SYSTEM_THEME_ID ? systemScheme() : themeId;
    return allThemes().find((t) => t.id === id) ?? registryToThemeData(isValidThemeKey(id) ? id : 'light');
  }

  /*
    A memo, not a bare accessor, and the distinction matters well beyond this store.

    `agentSettings` is a `{ equals: false }` signal — it notifies on every write, because
    `updateAgentSettings` mutates the settings object in place and re-sets it, so identity cannot be
    the test. A bare accessor passes that straight through: anything reading this inside an effect
    became a subscriber to every unrelated preference write. `spaceStore`'s theme resolution reads it,
    so toggling the theme scope switch re-ran the whole resolution and overwrote the theme the agent
    had just picked. Memoising collapses "settings changed" back to "*this* value changed".
  */
  const defaultThemeId: Accessor<string> = createMemo(() => datasetStore.agentSettings()?.defaultThemeId || 'light');

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

  /*
    Defaults **on** when unset, which is why this reads `!== false` rather than coercing.

    An agent whose settings predate the field, or who has never opened the switch, has no opinion —
    and the useful default is that a template designed for a particular look arrives in it. A plain
    truthiness read would make "never decided" mean off, which is the opposite.
  */
  const useTemplateTheme = createMemo(() => datasetStore.agentSettings()?.useTemplateTheme !== false);

  async function setUseTemplateTheme(enabled: boolean) {
    await datasetStore.updateAgentSettings({ useTemplateTheme: enabled });
  }

  function setDefaultTheme(themeId: string) {
    localStorage.setItem(THEME_KEY, themeId);
    setCurrentThemeId(themeId);
    datasetStore.updateAgentSettings({ defaultThemeId: themeId });
  }

  async function setThemeInstalled(themeId: string, visible: boolean) {
    const model = themeModelMap.get(themeId);
    const prefs = datasetStore.agentSettings();
    if (!model || !prefs) return;

    try {
      if (visible) {
        await prefs.addInstalledThemes(model);
        setVisibleThemeIds((prev) => new Set([...prev, themeId]));
      } else {
        await prefs.removeInstalledThemes(model);
        setVisibleThemeIds((prev) => {
          const next = new Set(prev);
          next.delete(themeId);
          return next;
        });
      }
    } catch (error) {
      // Was `.catch(() => {})`, which moved the switch and wrote nothing: the picker showed the new
      // state until the next boot restored the old one.
      console.error('ThemeStore: could not change theme visibility', error);
      toastService.error('Could not save that change.');
      throw error;
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
  function replaceTheme(themeId: string, opts?: { explicit?: boolean }) {
    /*
      An editing session outranks the space theme on both surfaces, so a recompute must not steal
      it: walking into a space while editing should keep showing what you are editing.

      A *pick* is the opposite, and the two arrive here by the same door. Without the distinction
      the theme picker looked broken — it writes the pin, the recompute lands here, the guard drops
      it, `currentThemeId` never moves, and nothing downstream notices; the editing theme kept
      masking `documentTheme` and the picker appeared stuck on it. Told which it is, an explicit
      choice moves `currentThemeId`, and EditorStore's effect on that ends the session and closes
      the panel — flushing any debounced edit on the way out.
    */
    if (!opts?.explicit && untrack(() => editingTheme())) return;
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
    const storedOverrides: ThemeOverrides = parseOverrides(base.overrides);
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

    const existing: ThemeOverrides = parseOverrides(current.overrides);

    // Pull mode-defining vars directly from the registry — they are no longer in the CSS
    // files so populateMissingOverrides can't read them from computed style.
    const presetEntry = preset && isValidThemeKey(preset) ? themeRegistry[preset] : null;
    const presetDefaults: ThemeOverrides = presetEntry?.overrides ?? {};

    const updated: ThemeOverrides = {
      ...existing,
      polarity: presetDefaults.polarity,
      lightnessFloor: presetDefaults.lightnessFloor,
      lightnessCeiling: presetDefaults.lightnessCeiling,
    };

    /*
      Reconcile the surface stack when the preset flips polarity.

      `...existing` carries the author's own role pins forward, which is right for almost all of
      them. It is wrong for the four surfaces: a stack tuned for dark is not merely stale under a
      light preset, it is upside down. Choosing Dark and then picking a light base preset left
      near-black cards under a light theme's near-black text — 1.12:1, three clicks in.
    */
    updated.roles = reconcileSurfaces(existing, presetDefaults);
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
      const existing: ThemeOverrides = parseOverrides(prev.overrides);
      // Stamped on write, not on read: `parseOverrides` migrates a theme in memory and leaves what
      // is stored alone, so an installed theme nobody edits is never rewritten under them. The
      // moment an author does change something, what they save is current.
      const merged = { ...existing, ...patch, schemaVersion: THEME_SCHEMA_VERSION };
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
        const base: ThemeOverrides = parseOverrides(source.overrides);
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
      // A space theme lives in spaceThemes, not installedThemes — drop it from
      // both lists so the deletion is visible without reloading the space.
      setSpaceThemes((prev) => prev.filter((t) => t.id !== themeId));
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

      /*
        Check if already installed by slug — update in place if so.

        Constrained to models that are actually *installed*, which means the ones living in the root
        perspective. `themeModelMap` is also filled by `loadSpaceThemes`, from every space visited
        this session and never pruned, so an unconstrained slug match could bind `existingModel` to a
        theme belonging to a *space* — and `save()` would then publish marketplace content into that
        space, for every member, while the toast said "updated" and the installed list showed nothing
        new. Slugs are not unique across perspectives and were never meant to be.
      */
      const installedIds = new Set(installedThemes().map((theme) => theme.id));
      let existingModel: Theme | undefined;
      for (const model of themeModelMap.values()) {
        if (installedIds.has(model.id) && model.slug === sourceSlug) {
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

  /**
   * Copy a marketplace theme into the current space, so every member of that community gets it.
   *
   * The counterpart to `templateStore.installToSpace`, and it did not exist. The default template's
   * space-settings page browsed marketplace *templates* and installed them into the space, then
   * browsed marketplace *themes* and installed them into your personal library — the same button,
   * on the same page, meaning two different things. Nobody chose that; the space-scoped half was
   * simply missing, so the page reached for the account-scoped one.
   *
   * It matters beyond the inconsistency: writing to your root perspective is an act on your account,
   * which is why `installFromMarketplace` sits at the chrome tier. A community template can offer
   * "give this space a theme" and cannot offer "put this in your library".
   */
  async function installToSpace(marketplaceThemeId: string): Promise<void> {
    const marketplacePerspective = datasetStore.marketplaceDataset()?.handle;
    const spacePerspective = datasetStore.currentDataset()?.handle;
    if (!marketplacePerspective || !spacePerspective) {
      toastService.error('Cannot install: no active space or marketplace not connected');
      return;
    }

    setOperationLoading(`space-install:${marketplaceThemeId}`);
    try {
      const source = await Theme.findOne(marketplacePerspective, { where: { id: marketplaceThemeId } });
      if (!source) {
        toastService.error('Theme not found in marketplace');
        return;
      }

      const slug = source.slug || source.name.toLowerCase().replace(/\s+/g, '-');
      const existing = await Theme.findOne(spacePerspective, { where: { slug } });
      if (existing) {
        toastService.error(`"${source.name}" is already in this space`);
        return;
      }

      // Raw file-storage fields resolve to `data:<mime>;base64,...` strings, so they are decoded
      // before re-encoding — otherwise the data URI itself becomes the new file's content.
      const overrides = decodeFileAsString(source.overrides) || null;
      const css = decodeFileAsString(source.css) || null;

      await Theme.create(spacePerspective, {
        name: source.name,
        description: source.description,
        icon: source.icon,
        slug,
        origin: 'shared',
        version: source.version || 1,
        overrides: overrides ? asFileField(encodeToFileData(overrides, 'overrides.json', 'application/json')) : null,
        css: css ? asFileField(encodeToFileData(css, 'theme.css', 'text/css')) : null,
      });

      await loadSpaceThemes();
      toastService.success(`"${source.name}" added to this space`);
    } catch (error) {
      console.error('ThemeStore: installToSpace error', error);
      toastService.error(`Failed to add theme: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setOperationLoading(null);
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
    useTemplateTheme,
    setUseTemplateTheme,
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
    setThemeInstalled,
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
    installToSpace,
    uninstallTheme,
    deleteMarketplaceTheme,
    publishToMarketplace,
    publishToSpace,
    loadInstalledThemes,
    // Schema-facing alias: templates re-pull the space theme list after a
    // mutation they performed themselves (e.g. deleting a space theme),
    // mirroring templateStore.refreshSpaceTemplates.
    refreshSpaceThemes: loadSpaceThemes,
    requestNamedThemes,
  };

  return <ThemeContext.Provider value={store}>{props.children}</ThemeContext.Provider>;
}

export function useThemeStore(): ThemeStore {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeStore must be used within ThemeStoreProvider');
  return ctx;
}

export default ThemeStoreProvider;
