/**
 * A person's display needs, applied over whatever theme is on screen.
 *
 * Five independent axes — colour scheme, contrast, text size, density, motion. A theme may say how it
 * looks in a mode (its `light`/`dark` sides, its `contrast.more` block), but which mode is worn is
 * the person's to say, and it wins over every theme: the app's, a space's, a node's. Somebody who
 * needs more contrast or larger text needs it in the space they are visiting as much as at home, and
 * a space's theme choosing otherwise would be choosing for them.
 *
 * That is enforced at one place: `applyThemeVars` lays the current preferences over every theme it
 * applies, so a caller that has never heard of them cannot leave them out. `setDisplayPreferences`
 * re-applies every theme on screen when they change.
 *
 * "Follow the system" is the default on the three axes the operating system has a signal for —
 * `prefers-color-scheme`, `prefers-contrast`, `prefers-reduced-motion` — and is resolved here, live.
 */
import type { ThemeOverrides } from './overrides';
import { type ThemeSideName, withThemeSide } from './sides';

export interface DisplayPreferences {
  /** Which side of a two-sided theme to wear. `system` follows the machine. */
  colorScheme?: 'light' | 'dark' | 'system';
  /** `more` raises the separation between text, borders and what is behind them. */
  contrast?: 'standard' | 'more' | 'system';
  /** A multiplier on the theme's own text size: 1 leaves it, 1.25 is a quarter larger. */
  textSize?: number;
  /** How much room things take: tighter or looser than the theme's own. */
  density?: 'compact' | 'normal' | 'roomy';
  /** `reduced` stops every transition and animation the design system draws. */
  motion?: 'full' | 'reduced' | 'system';
}

/**
 * The five axes, for anything that lists them — the settings screen, the generated reference. Each
 * names its values, whether the operating system has a signal it can follow, and what it does.
 */
export const DISPLAY_AXES: { key: keyof DisplayPreferences; values: string; system: boolean; doc: string }[] = [
  { key: 'colorScheme', values: 'light, dark, system', system: true, doc: 'Which side of a two-sided theme is worn.' },
  {
    key: 'contrast',
    values: 'standard, more, system',
    system: true,
    doc: "More separation between text, borders and their ground — the theme's own `contrast.more` where it has one.",
  },
  { key: 'textSize', values: 'a multiplier, 1 by default', system: false, doc: "On the theme's own text size." },
  { key: 'density', values: 'compact, normal, roomy', system: false, doc: 'How much room things take.' },
  {
    key: 'motion',
    values: 'full, reduced, system',
    system: true,
    doc: 'Reduced stops every transition and animation.',
  },
];

/** What the operating system is asking for right now, on the axes it has a signal for. */
export interface SystemDisplaySignals {
  dark: boolean;
  moreContrast: boolean;
  reducedMotion: boolean;
}

/** Preferences with every `system` answered. */
export interface ResolvedDisplay {
  side: ThemeSideName;
  contrast: 'standard' | 'more';
  textSize: number;
  density: 'compact' | 'normal' | 'roomy';
  motion: 'full' | 'reduced';
}

export function resolveDisplay(prefs: DisplayPreferences, signals: SystemDisplaySignals): ResolvedDisplay {
  const scheme = prefs.colorScheme ?? 'system';
  const contrast = prefs.contrast ?? 'system';
  const motion = prefs.motion ?? 'system';
  return {
    side: scheme === 'system' ? (signals.dark ? 'dark' : 'light') : scheme,
    contrast: contrast === 'system' ? (signals.moreContrast ? 'more' : 'standard') : contrast,
    textSize: prefs.textSize && prefs.textSize > 0 ? prefs.textSize : 1,
    density: prefs.density ?? 'normal',
    motion: motion === 'system' ? (signals.reducedMotion ? 'reduced' : 'full') : motion,
  };
}

/** How far each density moves the theme's spacing and control heights. */
const DENSITY = {
  compact: { spacing: 0.85, heightOffset: '-4px' },
  normal: { spacing: 1, heightOffset: undefined },
  roomy: { spacing: 1.15, heightOffset: '4px' },
} as const;

/**
 * More contrast, for a theme that has not said what that means for it.
 *
 * The quieter foregrounds are rebuilt nearer the text — as mixes of the theme's own text and page,
 * so they follow whatever the theme pinned — borders take the strong border, and the focus ring
 * thickens. It is the same theme, said more firmly.
 */
const MORE_CONTRAST: ThemeOverrides = {
  focusRingWidth: '3px',
  roles: {
    textMuted: 'color-mix(in oklab, var(--we-role-text) 82%, var(--we-role-page))',
    textFaint: 'color-mix(in oklab, var(--we-role-text) 68%, var(--we-role-page))',
    border: 'var(--we-role-border-strong)',
  },
};

const mergeRoles = (base: ThemeOverrides, over: ThemeOverrides): ThemeOverrides => ({
  ...base,
  ...over,
  ...(base.roles || over.roles ? { roles: { ...base.roles, ...over.roles } } : {}),
});

/** A theme as a person with these needs sees it: the side, then contrast, then size, room and motion. */
export function withDisplay(theme: ThemeOverrides, display: ResolvedDisplay): ThemeOverrides {
  const { contrast: modes, ...rest } = withThemeSide(theme, display.side);
  let result: ThemeOverrides = rest;
  if (display.contrast === 'more') {
    // A theme's own `more` block, which knows what more contrast means for its colours, over the
    // general rule rather than instead of it.
    result = mergeRoles(mergeRoles(result, MORE_CONTRAST), modes?.more ?? {});
  }
  if (display.textSize !== 1) result = { ...result, fontScale: (result.fontScale ?? 1) * display.textSize };
  if (display.density !== 'normal') {
    const { spacing, heightOffset } = DENSITY[display.density];
    result = {
      ...result,
      spacingScale: (result.spacingScale ?? 1) * spacing,
      ...(heightOffset && !result.controlHeightOffset ? { controlHeightOffset: heightOffset } : {}),
    };
  }
  if (display.motion === 'reduced') result = { ...result, animationSpeed: 'none' };
  return result;
}

// ── The current preferences, and the system's answers ──────────────────────

let preferences: DisplayPreferences = {};

function systemSignals(): SystemDisplaySignals {
  const query = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
  return {
    dark: query('(prefers-color-scheme: dark)'),
    moreContrast: query('(prefers-contrast: more)'),
    reducedMotion: query('(prefers-reduced-motion: reduce)'),
  };
}

/** The display every theme is applied with right now. */
export function currentDisplay(): ResolvedDisplay {
  return resolveDisplay(preferences, systemSignals());
}

const listeners = new Set<() => void>();

/** Called when the preferences or the system's answers change, so every theme on screen is redone. */
export function onDisplayChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Set the person's preferences, and redo every theme on screen under them. */
export function setDisplayPreferences(next: DisplayPreferences): void {
  preferences = { ...next };
  for (const listener of listeners) listener();
}

export function getDisplayPreferences(): DisplayPreferences {
  return preferences;
}

if (typeof matchMedia === 'function') {
  for (const q of ['(prefers-color-scheme: dark)', '(prefers-contrast: more)', '(prefers-reduced-motion: reduce)']) {
    matchMedia(q).addEventListener?.('change', () => {
      for (const listener of listeners) listener();
    });
  }
}
