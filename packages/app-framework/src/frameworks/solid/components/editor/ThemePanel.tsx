import { CodeEditor, Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import type { ThemeOverrides } from '@we/schema-shared';
import type { JSX } from 'solid-js';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';

import { useAiStore } from '../../stores/AiStore';
import { useThemeStore } from '../../stores/ThemeStore';

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

const HEIGHT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: '-4px', label: 'Short' },
  { value: '4px', label: 'Tall' },
  { value: '8px', label: 'Taller' },
  { value: '12px', label: 'Tallest' },
];

// ─── Presets ──────────────────────────────────────────────────────────────────

const SHAPE_PRESETS = {
  sharp: { controlRadius: '0', surfaceRadius: '0', inputRadius: '0' },
  default: { controlRadius: undefined, surfaceRadius: undefined, inputRadius: undefined },
  rounded: {
    controlRadius: 'var(--we-radius-600)',
    surfaceRadius: 'var(--we-radius-600)',
    inputRadius: 'var(--we-radius-600)',
  },
  pill: {
    controlRadius: 'var(--we-radius-pill)',
    surfaceRadius: 'var(--we-radius-600)',
    inputRadius: 'var(--we-radius-pill)',
  },
} as const;

const SPACING_PRESETS = {
  compact: {
    controlPaddingX: 'var(--we-space-200)',
    controlGap: 'var(--we-space-100)',
    controlHeight: '-4px',
    surfaceSpacing: 'var(--we-space-300)',
    surfaceGap: 'var(--we-space-200)',
  },
  comfortable: {
    controlPaddingX: undefined,
    controlGap: undefined,
    controlHeight: undefined,
    surfaceSpacing: undefined,
    surfaceGap: undefined,
  },
  spacious: {
    controlPaddingX: 'var(--we-space-600)',
    controlGap: 'var(--we-space-400)',
    controlHeight: '8px',
    surfaceSpacing: 'var(--we-space-900)',
    surfaceGap: 'var(--we-space-600)',
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
    <we-text fontSize="200" fontWeight="600" color="neutral-500" textTransform="uppercase" letterSpacing="0.05em">
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
        <we-icon name={open() ? 'caret-up' : 'caret-down'} size="sm" color="neutral-400" />
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
  const aiStore = useAiStore();
  const themeStore = useThemeStore();

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
        <we-text minWidth="80px" fontSize="300" color="neutral-600">
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
        <we-text minWidth="32px" fontSize="200" color="neutral-500" textAlign="right">
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
        <we-text minWidth="130px" fontSize="300" color="neutral-600">
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
        <we-text minWidth="36px" fontSize="200" color="neutral-500" textAlign="right">
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
        <we-text minWidth="120px" fontSize="300" color="neutral-600">
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
        <we-text minWidth="36px" fontSize="200" color="neutral-500" textAlign="right">
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
        <we-text minWidth={labelWidth} fontSize="300" color="neutral-600">
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
        (o.inputRadius ?? undefined) === vals.inputRadius
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
        (o.surfaceGap ?? undefined) === vals.surfaceGap
      ) {
        return name;
      }
    }
    return 'custom';
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
    <Column height="100%" width="100%" bg="neutral-25" overflow="hidden">
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
          <we-button variant="ghost" size="sm" onClick={() => aiStore.closeThemePanel()}>
            <we-icon name="x" size="sm" />
          </we-button>
        </we-tooltip>
      </Row>

      <Show
        when={editing()}
        fallback={
          <Column ax="center" ay="center" flex="1" gap="300" p="500">
            <we-icon name="paint-bucket" color="neutral-300" size="xl" />
            <we-text fontSize="400" color="neutral-500" textAlign="center">
              No theme selected for editing
            </we-text>
            <we-button variant="secondary" size="sm" onClick={() => themeStore.startEditing()}>
              Edit current theme
            </we-button>
          </Column>
        }
      >
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
                <we-text fontSize="200" color="neutral-400">
                  Hues
                </we-text>
                {hueSlider('Primary', 'primaryHue', 220)}
                {hueSlider('Success', 'successHue', 142)}
                {hueSlider('Warning', 'warningHue', 38)}
                {hueSlider('Danger', 'dangerHue', 4)}
                {hueSlider('Neutral', 'neutralHue', 220)}
              </Column>
              <Column gap="200">
                <we-text fontSize="200" color="neutral-400">
                  Saturation
                </we-text>
                {percentSlider('Colors', 'saturation', 0, 100, 50)}
                {percentSlider('Neutrals', 'neutralSaturation', 0, 100, 20)}
              </Column>
              <Column gap="200">
                <we-text fontSize="200" color="neutral-400">
                  Lightness
                </we-text>
                {percentSlider('Subtractor', 'subtractor', 0, 200, 0)}
              </Column>
            </CollapsibleSection>

            {/* ── Shape ── */}
            <CollapsibleSection title="Shape">
              <Column gap="200">
                <we-text fontSize="200" color="neutral-400">
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
                <we-text fontSize="200" color="neutral-400">
                  Overrides
                </we-text>
                {selectControl('Controls', 'controlRadius', RADIUS_OPTIONS, '80px')}
                {selectControl('Surfaces', 'surfaceRadius', RADIUS_OPTIONS, '80px')}
                {selectControl('Inputs', 'inputRadius', RADIUS_OPTIONS, '80px')}
              </Column>
            </CollapsibleSection>

            {/* ── Typography ── */}
            <CollapsibleSection title="Typography">
              {selectControl('Font family', 'fontFamily', FONT_OPTIONS, '100px', 'default')}
              {selectControl('Letter spacing', 'letterSpacing', LETTER_SPACING_OPTIONS, '100px', 'default')}
              {selectControl('Line height', 'lineHeight', LINE_HEIGHT_OPTIONS, '100px', 'default')}
              <Column gap="200">
                <we-text fontSize="200" color="neutral-400">
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
                <we-text fontSize="200" color="neutral-400">
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
                <we-text fontSize="200" color="neutral-400">
                  Overrides
                </we-text>
                {selectControl('Control padding', 'controlPaddingX', SPACING_OPTIONS, '120px')}
                {selectControl('Control gap', 'controlGap', SPACING_OPTIONS, '120px')}
                {selectControl('Control height', 'controlHeight', HEIGHT_OPTIONS, '120px')}
                {selectControl('Surface padding', 'surfaceSpacing', SPACING_OPTIONS, '120px')}
                {selectControl('Surface gap', 'surfaceGap', SPACING_OPTIONS, '120px')}
              </Column>
            </CollapsibleSection>

            {/* ── Effects & Motion ── */}
            <CollapsibleSection title="Effects & Motion">
              <Column gap="200">
                <we-text fontSize="200" color="neutral-400">
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
                <we-text fontSize="200" color="neutral-400">
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
