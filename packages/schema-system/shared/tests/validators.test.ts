import { describe, expect, it } from 'vitest';

import type { ThemeOverrides } from '../src/types';
import { validateStructure } from '../src/validators';

describe('validators', () => {
  it('validates a node successfully', () => {
    const node = { type: 'div' };
    const res = validateStructure(node);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('returns errors for invalid node', () => {
    const node = { type: 'div', unknown: 1 };
    const res = validateStructure(node);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors[0]).toHaveProperty('path');
    expect(res.errors[0]).toHaveProperty('message');
    expect(res.errors[0]).toHaveProperty('severity', 'error');
  });

  it('validates SchemaNode without meta', () => {
    const node = { type: 'root' };
    const res = validateStructure(node);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('validates TemplateSchema with meta and reports icon type error', () => {
    const template = { type: 'root', meta: { name: 'T', description: 'd', icon: 123 } };
    const res = validateStructure(template);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.path.includes('meta'))).toBe(true);
  });

  it('reports array children item errors', () => {
    const node = { type: 'div', children: [123] };
    const res = validateStructure(node);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('checks a panel’s opening box as numbers', () => {
    const meta = (box: unknown) => ({
      type: 'root',
      meta: { name: 'T', description: 'd', icon: 'x', panels: [{ id: 'key', snap: 'top-right', box }] },
    });

    expect(validateStructure(meta({ width: 252, height: 545 })).valid).toBe(true);
    expect(validateStructure(meta({ height: 545 })).valid).toBe(true);
    // A CSS length would pass an unlisted key unchecked and resolve to NaN in the dock geometry.
    const res = validateStructure(meta({ width: '252px' }));
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.path.includes('box'))).toBe(true);
  });

  it('reports multiple nested errors in TemplateSchema', () => {
    const template = {
      type: 'root',
      meta: { name: 123, description: [], icon: null },
      routes: [{ path: 123 }],
    };
    const res = validateStructure(template);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });
});

const themed = (theme: Record<string, unknown>) => ({ type: 'Column', theme, children: [] });

describe('a node-scoped theme', () => {
  it('accepts the current theme vocabulary', () => {
    const theme: Required<ThemeOverrides> = {
      schemaVersion: 6,
      themeName: 'dark',
      primaryHue: 160,
      successHue: 145,
      warningHue: 80,
      dangerHue: 25,
      neutralHue: 278,
      saturation: 60,
      neutralSaturation: 22,
      accentLightness: 85,
      dangerLightness: 60,
      successLightness: 60,
      warningLightness: 70,
      polarity: 'dark',
      lightnessFloor: '16%',
      lightnessCeiling: '104%',
      roles: { page: 'oklch(18.5% 0.04 278)', accent: 'oklch(85% 0.12 160)', onAccent: 'oklch(20% 0.045 278)' },
      fontFamily: 'Inter, sans-serif',
      headingFontFamily: 'Fraunces, serif',
      monoFontFamily: 'JetBrains Mono, monospace',
      letterSpacing: '0.01em',
      lineHeight: '1.5',
      fontScale: 1.125,
      controlRadius: '999px',
      surfaceRadius: '20px',
      inputRadius: '14px',
      avatarRadius: '999px',
      borderWidth: '1px',
      stateDuration: '120ms',
      focusRingWidth: '2px',
      controlPaddingX: '16px',
      controlGap: '8px',
      controlHeightOffset: '4px',
      surfacePadding: '24px',
      surfaceGap: '16px',
      inputPadding: '12px',
      spacingScale: 1.1,
      disabledOpacity: 0.5,
      shadowIntensity: 'subtle',
      surfaceOpacity: 0.9,
      surfaceBlur: 12,
      animationSpeed: 'fast',
    };
    expect(validateStructure(themed(theme)).errors).toEqual([]);
  });

  it('accepts it at a template root', () => {
    const template = {
      id: 'themed',
      schemaVersion: 1,
      meta: { name: 'Themed', description: 'A themed template', icon: 'palette' },
      type: 'Column',
      theme: { schemaVersion: 6, polarity: 'dark', roles: { page: '#111' }, surfaceRadius: '20px' },
      children: [],
    };
    expect(validateStructure(template).errors).toEqual([]);
  });

  it('still accepts the keys polarity and the lightness range replaced', () => {
    expect(validateStructure(themed({ multiplier: -1, subtractor: '112%' })).valid).toBe(true);
  });

  it('accepts a role the token table defines', () => {
    expect(validateStructure(themed({ roles: { borderHover: '#333' } })).valid).toBe(true);
  });

  it('refuses a key the theme vocabulary does not have', () => {
    const { valid, errors } = validateStructure(themed({ polarity: 'dark', glow: '1' }));
    expect(valid).toBe(false);
    expect(errors.map((e) => e.message).join(' ')).toContain('glow');
  });

  it('refuses a role name the token table does not define', () => {
    expect(validateStructure(themed({ roles: { sparkle: '#fff' } })).valid).toBe(false);
  });

  it('refuses a value of the wrong type', () => {
    expect(validateStructure(themed({ polarity: 'dim' })).valid).toBe(false);
    expect(validateStructure(themed({ surfaceRadius: 20 })).valid).toBe(false);
  });
});
