import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import type { ThemeOverrides } from '@we/schema-shared';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';

import { useAiStore } from '../../stores/AiStore';
import { useThemeStore } from '../../stores/ThemeStore';

const SAVE_DEBOUNCE_MS = 600;

const FONT_OPTIONS = [
  { value: 'base', label: 'System default' },
  { value: "'Mozilla Text', serif", label: 'Mozilla Text' },
  { value: "'Boldonse', serif", label: 'Boldonse' },
];

const BASE_THEME_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'black', label: 'Black' },
  { value: 'retro', label: 'Retro' },
  { value: 'cyberpunk', label: 'Cyberpunk' },
];

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
    <we-text
      style={{
        fontSize: tokenVar('font-size', '200'),
        fontWeight: '600',
        color: tokenVar('color', 'neutral-500'),
        'text-transform': 'uppercase',
        'letter-spacing': '0.05em',
      }}
    >
      {props.children}
    </we-text>
  );
}

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

  function setOverride<K extends keyof ThemeOverrides>(key: K, value: ThemeOverrides[K] | undefined) {
    if (value === undefined) {
      const next = { ...overrides() };
      delete next[key];
      themeStore.updateEditingOverrides(next as Partial<ThemeOverrides>);
    } else {
      themeStore.updateEditingOverrides({ [key]: value } as Partial<ThemeOverrides>);
    }
  }

  function hueSlider(label: string, key: keyof ThemeOverrides, defaultVal = 0) {
    const val = () => (overrides()[key] as number | undefined) ?? defaultVal;
    return (
      <Row ay="center" gap="300">
        <we-text
          style={{
            'min-width': '80px',
            'font-size': tokenVar('font-size', '300'),
            color: tokenVar('color', 'neutral-600'),
          }}
        >
          {label}
        </we-text>
        <HueSwatch hue={val()} />
        <we-slider
          style={{ flex: '1' }}
          value={val()}
          min={0}
          max={359}
          step={1}
          on:input={(e: CustomEvent) => setOverride(key, Number(e.detail))}
          on:change={() => saveTheme()}
        />
        <we-text
          style={{
            'min-width': '32px',
            'font-size': tokenVar('font-size', '200'),
            color: tokenVar('color', 'neutral-500'),
            'text-align': 'right',
          }}
        >
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
        <we-text
          style={{
            'min-width': '130px',
            'font-size': tokenVar('font-size', '300'),
            color: tokenVar('color', 'neutral-600'),
          }}
        >
          {label}
        </we-text>
        <we-slider
          style={{ flex: '1' }}
          value={numVal()}
          min={min}
          max={max}
          step={1}
          on:input={(e: CustomEvent) => setOverride(key, `${e.detail}%`)}
          on:change={() => saveTheme()}
        />
        <we-text
          style={{
            'min-width': '36px',
            'font-size': tokenVar('font-size', '200'),
            color: tokenVar('color', 'neutral-500'),
            'text-align': 'right',
          }}
        >
          {numVal()}%
        </we-text>
      </Row>
    );
  }

  return (
    <Column height="100%" width="100%" bg="neutral-25" overflow="hidden">
      {/* Header */}
      <Row
        ax="between"
        ay="center"
        px="400"
        py="300"
        borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
        styles={{ 'flex-shrink': '0' }}
      >
        <we-text style={{ 'font-size': tokenVar('font-size', '500'), 'font-weight': '600' }}>Theme Editor</we-text>
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
            <we-text
              style={{
                'font-size': tokenVar('font-size', '400'),
                color: tokenVar('color', 'neutral-500'),
                'text-align': 'center',
              }}
            >
              No theme selected for editing
            </we-text>
            <we-button variant="secondary" size="sm" onClick={() => themeStore.startEditing()}>
              Edit current theme
            </we-button>
          </Column>
        }
      >
        <we-scroll-area style={{ flex: '1' }}>
          <Column gap="500" p="400">
            {/* Name + icon */}
            <Column gap="200">
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
                  style={{ flex: '1' }}
                  on:input={(e: CustomEvent) => themeStore.updateEditingMeta({ name: e.detail })}
                  on:blur={() => saveTheme()}
                />
              </Row>
            </Column>

            {/* Base theme */}
            <Column gap="200">
              <SectionLabel>Base preset</SectionLabel>
              <we-select
                value={overrides().themeName ?? ''}
                options={BASE_THEME_OPTIONS}
                size="sm"
                on:change={(e: CustomEvent) => {
                  if (e.detail) setOverride('themeName', e.detail);
                  else setOverride('themeName', undefined);
                  saveTheme();
                }}
              />
            </Column>

            {/* Light / dark */}
            <Column gap="200">
              <SectionLabel>Mode</SectionLabel>
              <Row gap="200">
                <we-button
                  size="sm"
                  variant={(overrides().multiplier ?? 1) === 1 ? 'secondary' : 'ghost'}
                  onClick={() => {
                    setOverride('multiplier', 1);
                    setOverride('subtractor', '0%');
                    saveTheme();
                  }}
                >
                  <we-icon name="sun" />
                  Light
                </we-button>
                <we-button
                  size="sm"
                  variant={(overrides().multiplier ?? 1) === -1 ? 'secondary' : 'ghost'}
                  onClick={() => {
                    setOverride('multiplier', -1);
                    setOverride('subtractor', '108%');
                    saveTheme();
                  }}
                >
                  <we-icon name="moon" />
                  Dark
                </we-button>
              </Row>
            </Column>

            {/* Hues */}
            <Column gap="300">
              <SectionLabel>Color hues</SectionLabel>
              {hueSlider('Primary', 'primaryHue', 220)}
              {hueSlider('Success', 'successHue', 142)}
              {hueSlider('Warning', 'warningHue', 38)}
              {hueSlider('Danger', 'dangerHue', 4)}
              {hueSlider('Neutral', 'neutralHue', 220)}
            </Column>

            {/* Saturation */}
            <Column gap="300">
              <SectionLabel>Saturation</SectionLabel>
              {percentSlider('Colors', 'saturation', 0, 100, 50)}
              {percentSlider('Neutrals', 'neutralSaturation', 0, 100, 20)}
            </Column>

            {/* Lightness */}
            <Column gap="300">
              <SectionLabel>Lightness baseline</SectionLabel>
              {percentSlider('Subtractor', 'subtractor', 0, 200, 0)}
            </Column>

            {/* Font family */}
            <Column gap="200">
              <SectionLabel>Font family</SectionLabel>
              <we-select
                value={overrides().fontFamily ?? 'base'}
                options={FONT_OPTIONS}
                size="sm"
                on:change={(e: CustomEvent) => {
                  setOverride('fontFamily', e.detail);
                  saveTheme();
                }}
              />
            </Column>

            {/* Raw CSS */}
            <Column gap="200">
              <Row ax="between" ay="center">
                <SectionLabel>Custom CSS</SectionLabel>
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
              <Show
                when={cssEditing()}
                fallback={
                  <pre
                    style={{
                      margin: '0',
                      padding: tokenVar('space', '300'),
                      'border-radius': tokenVar('radius', '200'),
                      background: tokenVar('color', 'neutral-100'),
                      color: tokenVar('color', 'neutral-700'),
                      'font-size': tokenVar('font-size', '200'),
                      'font-family': 'monospace',
                      'white-space': 'pre-wrap',
                      'word-break': 'break-all',
                      'min-height': '60px',
                      cursor: 'text',
                    }}
                    onClick={startCssEdit}
                  >
                    {editing()?.css || (
                      <span style={{ color: tokenVar('color', 'neutral-400') }}>No custom CSS yet — click to add</span>
                    )}
                  </pre>
                }
              >
                <we-textarea
                  value={cssValue()}
                  rows={10}
                  resize="vertical"
                  style={{ 'font-family': 'monospace', 'font-size': tokenVar('font-size', '200') }}
                  on:input={(e: CustomEvent) => setCssValue(e.detail)}
                />
              </Show>
            </Column>
          </Column>
        </we-scroll-area>
      </Show>
    </Column>
  );
}
