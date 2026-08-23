import { CodeEditor, Column, Row } from '@we/components/solid';
import {
  APCA_MINIMUM,
  apcaContrast,
  CONTRAST_MINIMUM,
  type ContrastLevel,
  contrastRatio,
  parseColor,
  perceptualDistance,
  relativeLuminance,
  simulateVision,
  tokenVar,
} from '@we/design-utils';
import type { ThemeOverrides, ThemeRole } from '@we/schema-shared';
import { applyThemeVars, roleVar, surfacesForPolarity, themeParametersToStyle } from '@we/schema-shared';
import type { JSX } from 'solid-js';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

import { useEditorHost } from '../host';
import { nextRoles, roleTierLabel } from '../themeRoles';

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

/**
 * Stroke weight, as the three answers anybody actually wants.
 *
 * A free length would be more expressive and worse: the interesting decisions here are hairline,
 * standard and heavy, and offering a number invites 1.5px, which renders as a smeared 2px on a
 * non-integer device pixel ratio.
 */
const BORDER_WIDTH_OPTIONS = [
  { value: '', label: 'Default' },
  { value: '1px', label: 'Hairline' },
  { value: '2px', label: 'Medium' },
  { value: '3px', label: 'Heavy' },
];

const RING_WIDTH_OPTIONS = [
  { value: '', label: 'Default' },
  { value: '1px', label: 'Thin' },
  { value: '2px', label: 'Medium' },
  { value: '4px', label: 'Thick' },
];

const DISABLED_OPACITY_OPTIONS = [
  { value: '', label: 'Default' },
  { value: '0.7', label: 'Subtle' },
  { value: '0.5', label: 'Standard' },
  { value: '0.3', label: 'Strong' },
];

const SPACING_SCALE_OPTIONS = [
  { value: '', label: 'Default' },
  { value: '0.85', label: 'Compact' },
  { value: '1.15', label: 'Roomy' },
  { value: '1.3', label: 'Spacious' },
];

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
 * lightness scale steps evenly, so no combination of hue, saturation, polarity and range can
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
/**
 * A measurement rendered so it can never read as passing.
 *
 * `toFixed` rounds, and every one of these numbers is printed *because it fell short* — so a
 * `dangerText` at Lc 59.6 printed "Lc 60, needs Lc 60", which reads as a warning about a pair that
 * is fine. Truncating instead means the number shown is never above the true one, so a reported
 * failure always looks like one.
 *
 * Only correct for values known to be non-negative, which these are: `apcaContrast` returns an
 * absolute Lc and a contrast ratio starts at 1.
 */
function shortfall(value: number, decimals = 0): string {
  const scale = 10 ** decimals;
  return (Math.floor(value * scale) / scale).toFixed(decimals);
}

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
    controlHeightOffset: '-4px',
    surfacePadding: 'var(--we-space-300)',
    surfaceGap: 'var(--we-space-200)',
    inputPadding: 'var(--we-space-100) var(--we-space-200)',
  },
  comfortable: {
    controlPaddingX: undefined,
    controlGap: undefined,
    controlHeightOffset: undefined,
    surfacePadding: undefined,
    surfaceGap: undefined,
    inputPadding: undefined,
  },
  spacious: {
    controlPaddingX: 'var(--we-space-600)',
    controlGap: 'var(--we-space-400)',
    controlHeightOffset: '8px',
    surfacePadding: 'var(--we-space-900)',
    surfaceGap: 'var(--we-space-600)',
    inputPadding: 'var(--we-space-300) var(--we-space-500)',
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

/**
 * A preference that outlives the session, kept out of the theme itself.
 *
 * Whether somebody wants the preview on screen is about them, not about the theme they are editing
 * — so it must not travel with a published theme, and it should still be true tomorrow.
 */
function persistedFlag(key: string, fallback: boolean) {
  const read = () => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v === '1';
    } catch {
      return fallback; // Private mode, or no storage at all. A preference is not worth throwing over.
    }
  };
  const [value, setValue] = createSignal(read());
  return [
    value,
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        /* as above */
      }
    },
  ] as const;
}

function CollapsibleSection(props: {
  title: string;
  defaultOpen?: boolean;
  /**
   * Opens the section when it turns truthy — for arriving at a row inside a collapsed group.
   *
   * A section owns whether it is open, which is right for a click on its header and useless for
   * being sent to something inside it: the inspector's "take me to this role" landed on a row that
   * was not rendered, so the scroll had nothing to scroll to and the jump silently did nothing.
   * Only ever opens; it never closes a section somebody opened themselves.
   */
  openOn?: () => unknown;
  children: JSX.Element;
}) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false);
  createEffect(() => {
    if (props.openOn?.()) setOpen(true);
  });
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
  const [previewOpen, setPreviewOpen] = persistedFlag('we.themePanel.preview', true);

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

  /**
   * A 0–N slider over a theme key, which may be stored as a percentage string or a plain number.
   *
   * Both spellings exist on purpose. A lightness bound stays a percentage, because
   * that is what it is; `saturation` became a plain number when the ramp moved to OKLCH, where it
   * scales an absolute chroma rather than expressing a proportion. `unit` says which to write back,
   * so the slider itself does not have to know why.
   */
  function percentSlider(
    label: string,
    key: keyof ThemeOverrides,
    min: number,
    max: number,
    defaultVal: number,
    unit: '%' | '' = '%',
  ) {
    const raw = () => overrides()[key] as string | number | undefined;
    const numVal = () => {
      const r = raw();
      return r !== undefined ? parseFloat(String(r)) : defaultVal;
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
          on:input={(e: CustomEvent) => setOverride(key, unit === '%' ? `${e.detail}%` : Number(e.detail))}
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
        (o.controlHeightOffset ?? undefined) === vals.controlHeightOffset &&
        (o.surfacePadding ?? undefined) === vals.surfacePadding &&
        (o.surfaceGap ?? undefined) === vals.surfaceGap &&
        (o.inputPadding ?? undefined) === vals.inputPadding
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
  /*
    A plain `let` here, unlike `previewEl` below, and the difference is worth naming.

    That one is inside a `Show` the user can collapse, so its element is destroyed and recreated and
    the effect has to depend on *which* element it has. This one is rendered once at panel level,
    outside every toggle, so there is no second element to miss — and the effect re-runs on
    `overrides()` and `dragging()`, both of which change constantly, so even a remount would be
    corrected by the next edit rather than leaving a stale sample on screen.
  */
  let roleProbe: HTMLDivElement | undefined;
  const [roleColors, setRoleColors] = createSignal<Record<string, string>>({});
  const probeStyle = createMemo(() => themeParametersToStyle(overrides()) as Record<string, string>);

  /**
   * True from the moment a pointer goes down in this panel until it comes back up.
   *
   * Holds the role *swatches* still during a drag. They are sampled by reading eighteen resolved
   * roles off a probe element, which is one forced style recalculation plus seventeen cached reads —
   * cheap, but paid on every frame of a drag, for values nobody can read while the colour is still
   * moving.
   *
   * This began as a fix for something worse: the audit used to render above the role rows, so
   * gaining an issue pushed every picker down and moved the square being dragged out from under the
   * pointer. That is solved properly now — the audit is on-demand and lives in the preview section —
   * so what is left here is only the saving, which is worth keeping and is no longer load-bearing.
   */
  const [dragging, setDragging] = createSignal(false);
  {
    const up = () => setDragging(false);
    // On `window`, not the panel: a drag very often ends with the pointer outside the control it
    // started in, and a listener on the panel alone would never hear about it and stay frozen.
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    onCleanup(() => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    });
  }

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

  /**
   * The per-hue chroma ceilings this theme resolves to, measured rather than assumed.
   *
   * They are computed at apply time — how much chroma a hue can hold has no closed form worth
   * writing — so `themeParametersToStyle` cannot carry them, and anything showing the theme's palette without
   * them *inherits the document's*. A green theme edited from a violet app was being clipped to the
   * violet's ceiling, which is a different green from the one it would render as.
   *
   * Read back off the probe rather than recomputed here: `applyThemeVars` has just written the real
   * answer onto it, and a second implementation of the same measurement is a second thing to drift.
   */
  const [measuredCeilings, setMeasuredCeilings] = createSignal<Record<string, string>>({});

  createEffect(() => {
    const parameters = overrides();
    // Held still for the length of a drag — see `dragging`. Reading the signal here is what makes
    // the effect re-run, and re-sample, the moment the pointer lifts.
    if (dragging()) return;
    if (!roleProbe) return;

    /*
      Applied, not declared — the same distinction the scoped template and the preview needed.

      Sampling a probe that only carries `themeParametersToStyle` reports the theme's *declared* roles: muted
      text before it was corrected, a label before it was chosen, a fill before it was moved. The
      swatch beside each role would then show something the theme never renders.
    */
    applyThemeVars(roleProbe, parameters, { crossFade: false });

    const computed = getComputedStyle(roleProbe);
    const next: Record<string, string> = {};
    for (const group of ROLE_GROUPS) {
      for (const { role } of group.roles) {
        next[role] = resolveColor(roleProbe, computed.getPropertyValue(roleVar(role)).trim());
      }
    }
    roleProbe.style.color = '';
    setRoleColors(next);

    const ceilings: Record<string, string> = {};
    for (const family of ['neutral', 'primary', 'danger', 'success', 'warning']) {
      for (const suffix of ['chroma-max', 'fill-chroma-max']) {
        const prop = `--we-color-${family}-${suffix}`;
        const value = roleProbe.style.getPropertyValue(prop);
        if (value) ceilings[prop] = value;
      }
    }
    setMeasuredCeilings(ceilings);
  });

  /**
   * Every declared pair that currently fails, measured against what the theme actually resolves to.
   *
   * Sampled from the probe rather than from the stored overrides, so it judges the *result* — a
   * theme that pins nothing is still checked, and so is one whose failure comes from a hue slider
   * two sections up rather than from a role at all.
   */
  /*
    The audit is *run*, not watched.

    It used to be two live memos rendered above the role rows, which made it a layout problem rather
    than an information one: gaining an issue grew a block sitting above every colour picker and
    pushed them all down. Open a picker, change a colour, and the square you were dragging in moved
    out from under the pointer — which changed the colour again. Freezing it for the length of a
    gesture was not enough, because the list still settled the moment the pointer came up and moved
    the next thing you reached for.

    So it lives in the preview section behind a button, and clears itself on any change. That second
    half matters more than it sounds: a result computed against colours you have since edited is not
    stale information, it is *wrong* information, and showing it beside the controls that invalidated
    it is worse than showing nothing. The button's label carries the state instead — "Test theme"
    when there is nothing to show, "Re-test" when a result has been thrown away — which costs no
    layout at all.
  */
  const [auditRun, setAuditRun] = createSignal(false);
  const [auditResults, setAuditResults] = createSignal<{
    contrast: ReturnType<typeof measureContrast>;
    elevation: string[];
  } | null>(null);

  /*
    Any change at all invalidates the last run.

    Tracks `probeStyle()`, which is the whole theme — so a hue, a pin, a shape preset, anything.
    Deliberately blunt: working out which parameters could affect which pairs would be a second model
    of the derivations, and the two would drift.
  */
  createEffect(() => {
    probeStyle();
    setAuditResults(null);
  });

  function runAudit() {
    setAuditRun(true);
    setAuditResults({ contrast: measureContrast(), elevation: measureElevation() });
  }

  const measureContrast = () => {
    const colors = roleColors();
    return CONTRAST_PAIRS.flatMap((pair) => {
      const fg = parseColor(colors[pair.fg] ?? '');
      const bg = parseColor(colors[pair.bg] ?? '');
      if (!fg || !bg) return [];
      /*
        Both measures, and the stricter one governs.

        WCAG 2 stays because it may be the obligation. APCA is here because WCAG 2 is measurably
        wrong in the dark — it adds a flat 0.05 to both sides, which dominates the denominator
        against a near-black background, so a dark theme scores far better than it reads. Every
        dark built-in passed WCAG 2 and failed APCA before the foregrounds were derived.
      */
      const ratio = contrastRatio(fg, bg);
      const required = CONTRAST_MINIMUM[pair.level];
      const lc = apcaContrast(fg, bg);
      const lcRequired = APCA_MINIMUM[pair.level];
      if (ratio >= required && lc >= lcRequired) return [];
      return [{ ...pair, ratio, required, lc, lcRequired, apcaOnly: ratio >= required }];
    });
  };

  /**
   * The same elevation ordering the built-in themes are held to, applied to the theme on screen.
   *
   * The presets are covered by a unit test; a theme somebody builds here is not, and every wiring
   * fix has a hole the same shape — an author can always pin the four surfaces by hand in the wrong
   * direction, and nothing about the result announces itself. It does not look broken, it looks
   * *flat*, and the natural conclusion is that the theme is not very good rather than that it is
   * upside down.
   *
   * Sampled from the probe like the contrast check, so it judges what the theme resolves to rather
   * than what it stores.
   */
  const measureElevation = (): string[] => {
    const colors = roleColors();
    const lum = (r: ThemeRole) => {
      const c = parseColor(colors[r] ?? '');
      return c ? relativeLuminance(c) : null;
    };
    const [page, surface, raised, sunken] = (['page', 'surface', 'surfaceRaised', 'surfaceSunken'] as const).map(lum);
    if (page === null || surface === null || raised === null || sunken === null) return [];
    const out: string[] = [];
    // Equal is fine throughout — a flat design where separation comes from borders is a design.
    if (surface < page) out.push('Cards sit below the page, so they read as holes rather than objects.');
    if (raised < surface) out.push('Floating panels sit below the cards they float over.');
    if (sunken > surface) out.push('Wells sit above the surface they are recessed into.');
    return out;
  };

  /**
   * Whether this theme's danger and success read as one colour to a red-green viewer.
   *
   * Advice, not a failure. Red and green at the same lightness *are* the same colour to about one
   * man in twelve, and that is true of every palette built on them — the app answers it with an icon
   * per status rather than by moving the hues. But an author dragging `successHue` toward
   * `dangerHue` is making it *worse* with no feedback at all, and that is worth saying.
   */
  const statusCollapse = createMemo(() => {
    const colors = roleColors();
    const danger = parseColor(colors.danger ?? '');
    const success = parseColor(colors.success ?? '');
    if (!danger || !success) return null;
    const distance = perceptualDistance(
      simulateVision(danger, 'deuteranopia'),
      simulateVision(success, 'deuteranopia'),
    );
    return distance < 0.06 ? distance : null;
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
  /*
    The preview is *applied*, not merely declared — the same distinction the scoped template needed.

    `themeParametersToStyle` writes a theme's parameters and its role defaults and stops there. Everything that
    has to be *measured* — the per-hue chroma ceilings, the fills moved until a label fits, the label
    chosen against where they landed, the corrected foregrounds, which way a hover travels — happens
    at apply time and needs a real element.

    Left out, those variables do not simply go missing: custom properties inherit, so the preview
    picked up the *document's* ones. It was showing the edited theme's colours through the app
    theme's chroma ceilings, which is why toggling the scope changed a preview of a theme that had
    not changed. A green accent was being clipped to a violet's ceiling.

    Applying to the element runs the identical pipeline the real thing does, which is the only way a
    preview is worth looking at.
  */
  /*
    A signal, not a `let`, and that is the whole fix rather than a style preference.

    The preview is inside a `Show`, so collapsing it unmounts the element and expanding it mounts a
    *new* one. With a plain variable the effect tracked `overrides()` alone: reopening set the
    variable and nothing re-ran, so the fresh element never had the theme applied and inherited the
    ambient one — the panel showed you the app's chrome theme while you edited a space's.

    Holding the element in a signal makes the effect depend on *which element* as well as on what to
    put on it, so a remount re-applies by construction. It is not something a test could keep true
    either: the failure is a dependency that is absent, and there is nothing to assert about an
    absence except by rendering the panel and toggling it.
  */
  const [previewEl, setPreviewEl] = createSignal<HTMLDivElement>();
  createEffect(() => {
    const parameters = overrides();
    const el = previewEl();
    if (!el) return;
    // Never a cross-fade: this re-applies on every frame of a slider drag.
    applyThemeVars(el, parameters, { crossFade: false });
  });

  function previewStrip() {
    const chip = (bg: string, fg: string, text: string) => (
      <Column bg={bg} color={fg} px="200" py="100" r="200" fontSize="100">
        {text}
      </Column>
    );
    return (
      <div ref={setPreviewEl} style={{ 'border-radius': tokenVar('radius', '300'), overflow: 'hidden' }}>
        <Column bg="page" p="300" gap="300" border={'1px solid var(--we-role-border)'} r="300">
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

  /**
   * The edited theme's *colour scale*, for anything that has to show it rather than the app's.
   *
   * A picker's Tokens tab paints its swatches from `var(--we-color-<family>-<step>)`, which resolve
   * wherever the picker happens to be — and the picker is editor chrome, so in scoped mode it
   * resolves against the personal theme. Editing a green space theme from a purple personal one
   * offered a grid of purples and then applied green: the swatch you clicked was not the colour you
   * got, which is the one thing a colour picker must never do.
   *
   * Only the `--we-color-*` half of the theme. The roles are deliberately left alone so the picker's
   * own surfaces, borders and text stay part of the editor rather than flipping to the theme being
   * edited — a light space theme should not turn the picker's popover white inside a dark app.
   */
  const editedPalette = createMemo(() => ({
    ...Object.fromEntries(Object.entries(probeStyle()).filter(([prop]) => prop.startsWith('--we-color-'))),
    // Without these the swatches are drawn through whatever ceilings the *app* published, so a
    // green theme edited from a violet one offers greens clipped to a violet's limit.
    ...measuredCeilings(),
  }));

  /*
    Arriving at a role somebody asked for, from the inspector's readout.

    Three things have to happen and each was missing: the group has to be open (a `Show` means a
    collapsed section has no row to scroll to at all), the row has to come into view, and it has to
    say which one it is — a scroll that lands a row mid-panel among forty identical ones has not
    actually answered "take me to this".

    The store hands over a kebab-case role because that is what a schema and the readout both spell;
    the rows are keyed by the camelCase `ThemeRole`. A role the panel does not offer — the readout
    lists a few a template may set that the editor does not expose — simply reveals nothing rather
    than opening a section on an empty promise.
  */
  const roleRowEls = new Map<ThemeRole, HTMLElement>();
  const [revealed, setRevealed] = createSignal<ThemeRole | null>(null);

  const requestedRole = createMemo<ThemeRole | null>(() => {
    const kebab = themeStore.focusedRole();
    if (!kebab) return null;
    const camel = kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as ThemeRole;
    return ROLE_GROUPS.some((g) => g.roles.some((r) => r.role === camel)) ? camel : null;
  });

  createEffect(() => {
    const role = requestedRole();
    if (!role) return;
    /*
      One frame's grace, because the section this row lives in may be opening in the same tick — the
      element does not exist until that `Show` has rendered, so looking now finds nothing.
    */
    requestAnimationFrame(() => {
      roleRowEls.get(role)?.firstElementChild?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setRevealed(role);
    });
    const clear = setTimeout(() => setRevealed(null), 2000);
    onCleanup(() => clearTimeout(clear));
  });

  function roleRow(role: ThemeRole, label: string, hint: string) {
    const pinned = () => overrides().roles?.[role];
    // Unpinned, the swatch shows what the role currently resolves to — sampled with its alpha, so
    // opening the scrim's picker starts on a translucent colour rather than an opaque guess.
    const shown = () => pinned() ?? roleColors()[role] ?? '#000000';
    return (
      /*
        A native wrapper purely to hold a ref: `Row` is a DS component and forwarding a ref through
        it is not part of its contract, so the reveal below would be relying on something that
        happens to work today. `display: contents` keeps it out of the layout entirely.
      */
      <div
        ref={(el) => {
          roleRowEls.set(role, el);
          onCleanup(() => roleRowEls.delete(role));
        }}
        style={{ display: 'contents' }}
      >
        <Row
          ay="center"
          gap="300"
          r="200"
          // The ring is the whole point of the jump: it says "this is the one you clicked". Fades
          // rather than snaps off, so it does not read as a glitch on a panel that is still moving.
          transition="box-shadow 400 ease-out"
          styles={revealed() === role ? { 'box-shadow': '0 0 0 2px var(--we-role-focus)' } : { 'box-shadow': 'none' }}
        >
          <we-color-picker
            tokens
            alpha
            styles={{ ...editedPalette(), '--we-color-picker-swatch': '28px' }}
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
              {roleTierLabel(pinned(), role)}
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
      </div>
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
    <Column
      height="100%"
      width="100%"
      /*
        No background of its own: the dock frame paints the panel's surface.

        Every dock is wrapped in a frame that sets `surface-sunken`, precisely so a docked panel does
        not have to decide what it is made of — see the note in dockRegistry.ts. The editor's panels
        painted `surface-raised` over the top of it, ten lightness points above the page, so they read
        as a different material from every module panel docked at the same edge.
      */
      overflow="hidden"
      /*
        Any press inside the panel starts a gesture, not just one on a slider.

        Captured at the root rather than wired onto each control: the pickers, sliders and swatches
        are a mix of Lit primitives and native inputs, and a drag that begins on any of them has the
        same problem — see `dragging`. One listener here covers every present and future control,
        and a press that turns out not to be a drag simply clears on the next pointerup.
      */
      onPointerDown={() => setDragging(true)}
    >
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
          style={{ position: 'absolute', width: '0', height: '0', visibility: 'hidden' }}
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

            {/*
              ── Preview ──

              Sticky, and above every section rather than inside the Roles one.

              A theme is not a list of settings, it is a thing that looks like something, and the
              gap between the two is the whole difficulty of editing one: the panel occupies the
              side of the screen, so the app behind it is half-covered and the surface you are
              adjusting is often not on the route you happen to be on. Every control here benefits
              from somewhere to look — a hue slider and a radius slider and a shadow toggle all land
              in the same small gallery — which is why it belongs at the top rather than filed under
              the one section it was written for.

              Sticky because a preview you have scrolled past is a preview you do not have. Shape
              and Typography sit far enough down the panel that anchoring it to the top of the
              document would leave exactly the sections with the most visible effects looking at
              nothing.

              Collapsible, and remembered, because it costs real height on a narrow dock and
              somebody working on one number does not need it.
            */}
            <Column
              position="sticky"
              top="0"
              zIndex={2}
              /*
                Opaque, and the same material as the panel behind it.

                It cannot simply go transparent — being sticky, the sections scroll *under* it, and
                anything see-through would show them sliding past behind the preview. So it has to
                paint something, and the something has to be whatever the panel body is: it was
                `surface`, which sat a step above the body and made the preview read as a card
                floating in a panel rather than as part of it.

                Tied to the frame's choice by hand, which is the weak part. If the dock frame ever
                paints something else this has to follow, and nothing enforces that.
              */
              bg="surface-sunken"
              borderBottom={`1px solid ${tokenVar('color', 'neutral-100')}`}
              pb="300"
              pt="300"
            >
              <Row ay="center" ax="between" onClick={() => setPreviewOpen(!previewOpen())} cursor="pointer">
                <SectionLabel>Preview</SectionLabel>
                <we-icon name={previewOpen() ? 'caret-up' : 'caret-down'} size="sm" color="text-faint" />
              </Row>
              <Show when={previewOpen()}>
                <Column pt="300" gap="300">
                  {previewStrip()}

                  {/*
                    The audit, run on request and thrown away on any change.

                    Here rather than among the roles because its height varies and the roles are full
                    of things you drag — see the note on `auditRun`. A fixed height keeps even
                    *showing* a result from moving anything below it by a variable amount: the block
                    is the same size whether it holds one finding or nine, and scrolls internally
                    past that.
                  */}
                  <Row ay="center" gap="200">
                    <we-button size="sm" variant="secondary" onClick={runAudit}>
                      {auditResults() ? 'Re-test' : auditRun() ? 'Re-test' : 'Test theme'}
                    </we-button>
                    <Show when={auditResults()}>
                      <we-button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAuditResults(null)}
                        title="Hide these results"
                      >
                        Hide
                      </we-button>
                    </Show>
                    <Show when={auditRun() && !auditResults()}>
                      <we-text fontSize="100" color="text-faint">
                        Changed since last test
                      </we-text>
                    </Show>
                  </Row>

                  <Show when={auditResults()}>
                    {(results) => (
                      <Column
                        gap="200"
                        p="300"
                        r="200"
                        bg="surface"
                        height="132px"
                        overflow="auto"
                        // Fixed height, and it must not be squeezed out of it: the point is that the
                        // box is the same size whether it holds one finding or nine.
                        flex="0 0 auto"
                      >
                        <Show
                          when={results().contrast.length || results().elevation.length || statusCollapse() !== null}
                          fallback={
                            <Row ay="center" gap="200">
                              <we-icon name="check-circle" size="xs" color="success-text" />
                              <we-text fontSize="200" color="text-muted">
                                Every declared pair clears its threshold.
                              </we-text>
                            </Row>
                          }
                        >
                          <Show when={results().contrast.length}>
                            <Row ay="center" gap="200">
                              <we-icon name="warning" size="xs" color="warning-text" />
                              <we-text fontSize="200" fontWeight="600" color="warning-text">
                                {results().contrast.length} contrast{' '}
                                {results().contrast.length === 1 ? 'issue' : 'issues'}
                              </we-text>
                            </Row>
                            <For each={results().contrast}>
                              {(f) => (
                                <we-text fontSize="100" color="text-muted" lineHeight="1.4">
                                  {f.what} —{' '}
                                  {f.apcaOnly
                                    ? `Lc ${shortfall(f.lc)}, needs Lc ${f.lcRequired}`
                                    : `${shortfall(f.ratio, 1)}:1, needs ${f.required}:1`}
                                </we-text>
                              )}
                            </For>
                          </Show>

                          <Show when={results().elevation.length}>
                            <Row ay="center" gap="200">
                              <we-icon name="stack" size="xs" color="warning-text" />
                              <we-text fontSize="200" fontWeight="600" color="warning-text">
                                Elevation is inverted
                              </we-text>
                            </Row>
                            <For each={results().elevation}>
                              {(f) => (
                                <we-text fontSize="100" color="text-muted" lineHeight="1.4">
                                  {f}
                                </we-text>
                              )}
                            </For>
                          </Show>

                          {/*
                            Advice rather than a failure — see `statusCollapse`. Read live rather
                            than captured, because it depends only on two hues and says the same
                            thing whenever it is true.
                          */}
                          <Show when={statusCollapse() !== null}>
                            <Row ay="center" gap="200">
                              <we-icon name="eye" size="xs" color="text-muted" />
                              <we-text fontSize="100" color="text-faint" lineHeight="1.4">
                                Danger and success read alike to a red-green viewer. True of most palettes built on red
                                and green, and the app answers it with an icon per status — worth knowing rather than
                                fixing.
                              </we-text>
                            </Row>
                          </Show>
                        </Show>
                      </Column>
                    )}
                  </Show>
                </Column>
              </Show>
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
                  variant={(overrides().polarity ?? 'light') === 'light' ? 'secondary' : 'ghost'}
                  flex="1"
                  onClick={() => {
                    setOverrides({
                      polarity: 'light',
                      lightnessFloor: '0%',
                      lightnessCeiling: '100%',
                      roles: surfacesForPolarity('light', overrides().roles),
                    });
                  }}
                >
                  <we-icon name="sun" />
                  Light
                </we-button>
                <we-button
                  size="sm"
                  variant={overrides().polarity === 'dark' ? 'secondary' : 'ghost'}
                  flex="1"
                  onClick={() => {
                    setOverrides({
                      polarity: 'dark',
                      lightnessFloor: '12%',
                      lightnessCeiling: '112%',
                      roles: surfacesForPolarity('dark', overrides().roles),
                    });
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
                {/*
                  "Brand" rather than "Primary", because of what it actually moves.

                  `primary` is a hue *family* — it generates a whole ramp, and the accent fill, the
                  accent text, the muted tint, the focus ring and the gradients are all built from
                  it, as are the greys unless a theme separates `neutralHue`. Labelling it "Primary"
                  beside an "Accent" group made the two read as a matched pair of colours when one
                  is the source of the other, and it is the first thing anyone asks about.
                */}
                {hueSlider('Brand', 'primaryHue', 220)}
                {hueSlider('Success', 'successHue', 142)}
                {hueSlider('Warning', 'warningHue', 38)}
                {hueSlider('Danger', 'dangerHue', 4)}
                {hueSlider('Neutral', 'neutralHue', 220)}
              </Column>
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Saturation
                </we-text>
                {percentSlider('Colors', 'saturation', 0, 100, 50, '')}
                {percentSlider('Neutrals', 'neutralSaturation', 0, 100, 20, '')}
              </Column>
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Accent fill
                </we-text>
                {/*
                  The third axis of the accent, and the one that was missing.

                  Hue and saturation had sliders; lightness did not, because fills sit off the
                  neutral ramp so a red stays red in both polarities — which is right, and quietly
                  meant nobody could choose how light their accent was. The "Lightness range" group
                  below governs the *neutral* ramp, so it looked like the control for this and is
                  not: dragging it to 120% left a green accent at exactly the same #3a862d.

                  The default reads 55 because that is where the shared fill lightness sits; a theme
                  stating its own — `dark` states 55.3 — shows that instead until this is touched.
                */}
                {percentSlider('Lightness', 'accentLightness', 20, 95, 55, '')}
              </Column>
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Status fills
                </we-text>
                {/*
                  The same axis for the other three fills, which had the same gap for longer.

                  Each default is where its own hue is most itself (FILL_LIGHTNESS in @we/tokens) —
                  they differ because gold at violet's lightness is a stone. A theme that brightened
                  its accent and left these alone used to end up with a delete button that read as
                  the one muted control on the screen, and the only way out was pinning the role,
                  which throws away the derivations that keep its label readable.
                */}
                {percentSlider('Danger', 'dangerLightness', 20, 95, 62, '')}
                {percentSlider('Success', 'successLightness', 20, 95, 75, '')}
                {percentSlider('Warning', 'warningLightness', 20, 95, 76, '')}
              </Column>
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Lightness range
                </we-text>
                {/*
                  The two ends of the ramp, stated rather than encoded.

                  These replaced a single "Subtractor 0–200" slider, which is what the old model
                  exposed and which meant nothing on its own — `112` was "floor at 12%", and finding
                  that out took dragging it and looking. Together they are also the contrast control
                  the system had by accident and could not reach: a narrow span is a soft theme, a
                  full one is stark.
                */}
                {percentSlider('Darkest', 'lightnessFloor', 0, 100, 0)}
                {percentSlider('Lightest', 'lightnessCeiling', 0, 120, 100)}
              </Column>
            </CollapsibleSection>

            {/* ── Roles ── */}
            <CollapsibleSection title="Roles" openOn={requestedRole}>
              <we-text fontSize="200" color="text-muted" lineHeight="1.5">
                What a colour <i>means</i>, rather than where it sits on the scale. Left alone, each follows the hues
                and lightness above — pin one to redesign a relationship the scale cannot express, such as raised
                surfaces getting lighter in a dark theme instead of casting a shadow.
              </we-text>
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
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Strokes
                </we-text>
                {/* Beside the radii, because "what shape is this" is one question and a stroke is
                    half the answer. A theme that rounds everything and cannot thicken a line is
                    only half-themed. */}
                {selectControl('Borders', 'borderWidth', BORDER_WIDTH_OPTIONS)}
                {selectControl('Focus ring', 'focusRingWidth', RING_WIDTH_OPTIONS)}
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
                {selectControl('Control height', 'controlHeightOffset', HEIGHT_OPTIONS, '120px')}
                {selectControl('Surface padding', 'surfacePadding', SPACING_OPTIONS, '120px')}
                {selectControl('Surface gap', 'surfaceGap', SPACING_OPTIONS, '120px')}
                {selectControl('Input padding', 'inputPadding', INPUT_SPACING_OPTIONS, '120px')}
              </Column>
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  Overall scale
                </we-text>
                {/* Mirrors `fontScale` in Typography. It scales spacing *on top of* whatever the
                    type scale already did — the steps are in rem — so this is the control for
                    "denser at the same text size". */}
                {selectControl('Spacing', 'spacingScale', SPACING_SCALE_OPTIONS)}
              </Column>
            </CollapsibleSection>

            {/* ── Effects & Motion ── */}
            <CollapsibleSection title="Effects & Motion">
              <Column gap="200">
                <we-text fontSize="200" color="text-faint">
                  States
                </we-text>
                {/* How far "off" reads. A control rather than a role: one colour cannot serve a
                    disabled ghost button and a disabled danger one, since they start from
                    different fills. */}
                {selectControl('Disabled', 'disabledOpacity', DISABLED_OPACITY_OPTIONS)}
              </Column>
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
