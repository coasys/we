/**
 * The DS-prop machinery every layout component and primitive is built on.
 *
 * The first test is the single most load-bearing one in the design system:
 * `DesignSystemProps` (the interface, in @we/design-types) and
 * `designSystemKeys` (five hand-maintained arrays, here) describe the same
 * surface and nothing else enforces that. A prop added to the interface but
 * not the arrays typechecks everywhere and is then silently dropped by every
 * Column/Row/Grid/Card splitProps call.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildLayoutStyles,
  designSystemKeys,
  filterProps,
  mapFlexAxes,
  mergeProps,
  parseBorder,
  tokenVar,
  zIndexVar,
} from './index';

describe('DesignSystemProps ↔ designSystemKeys invariant', () => {
  it('the interface and the key arrays agree exactly', () => {
    const typesSource = readFileSync(fileURLToPath(new URL('../../types/src/index.ts', import.meta.url)), 'utf-8');
    const match = typesSource.match(/export interface DesignSystemProps \{(.*?)\n\}/s);
    expect(match).not.toBeNull();
    const interfaceKeys = new Set([...match![1].matchAll(/^ {2}(\w+)\??:/gm)].map(([, name]) => name));
    const arrayKeys = new Set<string>(designSystemKeys);

    const missingFromArrays = [...interfaceKeys].filter((k) => !arrayKeys.has(k));
    const missingFromInterface = [...arrayKeys].filter((k) => !interfaceKeys.has(k));

    // A prop in the interface but not the arrays is accepted by TypeScript and
    // silently dropped at runtime; one in the arrays but not the interface is
    // dead weight. Both directions must be empty.
    expect(missingFromArrays).toEqual([]);
    expect(missingFromInterface).toEqual([]);
  });
});

describe('tokenVar', () => {
  it('resolves token names to CSS variables', () => {
    expect(tokenVar('space', '400')).toBe('var(--we-space-400)');
    expect(tokenVar('color', 'primary-500')).toBe('var(--we-color-primary-500)');
  });

  it('passes raw CSS values through', () => {
    expect(tokenVar('space', '16px')).toBe('16px');
    expect(tokenVar('color', '#fff')).toBe('#fff');
    expect(tokenVar('color', 'rgba(0,0,0,0.5)')).toBe('rgba(0,0,0,0.5)');
    expect(tokenVar('space', 'calc(100% - 8px)')).toBe('calc(100% - 8px)');
    expect(tokenVar('space', 'auto')).toBe('auto');
    expect(tokenVar('space', 'var(--custom)')).toBe('var(--custom)');
  });

  it("treats bare '0' as a unitless CSS value, not a token", () => {
    expect(tokenVar('space', '0')).toBe('0');
  });

  it('falls back when no token is given', () => {
    expect(tokenVar('space', undefined)).toBe('0');
    expect(tokenVar('space', undefined, 'unset')).toBe('unset');
  });
});

describe('zIndexVar', () => {
  it('maps layer names to variables and numbers to strings', () => {
    expect(zIndexVar('modal')).toBe('var(--we-z-modal)');
    expect(zIndexVar(10)).toBe('10');
    expect(zIndexVar('-1')).toBe('-1');
    expect(zIndexVar(undefined)).toBeUndefined();
  });
});

describe('parseBorder', () => {
  it('resolves the color token in a border shorthand', () => {
    expect(parseBorder('1px solid neutral-200')).toBe('1px solid var(--we-color-neutral-200)');
  });

  it('passes already-processed values through', () => {
    expect(parseBorder('1px solid #ccc')).toBe('1px solid #ccc');
    expect(parseBorder('1px solid var(--we-color-neutral-200)')).toBe('1px solid var(--we-color-neutral-200)');
  });

  it('returns short values untouched and empty for nothing', () => {
    expect(parseBorder('none')).toBe('none');
    expect(parseBorder(undefined)).toBe('');
    expect(parseBorder(undefined, '1px solid neutral-100')).toBe('1px solid var(--we-color-neutral-100)');
  });
});

describe('mergeProps', () => {
  it('primary generic shorthands beat secondary specifics', () => {
    // The exact precedence the whole variant/size merge chain is built on:
    // an explicit p must override a default's px/pt, not merge under it.
    const merged = mergeProps({ p: '400' }, { px: '100', pt: '200' });
    expect(merged.px).toBe('400');
    expect(merged.pt).toBe('400');
    expect(merged.p).toBe('400');
  });

  it('primary specifics survive their own generic', () => {
    const merged = mergeProps({ p: '400', px: '600' }, {});
    expect(merged.px).toBe('600');
    expect(merged.py).toBe('400');
  });

  it('margin and radius follow the same rule', () => {
    const m = mergeProps({ m: '200' }, { ml: '500' });
    expect(m.ml).toBe('200');
    const r = mergeProps({ r: '300' }, { rtl: 'pill' });
    expect(r.rtl).toBe('300');
  });

  it('otherwise primary simply wins over secondary', () => {
    expect(mergeProps({ bg: 'primary-500' }, { bg: 'neutral-0', color: 'white' })).toEqual({
      bg: 'primary-500',
      color: 'white',
    });
  });
});

describe('mapFlexAxes', () => {
  it('ax is the main axis in a row, the cross axis in a column', () => {
    const row = mapFlexAxes({ ax: 'center', ay: 'end' }, 'row');
    expect(row.main).toBe('center');
    expect(row.cross).toBe('flex-end');

    const column = mapFlexAxes({ ax: 'center', ay: 'end' }, 'column');
    expect(column.main).toBe('flex-end');
    expect(column.cross).toBe('center');
  });

  it('maps the DS axis vocabulary onto CSS keywords', () => {
    expect(mapFlexAxes({ ay: 'between' }, 'column').main).toBe('space-between');
    expect(mapFlexAxes({ ax: 'stretch' }, 'column').cross).toBe('stretch');
  });
});

describe('filterProps', () => {
  it('keeps only listed keys with defined values', () => {
    expect(filterProps({ a: 1, b: undefined, c: 3 }, ['a', 'b'])).toEqual({ a: 1 });
  });
});

describe('buildLayoutStyles', () => {
  it('emits the structural flex baseline and resolved tokens', () => {
    const style = buildLayoutStyles({ gap: '300', p: '400', bg: 'neutral-0' }, 'column');
    expect(style.display).toBe('flex');
    expect(style['flex-direction']).toBe('column');
    expect(style['flex-wrap']).toBe('nowrap');
    expect(style.gap).toBe('var(--we-space-300)');
    expect(style.padding).toBe('var(--we-space-400) var(--we-space-400) var(--we-space-400) var(--we-space-400)');
    // bg emits the background-color longhand, never the shorthand — the
    // shorthand would reset background-image/position on every hover.
    expect(style['background-color']).toBe('var(--we-color-neutral-0)');
  });

  it('reverse flips the direction', () => {
    expect(buildLayoutStyles({ reverse: true }, 'row')['flex-direction']).toBe('row-reverse');
  });
});

describe('semantic roles as colour prop values', () => {
  /**
   * A template could not name a role before this — only spell out its variable — so templates used
   * scale positions, which cannot express a relationship that inverts between light and dark.
   */
  it('resolves a kebab-cased role name to its variable', () => {
    expect(tokenVar('color', 'surface-sunken')).toBe('var(--we-role-surface-sunken)');
    expect(tokenVar('color', 'surface-raised')).toBe('var(--we-role-surface-raised)');
    expect(tokenVar('color', 'text-muted')).toBe('var(--we-role-text-muted)');
    expect(tokenVar('color', 'overlay')).toBe('var(--we-role-overlay)');
  });

  it('leaves scale positions and raw CSS alone', () => {
    expect(tokenVar('color', 'neutral-100')).toBe('var(--we-color-neutral-100)');
    expect(tokenVar('color', 'primary-500')).toBe('var(--we-color-primary-500)');
    expect(tokenVar('color', '#1a1a1e')).toBe('#1a1a1e');
    expect(tokenVar('color', 'transparent')).toBe('transparent');
  });

  it('only applies to colour props', () => {
    // `surface` is a role, and also not a space token — a space prop naming it is a mistake, and
    // resolving it to a colour would hide that behind a plausible-looking variable.
    expect(tokenVar('space', 'surface')).toBe('var(--we-space-surface)');
  });

  it('resolves a border shorthand naming a role', () => {
    expect(parseBorder('1px solid border')).toBe('1px solid var(--we-role-border)');
    expect(parseBorder('1px solid border-strong')).toBe('1px solid var(--we-role-border-strong)');
  });
});
