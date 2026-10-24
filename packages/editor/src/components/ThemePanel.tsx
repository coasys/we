import { CodeEditor, Column, Grid, Row } from '@we/components/solid';
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
import { weProps } from '@we/design-utils/solid';
import { SECTION_LABEL_PROPS } from '@we/schema-kit';
import type { FontFaceSetting, ThemeOverrides, ThemeRole, ThemeSideName } from '@we/schema-shared';
import {
  applyThemeVars,
  basePolarity,
  fontFaceProblem,
  previewDisplay,
  roleVar,
  setThemeLive,
  themeParametersToStyle,
  withThemeSide,
} from '@we/schema-shared';
import {
  capitalise,
  CHROMATIC_FAMILIES,
  type ChromaticFamily,
  COLOR_FAMILIES,
  PALETTE_HUES,
  type PaletteHue,
  RAMP_FAMILIES,
  SEMANTIC_FAMILIES,
  SURFACE_IMAGE_ROLES,
  type SurfaceImageRole,
  TYPE_ROLES,
  type TypeRole,
} from '@we/tokens';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

import { colourToFamily, familyPatch, familyResetPatch, scaledSaturations, visiblyDifferent } from '../familyColour';
import { useEditorHost } from '../host';
import { nextRoles, roleTierLabel } from '../themeRoles';
import { type SidesChoice, sidesOf, sidesPatch, writePatch } from '../themeSides';
import { FoldingSection, PanelScroll, PanelShell, Subheading } from './panelKit';

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

type ComponentOverride = NonNullable<ThemeOverrides['components']>[string];
type TypeStyle = NonNullable<NonNullable<ThemeOverrides['typeStyles']>[TypeRole]>;

const WEIGHT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semibold' },
  { value: '700', label: 'Bold' },
  { value: '800', label: 'Heavy' },
];

const TRACKING_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'tight', label: 'Tight' },
  { value: 'normal', label: 'Normal' },
  { value: 'wide', label: 'Wide' },
  { value: 'wider', label: 'Wider' },
];

const CASE_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'none', label: 'As written' },
  { value: 'uppercase', label: 'Capitals' },
];

/** The foregrounds a type role or a component's words can take — roles, so contrast is measured. */
const TEXT_ROLE_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'text', label: 'Text' },
  { value: 'text-muted', label: 'Muted' },
  { value: 'text-faint', label: 'Faint' },
  { value: 'accent-text', label: 'Accent' },
];

/** Fills a component can be set apart with — roles only, for the reason above. */
const FILL_ROLE_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'surface', label: 'Surface' },
  { value: 'surface-raised', label: 'Raised' },
  { value: 'surface-sunken', label: 'Sunken' },
  { value: 'control-surface', label: 'Control' },
  { value: 'accent', label: 'Accent' },
  { value: 'accent-soft', label: 'Accent tint' },
];

const BORDER_ROLE_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'border', label: 'Border' },
  { value: 'border-strong', label: 'Strong' },
  { value: 'accent-border', label: 'Accent' },
];

const SHADOW_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'none', label: 'None' },
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Large' },
  { value: 'glow', label: 'Glow' },
];

const STATE_DURATION_OPTIONS = [
  { value: '', label: 'Default' },
  { value: '0ms', label: 'Instant' },
  { value: '80ms', label: 'Quick' },
  { value: '150ms', label: 'Easy' },
];

/** The kinds of text a theme styles, in the order a reader meets them. */
const TYPE_ROLE_LABELS: Record<TypeRole, string> = {
  heading: 'Headings',
  body: 'Body',
  label: 'Labels',
  control: 'Controls',
  badge: 'Badges',
  overline: 'Overlines',
};

/** The surfaces a theme can lay an image over — see SURFACE_IMAGE_ROLES in @we/tokens. */
const SURFACE_IMAGE_LABELS: Record<SurfaceImageRole, string> = {
  chrome: 'Chrome',
  page: 'Page',
  surface: 'Surfaces',
  surfaceRaised: 'Raised',
  surfaceSunken: 'Sunken',
};

/**
 * Components a theme can set apart here, by the name a theme's `components` addresses them by — the
 * ones whose look themes most often want to change. Any registered component's name works in the
 * theme's JSON; this list is what the panel offers, not what the system accepts.
 */
const COMPONENT_NAMES = [
  'alert',
  'avatar',
  'badge',
  'button',
  'card',
  'checkbox',
  'input',
  'menu',
  'menu-item',
  'modal',
  'select',
  'switch',
  'tab',
  'tag',
  'text',
  'textarea',
  'tooltip',
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
    label: 'Lists and selection',
    hint: 'Where the pointer is and what has been chosen, for every list, menu, tree, calendar and tab strip at once.',
    roles: [
      { role: 'itemHover', label: 'Hover', hint: 'A row or a cell under the pointer.' },
      { role: 'selected', label: 'Selected', hint: 'The chosen item — a menu entry, a tab, a day, a page.' },
      { role: 'onSelected', label: 'On selected', hint: 'The words on the chosen item.' },
      { role: 'textSelection', label: 'Text selection', hint: 'Text somebody has selected with the pointer.' },
    ],
  },
  {
    label: 'Elevation',
    hint: 'How far a thing sits from the page. Ordered here the way they stack.',
    roles: [
      // First because it is the bottom of the stack and the one the rest is measured from — the
      // group is ordered the way things sit, and everything here sits on the app's own ground.
      {
        role: 'chrome',
        label: 'Chrome',
        hint: "The app's own furniture — the sidebar, the module rail, a docked panel's frame, and the app's own screens. How dark the app is; everything else is measured from it.",
      },
      {
        role: 'page',
        label: 'Page',
        hint: "The plane a space's content sits on, a step above the chrome framing it. Set it to the chrome to have them match.",
      },
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
        role: 'accentSoft',
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
      { role: 'dangerSoft', label: 'Danger tint', hint: 'The panel behind danger content.' },
      { role: 'successText', label: 'Success', hint: 'A confirmation, a connected tick.' },
      { role: 'successSoft', label: 'Success tint', hint: 'The panel behind success content.' },
      { role: 'warningText', label: 'Warning', hint: 'A caution, something needing attention.' },
      { role: 'warningSoft', label: 'Warning tint', hint: 'The panel behind warning content.' },
    ],
  },
  {
    label: 'Depth & inversion',
    hint: 'The things that do not simply follow the light/dark ramp.',
    roles: [
      {
        role: 'surfaceInverse',
        label: 'Inverse surface',
        hint: 'A surface deliberately opposite to the page — a tooltip. Measured from the page, so it stays clear of it in a dark theme too.',
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
 * `dangerSoft` — so the foreground and the background of each test are known rather than guessed
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
  { fg: 'accentText', bg: 'accentSoft', level: 'body', what: 'Accent text on its own tint' },
  { fg: 'onInverse', bg: 'surfaceInverse', level: 'body', what: 'Tooltip text' },
  { fg: 'dangerText', bg: 'dangerSoft', level: 'body', what: 'Danger text on its tint' },
  { fg: 'dangerText', bg: 'surface', level: 'body', what: 'Danger text on a card' },
  { fg: 'successText', bg: 'successSoft', level: 'body', what: 'Success text on its tint' },
  { fg: 'warningText', bg: 'warningSoft', level: 'body', what: 'Warning text on its tint' },
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

/**
 * The colour a hue slider sets, drawn from the edited theme's own palette — its 500 step, the
 * middle of the family's ramp.
 *
 * It was `hsl(hue 60% 50%)`, and a theme's hues are OKLCH angles, not HSL ones: blue is 263 in
 * OKLCH and about 220 in HSL, so every dot sat some way round the wheel from the colour the slider
 * actually chose, and the preview above disagreed with it. Drawing through the theme's formula also
 * follows its saturation, lightness range and chroma ceilings rather than a fixed 60% and 50%.
 *
 * `palette` is the edited theme's `--we-color-*` declarations, carried on the dot itself: the panel
 * is editor chrome, so a bare `var()` here would resolve against the app's theme rather than the one
 * being edited.
 */
function HueSwatch(props: { family: string; palette: Record<string, string> }) {
  return (
    <div
      style={{
        ...props.palette,
        width: '20px',
        height: '20px',
        'border-radius': '50%',
        // role-audit: palette — a preview of the hue being chosen, so it IS that family's colour. The
        // rest of this panel is ordinary chrome and stays on roles.
        background: `var(--we-color-${props.family}-500)`,
        'flex-shrink': '0',
        border: `1px solid ${tokenVar('color', 'border')}`,
      }}
    />
  );
}

/**
 * A named region inside the panel — `sectionLabel`'s treatment, in the language this panel is in.
 *
 * It was a hand-spelled copy a size up and a shade stronger, with a fifth value for the tracking
 * (`0.05em`, against the inspector's `0.06em`, a `widest` twenty lines from that, and the kit's
 * `wide`). None of those was a decision anybody made twice.
 */

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

/** A family's roles as the edited theme draws them. */
interface FamilySample {
  fill: string;
  on: string;
  soft: string;
  text: string;
  border: string;
}

// ─── ThemePanel ───────────────────────────────────────────────────────────────

export function ThemePanel() {
  const themeStore = useEditorHost().theme;

  const editing = () => themeStore.editingTheme();
  /** The theme as stored: its base, and a `light` or `dark` block when it has two sides. */
  const stored = createMemo<ThemeOverrides>(() => {
    const raw = editing()?.overrides;
    return raw ? JSON.parse(raw) : {};
  });

  /*
    Sides. A theme is light, dark, or both — a base, and a block holding what differs on the other
    side. The base's polarity is its own or its preset's; the other side exists when its block does.
    With both, the panel edits one side at a time: every control shows that side and writes to it,
    and the app previews it (see the effect below), so what is on screen is what is being changed.
  */
  const basePol = () => basePolarity(stored());
  const otherSide = (): ThemeSideName => (basePol() === 'dark' ? 'light' : 'dark');
  const hasBoth = () => sidesOf(stored()) === 'both';
  const [chosenSide, setChosenSide] = createSignal<ThemeSideName | null>(null);
  /** The side block being edited, or null for the base. */
  const editedBlock = (): ThemeSideName | null => (hasBoth() && chosenSide() === otherSide() ? otherSide() : null);
  const editedSide = (): ThemeSideName => editedBlock() ?? basePol();

  /** What every control reads: the theme as worn on the side being edited. */
  const overrides = createMemo<ThemeOverrides>(() => withThemeSide(stored(), editedBlock() ?? undefined));

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

  /** Write settings to whichever side is being edited — see `writePatch`. */
  function write(partial: Partial<ThemeOverrides>) {
    themeStore.updateEditingOverrides(writePatch(stored(), editedBlock(), partial));
  }

  function setOverride<K extends keyof ThemeOverrides>(key: K, value: ThemeOverrides[K] | undefined) {
    write({ [key]: value } as Partial<ThemeOverrides>);
  }

  function setOverrides(partial: Partial<ThemeOverrides>) {
    write(partial);
    saveTheme();
  }

  // ── Saturation, as a set ────────────────────────────────────────────────────

  /*
    Where the theme stood when a saturation slider was taken, so a drag scales every family from
    there rather than from the last frame — see `scaledSaturations`. Dropped when it is let go.
  */
  let saturationStart: { scope: 'theme' | 'palette'; theme: ThemeOverrides; from: number } | null = null;

  function scaleSaturation(scope: 'theme' | 'palette', to: number) {
    if (!saturationStart || saturationStart.scope !== scope) {
      const theme = overrides();
      const from =
        scope === 'theme'
          ? (theme.saturation ?? effectiveSaturation().theme)
          : (theme.palette?.saturation ?? effectiveSaturation().palette);
      saturationStart = { scope, theme, from };
    }
    write(scaledSaturations(saturationStart.theme, saturationStart.from, to, scope));
  }

  // ── Colour families ─────────────────────────────────────────────────────────

  /** The colour last picked for each family, to say when the theme drew something else. */
  const [picked, setPicked] = createSignal<Record<string, string>>({});

  /** Whether the theme says anything of its own about a family — what a reset would undo. */
  function familyIsSet(family: ChromaticFamily): boolean {
    const theme = overrides();
    const pinned = theme.roles?.[family as ThemeRole] !== undefined;
    if (COLOR_FAMILIES[family].kind === 'palette') return pinned || !!theme.palette?.hues?.[family as PaletteHue];
    return (
      pinned ||
      ['Hue', 'Saturation', 'Lightness'].some((k) => theme[`${family}${k}` as keyof ThemeOverrides] !== undefined)
    );
  }

  /** A colour picked for a family, written as its settings — see `familyPatch`. */
  function pickFamily(family: ChromaticFamily, colour: string, commit: boolean) {
    const current =
      COLOR_FAMILIES[family].kind === 'palette'
        ? overrides().palette?.hues?.[family as PaletteHue]?.hue
        : (overrides()[`${family}Hue` as keyof ThemeOverrides] as number | undefined);
    const settings = colourToFamily(colour, family, current);
    if (!settings) return;
    write(familyPatch(overrides(), family, settings));
    setPicked((all) => ({ ...all, [family]: colour }));
    if (commit) saveTheme();
  }

  function resetFamily(family: ChromaticFamily) {
    write(familyResetPatch(overrides(), family));
    setPicked((all) => ({ ...all, [family]: '' }));
    saveTheme();
  }

  /** Pin the fill to exactly what was picked, past the correction — the label may then not read. */
  function keepPicked(family: ChromaticFamily) {
    write({ roles: { ...overrides().roles, [family]: picked()[family] } as ThemeOverrides['roles'] });
    saveTheme();
  }

  /**
   * One family as a colour: a swatch that opens the picker, what the family produces beside it —
   * the fill with its label, the tint with its text, the border — and, when the theme drew
   * something other than what was picked, why, and a way to keep the pick.
   */
  function familyRow(family: ChromaticFamily, compact = false) {
    const sample = () => familyColors()[family];
    const used = () => sample()?.fill ?? '';
    const adjusted = () => {
      const pick = picked()[family];
      return !!pick && !!used() && !dragging() && visiblyDifferent(pick, used());
    };
    return (
      <Column gap="100" width="100%">
        <Row ay="center" gap="300" width="100%">
          {/*
            No named swatches: the picker's palette offers the theme's own colours by name, and a
            family set to "teal" would be a family set to another family.
          */}
          <we-color-picker
            palette={[]}
            // The size the Roles section's swatches are.
            styles={{ '--we-color-picker-swatch': '28px' }}
            value={used()}
            on:preview={(e: CustomEvent) => pickFamily(family, e.detail as string, false)}
            on:change={(e: CustomEvent) => pickFamily(family, e.detail as string, true)}
          />
          <we-text flex="1" minWidth="0" fontSize="300" color="text-muted" truncate>
            {capitalise(family)}
          </we-text>
          <Show when={!compact}>
            <Row gap="100" ay="center">
              <we-text fontSize="100" px="200" py="100" r="200" bg={sample()?.fill} color={sample()?.on}>
                Aa
              </we-text>
              <we-text fontSize="100" px="200" py="100" r="200" bg={sample()?.soft} color={sample()?.text}>
                Aa
              </we-text>
              <we-text
                fontSize="100"
                px="200"
                py="100"
                r="200"
                border={`1px solid ${sample()?.border ?? 'transparent'}`}
                color={sample()?.text}
              >
                Aa
              </we-text>
            </Row>
          </Show>
          <Show when={familyIsSet(family)}>
            <we-button size="xs" variant="ghost" square label={`Reset ${family}`} onClick={() => resetFamily(family)}>
              <we-icon name="arrow-counter-clockwise" />
            </we-button>
          </Show>
        </Row>
        <Show when={adjusted()}>
          <Row ay="center" gap="200" wrap>
            <we-text fontSize="100" color="text-faint" lineHeight="1.4" flex="1" minWidth="0">
              Adjusted so its label stays readable.
            </we-text>
            <we-button size="xs" variant="ghost" onClick={() => keepPicked(family)}>
              Keep as picked
            </we-button>
          </Row>
        </Show>
      </Column>
    );
  }

  // ── Sides ───────────────────────────────────────────────────────────────────

  /** Make the theme one side only, or give it both — see `sidesPatch`. */
  function chooseSides(choice: SidesChoice) {
    const patch = sidesPatch(stored(), choice);
    if (!patch) return;
    themeStore.updateEditingOverrides(patch);
    // Adding a side opens it for editing; going back to one leaves nothing to choose between.
    setChosenSide(choice === 'both' ? otherSide() : null);
    saveTheme();
  }

  /*
    The person's own display, previewed while they edit: the side being edited when the theme has
    two, and the contrast chosen in Modes. A preview rather than a change to their settings, so
    closing the panel puts everything back.
  */
  const [contrastPreview, setContrastPreview] = createSignal<'standard' | 'more' | null>(null);
  createEffect(() => {
    const scheme = hasBoth() ? { colorScheme: editedSide() } : {};
    const contrast = contrastPreview() ? { contrast: contrastPreview()! } : {};
    previewDisplay({ ...scheme, ...contrast });
  });
  onCleanup(() => previewDisplay(null));

  // ── Slider helpers ──────────────────────────────────────────────────────────

  function hueSlider(label: string, key: keyof ThemeOverrides, defaultVal = 0) {
    const val = () => (overrides()[key] as number | undefined) ?? defaultVal;
    return (
      <Row ay="center" gap="300">
        <we-text minWidth="80px" fontSize="300" color="text-muted">
          {label}
        </we-text>
        <HueSwatch family={key.replace(/Hue$/, '')} palette={editedPalette()} />
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

  // ── Generic rows, for settings nested inside an object ──────────────────────

  /** A labelled slider over any value, for the nested settings the keyed helpers cannot reach. */
  function sliderRow(
    label: string,
    value: () => number,
    onInput: (value: number) => void,
    {
      min,
      max,
      step = 1,
      format,
      onCommit,
    }: { min: number; max: number; step?: number; format: (v: number) => string; onCommit?: () => void },
  ) {
    return (
      <Row ay="center" gap="300">
        <we-text minWidth="100px" fontSize="300" color="text-muted">
          {label}
        </we-text>
        <we-slider
          flex="1"
          value={value()}
          min={min}
          max={max}
          step={step}
          on:input={(e: CustomEvent) => onInput(Number(e.detail))}
          on:change={() => {
            onCommit?.();
            saveTheme();
          }}
        />
        <we-text minWidth="40px" fontSize="200" color="text-muted" textAlign="right">
          {format(value())}
        </we-text>
      </Row>
    );
  }

  /**
   * A labelled select over any value; an empty choice clears it.
   *
   * With `reset`, a row the theme has changed says so: its label in the text's own colour rather
   * than muted, and a reset beside it — so which settings of a component or a type role have moved
   * is visible at a glance, and each is one press from its default.
   */
  function choiceRow(
    label: string,
    value: () => string,
    options: { value: string; label: string }[],
    onChange: (value: string | undefined) => void,
    reset?: () => void,
  ) {
    const changed = () => !!reset && value() !== '';
    return (
      <Row ay="center" gap="300">
        <we-text minWidth="100px" fontSize="300" color={changed() ? 'text' : 'text-muted'}>
          {label}
        </we-text>
        <we-select
          flex="1"
          size="sm"
          value={value()}
          options={options}
          on:change={(e: CustomEvent) => {
            onChange((e.detail as string) || undefined);
            saveTheme();
          }}
        />
        <Show when={reset}>
          {/* Held in place when there is nothing to reset, so the selects line up down the column. */}
          <we-button
            size="xs"
            variant="ghost"
            square
            label={`Reset ${label.toLowerCase()}`}
            visibility={changed() ? 'visible' : 'hidden'}
            onClick={() => {
              reset!();
              saveTheme();
            }}
          >
            <we-icon name="arrow-counter-clockwise" />
          </we-button>
        </Show>
      </Row>
    );
  }

  /** Drop the keys a nested object no longer sets, and the object itself once it sets nothing. */
  function pruned<T extends object>(value: T): T | undefined {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== '');
    return entries.length ? (Object.fromEntries(entries) as T) : undefined;
  }

  function setPalette(change: Partial<NonNullable<ThemeOverrides['palette']>>) {
    setOverride('palette', pruned({ ...overrides().palette, ...change }));
  }

  function setTypeStyle(role: TypeRole, key: keyof TypeStyle, value: string | undefined) {
    const current = overrides().typeStyles ?? {};
    const next = pruned({ ...current, [role]: pruned({ ...current[role], [key]: value }) });
    setOverride('typeStyles', next as ThemeOverrides['typeStyles']);
  }

  const [component, setComponent] = createSignal('button');

  /** `menu-item` → `Menu item`. */
  const componentLabel = (name: string) => capitalise(name.replace(/-/g, ' '));
  const componentEdited = (name: string) => !!overrides().components?.[name];
  const editedComponents = () => Object.keys(overrides().components ?? {});

  function resetComponent(name: string) {
    const next = { ...overrides().components };
    delete next[name];
    setOverride('components', pruned(next) as ThemeOverrides['components']);
    saveTheme();
  }

  function setComponentKey(key: keyof ComponentOverride, value: string | undefined) {
    const current = overrides().components ?? {};
    const next = pruned({ ...current, [component()]: pruned({ ...current[component()], [key]: value }) });
    setOverride('components', next as ThemeOverrides['components']);
  }

  function setSurfaceImage(role: SurfaceImageRole, value: string | undefined) {
    setOverride('surfaceImages', pruned({ ...overrides().surfaceImages, [role]: value }));
  }

  const [fontProblem, setFontProblem] = createSignal('');

  /** Read a chosen font file into the theme as a face, named after the file. */
  function addFontFace(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const family = file.name
        .replace(/\.(woff2?|ttf|otf)$/i, '')
        .replace(/[^\p{L}\p{N} _-]/gu, ' ')
        .trim();
      const face: FontFaceSetting = { family, src: String(reader.result) };
      const problem = fontFaceProblem(face);
      setFontProblem(problem ?? '');
      if (problem) return;
      setOverride('fontFaces', [...(overrides().fontFaces ?? []).filter((f) => f.family !== family), face]);
      saveThemeNow();
    };
    reader.readAsDataURL(file);
  }

  function removeFontFace(family: string) {
    const rest = (overrides().fontFaces ?? []).filter((f) => f.family !== family);
    setOverride('fontFaces', rest.length ? rest : undefined);
    saveThemeNow();
  }

  // ── Select control ──────────────────────────────────────────────────────────

  /** The faces this theme carries (`fontFaces`), offered first, by the name they are used under. */
  const themeFaces = () =>
    [...new Set((overrides().fontFaces ?? []).map((face) => face.family))].map((family) => ({
      value: `'${family}', sans-serif`,
      label: `${family} (this theme)`,
    }));

  function selectControl(
    label: string,
    key: keyof ThemeOverrides,
    options: { value: string; label: string }[] | (() => { value: string; label: string }[]),
    labelWidth = '100px',
    sentinel = '',
  ) {
    const opts = () => (typeof options === 'function' ? options() : options);
    const current = () => {
      const v = overrides()[key] as string | undefined;
      const resolved = v ?? sentinel;
      // If the stored value isn't one of our known options, treat it as the default.
      // This handles values auto-populated from base theme CSS (e.g. "'DM Sans', sans-serif").
      if (sentinel && !opts().some((o) => o.value === resolved)) return sentinel;
      return resolved;
    };
    return (
      <Row ay="center" gap="300">
        <we-text prop:minWidth={labelWidth} fontSize="300" color="text-muted">
          {label}
        </we-text>
        <we-select
          flex="1"
          value={current()}
          options={opts()}
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
          <we-button size="sm" variant={isActive(p) ? 'soft' : 'ghost'} onClick={() => onSelect(p)} flex="1">
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
  const [familyColors, setFamilyColors] = createSignal<Record<string, FamilySample>>({});
  const [effectiveSaturation, setEffectiveSaturation] = createSignal({ theme: 50, palette: 50 });
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
  /*
    And holds the theme's measurements still everywhere it is applied: a drag re-applies the theme
    every frame, and measuring it is two whole-document style recalculations, which on a full page
    is most of a frame. Everything is measured once, in full, when the pointer comes up.
  */
  createEffect(() => setThemeLive(dragging()));
  {
    const up = () => setDragging(false);
    // On `window`, not the panel: a drag very often ends with the pointer outside the control it
    // started in, and a listener on the panel alone would never hear about it and stay frozen.
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    onCleanup(() => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setThemeLive(false);
    });
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

  /**
   * The colours some role variables resolve to on the probe, read in one pass: a cell per variable,
   * every one written before any is read, so the first read pays for the style pass and the rest
   * answer from it. Reading them one at a time — write, read, write, read — was a pass each.
   */
  function sampleVars(vars: string[]): string[] {
    const probe = roleProbe!;
    const cells = vars.map((v) => {
      const cell = document.createElement('div');
      cell.style.color = `var(${v})`;
      probe.appendChild(cell);
      return cell;
    });
    const out = cells.map((cell) => getComputedStyle(cell).color);
    for (const cell of cells) cell.remove();
    return out;
  }

  createEffect(() => {
    const parameters = overrides();
    if (!roleProbe) return;

    /*
      Applied, not declared — the same distinction the scoped template and the preview needed.

      Sampling a probe that only carries `themeParametersToStyle` reports the theme's *declared* roles: muted
      text before it was corrected, a label before it was chosen, a fill before it was moved. The
      swatch beside each role would then show something the theme never renders.

      Re-sampled on every frame of a drag too, so the family swatches and chips move with the slider
      — this used to wait for the pointer to lift, from before a theme could be applied cheaply
      while a slider is held (see `setThemeLive`). Mid-drag the samples are uncorrected; the pass on
      release corrects them.
    */
    applyThemeVars(roleProbe, parameters, { crossFade: false });

    const roles = ROLE_GROUPS.flatMap((group) => group.roles.map(({ role }) => role));
    /*
      Each family's roles as drawn, corrections included: the fill a picked colour is compared with,
      and the chips beside it. Read here because the chips sit outside anything wearing the edited
      theme — painted from the role names they would show the app's colours, not this theme's.
    */
    const parts = ['', 'on-', '-soft', '-text', '-border'];
    const familyVar = (family: string, part: string) =>
      part === 'on-' ? `--we-role-on-${family}` : `--we-role-${family}${part}`;
    const sampled = sampleVars([
      ...roles.map((role) => roleVar(role)),
      ...CHROMATIC_FAMILIES.flatMap((family) => parts.map((part) => familyVar(family, part))),
    ]);

    const next: Record<string, string> = {};
    roles.forEach((role, i) => (next[role] = sampled[i]));
    const fills: Record<string, FamilySample> = {};
    CHROMATIC_FAMILIES.forEach((family, f) => {
      const at = roles.length + f * parts.length;
      fills[family] = {
        fill: sampled[at],
        on: sampled[at + 1],
        soft: sampled[at + 2],
        text: sampled[at + 3],
        border: sampled[at + 4],
      };
    });
    setFamilyColors(fills);
    setRoleColors(next);
    // What the theme's saturations are, preset included — what the sliders show when it sets none.
    const declared = getComputedStyle(roleProbe);
    const number = (prop: string) => parseFloat(declared.getPropertyValue(prop));
    const theme = number('--we-color-saturation');
    const palette = number('--we-color-palette-saturation');
    setEffectiveSaturation({
      theme: Number.isNaN(theme) ? 50 : theme,
      palette: Number.isNaN(palette) ? theme : palette,
    });

    const ceilings: Record<string, string> = {};
    for (const family of RAMP_FAMILIES) {
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
    write({ roles: nextRoles(overrides().roles, role, value) });
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
    /*
      Real badges, in both variants — not hand-drawn chips.

      These were five `Column`s painting `danger-soft` on `danger-text` and so on, which is a
      copy of `we-badge`'s own soft table in another package. Two things were wrong with that. It
      could drift from the component it was standing in for, which is the failure this repo keeps
      finding; and because every chip was a *tint*, the preview showed no fill anywhere — so the
      "Status fills" sliders below had nothing on screen to move, and reasonably read as broken.

      Both rows, because the two variants are the two halves of the status palette and a theme
      author is choosing for both at once: `soft` shows what `*-soft` and `*-text` do, `solid`
      shows the fills and their corrected labels — the ones the sliders drive.
    */
    const badgeRow = (variant: 'soft' | 'solid') => (
      <Row gap="100" wrap ay="center">
        {(['neutral', 'accent', 'success', 'warning', 'danger'] as const).map((tone) => (
          <we-badge variant={variant} tone={tone} size="xs">
            {tone}
          </we-badge>
        ))}
      </Row>
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
              <we-button size="xs" variant="solid">
                Primary
              </we-button>
              <we-button size="xs" variant="soft">
                Secondary
              </we-button>
              <we-button size="xs" variant="ghost">
                Ghost
              </we-button>
            </Row>
            <we-input size="sm" placeholder="An input…" />
            <Column gap="100">
              <we-text fontSize="100" color="text-faint">
                Soft
              </we-text>
              {badgeRow('soft')}
              <we-text fontSize="100" color="text-faint">
                Solid
              </we-text>
              {badgeRow('solid')}
            </Column>
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
            // Both, so the theme follows the thumb as it moves and the draft is written when it
            // settles — the picker separated the two once a drag's worth of writes turned out to be
            // a real cost elsewhere. A role pin is a signal rather than a record, so previewing it
            // is free; keeping the pair here is what stops this panel losing its live feel.
            on:preview={(e: CustomEvent) => setRole(role, e.detail as string)}
            on:change={(e: CustomEvent) => setRole(role, e.detail as string)}
          />
          <Column flex="1" gap="0">
            {/*
            The tooltip hangs off the label rather than an info icon beside it: every row would
            need one, and a column of forty ⓘ glyphs is noise standing in for an explanation. The
            label is already the thing you point at when you are wondering what it means.
          */}
            <we-tooltip content={hint} placement="left">
              <we-text fontSize="300" color={pinned() ? 'text' : 'text-muted'} cursor="help">
                {label}
              </we-text>
            </we-tooltip>
            <we-text fontSize="100" color="text-faint" truncate>
              {roleTierLabel(pinned(), role)}
            </we-text>
          </Column>
          <Show when={pinned()}>
            <we-tooltip content="Back to the parametric default">
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
    /*
      No background of its own: the dock frame paints the panel's surface — every dock is wrapped in
      a frame that sets `page` (see dockRegistry.ts).

      Any press inside the panel starts a gesture, not just one on a slider: the pickers, sliders and
      swatches are a mix of Lit primitives and native inputs, and a drag that begins on any of them
      has the same problem — see `dragging`. A press that turns out not to be a drag simply clears on
      the next pointerup.
    */
    <PanelShell title="Theme Editor" onPointerDown={() => setDragging(true)}>
      <Show
        when={editing()}
        fallback={
          <Column ax="center" ay="center" flex="1" gap="300" p="500">
            <we-icon name="paint-bucket" color="text-faint" size="xl" />
            <we-text fontSize="400" color="text-muted" textAlign="center">
              No theme selected for editing
            </we-text>
            <we-button variant="soft" size="sm" onClick={() => themeStore.startEditing()}>
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

        <PanelScroll>
          {/*
            Sections spaced as the extraction panel spaces its own — `500`, well clear of the `200`
            between a heading and its rows: closer, and the end of one open section and the start
            of the next read as one list.
          */}
          <Column gap="500" pb="400">
            {/* ── Name + icon ── */}
            <Column gap="200">
              <we-text {...weProps(SECTION_LABEL_PROPS)}>Theme name</we-text>
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
                paint something, and the something has to be whatever the panel body is.

                **`page`, because that is what the dock frame paints** — see the note on `bg` in
                `dockRegistry.ts`. This said `surface-sunken`, which was right when it was written
                and stopped being right when the frame moved off that role; `surface-sunken` is
                `page` minus lightness, so the preview came out darker than every section under it
                and read as a well cut into the panel.

                That is the second time this drifted, and the last note here predicted it: the tie to
                the frame's choice is by hand and nothing enforces it. It still is — the frame is in
                `@we/app-shell`, which depends on this package, so the constant cannot be shared
                without inverting the dependency. Worth doing if it moves a third time.

                One case this does not follow: a *floating* panel's frame is translucent glass, and
                this band stays opaque over it. Matching that would mean reading the dock's floating
                state, which is the same import that is not available.
              */
              bg="page"
              /* A rule under it, since the sections scroll beneath it: the one divider left here. */
              borderBottom={`1px solid ${tokenVar('color', 'border')}`}
              pb="300"
            >
              <FoldingSection title="Preview" open={previewOpen} onToggle={setPreviewOpen}>
                <Column gap="300">
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
                    <we-button size="sm" variant="soft" onClick={runAudit}>
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
              </FoldingSection>
            </Column>

            {/* ── Base preset ── */}
            <FoldingSection title="Base preset">
              <we-select
                value={overrides().themeName ?? ''}
                options={BASE_THEME_OPTIONS}
                size="sm"
                on:change={(e: CustomEvent) => {
                  themeStore.changeBasePreset((e.detail as string) || undefined);
                  saveTheme();
                }}
              />
            </FoldingSection>

            {/* ── Sides ── */}
            {/*
              One control for light and dark: what the theme is (light, dark), or that it carries
              both. With both, which side the panel is editing — and previewing, since a person's own
              light/dark setting is what decides which side they see.
            */}
            <FoldingSection title="Sides">
              <Row gap="200">
                <For each={['light', 'dark', 'both'] as const}>
                  {(choice) => (
                    <we-button
                      size="sm"
                      flex="1"
                      variant={sidesOf(stored()) === choice ? 'soft' : 'ghost'}
                      onClick={() => chooseSides(choice)}
                    >
                      <we-icon name={choice === 'light' ? 'sun' : choice === 'dark' ? 'moon' : 'circle-half'} />
                      {choice === 'both' ? 'Both' : capitalise(choice)}
                    </we-button>
                  )}
                </For>
              </Row>
              <Show
                when={hasBoth()}
                fallback={
                  <we-text fontSize="100" color="text-faint" lineHeight="1.4">
                    One look, worn whatever somebody's light or dark setting is. Choose the other side to turn it, or
                    Both to give it a second side.
                  </we-text>
                }
              >
                <Row ay="center" gap="300">
                  <we-text minWidth="80px" fontSize="300" color="text-muted">
                    Editing
                  </we-text>
                  <For each={['light', 'dark'] as const}>
                    {(side) => (
                      <we-button
                        size="sm"
                        flex="1"
                        variant={editedSide() === side ? 'soft' : 'ghost'}
                        onClick={() => setChosenSide(side)}
                      >
                        {capitalise(side)} side
                      </we-button>
                    )}
                  </For>
                </Row>
                <we-text fontSize="100" color="text-faint" lineHeight="1.4">
                  People see the side their light or dark setting asks for. Every control below shows and changes the{' '}
                  {editedSide()} side, and the app is previewing it.
                </we-text>
              </Show>
            </FoldingSection>

            {/* ── Colour ── */}
            {/*
              By family, the way the system is built: each family's hue, how vivid it is and where
              its fill sits, together — then the palette, then the whole theme. It was laid out by
              kind of control (every hue, then every saturation, then every lightness), which put
              one family's three settings in three places and called the accent "Brand".
            */}
            <FoldingSection title="Colour">
              {/*
                A colour per family, picked rather than dialled in three sliders: the picker writes
                the hue, saturation and fill lightness that make it (see familyColour.ts), so the
                family still turns with the theme and keeps its label readable.
              */}
              <Column gap="200">
                <Subheading>Accent and status</Subheading>
                <For each={[...SEMANTIC_FAMILIES]}>{(family) => familyRow(family)}</For>
              </Column>
              <Column gap="200">
                <Subheading>Neutral</Subheading>
                {hueSlider('Tint', 'neutralHue', COLOR_FAMILIES.accent.hue)}
                {percentSlider('Amount', 'neutralSaturation', 0, 100, 20, '')}
              </Column>
              <Column gap="200">
                <Subheading>Palette</Subheading>
                <we-text fontSize="100" color="text-faint" lineHeight="1.4">
                  The ten colours communities give their categories. Set how vivid and how light they are as a set, then
                  pick any one — it stays near the colour it is named for.
                </we-text>
                {sliderRow(
                  'Vividness',
                  () => overrides().palette?.saturation ?? effectiveSaturation().palette,
                  (v) => scaleSaturation('palette', v),
                  {
                    min: 0,
                    max: 100,
                    format: (v) => `${Math.round(v)}%`,
                    onCommit: () => (saturationStart = null),
                  },
                )}
                {sliderRow(
                  'Lightness',
                  () => overrides().palette?.lightness ?? 0,
                  (v) => setPalette({ lightness: v }),
                  {
                    min: -20,
                    max: 20,
                    format: (v) => (v > 0 ? `+${v}` : `${v}`),
                  },
                )}
                <Grid minChildWidth="120px" gap="200">
                  <For each={[...PALETTE_HUES]}>{(hue) => familyRow(hue, true)}</For>
                </Grid>
              </Column>
              <Column gap="200">
                <Subheading>Whole theme</Subheading>
                {/*
                  The two ends of the ramp, stated rather than encoded — a narrow span is a soft
                  theme, a full one is stark — and the saturation every family starts from.
                */}
                {sliderRow(
                  'Saturation',
                  () => overrides().saturation ?? effectiveSaturation().theme,
                  (v) => scaleSaturation('theme', v),
                  {
                    min: 0,
                    max: 100,
                    format: (v) => `${Math.round(v)}%`,
                    onCommit: () => (saturationStart = null),
                  },
                )}
                <we-text fontSize="100" color="text-faint" lineHeight="1.4">
                  Every colour follows, the ones you have picked included. Neutral has its own above.
                </we-text>
                {percentSlider('Darkest', 'lightnessFloor', 0, 100, 0)}
                {percentSlider('Lightest', 'lightnessCeiling', 0, 120, 100)}
              </Column>
            </FoldingSection>

            {/* ── Roles ── */}
            <FoldingSection title="Roles" openOn={requestedRole}>
              <we-text fontSize="200" color="text-muted" lineHeight="1.5">
                What a colour <i>means</i>, rather than where it sits on the scale. Left alone, each follows the hues
                and lightness above — pin one to redesign a relationship the scale cannot express, such as raised
                surfaces getting lighter in a dark theme instead of casting a shadow.
              </we-text>
              <For each={ROLE_GROUPS}>
                {(group) => (
                  <Column gap="200">
                    <Subheading>{group.label}</Subheading>
                    {/* What the group is *for*, once, rather than repeated on every row inside it. */}
                    <we-text fontSize="100" color="text-faint" lineHeight="1.4">
                      {group.hint}
                    </we-text>
                    <For each={group.roles}>{(entry) => roleRow(entry.role, entry.label, entry.hint)}</For>
                  </Column>
                )}
              </For>
            </FoldingSection>

            {/* ── Modes ── */}
            {/*
              Preview, not settings: which side and which contrast are worn is the person's to say,
              over any theme. These change the editor's own display preferences so a theme can be seen
              the way somebody will see it.
            */}
            <FoldingSection title="Modes">
              <we-text fontSize="200" color="text-muted" lineHeight="1.5">
                People choose more contrast for themselves, over any theme. Preview this theme the way they will see it
                — your own setting is left as it is:
              </we-text>
              <Row ay="center" gap="300">
                <we-text minWidth="100px" fontSize="300" color="text-muted">
                  Contrast
                </we-text>
                {/* Not `choiceRow`, which saves the theme: this changes nothing in it. */}
                <we-select
                  flex="1"
                  size="sm"
                  value={contrastPreview() ?? ''}
                  options={[
                    { value: '', label: 'As I have it' },
                    { value: 'standard', label: 'Standard' },
                    { value: 'more', label: 'More' },
                  ]}
                  on:change={(e: CustomEvent) =>
                    setContrastPreview(((e.detail as string) || null) as 'standard' | 'more' | null)
                  }
                />
              </Row>
            </FoldingSection>

            {/* ── Shape ── */}
            <FoldingSection title="Shape">
              <Column gap="200">
                <Subheading>Preset</Subheading>
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
                <Subheading>Overrides</Subheading>
                {selectControl('Controls', 'controlRadius', RADIUS_OPTIONS, '80px')}
                {selectControl('Surfaces', 'surfaceRadius', RADIUS_OPTIONS, '80px')}
                {selectControl('Inputs', 'inputRadius', RADIUS_OPTIONS, '80px')}
                {selectControl('Avatars', 'avatarRadius', AVATAR_RADIUS_OPTIONS, '80px')}
              </Column>
              <Column gap="200">
                <Subheading>Strokes</Subheading>
                {/* Beside the radii, because "what shape is this" is one question and a stroke is
                    half the answer. A theme that rounds everything and cannot thicken a line is
                    only half-themed. */}
                {selectControl('Borders', 'borderWidth', BORDER_WIDTH_OPTIONS)}
                {selectControl('Focus ring', 'focusRingWidth', RING_WIDTH_OPTIONS)}
              </Column>
            </FoldingSection>

            {/* ── Type ── */}
            {/*
              Typefaces and how text is set, in one section: a face the theme carries only matters as a
              font choice, so it sits beside the choices it adds to.
            */}
            <FoldingSection title="Type">
              <Column gap="200">
                <Subheading>Typefaces</Subheading>
                {selectControl(
                  'Font family',
                  'fontFamily',
                  () => [...themeFaces(), ...FONT_OPTIONS],
                  '100px',
                  'default',
                )}
                {selectControl(
                  'Heading font',
                  'headingFontFamily',
                  () => [HEADING_FONT_OPTIONS[0], ...themeFaces(), ...HEADING_FONT_OPTIONS.slice(1)],
                  '100px',
                  'match',
                )}
                {selectControl('Code font', 'monoFontFamily', MONO_FONT_OPTIONS, '100px', 'system')}
                <we-text fontSize="100" color="text-faint" lineHeight="1.4">
                  Add a font file to carry it in the theme, so it works for everybody who opens it. It joins the choices
                  above.
                </we-text>
                <For each={overrides().fontFaces ?? []}>
                  {(face) => (
                    <Row ay="center" ax="between" gap="300">
                      <we-text fontSize="300">{face.family}</we-text>
                      <we-button size="sm" variant="ghost" onClick={() => removeFontFace(face.family)}>
                        Remove
                      </we-button>
                    </Row>
                  )}
                </For>
                <we-file-upload
                  accept=".woff2,.woff,.ttf,.otf"
                  on:change={(e: CustomEvent) => {
                    const file = (Array.isArray(e.detail) ? e.detail[0] : e.detail) as File | undefined;
                    if (file instanceof File) addFontFace(file);
                  }}
                />
                <Show when={fontProblem()}>
                  <we-text fontSize="200" color="danger-text">
                    {fontProblem()}
                  </we-text>
                </Show>
              </Column>
              <Column gap="200">
                <Subheading>Text</Subheading>
                {selectControl('Letter spacing', 'letterSpacing', LETTER_SPACING_OPTIONS, '100px', 'default')}
                {selectControl('Line height', 'lineHeight', LINE_HEIGHT_OPTIONS, '100px', 'default')}
                <we-text fontSize="300" color="text-muted">
                  Size
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
              {/*
                The kinds of text, each set once and reached wherever it is drawn — a heading in a
                template, in markdown and in a post alike. Unset keeps each component's own.
              */}
              <For each={[...TYPE_ROLES]}>
                {(role) => (
                  <Column gap="200">
                    <Subheading>{TYPE_ROLE_LABELS[role]}</Subheading>
                    {choiceRow(
                      'Weight',
                      () => String(overrides().typeStyles?.[role]?.weight ?? ''),
                      WEIGHT_OPTIONS,
                      (v) => setTypeStyle(role, 'weight', v),
                      () => setTypeStyle(role, 'weight', undefined),
                    )}
                    {choiceRow(
                      'Tracking',
                      () => overrides().typeStyles?.[role]?.letterSpacing ?? '',
                      TRACKING_OPTIONS,
                      (v) => setTypeStyle(role, 'letterSpacing', v),
                      () => setTypeStyle(role, 'letterSpacing', undefined),
                    )}
                    {choiceRow(
                      'Case',
                      () => overrides().typeStyles?.[role]?.textTransform ?? '',
                      CASE_OPTIONS,
                      (v) => setTypeStyle(role, 'textTransform', v),
                      () => setTypeStyle(role, 'textTransform', undefined),
                    )}
                    {choiceRow(
                      'Colour',
                      () => overrides().typeStyles?.[role]?.color ?? '',
                      TEXT_ROLE_OPTIONS,
                      (v) => setTypeStyle(role, 'color', v),
                      () => setTypeStyle(role, 'color', undefined),
                    )}
                  </Column>
                )}
              </For>
            </FoldingSection>

            {/* ── Spacing & Density ── */}
            <FoldingSection title="Spacing & Density">
              <Column gap="200">
                <Subheading>Preset</Subheading>
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
                <Subheading>Overrides</Subheading>
                {selectControl('Control padding', 'controlPaddingX', SPACING_OPTIONS, '120px')}
                {selectControl('Control gap', 'controlGap', SPACING_OPTIONS, '120px')}
                {selectControl('Control height', 'controlHeightOffset', HEIGHT_OPTIONS, '120px')}
                {selectControl('Surface padding', 'surfacePadding', SPACING_OPTIONS, '120px')}
                {selectControl('Surface gap', 'surfaceGap', SPACING_OPTIONS, '120px')}
                {selectControl('Input padding', 'inputPadding', INPUT_SPACING_OPTIONS, '120px')}
              </Column>
              <Column gap="200">
                <Subheading>Overall scale</Subheading>
                {/* Mirrors `fontScale` in Typography. It scales spacing *on top of* whatever the
                    type scale already did — the steps are in rem — so this is the control for
                    "denser at the same text size". */}
                {selectControl('Spacing', 'spacingScale', SPACING_SCALE_OPTIONS)}
              </Column>
            </FoldingSection>

            {/* ── Elevation ── */}
            <FoldingSection title="Elevation">
              <Column gap="200">
                <Subheading>Shadows</Subheading>
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
              <Column gap="200">
                <Subheading>Glow</Subheading>
                {/* What shadow: 'glow' draws — the accent as light, coloured by an element's tone. */}
                {presetRow(
                  { none: 'None', subtle: 'Subtle', medium: 'Medium', strong: 'Strong' } as Record<
                    NonNullable<ThemeOverrides['glowIntensity']>,
                    string
                  >,
                  (p) => (overrides().glowIntensity ?? 'medium') === p,
                  (p) => {
                    setOverride('glowIntensity', p === 'medium' ? undefined : p);
                    saveTheme();
                  },
                )}
              </Column>
            </FoldingSection>

            {/* ── Surfaces ── */}
            <FoldingSection title="Surfaces">
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
                <Subheading>Images</Subheading>
                <we-text fontSize="100" color="text-faint" lineHeight="1.4">
                  A gradient laid over every surface of a kind — radial-, linear- or conic-gradient. The page and the
                  chrome hold still behind scrolling content.
                </we-text>
                <For each={[...SURFACE_IMAGE_ROLES]}>
                  {(role) => (
                    <Row ay="center" gap="300">
                      <we-text minWidth="100px" fontSize="300" color="text-muted">
                        {SURFACE_IMAGE_LABELS[role]}
                      </we-text>
                      <we-input
                        flex="1"
                        size="sm"
                        placeholder="radial-gradient(…)"
                        value={overrides().surfaceImages?.[role] ?? ''}
                        on:change={(e: CustomEvent) => {
                          setSurfaceImage(role, (e.detail as string).trim() || undefined);
                          saveTheme();
                        }}
                      />
                    </Row>
                  )}
                </For>
              </Column>
            </FoldingSection>

            {/* ── Motion ── */}
            <FoldingSection title="Motion">
              <Column gap="200">
                <Subheading>Animation speed</Subheading>
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
              {selectControl('Hover and press', 'stateDuration', STATE_DURATION_OPTIONS, '120px')}
              {/* How far "off" reads. A control rather than a role: one colour cannot serve a disabled
                  ghost button and a disabled danger one, since they start from different fills. */}
              {selectControl('Disabled', 'disabledOpacity', DISABLED_OPACITY_OPTIONS, '120px')}
              {choiceRow(
                'Icon weight',
                () => overrides().iconWeight ?? '',
                [
                  { value: '', label: 'Default' },
                  { value: 'thin', label: 'Thin' },
                  { value: 'light', label: 'Light' },
                  { value: 'regular', label: 'Regular' },
                  { value: 'bold', label: 'Bold' },
                  { value: 'fill', label: 'Filled' },
                ],
                (v) => setOverride('iconWeight', v as ThemeOverrides['iconWeight']),
              )}
            </FoldingSection>

            {/* ── Components ── */}
            {/*
              The narrow tier: one component set apart from its family, with the family's own keys.
              Per variant is a level further and lives in the theme's JSON (components.<name>.variants).
            */}
            <FoldingSection title="Components">
              {/*
                The chooser apart from what it chooses: a full-size select above a box holding that
                component's settings, so it reads as "pick one, then change it" rather than as one
                more setting. Edited components say so in the list and can be reset from beside it.
              */}
              <Row ay="center" gap="200">
                <we-select
                  flex="1"
                  value={component()}
                  options={COMPONENT_NAMES.map((name) => ({
                    value: name,
                    label: componentEdited(name) ? `${componentLabel(name)} · edited` : componentLabel(name),
                  }))}
                  on:change={(e: CustomEvent) => setComponent((e.detail as string) || 'button')}
                />
                <Show when={componentEdited(component())}>
                  <we-button size="sm" variant="ghost" onClick={() => resetComponent(component())}>
                    Reset
                  </we-button>
                </Show>
              </Row>
              <Column gap="300" p="300" r="surface" border="1px solid border">
                {choiceRow(
                  'Radius',
                  () => overrides().components?.[component()]?.radius ?? '',
                  RADIUS_OPTIONS,
                  (v) => setComponentKey('radius', v),
                  () => setComponentKey('radius', undefined),
                )}
                {choiceRow(
                  'Padding',
                  () => overrides().components?.[component()]?.padding ?? '',
                  SPACING_OPTIONS,
                  (v) => setComponentKey('padding', v),
                  () => setComponentKey('padding', undefined),
                )}
                {choiceRow(
                  'Gap',
                  () => overrides().components?.[component()]?.gap ?? '',
                  SPACING_OPTIONS,
                  (v) => setComponentKey('gap', v),
                  () => setComponentKey('gap', undefined),
                )}
                {choiceRow(
                  'Border width',
                  () => overrides().components?.[component()]?.borderWidth ?? '',
                  BORDER_WIDTH_OPTIONS,
                  (v) => setComponentKey('borderWidth', v),
                  () => setComponentKey('borderWidth', undefined),
                )}
                {choiceRow(
                  'Shadow',
                  () => overrides().components?.[component()]?.shadow ?? '',
                  SHADOW_OPTIONS,
                  (v) => setComponentKey('shadow', v),
                  () => setComponentKey('shadow', undefined),
                )}
                {choiceRow(
                  'Type',
                  () => overrides().components?.[component()]?.type ?? '',
                  [
                    { value: '', label: 'Default' },
                    ...TYPE_ROLES.map((role) => ({ value: role, label: TYPE_ROLE_LABELS[role] })),
                  ],
                  (v) => setComponentKey('type', v),
                  () => setComponentKey('type', undefined),
                )}
                {choiceRow(
                  'Fill',
                  () => overrides().components?.[component()]?.fill ?? '',
                  FILL_ROLE_OPTIONS,
                  (v) => setComponentKey('fill', v),
                  () => setComponentKey('fill', undefined),
                )}
                {choiceRow(
                  'Text',
                  () => overrides().components?.[component()]?.text ?? '',
                  TEXT_ROLE_OPTIONS,
                  (v) => setComponentKey('text', v),
                  () => setComponentKey('text', undefined),
                )}
                {choiceRow(
                  'Border',
                  () => overrides().components?.[component()]?.border ?? '',
                  BORDER_ROLE_OPTIONS,
                  (v) => setComponentKey('border', v),
                  () => setComponentKey('border', undefined),
                )}
              </Column>
              <Show when={editedComponents().length}>
                <Row ay="center" gap="200">
                  <we-text flex="1" fontSize="200" color="text-faint">
                    {editedComponents().length === 1
                      ? '1 component edited'
                      : `${editedComponents().length} components edited`}
                  </we-text>
                  <we-button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setOverride('components', undefined);
                      saveTheme();
                    }}
                  >
                    Reset all
                  </we-button>
                </Row>
              </Show>
            </FoldingSection>

            {/* ── Custom CSS ── */}
            <FoldingSection title="Custom CSS">
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
            </FoldingSection>
          </Column>
        </PanelScroll>
      </Show>
    </PanelShell>
  );
}
