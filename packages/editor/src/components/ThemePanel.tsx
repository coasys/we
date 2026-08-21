import { CodeEditor, Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
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
 * The 21 semantic roles, grouped the way somebody designing a theme thinks about them.
 *
 * Roles are the difference between a theme that recolours and a theme that is designed: the
 * lightness scale steps evenly, so no combination of hue, saturation, multiplier and subtractor can
 * say "raised surfaces are lighter than the page by 6 but the rail is darker by 3.5". Both built-in
 * reference themes (channels, timeline) reach for roles to express exactly that, and until now the
 * only way for anyone else to do it was hand-writing the theme's CSS.
 */
const ROLE_GROUPS: { label: string; roles: { role: ThemeRole; label: string }[] }[] = [
  {
    label: 'Surfaces',
    roles: [
      { role: 'page', label: 'Page' },
      { role: 'surface', label: 'Surface' },
      { role: 'surfaceRaised', label: 'Raised' },
      { role: 'surfaceSunken', label: 'Sunken' },
      { role: 'surfaceHover', label: 'Hover' },
      { role: 'surfaceActive', label: 'Pressed' },
    ],
  },
  {
    label: 'Text',
    roles: [
      { role: 'text', label: 'Primary' },
      { role: 'textMuted', label: 'Muted' },
      { role: 'textFaint', label: 'Faint' },
      { role: 'textInverse', label: 'Inverse' },
    ],
  },
  {
    label: 'Lines',
    roles: [
      { role: 'border', label: 'Border' },
      { role: 'borderStrong', label: 'Strong border' },
    ],
  },
  {
    label: 'Accent',
    roles: [
      { role: 'accent', label: 'Accent' },
      { role: 'accentStrong', label: 'Accent text' },
      { role: 'accentText', label: 'On accent' },
      { role: 'accentMuted', label: 'Accent tint' },
      { role: 'focus', label: 'Focus ring' },
    ],
  },
  {
    label: 'Status',
    roles: [
      { role: 'dangerText', label: 'Danger' },
      { role: 'dangerSurface', label: 'Danger tint' },
      { role: 'successText', label: 'Success' },
      { role: 'successSurface', label: 'Success tint' },
      { role: 'warningText', label: 'Warning' },
      { role: 'warningSurface', label: 'Warning tint' },
    ],
  },
  {
    label: 'Depth',
    roles: [
      { role: 'overlay', label: 'Scrim' },
      { role: 'shadowColor', label: 'Shadow' },
    ],
  },
];

/**
 * The colour to store for a role, given what the picker returned and the alpha the role already had.
 *
 * Exported for its test rather than for reuse. `<input type="color">` cannot express alpha, so a
 * picker interaction on a translucent role returns an opaque colour — and the scrim's default is 60%
 * transparent, where that is not a slightly-wrong colour but a solid sheet over the whole app.
 */
export function roleColorToStore(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r} ${g} ${b} / ${alpha})`;
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
  const [roleColors, setRoleColors] = createSignal<Record<string, { hex: string; alpha: number }>>({});
  const probeStyle = createMemo(() => themeToStyle(overrides()) as Record<string, string>);

  /** Resolve any CSS colour — hsl(), a var() chain, a hex — to hex plus its alpha. */
  function resolveColor(el: HTMLElement, value: string): { hex: string; alpha: number } {
    el.style.color = '';
    el.style.color = value;
    const parts = getComputedStyle(el).color.match(/[\d.]+/g);
    if (!parts) return { hex: '#000000', alpha: 1 };
    const [r, g, b] = parts.slice(0, 3).map((n) => Math.round(Number(n)));
    const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    return { hex, alpha: parts.length > 3 ? Number(parts[3]) : 1 };
  }

  createEffect(() => {
    probeStyle(); // re-sample whenever any part of the theme changes
    if (!roleProbe) return;
    const computed = getComputedStyle(roleProbe);
    const next: Record<string, { hex: string; alpha: number }> = {};
    for (const group of ROLE_GROUPS) {
      for (const { role } of group.roles) {
        next[role] = resolveColor(roleProbe, computed.getPropertyValue(roleVar(role)).trim());
      }
    }
    roleProbe.style.color = '';
    setRoleColors(next);
  });

  function setRole(role: ThemeRole, value: string | undefined) {
    themeStore.updateEditingOverrides({ roles: nextRoles(overrides().roles, role, value) });
    saveTheme();
  }

  function roleRow(role: ThemeRole, label: string) {
    const pinned = () => overrides().roles?.[role];
    const sampled = () => roleColors()[role] ?? { hex: '#000000', alpha: 1 };
    return (
      <Row ay="center" gap="300">
        <we-color-picker
          value={sampled().hex}
          on:change={(e: CustomEvent) => setRole(role, roleColorToStore(e.detail as string, sampled().alpha))}
        />
        <we-text flex="1" fontSize="300" color={pinned() ? 'neutral-800' : 'neutral-600'}>
          {label}
        </we-text>
        <Show
          when={pinned()}
          fallback={
            <we-text fontSize="200" color="text-faint">
              auto
            </we-text>
          }
        >
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
              <For each={ROLE_GROUPS}>
                {(group) => (
                  <Column gap="200">
                    <we-text fontSize="200" color="text-faint">
                      {group.label}
                    </we-text>
                    <For each={group.roles}>{(entry) => roleRow(entry.role, entry.label)}</For>
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
