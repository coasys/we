import { CodeEditor, Column, Row } from '@we/components/solid';
import { CONTRAST_MINIMUM, type ContrastLevel, contrastRatio, parseColor, tokenVar } from '@we/design-utils';
import type { ThemeOverrides, ThemeRole } from '@we/schema-shared';
import { roleVar, themeToStyle } from '@we/schema-shared';
import type { JSX } from 'solid-js';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

import { useEditorHost } from '../host';

const SAVE_DEBOUNCE_MS = 600;

// ─── Option lists ────────────────────────────────────────────────────────────

const BASE_THEME_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'black', label: 'Black' },
  { value: 'retro', label: 'Retro' },
  { value: 'cyberpunk', label: 'Cyberpunk' },
];

const FONT_OPTIONS = [
  { value: 'default', label: 'DM Sans' },
  { value: "'Mozilla Text', serif", label: 'Mozilla Text' },
  { value: "'Boldonse', serif", label: 'Boldonse' },
];

/**
 * "Match body" rather than "Default": unset here does not mean a particular face, it means the
 * heading takes whatever the body font is — including a change made on the row above.
 */
const HEADING_FONT_OPTIONS = [
  { value: 'match', label: 'Match body' },
  { value: "'DM Sans', sans-serif", label: 'DM Sans' },
  { value: "'Mozilla Text', serif", label: 'Mozilla Text' },
  { value: "'Boldonse', serif", label: 'Boldonse' },
];

const MONO_FONT_OPTIONS = [
  { value: 'system', label: 'System mono' },
  { value: "'Courier New', monospace", label: 'Courier' },
  { value: "ui-monospace, 'Cascadia Code', monospace", label: 'Cascadia' },
];

const LETTER_SPACING_OPTIONS = [
  { value: '-0.02em', label: 'Tight' },
  { value: 'default', label: 'Default' },
  { value: '0.04em', label: 'Airy' },
  { value: '0.08em', label: 'Wide' },
];

const LINE_HEIGHT_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: '1.5', label: 'Comfortable' },
  { value: '1.625', label: 'Relaxed' },
  { value: '2', label: 'Loose' },
];

const FONT_SCALE_PRESETS = {
  sm: 0.875,
  default: undefined,
  lg: 1.125,
  xl: 1.25,
} as const;

type FontScalePreset = keyof typeof FONT_SCALE_PRESETS;

const RADIUS_OPTIONS = [
  { value: '', label: 'Default' },
  { value: '0', label: 'None' },
  { value: 'var(--we-radius-100)', label: 'XS' },
  { value: 'var(--we-radius-200)', label: 'SM' },
  { value: 'var(--we-radius-300)', label: 'MD' },
  { value: 'var(--we-radius-400)', label: 'LG' },
  { value: 'var(--we-radius-600)', label: 'XL' },
  { value: 'var(--we-radius-pill)', label: 'Pill' },
];

/**
 * Avatars get Circle as well, and only avatars do.
 *
 * `full` is `50%` — a percentage, resolved per-axis — so it is a circle on a square box and an
 * ellipse on anything else. Avatars are square by construction; controls, surfaces and inputs are
 * not, which is why the option is absent from the shared list rather than filtered out of it.
 */
const AVATAR_RADIUS_OPTIONS = [...RADIUS_OPTIONS, { value: 'var(--we-radius-full)', label: 'Circle' }];

const SPACING_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'var(--we-space-100)', label: 'XS' },
  { value: 'var(--we-space-200)', label: 'SM' },
  { value: 'var(--we-space-300)', label: 'MD' },
  { value: 'var(--we-space-400)', label: 'LG' },
  { value: 'var(--we-space-500)', label: 'XL' },
  { value: 'var(--we-space-600)', label: 'XXL' },
  { value: 'var(--we-space-900)', label: 'XXXL' },
];

/**
 * Input padding is a full shorthand, not a single token: textarea shares this group and has no
 * fixed height to supply the vertical from, so a one-value option would either crush its text
 * against the top edge or push a fixed-height input's content out of its box.
 */
const INPUT_SPACING_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'var(--we-space-100) var(--we-space-200)', label: 'Compact' },
  { value: 'var(--we-space-200) var(--we-space-400)', label: 'Comfortable' },
  { value: 'var(--we-space-300) var(--we-space-500)', label: 'Spacious' },
];

/**
 * Every semantic role, grouped the way somebody designing a theme thinks about them.
 *
 * Roles are the difference between a theme that recolours and a theme that is designed: the
 * lightness scale steps evenly, so no combination of hue, saturation, multiplier and subtractor can
 * say "raised surfaces are lighter than the page by 6 but the rail is darker by 3.5". Both built-in
 * reference themes (channels, timeline) reach for roles to express exactly that, and until now the
 * only way for anyone else to do it was hand-writing the theme's CSS.
 */
const ROLE_GROUPS: { label: string; hint: string; roles: { role: ThemeRole; label: string; hint: string }[] }[] = [
  {
    label: 'Elevation',
    hint: 'How far a thing sits from the page. Ordered here the way they stack.',
    roles: [
      { role: 'page', label: 'Page', hint: 'The background behind everything, including the window itself.' },
      {
        role: 'surfaceSunken',
        label: 'Sunken',
        hint: 'A well recessed into a surface — an inset box, a code block, an input trough.',
      },
      {
        role: 'surface',
        label: 'Surface',
        hint: 'A card, panel or sheet sitting on the page. Most content sits on this.',
      },
      {
        role: 'surfaceRaised',
        label: 'Raised',
        hint: 'Something floating above the page — a popover, a menu, a docked rail, a floating bar.',
      },
    ],
  },
  {
    label: 'Interaction',
    hint: 'Feedback under the pointer. These are states, not places — they apply to rows, tabs, menu items and buttons alike.',
    roles: [
      { role: 'surfaceHover', label: 'Hover', hint: 'The tint a row or a ghost button takes under the pointer.' },
      { role: 'surfaceActive', label: 'Pressed', hint: 'The tint while it is actually being pressed.' },
      {
        role: 'controlSurface',
        label: 'Control fill',
        hint: 'The filled neutral of a control — a slider or switch track, a progress trough, a scrollbar thumb, a secondary button.',
      },
      { role: 'focus', label: 'Focus ring', hint: 'The ring around whatever the keyboard is on.' },
    ],
  },
  {
    label: 'Text',
    hint: 'Three levels of emphasis, plus the one that sits on a dark surface.',
    roles: [
      {
        role: 'text',
        label: 'Primary',
        hint: 'Body copy and headings. Most text in the app inherits this without asking.',
      },
      { role: 'textMuted', label: 'Muted', hint: 'Secondary text — captions, labels, metadata, timestamps.' },
      { role: 'textFaint', label: 'Faint', hint: 'Tertiary text — placeholders, disabled labels, decorative icons.' },
      {
        role: 'onInverse',
        label: 'On inverse',
        hint: 'Text on the inverse surface — a tooltip. Holds its lightness in both light and dark.',
      },
    ],
  },
  {
    label: 'Accent',
    hint: 'Your brand colour, in the four jobs it has to do.',
    roles: [
      { role: 'accent', label: 'Accent fill', hint: 'A filled accent — a primary button, a selected disc.' },
      { role: 'accentHover', label: 'Fill hover', hint: 'That fill under the pointer.' },
      { role: 'accentActive', label: 'Fill pressed', hint: 'That fill while pressed.' },
      { role: 'onAccent', label: 'On accent', hint: 'Text and icons placed ON an accent fill. Usually near-white.' },
      {
        role: 'accentText',
        label: 'Accent text',
        hint: 'The accent used AS text — a coloured heading or icon on an ordinary surface, where the fill colour is often too light to read.',
      },
      {
        role: 'accentMuted',
        label: 'Accent tint',
        hint: 'An accent-tinted fill — a selected row, a subtle highlight.',
      },
    ],
  },
  {
    label: 'Lines',
    hint: 'Borders and dividers.',
    roles: [
      { role: 'border', label: 'Border', hint: 'Default borders, dividers and hairlines.' },
      {
        role: 'borderStrong',
        label: 'Strong border',
        hint: 'Emphasised separation, and the outline a control takes on hover.',
      },
    ],
  },
  {
    label: 'Status',
    hint: 'Each status has a foreground and a tint. The foreground is the message; the tint is the panel behind it.',
    roles: [
      { role: 'dangerText', label: 'Danger', hint: 'Error text, a destructive icon, a failed state.' },
      { role: 'dangerSurface', label: 'Danger tint', hint: 'The panel behind danger content.' },
      { role: 'successText', label: 'Success', hint: 'A confirmation, a connected tick.' },
      { role: 'successSurface', label: 'Success tint', hint: 'The panel behind success content.' },
      { role: 'warningText', label: 'Warning', hint: 'A caution, something needing attention.' },
      { role: 'warningSurface', label: 'Warning tint', hint: 'The panel behind warning content.' },
    ],
  },
  {
    label: 'Depth & inversion',
    hint: 'The things that are deliberately not on the light/dark ramp.',
    roles: [
      {
        role: 'surfaceInverse',
        label: 'Inverse surface',
        hint: 'A surface deliberately opposite to the page — a tooltip. Stays dark in a dark theme too.',
      },
      { role: 'overlay', label: 'Scrim', hint: 'The dimming behind a modal or drawer. Carries its own transparency.' },
      {
        role: 'shadowColor',
        label: 'Shadow',
        hint: 'The colour shadows are built from. Tint it to match a coloured theme.',
      },
    ],
  },
];

/**
 * Which rung of the ladder a stored role value sits on.
 *
 * The string says it, so nothing needs to be remembered alongside it. It matters because the rungs
 * behave differently under everything else a theme can change: a `token` follows the hue sliders and
 * the light/dark polarity, a `lightness` pin (the form the built-in presets use) follows hue and
 * saturation but holds its lightness against a polarity flip, and a `custom` colour follows nothing
 * at all. Only the last is really "opting out", and the editor should say so rather than making it
 * the silent default.
 */
export type RoleTier = 'auto' | 'token' | 'lightness' | 'relative' | 'custom';

export function roleTier(value: string | undefined): RoleTier {
  if (!value) return 'auto';
  if (/^var\(--we-color-[a-z]+-\d+\)$/.test(value.trim())) return 'token';
  if (/^hsl\(\s*var\(--we-color-[a-z]+-hue\)/.test(value.trim())) return 'lightness';
  // A value expressed *against another role* — "a step lighter than the surface". It survives more
  // than any other pin: a change to the role it references carries through, and because the thing
  // it mixes toward inverts with the theme, so does the direction.
  if (/^color-mix\(/.test(value.trim())) return 'relative';
  return 'custom';
}

/** What to show beside the swatch: the token's name, or the rung. */
export function roleTierLabel(value: string | undefined): string {
  const tier = roleTier(value);
  if (tier === 'token') return /var\(--we-color-([a-z]+-\d+)\)/.exec(value!)![1];
  if (tier === 'lightness') return 'theme tint';
  if (tier === 'relative') return 'relative to another role';
  if (tier === 'custom') return 'custom';
  return 'auto';
}

/**
 * The `roles` value to store after setting one role — `undefined` once nothing is pinned.
 *
 * An empty object would persist as `"roles":{}`, which reads as "this theme pins roles" to anything
 * inspecting it and never becomes false again.
 */
export function nextRoles(
  current: Partial<Record<ThemeRole, string>> | undefined,
  role: ThemeRole,
  value: string | undefined,
): Partial<Record<ThemeRole, string>> | undefined {
  const next = { ...(current ?? {}) };
  if (value === undefined) delete next[role];
  else next[role] = value;
  return Object.keys(next).length ? next : undefined;
}

/**
 * The pairs the vocabulary already declares, and what each has to clear.
 *
 * This is the check nothing was doing: you could pin `text` to the same colour as `surface` and the
 * editor would smile at you. It is possible here *only* because the roles name their pairings —
 * `onAccent` is defined as the thing that sits on `accent`, `dangerText` as the message on
 * `dangerSurface` — so the foreground and the background of each test are known rather than guessed
 * at by walking the DOM.
 *
 * `ui` pairs are the 3:1 ones: a border or a focus ring is not text, and holding it to 4.5 would
 * fail every reasonable design. `large` is for text that is always rendered big.
 */
const CONTRAST_PAIRS: { fg: ThemeRole; bg: ThemeRole; level: ContrastLevel; what: string }[] = [
  { fg: 'text', bg: 'page', level: 'body', what: 'Body text on the page' },
  { fg: 'text', bg: 'surface', level: 'body', what: 'Body text on a card' },
  { fg: 'text', bg: 'surfaceSunken', level: 'body', what: 'Body text in a well' },
  { fg: 'textMuted', bg: 'surface', level: 'body', what: 'Muted text on a card' },
  { fg: 'textFaint', bg: 'surface', level: 'large', what: 'Faint text on a card' },
  { fg: 'onAccent', bg: 'accent', level: 'body', what: 'Label on a primary button' },
  { fg: 'onAccent', bg: 'accentHover', level: 'body', what: 'Label on a hovered primary button' },
  { fg: 'accentText', bg: 'surface', level: 'body', what: 'Accent text on a card' },
  { fg: 'accentText', bg: 'accentMuted', level: 'body', what: 'Accent text on its own tint' },
  { fg: 'onInverse', bg: 'surfaceInverse', level: 'body', what: 'Tooltip text' },
  { fg: 'dangerText', bg: 'dangerSurface', level: 'body', what: 'Danger text on its tint' },
  { fg: 'dangerText', bg: 'surface', level: 'body', what: 'Danger text on a card' },
  { fg: 'successText', bg: 'successSurface', level: 'body', what: 'Success text on its tint' },
  { fg: 'warningText', bg: 'warningSurface', level: 'body', what: 'Warning text on its tint' },
  { fg: 'border', bg: 'surface', level: 'ui', what: 'A border against a card' },
  { fg: 'focus', bg: 'page', level: 'ui', what: 'The focus ring on the page' },
];

const HEIGHT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: '-4px', label: 'Short' },
  { value: '4px', label: 'Tall' },
  { value: '8px', label: 'Taller' },
  { value: '12px', label: 'Tallest' },
];

// ─── Presets ──────────────────────────────────────────────────────────────────

/**
 * Only `sharp` touches `avatarRadius`. "Rounded" and "Pill" describe a corner treatment, and an
 * avatar is already as round as a corner gets — squaring it off there would surprise. A sharp theme
 * is the one case where circular avatars actively contradict what the preset says.
 */
const SHAPE_PRESETS = {
  sharp: { controlRadius: '0', surfaceRadius: '0', inputRadius: '0', avatarRadius: '0' },
  default: { controlRadius: undefined, surfaceRadius: undefined, inputRadius: undefined, avatarRadius: undefined },
  rounded: {
    controlRadius: 'var(--we-radius-600)',
    surfaceRadius: 'var(--we-radius-600)',
    inputRadius: 'var(--we-radius-600)',
    avatarRadius: undefined,
  },
  pill: {
    controlRadius: 'var(--we-radius-pill)',
    surfaceRadius: 'var(--we-radius-600)',
    inputRadius: 'var(--we-radius-pill)',
    avatarRadius: undefined,
  },
} as const;

const SPACING_PRESETS = {
  compact: {
    controlPaddingX: 'var(--we-space-200)',
    controlGap: 'var(--we-space-100)',
    controlHeight: '-4px',
    surfaceSpacing: 'var(--we-space-300)',
    surfaceGap: 'var(--we-space-200)',
    inputSpacing: 'var(--we-space-100) var(--we-space-200)',
  },
  comfortable: {
    controlPaddingX: undefined,
    controlGap: undefined,
    controlHeight: undefined,
    surfaceSpacing: undefined,
    surfaceGap: undefined,
    inputSpacing: undefined,
  },
  spacious: {
    controlPaddingX: 'var(--we-space-600)',
    controlGap: 'var(--we-space-400)',
    controlHeight: '8px',
    surfaceSpacing: 'var(--we-space-900)',
    surfaceGap: 'var(--we-space-600)',
    inputSpacing: 'var(--we-space-300) var(--we-space-500)',
  },
} as const;

type ShapePreset = keyof typeof SHAPE_PRESETS;
type SpacingPreset = keyof typeof SPACING_PRESETS;

// ─── Shared atoms ─────────────────────────────────────────────────────────────

function HueSwatch(props: { hue: number }) {
  return (
    <div
      style={{
        width: '20px',
        height: '20px',
        'border-radius': '50%',
        background: `hsl(${props.hue} 60% 50%)`,
        'flex-shrink': '0',
        border: `1px solid ${tokenVar('color', 'neutral-200')}`,
      }}
    />
  );
}

function SectionLabel(props: { children: string }) {
  return (
    <we-text fontSize="200" fontWeight="600" color="text-muted" textTransform="uppercase" letterSpacing="0.05em">
      {props.children}
    </we-text>
  );
}

function CollapsibleSection(props: { title: string; defaultOpen?: boolean; children: JSX.Element }) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false);
  return (
    <Column borderBottom={`1px solid ${tokenVar('color', 'neutral-100')}`} pb="0">
      <Row ay="center" ax="between" py="300" onClick={() => setOpen(!open())} cursor="pointer">
        <SectionLabel>{props.title}</SectionLabel>
        <we-icon name={open() ? 'caret-up' : 'caret-down'} size="sm" color="text-faint" />
      </Row>
      <Show when={open()}>
        <Column gap="300" pb="400">
          {props.children}
        </Column>
      </Show>
    </Column>
  );
}

// ─── ThemePanel ───────────────────────────────────────────────────────────────

export function ThemePanel() {
  const session = useEditorHost().session;
  const themeStore = useEditorHost().theme;

  const editing = () => themeStore.editingTheme();
  const overrides = createMemo<ThemeOverrides>(() => {
    const raw = editing()?.overrides;
    return raw ? JSON.parse(raw) : {};
  });

  const [cssEditing, setCssEditing] = createSignal(false);
  const [cssValue, setCssValue] = createSignal('');

  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  function saveTheme() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => themeStore.saveEditingTheme(), SAVE_DEBOUNCE_MS);
  }

  function saveThemeNow() {
    clearTimeout(saveTimer);
    themeStore.saveEditingTheme();
  }

  onCleanup(() => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      themeStore.saveEditingTheme();
    }
  });

  function setOverride<K extends keyof ThemeOverrides>(key: K, value: ThemeOverrides[K] | undefined) {
    // Pass undefined explicitly — updateEditingOverrides spreads it into the existing overrides,
    // and JSON.stringify strips undefined values, which correctly deletes the key.
    themeStore.updateEditingOverrides({ [key]: value } as Partial<ThemeOverrides>);
  }

  function setOverrides(partial: Partial<ThemeOverrides>) {
    // Pass the partial directly with undefined values intact. The spread in updateEditingOverrides
    // will shadow existing keys with undefined, and JSON.stringify will strip them.
    themeStore.updateEditingOverrides(partial);
    saveTheme();
  }

  // ── Slider helpers ──────────────────────────────────────────────────────────

  function hueSlider(label: string, key: keyof ThemeOverrides, defaultVal = 0) {
    const val = () => (overrides()[key] as number | undefined) ?? defaultVal;
    return (
      <Row ay="center" gap="300">
        <we-text minWidth="80px" fontSize="300" color="text-muted">
          {label}
        </we-text>
        <HueSwatch hue={val()} />
        <we-slider
          flex="1"
          value={val()}
          min={0}
          max={359}
          step={1}
          on:input={(e: CustomEvent) => setOverride(key, Number(e.detail))}
          on:change={() => saveTheme()}
        />
        <we-text minWidth="32px" fontSize="200" color="text-muted" textAlign="right">
          {val()}°
        </we-text>
      </Row>
    );
  }

  function percentSlider(label: string, key: keyof ThemeOverrides, min: number, max: number, defaultVal: number) {
    const raw = () => overrides()[key] as string | undefined;
    const numVal = () => {
      const r = raw();
      return r !== undefined ? parseFloat(r) : defaultVal;
    };
    return (
      <Row ay="center" gap="300">
        <we-text minWidth="130px" fontSize="300" color="text-muted">
          {label}
        </we-text>
        <we-slider
          flex="1"
          value={numVal()}
          min={min}
          max={max}
          step={1}
          on:input={(e: CustomEvent) => setOverride(key, `${e.detail}%`)}
          on:change={() => saveTheme()}
        />
        <we-text minWidth="36px" fontSize="200" color="text-muted" textAlign="right">
          {numVal()}%
        </we-text>
      </Row>
    );
  }

  function numericSlider(
    label: string,
    key: keyof ThemeOverrides,
    defaultVal: number,
    {
      min,
      max,
      step,
      format,
      clearOnZero = false,
    }: { min: number; max: number; step: number; format: (v: number) => string; clearOnZero?: boolean },
  ) {
    const val = () => (overrides()[key] as number | undefined) ?? defaultVal;
    return (
      <Row ay="center" gap="300">
        <we-text minWidth="120px" fontSize="300" color="text-muted">
          {label}
        </we-text>
        <we-slider
          flex="1"
          value={val()}
          min={min}
          max={max}
          step={step}
          on:input={(e: CustomEvent) => {
            const raw = step < 1 ? Number(Number(e.detail).toFixed(2)) : Number(e.detail);
            setOverride(key, (clearOnZero && raw === 0 ? undefined : raw) as ThemeOverrides[typeof key]);
          }}
          on:change={() => saveTheme()}
        />
        <we-text minWidth="36px" fontSize="200" color="text-muted" textAlign="right">
          {format(val())}
        </we-text>
      </Row>
    );
  }

  // ── Select control ──────────────────────────────────────────────────────────

  function selectControl(
    label: string,
    key: keyof ThemeOverrides,
    options: { value: string; label: string }[],
    labelWidth = '100px',
    sentinel = '',
  ) {
    const current = () => {
      const v = overrides()[key] as string | undefined;
      const resolved = v ?? sentinel;
      // If the stored value isn't one of our known options, treat it as the default.
      // This handles values auto-populated from base theme CSS (e.g. "'DM Sans', sans-serif").
      if (sentinel && !options.some((o) => o.value === resolved)) return sentinel;
      return resolved;
    };
    return (
      <Row ay="center" gap="300">
        <we-text minWidth={labelWidth} fontSize="300" color="text-muted">
          {label}
        </we-text>
        <we-select
          flex="1"
          value={current()}
          options={options}
          size="sm"
          on:change={(e: CustomEvent) => {
            const val = e.detail as string;
            setOverride(key, val === sentinel || !val ? undefined : val);
            saveTheme();
          }}
        />
      </Row>
    );
  }

  // ── Preset button row ───────────────────────────────────────────────────────

  function presetRow<T extends string>(
    labels: Record<T, string>,
    isActive: (p: T) => boolean,
    onSelect: (p: T) => void,
  ) {
    return (
      <Row gap="100">
        {(Object.keys(labels) as T[]).map((p) => (
          <we-button size="sm" variant={isActive(p) ? 'secondary' : 'ghost'} onClick={() => onSelect(p)} flex="1">
            {labels[p]}
          </we-button>
        ))}
      </Row>
    );
  }

  // ── Font scale preset helper ────────────────────────────────────────────────

  function activeFontScalePreset(): FontScalePreset {
    const scale = overrides().fontScale ?? undefined;
    for (const [name, val] of Object.entries(FONT_SCALE_PRESETS) as [FontScalePreset, number | undefined][]) {
      if (scale === val) return name;
    }
    return 'default';
  }

  // ── Shape preset helpers ────────────────────────────────────────────────────

  function activeShapePreset(): ShapePreset | 'custom' {
    const o = overrides();
    for (const [name, vals] of Object.entries(SHAPE_PRESETS) as [ShapePreset, (typeof SHAPE_PRESETS)[ShapePreset]][]) {
      if (
        (o.controlRadius ?? undefined) === vals.controlRadius &&
        (o.surfaceRadius ?? undefined) === vals.surfaceRadius &&
        (o.inputRadius ?? undefined) === vals.inputRadius &&
        (o.avatarRadius ?? undefined) === vals.avatarRadius
      ) {
        return name;
      }
    }
    return 'custom';
  }

  function activeSpacingPreset(): SpacingPreset | 'custom' {
    const o = overrides();
    for (const [name, vals] of Object.entries(SPACING_PRESETS) as [
      SpacingPreset,
      (typeof SPACING_PRESETS)[SpacingPreset],
    ][]) {
      if (
        (o.controlPaddingX ?? undefined) === vals.controlPaddingX &&
        (o.controlGap ?? undefined) === vals.controlGap &&
        (o.controlHeight ?? undefined) === vals.controlHeight &&
        (o.surfaceSpacing ?? undefined) === vals.surfaceSpacing &&
        (o.surfaceGap ?? undefined) === vals.surfaceGap &&
        (o.inputSpacing ?? undefined) === vals.inputSpacing
      ) {
        return name;
      }
    }
    return 'custom';
  }

  // ── Semantic roles ──────────────────────────────────────────────────────────

  /*
    A hidden element carrying the theme being edited, so a swatch can be read off it.

    The panel is editor chrome, and the theme it is editing is usually not applied to it: a space
    theme is scoped to the space's own content by default, so sampling --we-role-* from the panel —
    or from documentElement — would report the *personal* theme's colours, and every unpinned role
    would show a swatch from the wrong theme entirely. One throwaway element carrying the edited
    overrides is the only place guaranteed to resolve them the way the space will.
  */
  let roleProbe: HTMLDivElement | undefined;
  const [roleColors, setRoleColors] = createSignal<Record<string, string>>({});
  const probeStyle = createMemo(() => themeToStyle(overrides()) as Record<string, string>);

  /**
   * Resolve any CSS colour — an hsl(), a var() chain, a hex — to what the browser paints.
   *
   * Returned as the computed string rather than a hex, so a role that carries transparency keeps
   * it: the scrim is 60% alpha by default, and handing its picker an opaque hex would open it on a
   * colour the role has never been.
   */
  function resolveColor(el: HTMLElement, value: string): string {
    el.style.color = '';
    el.style.color = value;
    return getComputedStyle(el).color;
  }

  createEffect(() => {
    probeStyle(); // re-sample whenever any part of the theme changes
    if (!roleProbe) return;
    const computed = getComputedStyle(roleProbe);
    const next: Record<string, string> = {};
    for (const group of ROLE_GROUPS) {
      for (const { role } of group.roles) {
        next[role] = resolveColor(roleProbe, computed.getPropertyValue(roleVar(role)).trim());
      }
    }
    roleProbe.style.color = '';
    setRoleColors(next);
  });

  /**
   * Every declared pair that currently fails, measured against what the theme actually resolves to.
   *
   * Sampled from the probe rather than from the stored overrides, so it judges the *result* — a
   * theme that pins nothing is still checked, and so is one whose failure comes from a hue slider
   * two sections up rather than from a role at all.
   */
  const contrastFailures = createMemo(() => {
    const colors = roleColors();
    return CONTRAST_PAIRS.flatMap((pair) => {
      const fg = parseColor(colors[pair.fg] ?? '');
      const bg = parseColor(colors[pair.bg] ?? '');
      if (!fg || !bg) return [];
      const ratio = contrastRatio(fg, bg);
      const required = CONTRAST_MINIMUM[pair.level];
      return ratio < required ? [{ ...pair, ratio, required }] : [];
    });
  });

  function setRole(role: ThemeRole, value: string | undefined) {
    themeStore.updateEditingOverrides({ roles: nextRoles(overrides().roles, role, value) });
    saveTheme();
  }

  /**
   * A small gallery rendered in the theme being edited.
   *
   * Every role needs somewhere visible to land, and no single screen of a real app contains one of
   * everything — the roles that look inert are usually the ones the current route happens not to
   * use. Editing a colour and looking is the natural way to understand what it does; this is what
   * makes that reliable rather than a hunt for a screen with a tooltip on it.
   *
   * It carries `probeStyle` for the same reason the sampling probe does: the panel is chrome, and
   * in scoped mode the theme being edited is not the one the chrome is wearing.
   */
  function previewStrip() {
    const chip = (bg: string, fg: string, text: string) => (
      <Column bg={bg} color={fg} px="200" py="100" r="200" fontSize="100">
        {text}
      </Column>
    );
    return (
      <div style={{ ...probeStyle(), 'border-radius': tokenVar('radius', '300'), overflow: 'hidden' }}>
        <Column bg="page" p="300" gap="300">
          <Column bg="surface" p="300" r="300" gap="200" border={`1px solid ${'var(--we-role-border)'}`}>
            <we-text fontSize="300" fontWeight="600" color="text">
              A card on the page
            </we-text>
            <we-text fontSize="200" color="text-muted">
              Muted supporting text.
            </we-text>
            <we-text fontSize="100" color="text-faint">
              Faint metadata.
            </we-text>
            <Row gap="200" ay="center" wrap>
              <we-button size="xs" variant="primary">
                Primary
              </we-button>
              <we-button size="xs" variant="secondary">
                Secondary
              </we-button>
              <we-button size="xs" variant="ghost">
                Ghost
              </we-button>
            </Row>
            <we-input size="sm" placeholder="An input…" />
            <Row gap="100" wrap>
              {chip('danger-surface', 'danger-text', 'Danger')}
              {chip('success-surface', 'success-text', 'Success')}
              {chip('warning-surface', 'warning-text', 'Warning')}
              {chip('accent-muted', 'accent-text', 'Accent')}
            </Row>
          </Column>
          <Row gap="200" ay="center">
            <Column bg="surface-raised" px="300" py="200" r="300" shadow="md" fontSize="100" color="text">
              Raised
            </Column>
            <Column bg="surface-sunken" px="300" py="200" r="300" fontSize="100" color="text-muted">
              Sunken
            </Column>
            <Column bg="surface-inverse" px="300" py="200" r="300" fontSize="100" color="on-inverse">
              Tooltip
            </Column>
          </Row>
        </Column>
      </div>
    );
  }

  function roleRow(role: ThemeRole, label: string, hint: string) {
    const pinned = () => overrides().roles?.[role];
    // Unpinned, the swatch shows what the role currently resolves to — sampled with its alpha, so
    // opening the scrim's picker starts on a translucent colour rather than an opaque guess.
    const shown = () => pinned() ?? roleColors()[role] ?? '#000000';
    return (
      <Row ay="center" gap="300">
        <we-color-picker
          tokens
          alpha
          styles={{ '--we-color-picker-swatch': '28px' }}
          value={shown()}
          on:change={(e: CustomEvent) => setRole(role, e.detail as string)}
        />
        <Column flex="1" gap="0">
          {/*
            The tooltip hangs off the label rather than an info icon beside it: every row would
            need one, and a column of forty ⓘ glyphs is noise standing in for an explanation. The
            label is already the thing you point at when you are wondering what it means.
          */}
          <we-tooltip title={hint} placement="left">
            <we-text fontSize="300" color={pinned() ? 'text' : 'text-muted'} cursor="help">
              {label}
            </we-text>
          </we-tooltip>
          <we-text fontSize="100" color="text-faint" truncate>
            {roleTierLabel(pinned())}
          </we-text>
        </Column>
        <Show when={pinned()}>
          <we-tooltip title="Back to the parametric default">
            <we-button variant="ghost" size="xs" onClick={() => setRole(role, undefined)}>
              <we-icon name="arrow-counter-clockwise" />
            </we-button>
          </we-tooltip>
        </Show>
      </Row>
    );
  }

  // ── CSS edit helpers ────────────────────────────────────────────────────────

  function startCssEdit() {
    setCssValue(editing()?.css ?? '');
    setCssEditing(true);
  }

  function commitCssEdit() {
    themeStore.updateEditingCss(cssValue());
    setCssEditing(false);
    saveThemeNow();
  }

  function cancelCssEdit() {
    setCssEditing(false);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Column height="100%" width="100%" bg="surface-raised" overflow="hidden">
      {/* Header */}
      <Row
        ax="between"
        ay="center"
        px="400"
        py="300"
        borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
        flexShrink="0"
      >
        <we-text fontSize="500" fontWeight="600">
          Theme Editor
        </we-text>
        <we-tooltip title="Close theme panel">
          <we-button variant="ghost" size="sm" onClick={() => session.closeThemePanel()}>
            <we-icon name="x" size="sm" />
          </we-button>
        </we-tooltip>
      </Row>

      <Show
        when={editing()}
        fallback={
          <Column ax="center" ay="center" flex="1" gap="300" p="500">
            <we-icon name="paint-bucket" color="text-faint" size="xl" />
            <we-text fontSize="400" color="text-muted" textAlign="center">
              No theme selected for editing
            </we-text>
            <we-button variant="secondary" size="sm" onClick={() => themeStore.startEditing()}>
              Edit current theme
            </we-button>
          </Column>
        }
      >
        {/* Carries the edited theme so role swatches can be sampled from it — see setRole above.
            Rendered rather than detached: a custom property only resolves inside the document. */}
        <div
          ref={roleProbe}
          aria-hidden="true"
          style={{ ...probeStyle(), position: 'absolute', width: '0', height: '0', visibility: 'hidden' }}
        />

        <we-scroll-area flex="1">
          <Column gap="0" p="400">
            {/* ── Name + icon ── */}
            <Column gap="200" borderBottom={`1px solid ${tokenVar('color', 'neutral-100')}`} pb="400" mb="0">
              <SectionLabel>Theme name</SectionLabel>
              <Row gap="200" ay="center">
                <we-icon-picker
                  value={editing()!.icon}
                  size="sm"
                  on:change={(e: CustomEvent) => {
                    themeStore.updateEditingMeta({ icon: e.detail });
                    saveTheme();
                  }}
                />
                <we-input
                  value={editing()!.name}
                  placeholder="Theme name"
                  size="sm"
                  flex="1"
                  on:input={(e: CustomEvent) => themeStore.updateEditingMeta({ name: e.detail })}
                  on:blur={() => saveTheme()}
                />
              </Row>
            </Column>

            {/* ── Base preset ── */}
            <CollapsibleSection title="Base preset">
              <we-select
                value={overrides().themeName ?? ''}
                options={BASE_THEME_OPTIONS}
                size="sm"
                on:change={(e: CustomEvent) => {
                  themeStore.changeBasePreset((e.detail as string) || undefined);
                  saveTheme();
                }}
              />
              <Row gap="200">
                <we-button
                  size="sm"
                  variant={(overrides().multiplier ?? 1) === 1 ? 'secondary' : 'ghost'}
                  flex="1"
                  onClick={() => {
                    setOverrides({ multiplier: 1, subtractor: '0%' });
                  }}
                >
                  <we-icon name="sun" />
                  Light
                </we-button>
                <we-button
                  size="sm"
                  variant={(overrides().multiplier ?? 1) === -1 ? 'secondary' : 'ghost'}
                  flex="1"
                  onClick={() => {
                    setOverrides({ multiplier: -1, subtractor: '108%' });
                  }}
                >
                  <we-icon name="moon" />
                  Dark
                </we-button>
              </Row>
            </CollapsibleSection>

            {/* ── Color ── */}
            <CollapsibleSection title="Color">
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Hues
                </we-text>
                {hueSlider('Primary', 'primaryHue', 220)}
                {hueSlider('Success', 'successHue', 142)}
                {hueSlider('Warning', 'warningHue', 38)}
                {hueSlider('Danger', 'dangerHue', 4)}
                {hueSlider('Neutral', 'neutralHue', 220)}
              </Column>
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Saturation
                </we-text>
                {percentSlider('Colors', 'saturation', 0, 100, 50)}
                {percentSlider('Neutrals', 'neutralSaturation', 0, 100, 20)}
              </Column>
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Lightness
                </we-text>
                {percentSlider('Subtractor', 'subtractor', 0, 200, 0)}
              </Column>
            </CollapsibleSection>

            {/* ── Roles ── */}
            <CollapsibleSection title="Roles">
              <we-text fontSize="200" color="text-muted" lineHeight="1.5">
                What a colour <i>means</i>, rather than where it sits on the scale. Left alone, each follows the hues
                and lightness above — pin one to redesign a relationship the scale cannot express, such as raised
                surfaces getting lighter in a dark theme instead of casting a shadow.
              </we-text>
              {previewStrip()}

              {/*
                Shown where the decisions are made rather than on a separate audit screen: a
                warning you have to go and look for is one nobody looks for. It reports the *result*,
                so a failure caused by the hue sliders reads the same as one caused by a pin.
              */}
              <Show when={contrastFailures().length}>
                <Column gap="100" p="300" r="200" bg="warning-surface">
                  <Row ay="center" gap="200">
                    <we-icon name="warning" size="xs" color="warning-text" />
                    <we-text fontSize="200" fontWeight="600" color="warning-text">
                      {contrastFailures().length} contrast {contrastFailures().length === 1 ? 'issue' : 'issues'}
                    </we-text>
                  </Row>
                  <For each={contrastFailures()}>
                    {(f) => (
                      <we-text fontSize="100" color="text-muted" lineHeight="1.4">
                        {f.what} — {f.ratio.toFixed(1)}:1, needs {f.required}:1
                      </we-text>
                    )}
                  </For>
                </Column>
              </Show>

              <For each={ROLE_GROUPS}>
                {(group) => (
                  <Column gap="200">
                    <we-text fontSize="200" color="text-faint">
                      {group.label}
                    </we-text>
                    {/* What the group is *for*, once, rather than repeated on every row inside it. */}
                    <we-text fontSize="100" color="text-faint" lineHeight="1.4">
                      {group.hint}
                    </we-text>
                    <For each={group.roles}>{(entry) => roleRow(entry.role, entry.label, entry.hint)}</For>
                  </Column>
                )}
              </For>
            </CollapsibleSection>

            {/* ── Shape ── */}
            <CollapsibleSection title="Shape">
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Preset
                </we-text>
                {presetRow(
                  { sharp: 'Sharp', default: 'Default', rounded: 'Rounded', pill: 'Pill' } as Record<
                    ShapePreset,
                    string
                  >,
                  (p) => activeShapePreset() === p,
                  (p) => setOverrides(SHAPE_PRESETS[p]),
                )}
              </Column>
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Overrides
                </we-text>
                {selectControl('Controls', 'controlRadius', RADIUS_OPTIONS, '80px')}
                {selectControl('Surfaces', 'surfaceRadius', RADIUS_OPTIONS, '80px')}
                {selectControl('Inputs', 'inputRadius', RADIUS_OPTIONS, '80px')}
                {selectControl('Avatars', 'avatarRadius', AVATAR_RADIUS_OPTIONS, '80px')}
              </Column>
            </CollapsibleSection>

            {/* ── Typography ── */}
            <CollapsibleSection title="Typography">
              {selectControl('Font family', 'fontFamily', FONT_OPTIONS, '100px', 'default')}
              {selectControl('Heading font', 'headingFontFamily', HEADING_FONT_OPTIONS, '100px', 'match')}
              {selectControl('Code font', 'monoFontFamily', MONO_FONT_OPTIONS, '100px', 'system')}
              {selectControl('Letter spacing', 'letterSpacing', LETTER_SPACING_OPTIONS, '100px', 'default')}
              {selectControl('Line height', 'lineHeight', LINE_HEIGHT_OPTIONS, '100px', 'default')}
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Scale
                </we-text>
                {presetRow(
                  { sm: 'Small', default: 'Default', lg: 'Large', xl: 'XL' } as Record<FontScalePreset, string>,
                  (p) => activeFontScalePreset() === p,
                  (p) => {
                    const scale = FONT_SCALE_PRESETS[p];
                    setOverrides({ fontScale: scale });
                  },
                )}
              </Column>
            </CollapsibleSection>

            {/* ── Spacing & Density ── */}
            <CollapsibleSection title="Spacing & Density">
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Preset
                </we-text>
                {presetRow(
                  { compact: 'Compact', comfortable: 'Comfortable', spacious: 'Spacious' } as Record<
                    SpacingPreset,
                    string
                  >,
                  (p) => activeSpacingPreset() === p,
                  (p) => setOverrides(SPACING_PRESETS[p]),
                )}
              </Column>
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Overrides
                </we-text>
                {selectControl('Control padding', 'controlPaddingX', SPACING_OPTIONS, '120px')}
                {selectControl('Control gap', 'controlGap', SPACING_OPTIONS, '120px')}
                {selectControl('Control height', 'controlHeight', HEIGHT_OPTIONS, '120px')}
                {selectControl('Surface padding', 'surfaceSpacing', SPACING_OPTIONS, '120px')}
                {selectControl('Surface gap', 'surfaceGap', SPACING_OPTIONS, '120px')}
                {selectControl('Input padding', 'inputSpacing', INPUT_SPACING_OPTIONS, '120px')}
              </Column>
            </CollapsibleSection>

            {/* ── Effects & Motion ── */}
            <CollapsibleSection title="Effects & Motion">
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Shadow intensity
                </we-text>
                {presetRow(
                  { flat: 'Flat', subtle: 'Subtle', elevated: 'Elevated', dramatic: 'Dramatic' } as Record<
                    NonNullable<ThemeOverrides['shadowIntensity']>,
                    string
                  >,
                  (p) => overrides().shadowIntensity === p,
                  (p) => {
                    setOverride('shadowIntensity', p);
                    saveTheme();
                  },
                )}
              </Column>
              {numericSlider('Surface opacity', 'surfaceOpacity', 1, {
                min: 0,
                max: 1,
                step: 0.05,
                format: (v) => `${Math.round(v * 100)}%`,
              })}
              {numericSlider('Surface blur', 'surfaceBlur', 0, {
                min: 0,
                max: 24,
                step: 1,
                format: (v) => `${v}px`,
                clearOnZero: true,
              })}
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Animation speed
                </we-text>
                {presetRow(
                  { none: 'None', fast: 'Fast', normal: 'Normal', slow: 'Slow' } as Record<
                    NonNullable<ThemeOverrides['animationSpeed']>,
                    string
                  >,
                  (p) => (overrides().animationSpeed ?? 'normal') === p,
                  (p) => {
                    setOverride('animationSpeed', p === 'normal' ? undefined : p);
                    saveTheme();
                  },
                )}
              </Column>
            </CollapsibleSection>

            {/* ── Custom CSS ── */}
            <CollapsibleSection title="Custom CSS">
              <Row ax="end">
                <Show
                  when={cssEditing()}
                  fallback={
                    <we-button size="sm" variant="ghost" onClick={startCssEdit}>
                      <we-icon name="pencil-simple" size="sm" />
                      Edit
                    </we-button>
                  }
                >
                  <Row gap="100">
                    <we-button size="sm" variant="ghost" onClick={cancelCssEdit}>
                      Cancel
                    </we-button>
                    <we-button size="sm" onClick={commitCssEdit}>
                      Save CSS
                    </we-button>
                  </Row>
                </Show>
              </Row>
              <CodeEditor
                language="css"
                code={cssEditing() ? cssValue() : (editing()?.css ?? '')}
                readOnly={!cssEditing()}
                onChange={setCssValue}
                styles={{ height: '200px' }}
              />
            </CollapsibleSection>
          </Column>
        </we-scroll-area>
      </Show>
    </Column>
  );
}
