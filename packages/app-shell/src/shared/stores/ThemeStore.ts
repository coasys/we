import { readBootSnapshot } from '@shared/bundles/bootSnapshot';
import { readDeviceApp } from '@shared/bundles/deviceApp';
import { offeredInPickers } from '@shared/devOnlyOffers';
import { appTemplateRegistry } from '@shared/registries/appTemplates';
import { seedBundleAppId, seedBundleApps } from '@shared/registries/seedBundles';
import { devOnlyThemeIds, isValidThemeKey, themeRegistry } from '@shared/registries/themeRegistry';
import { getSeed } from '@shared/seedRegistry';
import { createLibraryFlow, type InstallDestination, type LibraryEntity } from '@shared/stores/libraryFlow';
import type { NewRecord } from '@we/backend-shared';
import type { ThemeData } from '@we/entities';
import { AGENT_DEFAULT, asFileField, decodeFileAsString, FOLLOW_SPACE, modelToThemeData, Theme } from '@we/entities';
import type { Accessor, ReactivityPort } from '@we/reactivity';
import type { BundleTheme, DisplayPreferences, ThemeOverrides } from '@we/schema-shared';
import {
  applyThemeVars,
  parseOverrides,
  readThemeSettings,
  reconcileSurfaces,
  registerNamedThemes,
  setDisplayPreferences,
  // Aliased: the store has a `templateThemeId` of its own, the id the template surface is asking for.
  templateThemeId as themeOfTemplate,
  THEME_SCHEMA_VERSION,
  themeParametersToStyle,
  themeSides,
} from '@we/schema-shared';
import type { SanitiseCssOptions } from '@we/themes/sanitiseCss';
import { sanitiseCss } from '@we/themes/sanitiseCss';

import { distinctSignal } from '../distinctSignal';
import { safeMode } from '../safeMode';
import { overrideOptions, type SpaceAppearance, type SpaceOverride, themeResolutionInputOf } from '../spaceAppearance';
import { resolveSpaceTheme, type SpaceThemeHiddenBy, spaceThemeHiddenBy as hiddenBy } from '../themeResolution';
import type { Toasts } from '../toasts';
import type { DatasetStore } from './DatasetStore';
import type { SessionStore } from './SessionStore';

const THEME_KEY = 'we.theme';
/*
  The two halves of "Follow system", cached the same way the current theme is.

  The pair lives in AgentSettings, which arrives seconds after the first paint, and the whole point
  of following the system is that the answer is given at the moment of use — including the first
  one. Without a cache the boot screen resolves `system` to the built-in of that polarity and then
  swaps to the agent's own theme once the settings land, which is the light-flash bug wearing a
  different hat.
*/
const SYSTEM_LIGHT_KEY = 'we.system-light';
const SYSTEM_DARK_KEY = 'we.system-dark';
const EDITING_THEME_KEY = 'we.editing-theme';
/** The person's display needs, cached for the first paint like the theme itself. */
const DISPLAY_KEY = 'we.display';

/** `light`, `dark`, or `system` to follow the machine — the colour-scheme axis of the display needs. */
export type ThemeMode = 'light' | 'dark' | 'system';

function asThemeMode(value: string | null | undefined): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** Stored display preferences, or none for anything that is not an object. */
function displayFrom(stored: unknown): DisplayPreferences {
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

/** The display preferences this device cached, which is text, since that is what localStorage holds. */
function cachedDisplay(): DisplayPreferences {
  if (typeof window === 'undefined') return {};
  try {
    return displayFrom(JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? 'null'));
  } catch {
    return {};
  }
}

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

/** What the theme store reads of the templates — see `ThemeStore.provideTemplates`. */
export interface ThemeTemplates {
  /** The first theme the app in use names, when it should stand in for the agent's default. */
  appTheme: () => string | undefined;
  /** The template on screen. */
  onScreen: () => { id?: string; meta?: { themeId?: string; themeIds?: string[] } } | undefined;
}

export interface ThemeStore {
  // State
  builtInThemes: Accessor<ThemeData[]>;
  /** Modes that resolve to a theme rather than being one — currently just "Follow system". */
  automaticThemes: Accessor<ThemeData[]>;
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
  setDefaultTheme: (themeId: string) => Promise<boolean>;
  /**
   * Lend this store what it needs of the templates: the theme the app in use offers first, which
   * stands in for the agent's default until they choose one, and the template on screen, whose
   * suggested theme a space's theme resolution reads. `TemplateStore` knows both and is composed
   * after this store, so it hands them back — the same arrangement as
   * `appStore.provideInstalledModules`.
   */
  provideTemplates: (templates: ThemeTemplates) => void;
  /**
   * Lend this store the spaces' records and this agent's overrides for them, which the space store
   * holds and is composed after this store to lend. See `spaceAppearance.ts`.
   */
  provideSpaceAppearance: (appearance: SpaceAppearance) => void;
  /** Options for the per-space theme override picker, including a "follow the space" entry. */
  themeOverrideOptions: Accessor<{ label: string; value: string }[]>;
  /**
   * Has this agent pinned a theme for the space on screen that diverges from what would otherwise
   * apply — is there something for a "reset" to undo?
   */
  spaceThemePinned: Accessor<boolean>;
  /**
   * What keeps this agent from seeing the space on screen's own theme: `'pin'`, `'agent-default'`,
   * `'template'`, or `''` when nothing does.
   */
  spaceThemeHiddenBy: Accessor<SpaceThemeHiddenBy>;
  /** Override the theme this agent sees in one space; FOLLOW_SPACE follows its default. Private. */
  setSpaceThemeOverride: (themeId: string, spaceUuid?: string) => Promise<void>;
  /**
   * Apply a theme where the agent is: pinned to the space on screen, or their global default when
   * there is no space. What the rail's theme picker calls.
   */
  applyTheme: (themeId: string) => Promise<void>;
  /** Drop the theme pin for the space on screen, returning it to whatever would otherwise apply. */
  clearSpaceThemePin: () => Promise<void>;
  /**
   * Say why a default just set for the space on screen is not what this agent sees, if something
   * hides it. Called by the space store when the default is set. Wiring, not template API.
   */
  explainSpaceThemeHidden: () => void;
  /**
   * The role the theme editor should jump to, kebab-case, or empty.
   *
   * Set by whatever sent somebody to the panel — the inspector's role readout, chiefly, where the
   * whole gesture is "this colour is wrong, take me to it". Without it the jump lands at the top of
   * a panel holding some forty roles with nothing marking the one you came for, which is a worse
   * answer than not offering the jump.
   *
   * Notifies on every set, including a repeat of the same role: clicking the same chip twice is a
   * person saying "again, I lost it", and a signal that dedupes would answer the second click with
   * silence.
   */
  focusedRole: Accessor<string>;
  /** Ask the theme editor to reveal a role. Kebab-case, as a schema and the readout spell it. */
  focusRole: (role: string) => void;
  /**
   * Which two themes "Follow system" chooses between, and the ids currently on each side.
   *
   * `light`/`dark` are the ids as *chosen*, empty for a side left at the built-in — what the control
   * that sets them needs, so "Built-in" shows as selected rather than as an option that appears to
   * do nothing. `resolved` is which of the two the OS is asking for right now.
   */
  systemThemes: Accessor<{ light: string; dark: string; resolved: 'light' | 'dark' }>;
  /** Set one side of the pair. An empty id returns that side to the built-in. */
  setSystemTheme: (polarity: 'light' | 'dark', themeId: string) => Promise<boolean>;
  /**
   * Which side of a two-sided theme the agent wears: `light`, `dark` or `system`. Applies to every
   * theme that has both sides (`ThemeOverrides.light`/`dark`); a theme with one look ignores it.
   */
  themeMode: Accessor<ThemeMode>;
  /** The side worn right now — `themeMode`, with `system` answered by the machine. */
  themeSide: Accessor<'light' | 'dark'>;
  /** The sides the theme on screen carries — what decides whether a Light / Dark / System choice is offered. */
  currentThemeSides: Accessor<('light' | 'dark')[]>;
  /** Choose the side, for this agent everywhere. */
  setThemeMode: (mode: ThemeMode) => Promise<boolean>;
  /**
   * The person's display needs — colour scheme, contrast, text size, density, motion — applied over
   * every theme on screen, a space's included. See `DisplayPreferences` in @we/themes.
   */
  displayPreferences: Accessor<DisplayPreferences>;
  /** Set one display need for this agent everywhere; `system` or null returns it to the default. */
  setDisplayPreference: <K extends keyof DisplayPreferences>(
    key: K,
    value: DisplayPreferences[K] | null,
  ) => Promise<boolean>;
  /** Options for either side, with a "Built-in" entry a schema could not prepend itself. */
  systemThemeOptions: Accessor<{ label: string; value: string }[]>;
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
  /**
   * True while the template's theme cannot yet be resolved and might still arrive.
   *
   * Whatever applies the scoped theme should hold what is on screen rather than paint a fallback —
   * see the note where it is computed.
   */
  templateThemePending: Accessor<boolean>;
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
  /**
   * The naming dialog for a new theme or a fork of one, while it is open: the theme forked (empty for
   * a new one) and what the copy starts as. The host draws the dialog, as it draws the template one,
   * so asking for it — from the rail's picker or a space's own list — writes nothing: the theme is
   * made by a press in the host's dialog.
   */
  themeFork: Accessor<{ source: string; name: string; icon: string } | null>;
  /** Open that dialog for a fork of `sourceId`, or for a new theme without one. */
  startThemeFork: (sourceId?: string) => void;
  /** Close it without making anything. */
  cancelThemeFork: () => void;
  saveEditingTheme: () => Promise<ThemeData | null>;
  saveEditingThemeAs: (name: string, icon: string) => Promise<ThemeData | null>;
  deleteTheme: (themeId: string) => Promise<void>;
  installFromMarketplace: (marketplaceThemeId: string) => Promise<void>;
  /**
   * Write a bundle's theme into the agent's library, updating the one an earlier install of the same
   * bundle wrote. Resolves with the theme's id. Throws if the write fails. Wiring, not template API.
   */
  writeLibraryTheme: (theme: BundleTheme) => Promise<string>;
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

function registryToThemeData(key: string): ThemeData {
  const t = themeRegistry[key] ?? { name: key, icon: 'palette', css: null, overrides: null };
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
  if (saved && !UNCHOSEN_THEME_IDS.has(saved)) return saved;
  // Nobody has chosen on this device: the app it last ran, else the app the deployment opens in.
  return readDeviceApp()?.themes?.[0]?.id ?? seedAppThemeId() ?? 'dark';
}

/**
 * What `AgentSettings.defaultThemeId` holds for an agent who has never chosen: the model's default
 * (`'default'`, which names no theme) or nothing. Read as "no choice", so the app's own theme can
 * stand in for it.
 */
const UNCHOSEN_THEME_IDS = new Set(['', 'default']);

/** The first theme the deployment's own app names (the seed's `host.ui.app`, or its first bundle's app). */
function seedAppThemeId(): string | undefined {
  let appId: string | undefined;
  try {
    appId = getSeed().host?.ui?.app || seedBundleAppId;
  } catch {
    appId = seedBundleAppId;
  }
  if (!appId) return undefined;
  const app = seedBundleApps[appId] ?? appTemplateRegistry[appId];
  return themeOfTemplate(app?.meta);
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
function createSystemScheme(reactivity: ReactivityPort): Accessor<'light' | 'dark'> {
  if (typeof window === 'undefined' || !window.matchMedia) return () => 'light';
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const [scheme, setScheme] = distinctSignal<'light' | 'dark'>(reactivity, query.matches ? 'dark' : 'light');
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
  /*
    The whole theme, both sides included: `applyThemeVars` picks the side from the person's display
    preferences, and from the theme editor's preview of the side being edited. Folding it to one side
    here first, from the preference alone, left the editor's preview nothing to choose between — the
    panel switched sides and the app stayed where it was.
  */
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

/**
 * For any override keys missing from `overrides`, reads their actual computed CSS values so
 * sliders initialise at the position matching what the user sees, not hardcoded defaults.
 *
 * `from` is the element carrying the theme being read. It used to be documentElement, always, with
 * the caller responsible for applying the theme there first — which is exactly what went wrong: in
 * scoped mode the theme being edited is *not* the document's, so `startEditing` applied it to the
 * document to take this reading and relied on a later effect to put it back. That effect only fires
 * in global mode, where `documentTheme` depends on the theme being edited. In scoped mode it
 * depends on `personalTheme`, which had not changed, so nothing re-ran and the app chrome simply
 * kept the theme being edited until the scope toggle was flipped and back.
 *
 * Reading from a caller-supplied element removes the need to disturb anything.
 */
function populateMissingOverrides(
  overrides: ThemeOverrides,
  from: HTMLElement = document.documentElement,
): ThemeOverrides {
  const result = { ...overrides };
  // Normalize legacy fontFamily: 'base' sentinel saved before the font-family fix
  if (result.fontFamily === 'base') delete result.fontFamily;
  // Read through the settings registry, which says for each setting where it lives and how its value
  // comes back — the second, drifted copy of that map this used to keep is gone.
  return readThemeSettings(result, getComputedStyle(from));
}

/** What the theme store reads off the stores composed before it. */
export interface ThemeStoreDeps {
  reactivity: ReactivityPort;
  toasts: Toasts;
  sessionStore: Pick<SessionStore, 'devTools' | 'me'>;
  datasetStore: Pick<
    DatasetStore,
    'agentSettings' | 'updateAgentSettings' | 'currentDataset' | 'rootDataset' | 'marketplaceDataset' | 'datasets'
  >;
}

export function createThemeStore(deps: ThemeStoreDeps): ThemeStore {
  const { reactivity, toasts } = deps;
  const { memo, effect, untrack, onCleanup } = reactivity;
  const session = deps.sessionStore;
  const datasetStore = deps.datasetStore;
  /** A signal that skips a write equal to what it holds, as every signal here did under Solid. */
  const signal = <T>(initial: T) => distinctSignal<T>(reactivity, initial);

  /*
    The theme an agent who has not chosen one wears: the one the app in use offers first, else what
    this device last wore. Their own choice, once made, always wins — see `UNCHOSEN_THEME_IDS`.
  */
  const [templates, setTemplates] = signal<ThemeTemplates | null>(null);
  const provideTemplates = (lent: ThemeTemplates) => setTemplates(lent);
  const appThemeLookup = () => templates()?.appTheme ?? (() => undefined);
  const chosenDefaultThemeId = (): string | undefined => {
    const own = datasetStore.agentSettings()?.defaultThemeId;
    return own && !UNCHOSEN_THEME_IDS.has(own) ? own : undefined;
  };
  const agentDefaultThemeId = (): string => chosenDefaultThemeId() ?? appThemeLookup()() ?? getInitialThemeId();
  /** The themes the device remembers from the app it last ran, for the moments before they load. */
  const rememberedThemes = readDeviceApp()?.themes ?? [];

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

  /** Every built-in theme this build has — what a theme is looked up in by name. */
  const registryThemes = (): ThemeData[] => Object.keys(themeRegistry).map(registryToThemeData);
  /*
    The ones offered: a showcase theme only while developer tools are showing — see
    `offeredInPickers`. A space already using one still resolves it, through `registryThemes` in the
    named-theme lookup below.
  */
  const builtInThemes: Accessor<ThemeData[]> = () =>
    offeredInPickers(registryThemes(), session.devTools(), devOnlyThemeIds);

  /**
   * "Follow system", on its own, because it is not one of the built-ins.
   *
   * It used to be the first entry of `builtInThemes`, which put it at the head of the only section a
   * fresh agent sees — the most prominent row in the picker, above every actual theme, under a
   * heading that says it is a built-in one. It is not a theme at all: it carries no parameters and
   * is answered at the point of use by asking the operating system. The first question anyone asked
   * about it was what it was.
   *
   * An array rather than a single value so the picker's existing section helper can render it, and
   * so a second automatic mode later — following a schedule, say — needs no new machinery.
   */
  const automaticThemes: Accessor<ThemeData[]> = () => [systemThemeEntry()];

  const [installedThemes, setInstalledThemes] = signal<ThemeData[]>([]);
  /**
   * Whether custom themes have been read from the root dataset yet.
   *
   * Boot caches the *id* of the theme to wear, which is enough for a built-in — the registry holds
   * its parameters — and not enough for a custom one, where an id without its record means nothing.
   * So there is a window on every load where a pinned personal theme is referenced by an id nothing
   * can answer, and the resolver has to make something up.
   *
   * What it made up was `light`, and since the token CSS's `:root` defaults *are* the light theme, a
   * wrong answer here is maximally visible: dark boot screen, white flash, then the real theme.
   * Intermittent, because it is a race — sometimes the records arrive first.
   */
  const [themesLoaded, setThemesLoaded] = signal(false);
  // IDs of custom themes visible in pickers (subset of installedThemes)
  const [visibleThemeIds, setVisibleThemeIds] = signal<Set<string>>(new Set());

  /*
    The theme the app somebody is in was drawn with last time, until the installed themes have loaded
    — the other half of `TemplateStore`'s boot snapshot, which brings the templates naming it. Without
    it the app arrived on time and in the agent's own theme, and changed colour a few seconds later.
    Loading the real list replaces it; `themesLoaded` is left alone, so nothing else mistakes this
    for the answer.
  */
  effect(() => {
    if (themesLoaded()) return;
    const remembered = readBootSnapshot(session.me()?.did)?.themes;
    if (!remembered?.length) return;
    setInstalledThemes(remembered);
    setVisibleThemeIds(new Set(remembered.map((theme) => theme.id)));
  });
  const [spaceThemes, setSpaceThemes] = signal<ThemeData[]>([]);
  const systemScheme = createSystemScheme(reactivity);

  /*
    The side a two-sided theme is worn on. The agent's own setting once it has loaded; before that,
    what this device last wore, so the first paint does not flip sides when the settings land.
  */
  const displayPreferences = memo<DisplayPreferences>(() => {
    const settings = datasetStore.agentSettings();
    return settings ? displayFrom(settings.displayPreferences) : cachedDisplay();
  });
  /*
    Handed to @we/themes, which lays them over every theme it applies and redoes every theme on
    screen when they change — a space's and a node's as well as this store's. Set once now, from the
    cache, so the first paint already has them.
  */
  setDisplayPreferences(untrack(displayPreferences));
  effect(() => setDisplayPreferences(displayPreferences()));
  function setDisplayPreference<K extends keyof DisplayPreferences>(
    key: K,
    value: DisplayPreferences[K] | null,
  ): Promise<boolean> {
    const next: DisplayPreferences = { ...displayPreferences() };
    if (value === null || value === undefined || value === 'system') delete next[key];
    else next[key] = value;
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(next));
    // Nothing chosen is no value at all, so a later default for an axis reaches this person too.
    return datasetStore.updateAgentSettings({ displayPreferences: Object.keys(next).length ? next : null });
  }
  const themeMode = memo<ThemeMode>(() => asThemeMode(displayPreferences().colorScheme));
  const themeSide = memo<'light' | 'dark'>(() => {
    const mode = themeMode();
    return mode === 'system' ? systemScheme() : mode;
  });
  function setThemeMode(mode: ThemeMode): Promise<boolean> {
    return setDisplayPreference('colorScheme', asThemeMode(mode));
  }

  /*
    These three sit *after* `systemScheme` deliberately.

    A memo may run its computation on creation, so one reading `systemScheme` from above the line
    that defines it throws `Cannot access before initialization` and takes the whole store with it —
    a blank app, from an ordering mistake that typechecks.
  */
  /**
   * Which theme "Follow system" currently means.
   *
   * `system` used to resolve straight to the string `'light'` or `'dark'`, which happened to be the
   * ids of two built-ins — so an agent who had made their own dark theme could follow their machine
   * or wear their own theme, never both, and the setting that reads as "match my machine" quietly
   * meant "match my machine, using somebody else's palette".
   *
   * An unset half falls back to the built-in of that polarity, which is what every existing agent
   * has and exactly what this did before. The localStorage copies answer the frames before
   * AgentSettings arrives; without them the boot screen resolves the built-in and then swaps.
   */
  const systemThemeId = memo(() => {
    const prefs = datasetStore.agentSettings();
    const dark = systemScheme() === 'dark';
    const stored = prefs?.[dark ? 'systemDarkThemeId' : 'systemLightThemeId'];
    const cached =
      typeof window !== 'undefined' ? localStorage.getItem(dark ? SYSTEM_DARK_KEY : SYSTEM_LIGHT_KEY) : null;
    const chosen = stored || cached || '';
    // Never `system` itself: a pair pointing at the thing being resolved would not terminate.
    return chosen && chosen !== SYSTEM_THEME_ID ? chosen : dark ? 'dark' : 'light';
  });

  /**
   * Both sides of the pair as *chosen*, for the control that sets them.
   *
   * Deliberately not resolved: an unset side reads as `''`, which is the "Built-in" option, so the
   * select shows the choice that was made and returning to it visibly does something. Reporting the
   * fallback here instead would show "Light" for an unset light side — truthful about the outcome
   * and wrong about the control, since picking "Built-in" would then appear to do nothing at all.
   * `systemThemeId` is where the fallback belongs, and it is the only place it happens.
   */
  const systemThemes = memo(() => {
    const prefs = datasetStore.agentSettings();
    const side = (polarity: 'light' | 'dark') => {
      const stored = prefs?.[polarity === 'dark' ? 'systemDarkThemeId' : 'systemLightThemeId'];
      const cached =
        typeof window !== 'undefined'
          ? localStorage.getItem(polarity === 'dark' ? SYSTEM_DARK_KEY : SYSTEM_LIGHT_KEY)
          : null;
      const chosen = stored || cached || '';
      return chosen === SYSTEM_THEME_ID ? '' : chosen;
    };
    return { light: side('light'), dark: side('dark'), resolved: systemScheme() };
  });

  const [currentThemeId, setCurrentThemeId] = signal<string>(getInitialThemeId());
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
  const themeScopePreference = memo<'global' | 'scoped'>(() =>
    datasetStore.agentSettings()?.themeScope === 'global' ? 'global' : 'scoped',
  );
  const [themeScopeOverride, setThemeScopeOverride] = signal<'global' | 'scoped' | null>(null);
  const themeScope = memo<'global' | 'scoped'>(() => themeScopeOverride() ?? themeScopePreference());
  // Space theme data for the template content area — only populated in scoped mode.
  const [editingTheme, setEditingTheme] = signal<EditingTheme | null>(null);
  /**
   * The spaces' records and this agent's overrides, lent by the space store once it exists. Declared
   * ahead of the effects, since the one applying the agent's default reads it.
   */
  const [appearance, setAppearance] = signal<SpaceAppearance | null>(null);

  // ── History (delegated to the unified EditorStore history) ──

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
    /*
      Safe mode: WE's own themes and nothing else. A theme is CSS, and CSS can hide every way out of
      the app as thoroughly as a template can, so safe mode that kept the chosen theme would be safe
      from half the problem. Here because every id this store resolves — the one on screen, the
      agent's default, a template's named themes — is looked up in this list, so leaving the others
      out of it is leaving them out of everything. The settings page still lists them to delete.
    */
    if (safeMode().on) return builtInThemes();
    /*
      Only the ones on the visible list, an empty list included. Read as "show everything" when it was
      empty, hiding the last theme shown brought every hidden one back.
    */
    const ids = visibleThemeIds();
    const visible = installedThemes().filter((t) => ids.has(t.id));
    return [...builtInThemes(), ...visible, ...spaceThemes()];
  };

  /*
    A theme named on a schema node (`theme: { themeName }`) finds its settings here, whichever kind of
    theme it is. Built-ins resolve inside the theme package; installed and space themes only this store
    knows. Reading `allThemes` from inside the renderer's effect makes a node's theme re-apply when the
    theme it names finishes loading.
  */
  registerNamedThemes((name) => {
    const named = [...registryThemes(), ...allThemes()].find((theme) => theme.id === name || theme.slug === name);
    return named ? parseOverrides(named.overrides) : undefined;
  });
  onCleanup(() => registerNamedThemes(undefined));

  /**
   * What either half of the pair may be set to, ready for a `we-select`.
   *
   * Built in the store rather than `$map`ped in the schema for the reason `themeOverrideOptions`
   * documents: a schema can map a store array into options and cannot prepend one, and without the
   * "Built-in" entry there would be no way back out of a choice — the nearest thing available would
   * be picking the built-in by name and hoping it is still the same theme next release.
   *
   * "Follow system" is excluded, being the thing this resolves.
   */
  const systemThemeOptions: Accessor<{ label: string; value: string }[]> = memo(() => [
    { label: 'Built-in light or dark', value: '' },
    ...allThemes()
      .filter((t) => t.id !== SYSTEM_THEME_ID)
      .map((t) => ({ label: t.name, value: String(t.id) })),
  ]);

  const currentTheme: Accessor<ThemeData> = () =>
    allThemes().find((t) => t.id === currentThemeId()) ?? registryToThemeData('light');

  // Map theme record id → record for save/delete. `NewRecord` because entries arrive
  // both from a load and from whatever a save or install just wrote, and a create carries no
  // relations (see `NewRecord`) — nothing here reads one, an entry existing to be saved and deleted.
  const themeRecordMap = new Map<string, NewRecord<Theme>>();

  async function loadSpaceThemes() {
    const perspective = datasetStore.currentDataset()?.handle;
    if (!perspective) {
      setSpaceThemes([]);
      return;
    }
    try {
      const models = await Theme.findAll(perspective);
      for (const model of models) themeRecordMap.set(model.id, model);
      setSpaceThemes(models.map(modelToThemeData));
    } catch (e) {
      console.error('ThemeStore: failed to load space themes', e);
    }
  }

  async function loadInstalledThemes() {
    const perspective = datasetStore.rootDataset()?.handle;
    // Deliberately does *not* open the gate below: with no root dataset there is nothing to load
    // yet, and saying "loaded" here would let a custom theme's id be guessed at before its record
    // has had any chance to arrive.
    if (!perspective) return;
    try {
      const models = await Theme.findAll(perspective);
      for (const model of models) themeRecordMap.set(model.id, model);
      setInstalledThemes(models.map(modelToThemeData));
      setThemesLoaded(true);

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
  effect(() => {
    if (datasetStore.rootDataset()) void loadInstalledThemes();
  });

  // Load space themes when the current space perspective changes
  effect(() => {
    if (datasetStore.currentDataset()) void loadSpaceThemes();
    else setSpaceThemes([]);
  });

  // Apply the agent's default theme when AgentSettings first loads or when the user
  // explicitly changes their default theme. Guard against re-firing on unrelated
  // settings changes (e.g. currentTemplateId updates from template switches), which
  // would otherwise reset the theme to defaultThemeId mid-session.
  //
  // Only outside a space. In one, which theme applies is the space resolution's to say (below), and
  // the agent's default reaches it there as the resolution's last word. Applied in a space as well,
  // settings arriving after the agent had entered one put their default over the space's theme, and
  // the resolution, seeing its own answer unchanged, never put it back.
  let lastAppliedDefaultThemeId: string | undefined;
  effect(() => {
    const prefs = datasetStore.agentSettings();
    if (!prefs) return;
    if (appearance() && datasetStore.currentDataset()) return;
    const defaultId = agentDefaultThemeId();
    // Don't override currentThemeId while the user is actively editing a theme —
    // agentSettings can update (e.g. when a theme save triggers the backend's subscriptions)
    // and blindly resetting currentThemeId to defaultThemeId would exit editing mode.
    if (untrack(() => editingTheme())) return;
    if (defaultId === lastAppliedDefaultThemeId) return;
    lastAppliedDefaultThemeId = defaultId;
    setCurrentThemeId(defaultId);
  });

  // Keep localStorage in sync with the agent's default theme so the bootscreen
  // can apply it immediately on next launch without waiting for the backend.
  effect(() => {
    if (!datasetStore.agentSettings()) return;
    localStorage.setItem(THEME_KEY, agentDefaultThemeId());
  });

  // The same, for the two halves of "Follow system" — the boot screen has to resolve `system`
  // before AgentSettings exists, and resolving it to the built-in and then swapping is a flash.
  effect(() => {
    const prefs = datasetStore.agentSettings();
    if (!prefs) return;
    for (const [key, value] of [
      [SYSTEM_LIGHT_KEY, prefs.systemLightThemeId],
      [SYSTEM_DARK_KEY, prefs.systemDarkThemeId],
    ] as const) {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    }
  });

  /**
   * The agent's own theme — what the shell wears in scoped mode, and what a space falls back to.
   *
   * Prefers `AgentSettings` over `localStorage` so it is reactive; localStorage is the boot answer,
   * before the backend has answered, and an effect above keeps the two in step.
   */
  const personalTheme = memo<ThemeData>(() => resolveThemeData(agentDefaultThemeId()));

  /**
   * Where the theme actually gets applied — two derived answers and one effect each, replacing
   * fourteen imperative `applyThemeToDOM` calls spread across six functions and three effects.
   *
   * Deriving is what fixes the flicker. The scope transition used to write a signal (which the
   * wrapper renders on the renderer's next flush) *and* documentElement (immediately), so for one frame the
   * whole window wore the personal theme before the wrapper caught up — the theme visibly went
   * forward, back, and forward again. Both surfaces now read the same signals, so they change in
   * the same flush and there is no intermediate state to paint.
   *
   * It also removes the class of bug where two of those writers disagreed about what should be on
   * screen: there is one answer now, and it is computed rather than remembered.
   */
  const documentTheme = memo<ThemeData>(() =>
    themeScope() === 'scoped' ? personalTheme() : (editingTheme() ?? currentTheme()),
  );

  /** The sides the theme on screen carries. See `ThemeStore.currentThemeSides`. */
  const currentThemeSides = memo(() => themeSides(parseOverrides((editingTheme() ?? currentTheme()).overrides)));

  // The display needs, cached for the next first paint.
  effect(() => {
    const settings = datasetStore.agentSettings();
    if (!settings) return;
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(displayFrom(settings.displayPreferences)));
  });

  /** What the scoped wrapper renders. Null in global mode — the template inherits documentElement. */
  const activeTemplateTheme = memo<ThemeData | null>(() =>
    themeScope() === 'scoped' ? (editingTheme() ?? currentTheme()) : null,
  );

  /** Can this id be *answered*, or would resolving it be a guess? */
  function canResolveTheme(themeId: string): boolean {
    const id = themeId === SYSTEM_THEME_ID ? systemThemeId() : themeId;
    return isValidThemeKey(id) || allThemes().some((t) => t.id === id);
  }

  /*
    The ids each surface is *asking* for, as opposed to what they currently resolve to.

    Needed because `resolveThemeData` always answers with something, so its result cannot tell a
    real match from a fallback. These mirror the branches in `documentTheme` and
    `activeTemplateTheme` — if either of those changes, these have to follow.
  */
  const documentThemeId = memo(() =>
    themeScope() === 'scoped' ? agentDefaultThemeId() : (editingTheme()?.id ?? currentThemeId()),
  );
  const templateThemeId = memo(() => editingTheme()?.id ?? currentThemeId());

  /**
   * True while the theme a surface wants cannot be resolved and might still arrive.
   *
   * Read by whatever applies a theme, so it holds what is already on screen instead of painting a
   * guess over it. The wrong guess is not a neutral placeholder — with the token CSS's `:root`
   * defaults being the light theme, it is a white flash in the middle of a dark one.
   *
   * Only until the records load. After that an unknown id really is unknown, a fallback is the
   * honest answer, and this stops holding anything back.
   */
  const templateThemePending = memo(() => !themesLoaded() && !canResolveTheme(templateThemeId()));

  effect(() => {
    const theme = documentTheme();
    if (!themesLoaded() && !canResolveTheme(documentThemeId())) return;
    applyThemeToDOM(theme);
  });

  /*
    In scoped mode, the space/editing theme's component-level CSS goes into its own style tag,
    confined to the template wrapper by `THEME_SCOPE_SELECTOR`.

    That confinement used to be incidental: the rules were left as written and happened to begin
    `[data-we-theme='X']`, which only the wrapper carries — so a theme that simply omitted the
    attribute selector styled the whole window, shell included. Scoping is now enforced rather than
    relied upon, which is what makes a space theme safe to accept from a peer.

    Cleared when returning to global mode (we-custom-theme-css handles it there).
  */
  effect(() => {
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
  const [requestedThemeNames, setRequestedThemeNames] = signal<string[]>([]);

  function requestNamedThemes(schema: unknown) {
    const names = collectThemeNames(schema);
    if (!names.size) return;
    const next = new Set(untrack(requestedThemeNames));
    const before = next.size;
    for (const name of names) if (SAFE_THEME_ID.test(name)) next.add(name);
    if (next.size !== before) setRequestedThemeNames([...next]);
  }

  effect(() => {
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
  // so the correct theme renders before the backend answers, without relying on a stylesheet.
  const initialId = getInitialThemeId();
  applyThemeToDOM(
    isValidThemeKey(initialId)
      ? registryToThemeData(initialId)
      : (rememberedThemes.find((t) => t.id === initialId) ?? registryToThemeData('light')),
  );

  function resolveThemeData(themeId: string): ThemeData {
    // `system` is not a theme, it is a question — asked here rather than remembered, so the answer
    // follows the OS while the app is open instead of being fixed at whatever it was on the click.
    const id = themeId === SYSTEM_THEME_ID ? systemThemeId() : themeId;
    const found = allThemes().find((t) => t.id === id);
    if (found) return found;
    if (isValidThemeKey(id)) return registryToThemeData(id);
    // An app's theme the library has not loaded yet, worn as the device remembers it.
    const remembered = rememberedThemes.find((t) => t.id === id);
    if (remembered) return remembered;

    /*
      An id nothing answers to — which, for the first second of every load, is any custom theme.

      `installedThemes` comes out of the root dataset asynchronously, so a pinned personal theme is
      referenced by an id that is not in `allThemes()` yet. This used to answer `light` outright,
      which is why a refresh went dark (the boot screen, correct), flashed light for a beat as the
      template resolved, then landed on the pinned theme once its record arrived. The flash was not a
      loading state; it was a hardcoded guess.

      Answering with the agent's own default instead makes the interval invisible in the common case,
      because that is the theme the boot screen was already wearing. `light` remains the last resort
      for an agent who has no default either — there has to be *some* answer, and a wrong one that
      matches what is already on screen beats a wrong one that does not.
    */
    const preferred = agentDefaultThemeId();
    const rememberedPreferred = rememberedThemes.find((t) => t.id === preferred);
    if (rememberedPreferred) return rememberedPreferred;
    return registryToThemeData(isValidThemeKey(preferred) ? preferred : 'light');
  }

  /*
    A memo, not a bare accessor, and the distinction matters well beyond this store.

    `agentSettings` wakes its readers on every write, because
    `updateAgentSettings` mutates the settings object in place and re-sets it, so identity cannot be
    the test. A bare accessor passes that straight through: anything reading this inside an effect
    became a subscriber to every unrelated preference write. `spaceStore`'s theme resolution reads it,
    so toggling the theme scope switch re-ran the whole resolution and overwrote the theme the agent
    had just picked. Memoising collapses "settings changed" back to "*this* value changed".
  */
  const defaultThemeId: Accessor<string> = memo(() => chosenDefaultThemeId() ?? appThemeLookup()() ?? 'light');

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

  const themeScopeGlobal = memo(() => themeScopePreference() === 'global');
  const themeScopePreviewing = memo(() => themeScopeOverride() !== null);

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
  const useTemplateTheme = memo(() => datasetStore.agentSettings()?.useTemplateTheme !== false);

  async function setUseTemplateTheme(enabled: boolean) {
    await datasetStore.updateAgentSettings({ useTemplateTheme: enabled });
  }

  /*
    A fresh box per request, so the same role set twice still notifies — see `focusedRole` in the
    contract. The port does not promise that an equal write wakes anything.
  */
  const [focusRequest, setFocusRequest] = reactivity.signal({ role: '' });
  const focusedRole = () => focusRequest().role;
  function focusRole(role: string) {
    setFocusRequest({ role });
  }

  function setDefaultTheme(themeId: string): Promise<boolean> {
    localStorage.setItem(THEME_KEY, themeId);
    setCurrentThemeId(themeId);
    return datasetStore.updateAgentSettings({ defaultThemeId: themeId });
  }

  /**
   * Choose which theme "Follow system" means on one side of the switch.
   *
   * An empty id clears the choice back to the built-in of that polarity, so the control has a way
   * out that is not "pick the built-in and hope it is still the same theme next release".
   *
   * `system` itself is refused rather than sanitised at read time only: a pair naming the thing
   * being resolved is the one input that cannot be answered, and the resolver's own guard should
   * not be the only thing standing between a click and a loop.
   */
  function setSystemTheme(polarity: 'light' | 'dark', themeId: string): Promise<boolean> {
    if (themeId === SYSTEM_THEME_ID) return Promise.resolve(false);
    const key = polarity === 'dark' ? SYSTEM_DARK_KEY : SYSTEM_LIGHT_KEY;
    if (themeId) localStorage.setItem(key, themeId);
    else localStorage.removeItem(key);
    return datasetStore.updateAgentSettings(
      polarity === 'dark' ? { systemDarkThemeId: themeId } : { systemLightThemeId: themeId },
    );
  }

  async function setThemeInstalled(themeId: string, visible: boolean) {
    const model = themeRecordMap.get(themeId);
    const prefs = datasetStore.agentSettings();
    if (!model || !prefs) return;

    try {
      if (visible) {
        await prefs.addInstalledThemes(model);
        setVisibleThemeIds(new Set([...untrack(visibleThemeIds), themeId]));
      } else {
        await prefs.removeInstalledThemes(model);
        const next = new Set(untrack(visibleThemeIds));
        next.delete(themeId);
        setVisibleThemeIds(next);
      }
    } catch (error) {
      // Was `.catch(() => {})`, which moved the switch and wrote nothing: the picker showed the new
      // state until the next boot restored the old one.
      console.error('ThemeStore: could not change theme visibility', error);
      toasts.error('Could not save that change.');
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
    setCurrentThemeId(agentDefaultThemeId());
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
      /*
        In scoped mode documentElement wears the *personal* theme, not the one being edited, so the
        slider values have to be read from somewhere else.

        A throwaway element carrying the base theme, rather than applying it to the document and
        hoping something puts it back. That is what this used to do, on the reasoning that
        `setEditingTheme` moves `documentTheme` and its effect rewrites the document before paint —
        true in global mode and false here, because in scoped mode `documentTheme` follows
        `personalTheme`, which has not changed. Nothing re-ran, and the app chrome kept the theme
        being edited until the scope toggle was flipped twice.
      */
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none';
      for (const [prop, value] of Object.entries(themeParametersToStyle(storedOverrides))) {
        probe.style.setProperty(prop, value);
      }
      document.body.appendChild(probe);
      initialOverrides = populateMissingOverrides(storedOverrides, probe);
      probe.remove();
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
    const prev = untrack(editingTheme);
    if (!prev) return;
    const existing: ThemeOverrides = parseOverrides(prev.overrides);
    // Stamped on write, not on read: `parseOverrides` migrates a theme in memory and leaves what
    // is stored alone, so an installed theme nobody edits is never rewritten under them. The
    // moment an author does change something, what they save is current.
    const merged = { ...existing, ...patch, schemaVersion: THEME_SCHEMA_VERSION };
    setEditingTheme({ ...prev, overrides: JSON.stringify(merged), isDirty: true });
  }

  function updateEditingCss(css: string) {
    captureSnapshot();
    const prev = untrack(editingTheme);
    if (prev) setEditingTheme({ ...prev, css, isDirty: true });
  }

  function updateEditingMeta(fields: { name?: string; icon?: string }) {
    captureSnapshot();
    const prev = untrack(editingTheme);
    if (prev) setEditingTheme({ ...prev, ...fields, isDirty: true });
  }

  const [themeFork, setThemeFork] = signal<{ source: string; name: string; icon: string } | null>(null);
  function startThemeFork(sourceId?: string) {
    // Only a name is a theme: a button wired without `args` hands an action its click.
    const source = typeof sourceId === 'string' && sourceId ? allThemes().find((t) => t.id === sourceId) : undefined;
    setThemeFork({ source: source?.id ?? '', name: source?.name ?? '', icon: source?.icon || 'paint-bucket' });
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
      toasts.error(`Cannot save theme: no ${destination} perspective available`);
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
      themeRecordMap.set(model.id, model);
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
      if (destination === 'space') {
        // It lives in the space, so it joins the space's list, as a reload would put it. Added to
        // this agent's installed list instead, it showed under "My themes" and was missing from
        // the space's own pickers until the next load.
        setSpaceThemes([...untrack(spaceThemes), data]);
      } else {
        setInstalledThemes([...untrack(installedThemes), data]);
        setVisibleThemeIds(new Set([...untrack(visibleThemeIds), model.id]));
        const prefs = datasetStore.agentSettings();
        if (prefs) await prefs.addInstalledThemes(model).catch(() => {});
      }
      setCurrentTheme(data.id);
      setEditingTheme({ ...data, isDirty: false });
      sessionStorage.setItem(EDITING_THEME_KEY, data.id);
      return true;
    } catch (e) {
      console.error('ThemeStore: createAndStartEditing error', e);
      toasts.error('Failed to create theme');
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
        setSpaceThemes(untrack(spaceThemes).map((t) => (t.id === editing.id ? editing : t)));
      } else if (installedThemes().some((t) => t.id === editing.id)) {
        setInstalledThemes(untrack(installedThemes).map((t) => (t.id === editing.id ? editing : t)));
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
      const existing = themeRecordMap.get(editing.id);
      if (existing && existing.origin !== 'built-in') {
        existing.name = editing.name ?? '';
        existing.icon = editing.icon ?? '';
        existing.overrides = editing.overrides
          ? asFileField(encodeToFileData(editing.overrides, 'overrides.json', 'application/json'))
          : null;
        existing.css = editing.css ? asFileField(encodeToFileData(editing.css, 'theme.css', 'text/css')) : null;
        // Moved on every save, as a template's is: the theme tools an agent edits with refuse a write
        // against a version that has moved, and a save here that left it alone was invisible to them.
        existing.version = (existing.version || 1) + 1;
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
          setSpaceThemes(untrack(spaceThemes).map((t) => (t.id === saved.id ? saved : t)));
        } else {
          setInstalledThemes(untrack(installedThemes).map((t) => (t.id === saved.id ? saved : t)));
        }
        const still = untrack(editingTheme);
        if (still) setEditingTheme({ ...still, isDirty: false });
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
      toasts.error('Failed to save theme');
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
      themeRecordMap.set(model.id, model);
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
      setInstalledThemes([...untrack(installedThemes), data]);
      // Visible as well, as a new theme is: one left off the list is missing from every picker and
      // from the lookup of the theme on screen, which then fell back to another.
      setVisibleThemeIds(new Set([...untrack(visibleThemeIds), model.id]));
      const prefs = datasetStore.agentSettings();
      if (prefs) await prefs.addInstalledThemes(model).catch(() => {});
      setEditingTheme({ ...data, isDirty: false });
      setCurrentTheme(data.id);
      toasts.success(`Theme "${name}" saved`);
      return data;
    } catch (e) {
      console.error('ThemeStore: saveEditingThemeAs error', e);
      toasts.error('Failed to save theme');
      return null;
    }
  }

  async function deleteTheme(themeId: string) {
    const model = themeRecordMap.get(themeId);
    if (!model) return;
    try {
      await model.delete();
      themeRecordMap.delete(themeId);
      setInstalledThemes(untrack(installedThemes).filter((t) => t.id !== themeId));
      // A space theme lives in spaceThemes, not installedThemes — drop it from
      // both lists so the deletion is visible without reloading the space.
      setSpaceThemes(untrack(spaceThemes).filter((t) => t.id !== themeId));
      if (currentThemeId() === themeId) setCurrentTheme('light');
      toasts.success('Theme deleted');
    } catch (e) {
      console.error('ThemeStore: deleteTheme error', e);
      toasts.error('Failed to delete theme');
    }
  }

  /** A theme's two files, as a record holds them. */
  const themeFiles = (overrides: string | null | undefined, css: string | null | undefined) => ({
    overrides: overrides ? asFileField(encodeToFileData(overrides, 'overrides.json', 'application/json')) : null,
    css: css ? asFileField(encodeToFileData(css, 'theme.css', 'text/css')) : null,
  });

  /*
    Installing a marketplace theme: into the agent's library, updating the copy an earlier install
    made, or into the space on screen for every member. A theme carries no grants to name, so nobody
    is asked first; its CSS is filtered where it is injected, whichever way it arrived.
  */
  async function installTheme(source: Theme, destination: InstallDestination): Promise<void> {
    const slug = source.slug || source.name.toLowerCase().replace(/\s+/g, '-');
    // Raw file-storage fields resolve to `data:<mime>;base64,...` strings, so they are decoded
    // before re-encoding — otherwise the data URI itself becomes the new file's content.
    const files = themeFiles(decodeFileAsString(source.overrides) || null, decodeFileAsString(source.css) || null);

    if (destination === 'space') {
      const space = datasetStore.currentDataset()?.handle;
      if (!space) throw new Error('There is no space open');
      if (await Theme.findOne(space, { where: { slug } })) {
        toasts.error(`"${source.name}" is already in this space`);
        return;
      }
      await Theme.create(space, {
        name: source.name,
        description: source.description,
        icon: source.icon,
        slug,
        origin: 'shared',
        version: source.version || 1,
        ...files,
      });
      await loadSpaceThemes();
      toasts.success(`"${source.name}" added to this space`);
      return;
    }

    const root = datasetStore.rootDataset()?.handle;
    if (!root) throw new Error('Your library is not available yet');
    /*
      Already installed under this slug: updated in place.

      Constrained to models that are actually *installed*, which means the ones living in the root
      perspective. `themeRecordMap` is also filled by `loadSpaceThemes`, from every space visited
      this session and never pruned, so an unconstrained slug match could bind the record to a theme
      belonging to a *space* — and `save()` would then publish marketplace content into that space,
      for every member, while the toast said "updated" and the installed list showed nothing new.
      Slugs are not unique across perspectives and were never meant to be.
    */
    const installedIds = new Set(installedThemes().map((theme) => theme.id));
    const existing = [...themeRecordMap.values()].find((model) => installedIds.has(model.id) && model.slug === slug);
    if (existing) {
      existing.name = source.name;
      existing.icon = source.icon;
      existing.version = source.version;
      Object.assign(existing, files);
      await existing.save();
      const updated = modelToThemeData(existing);
      setInstalledThemes(untrack(installedThemes).map((t) => (t.id === existing.id ? updated : t)));
      toasts.success(`Theme "${source.name}" updated to v${source.version}`);
      return;
    }
    const model = await Theme.create(root, {
      name: source.name,
      icon: source.icon,
      slug,
      origin: 'marketplace',
      version: source.version,
      ...files,
    });
    themeRecordMap.set(model.id, model);
    setInstalledThemes([...untrack(installedThemes), modelToThemeData(model)]);
    const settings = datasetStore.agentSettings();
    if (settings) await settings.addInstalledThemes(model);
    toasts.success(`Theme "${source.name}" installed`);
  }

  const flow = createLibraryFlow<Theme, Theme>({
    reactivity,
    toasts,
    entity: Theme as unknown as LibraryEntity<Theme>,
    noun: 'theme',
    marketplace: () => datasetStore.marketplaceDataset()?.handle,
    space: () => datasetStore.currentDataset()?.handle,
    datasetOf: (id) => datasetStore.datasets().find((d) => d.id === id)?.handle,
    me: () => session.me()?.did,
    judge: (listing) => listing,
    asks: false,
    apply: installTheme,
  });

  const installFromMarketplace = (listingId: string) => flow.install(listingId, 'personal');

  async function writeLibraryTheme(theme: BundleTheme): Promise<string> {
    const rootPerspective = datasetStore.rootDataset()?.handle;
    if (!rootPerspective) throw new Error('Your library is not available yet');
    const overrides = asFileField(
      encodeToFileData(JSON.stringify(theme.overrides), 'overrides.json', 'application/json'),
    );
    const css = theme.css ? asFileField(encodeToFileData(theme.css, 'theme.css', 'text/css')) : null;
    // By slug among the installed ones only — `themeRecordMap` also holds every space's themes, and an
    // update must never land in a space. See `installFromMarketplace`.
    const installedIds = new Set(installedThemes().map((t) => t.id));
    const existing = [...themeRecordMap.values()].find(
      (model) => installedIds.has(model.id) && model.slug === theme.id,
    );
    if (existing) {
      existing.name = theme.name;
      existing.icon = theme.icon ?? 'palette';
      existing.version = (existing.version || 1) + 1;
      existing.overrides = overrides;
      existing.css = css;
      await existing.save();
      const updated = modelToThemeData(existing);
      setInstalledThemes(untrack(installedThemes).map((t) => (t.id === existing.id ? updated : t)));
      setVisibleThemeIds(new Set([...untrack(visibleThemeIds), existing.id]));
      return existing.id;
    }
    const model = await Theme.create(rootPerspective, {
      name: theme.name,
      icon: theme.icon ?? 'palette',
      slug: theme.id,
      origin: 'bundle',
      version: 1,
      overrides,
      css,
    });
    themeRecordMap.set(model.id, model);
    setInstalledThemes([...untrack(installedThemes), modelToThemeData(model)]);
    /*
      Visible as well as installed. Once anything is on the visible list, a theme that is not on it is
      left out of `allThemes`, which is where every theme id is looked up — so an app's templates
      named a theme nothing could find, and fell back to the agent's own until a reload re-read the
      list. A marketplace install does the same, for the same reason.
    */
    setVisibleThemeIds(new Set([...untrack(visibleThemeIds), model.id]));
    const settings = datasetStore.agentSettings();
    if (settings) await settings.addInstalledThemes(model);
    return model.id;
  }

  async function uninstallTheme(themeId: string) {
    const model = themeRecordMap.get(themeId);
    const settings = datasetStore.agentSettings();
    if (!model || !settings) return;
    try {
      await settings.removeInstalledThemes(model);
      await model.delete();
      themeRecordMap.delete(themeId);
      setInstalledThemes(untrack(installedThemes).filter((t) => t.id !== themeId));
      if (currentThemeId() === themeId) setCurrentTheme('light');
      toasts.success('Theme uninstalled');
    } catch (e) {
      console.error('ThemeStore: uninstallTheme error', e);
      toasts.error('Failed to uninstall theme');
    }
  }

  function publishToMarketplace(options: {
    name: string;
    description: string;
    icon?: string;
    slug?: string;
    screenshots: File[];
  }): Promise<boolean> {
    const base = editingTheme() ?? currentTheme();
    return flow.publish({
      name: options.name,
      description: options.description,
      icon: options.icon ?? base.icon,
      slug: (options.slug || base.slug || options.name.toLowerCase().replace(/\s+/g, '-'))
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-'),
      content: themeFiles(base.overrides, base.css),
      screenshots: options.screenshots,
    });
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
  function installToSpace(listingId: string): Promise<void> {
    return flow.install(listingId, 'space');
  }

  async function publishToSpace(datasetId: string, spaceName: string): Promise<boolean> {
    const editing = editingTheme();
    if (!editing) {
      toasts.error('No theme is being edited');
      return false;
    }
    const shared = await flow.share({
      datasetId,
      spaceName,
      name: editing.name,
      slug: editing.slug || editing.name.toLowerCase().replace(/\s+/g, '-'),
      content: { icon: editing.icon, ...themeFiles(editing.overrides, editing.css) },
    });
    // Space themes are read on entering a space, not watched, so the open space's list is read
    // again here — or the theme just shared is missing from its pickers until the next visit.
    // Another space reads its own when it is next opened.
    if (shared && datasetStore.currentDataset()?.id === datasetId) await loadSpaceThemes();
    return shared;
  }

  // ────────────────────────────────────────────────────────────────
  // The theme a space is seen in
  // ────────────────────────────────────────────────────────────────

  const overrideFor = (datasetId: string): SpaceOverride =>
    appearance()?.overrideFor(datasetId) ?? { template: FOLLOW_SPACE, theme: FOLLOW_SPACE };

  /** Everything the precedence rule needs for one space, read off the signals. */
  const resolutionInput = (datasetId: string) => {
    const shown = datasetStore.currentDataset()?.id === datasetId ? templates()?.onScreen() : undefined;
    return themeResolutionInputOf({
      override: overrideFor(datasetId),
      space: appearance()?.spaceFor(datasetId),
      onScreenTemplate: shown && { id: shown.id, themeId: themeOfTemplate(shown.meta) },
      useTemplateTheme: useTemplateTheme(),
      hasTheme: (id) => allThemes().some((t) => t.id === id),
      agentTheme: defaultThemeId(),
    });
  };

  /**
   * Which theme this agent sees in one space. The precedence is `resolveSpaceTheme`'s — a pure
   * function, because the rule is the feature and it was designed wrong once.
   */
  const resolveThemeFor = (datasetId: string): string => resolveSpaceTheme(resolutionInput(datasetId));

  const themeOverrideOptions = memo(() => {
    const byId = (id: string) => allThemes().find((t) => t.id === id)?.name;
    const space = appearance()?.spaceFor(datasetStore.currentDataset()?.id ?? '');
    return overrideOptions({
      choices: allThemes().map((t) => ({ label: t.name || t.id, value: t.id })),
      spaceDefaultName: byId(space?.defaultThemeId ?? ''),
      agentDefaultName: byId(defaultThemeId()),
    });
  });

  /*
    A pin that diverges from what would otherwise apply. False outside a space, for the two sentinels
    (neither is a pin), and for a pin naming what would have applied anyway — saying so would put a
    "reset" in front of someone with nothing to reset. It can become true without anyone touching it:
    an administrator changing the space's default is exactly when a pin starts mattering.
  */
  const spaceThemePinned = memo<boolean>(() => {
    const datasetId = datasetStore.currentDataset()?.id;
    if (!datasetId) return false;
    const pin = overrideFor(datasetId).theme;
    if (pin === FOLLOW_SPACE || pin === AGENT_DEFAULT) return false;
    return pin !== resolveSpaceTheme({ ...resolutionInput(datasetId), themeOverride: FOLLOW_SPACE });
  });

  /*
    What keeps this agent from seeing the space on screen's own theme, so setting the space's default
    while one of these holds can say why nothing changed, rather than looking as though it did not save.
  */
  const spaceThemeHiddenBy = memo<SpaceThemeHiddenBy>(() => {
    const datasetId = datasetStore.currentDataset()?.id;
    return datasetId ? hiddenBy(resolutionInput(datasetId)) : '';
  });

  /*
    Apply the theme that resolves where the agent is: a space's when in one, the personal theme
    restored when there is no space at all.

    Compared by value before it acts, and that is the whole fix for a class of bug rather than a
    tidy-up: the resolution reaches through the agent's settings, which wake their readers on every
    write — toggling the theme scope switch, turning a module on, switching a template — and each
    re-ran this and pushed its answer over whatever the agent had actually chosen. The space is part
    of the value, because moving between two spaces that resolve to the same theme must still
    re-apply it: something may have set the theme out of band meanwhile (a link's `?theme=`, a theme
    being deleted), and arriving somewhere new is when that should be corrected.
  */
  let appliedSpaceTheme: { datasetId: string; spaceUuid: string; themeId: string } | null = null;
  effect(() => {
    const lent = appearance();
    if (!lent) return;
    const datasetId = datasetStore.currentDataset()?.id ?? '';
    const next = {
      datasetId,
      spaceUuid: datasetId ? (lent.spaceFor(datasetId)?.uuid ?? '') : '',
      themeId: datasetId ? resolveThemeFor(datasetId) : '',
    };
    const last = appliedSpaceTheme;
    if (last && last.datasetId === next.datasetId && last.spaceUuid === next.spaceUuid && last.themeId === next.themeId)
      return;
    appliedSpaceTheme = next;
    untrack(() => {
      if (next.themeId) replaceTheme(next.themeId);
      // Only restored when there is genuinely no space — not in the moment between two.
      else if (!datasetId) restorePersonalTheme();
      // In a space with no theme of its own: drop whatever a previous space put up.
      else clearSpaceTheme();
    });
  });

  /*
    Said once when a template asks for a theme this agent does not have. Apart from the effect above,
    which runs on every switch and every preference write — a toast in there would repeat. Gated on
    the themes having loaded, so the boot frame does not read as "you don't have it".
  */
  const reportedMissingThemes = new Set<string>();
  effect(() => {
    if (!useTemplateTheme()) return;
    if (!datasetStore.currentDataset()) return;
    const themes = allThemes();
    if (!themes.length) return;
    const suggested = themeOfTemplate(templates()?.onScreen()?.meta);
    if (!suggested || themes.some((t) => t.id === suggested)) return;
    if (reportedMissingThemes.has(suggested)) return;
    reportedMissingThemes.add(suggested);
    toasts.warning(`This template suggests a theme ("${suggested}") you don't have — using your own.`);
  });

  /** Override the theme this agent sees in one space. {@link FOLLOW_SPACE} returns to its default. */
  async function setSpaceThemeOverride(themeId: string, spaceUuid?: string): Promise<void> {
    const lent = untrack(appearance);
    const datasetId = spaceUuid ?? datasetStore.currentDataset()?.id;
    if (!lent || !datasetId) return;
    await lent.setOverride(datasetId, 'theme', themeId);
    if (datasetStore.currentDataset()?.id !== datasetId) return;
    const effective = untrack(() => resolveThemeFor(datasetId));
    // Explicit: this is only reached by someone choosing a theme, so it outranks an editing
    // session on a different one. The recompute on entering a space deliberately does not.
    if (effective) replaceTheme(effective, { explicit: true });
    else clearSpaceTheme();
  }

  /**
   * Apply a theme *where the agent is* — what the rail's theme picker does.
   *
   * In a space this pins it there; outside one it sets their global default. The picker is a
   * contextual control in contextual chrome, so "here" is the only reading of a click in it that
   * does not surprise: rewriting the global default from inside a space makes per-space themes
   * reachable only from Settings, which is backwards for the commonest act there is.
   *
   * A store method rather than a condition in the schema because a condition inside an action's args
   * resolves at render time, so it would freeze whichever branch was true when the picker painted.
   * Persisting at all is the point: `setCurrentTheme` sets a signal and writes nothing, so a choice
   * made through it lasts only until something recomputes the space theme.
   */
  async function applyTheme(themeId: string): Promise<void> {
    const datasetId = datasetStore.currentDataset()?.id;
    if (datasetId) await setSpaceThemeOverride(themeId, datasetId);
    else await setDefaultTheme(themeId);
  }

  /**
   * Drop this agent's theme pin for the space on screen — the way back out of {@link applyTheme},
   * without the picker having to spell the sentinel, a literal that would not move with the constant.
   */
  async function clearSpaceThemePin(): Promise<void> {
    const datasetId = datasetStore.currentDataset()?.id;
    if (datasetId) await setSpaceThemeOverride(FOLLOW_SPACE, datasetId);
  }

  /*
    Members see a space's new default; the person who set it is the one looking at something else,
    and without this the setting reads as not having saved.
  */
  function explainSpaceThemeHidden(): void {
    const reason = untrack(spaceThemeHiddenBy);
    const datasetId = datasetStore.currentDataset()?.id;
    if (!reason || !datasetId) return;
    const resolved = untrack(() => resolveThemeFor(datasetId));
    const name = untrack(allThemes).find((t) => t.id === resolved)?.name ?? 'another theme';
    if (reason === 'template') {
      toasts.info(`Saved. You won't see it while this template brings its own theme, ${name}.`, 8000);
      return;
    }
    const useSpaceTheme = { label: "Use the space's theme", run: () => void clearSpaceThemePin() };
    toasts.info(`Saved. You won't see it while you're using ${name} in this space.`, 8000, useSpaceTheme);
  }

  const store: ThemeStore = {
    automaticThemes,
    builtInThemes,
    installedThemes,
    spaceThemes,
    allThemes,
    currentThemeId,
    currentTheme,
    defaultThemeId,
    themeScope,
    templateThemePending,
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
    operationLoading: flow.operationLoading,
    registerHistoryCallbacks,
    applySnapshot,
    setCurrentTheme,
    setDefaultTheme,
    provideTemplates,
    provideSpaceAppearance: (lent: SpaceAppearance) => setAppearance(lent),
    themeOverrideOptions,
    spaceThemePinned,
    spaceThemeHiddenBy,
    setSpaceThemeOverride,
    applyTheme,
    clearSpaceThemePin,
    explainSpaceThemeHidden,
    focusedRole,
    focusRole,
    setSystemTheme,
    themeMode,
    displayPreferences,
    setDisplayPreference,
    themeSide,
    currentThemeSides,
    setThemeMode,
    systemThemes,
    systemThemeOptions,
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
    themeFork,
    startThemeFork,
    cancelThemeFork: () => setThemeFork(null),
    saveEditingTheme,
    saveEditingThemeAs,
    deleteTheme,
    installFromMarketplace,
    writeLibraryTheme,
    installToSpace,
    uninstallTheme,
    deleteMarketplaceTheme: flow.removeListing,
    publishToMarketplace,
    publishToSpace,
    loadInstalledThemes,
    // Schema-facing alias: templates re-pull the space theme list after a
    // mutation they performed themselves (e.g. deleting a space theme),
    // mirroring templateStore.refreshSpaceTemplates.
    refreshSpaceThemes: loadSpaceThemes,
    requestNamedThemes,
  };

  return store;
}
