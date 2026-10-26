/**
 * The theming reference and the docs, held to the registries.
 *
 * The reference is generated, so the first half is about the generator: every registry entry it
 * should list is listed, and every setting it lists is one that exists. The second half is about the
 * hand-written architecture doc, which cannot be generated and so is checked: it names every family,
 * type role, component key and display axis, and nothing that is not one.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  COMPONENT_THEME_KEYS,
  PALETTE_HUES,
  SEMANTIC_FAMILIES,
  SURFACE_IMAGE_ROLES,
  TYPE_ROLE_KEYS,
  TYPE_ROLES,
} from '@we/tokens';
import { describe, expect, it } from 'vitest';

import { DISPLAY_AXES } from './display';
import { themingReference } from './reference';
import { SPECIAL_SETTING_DOCS, SPECIAL_SETTINGS, THEME_SETTINGS } from './themeSettings';

const reference = themingReference();
const named = (text: string, name: string) => text.includes('`' + name + '`');

describe('the theming reference', () => {
  it('lists every setting a theme can set, with what it does', () => {
    const documented = [...Object.keys(THEME_SETTINGS), ...Object.keys(SPECIAL_SETTING_DOCS)];
    for (const key of documented) expect(reference, key).toMatch(new RegExp(`^- \`${key}\` — \\S`, 'm'));
    // Every special setting is documented, apart from the two that are bookkeeping.
    const undocumented = SPECIAL_SETTINGS.filter((key) => !(key in SPECIAL_SETTING_DOCS));
    expect(undocumented.sort()).toEqual(['schemaVersion', 'themeName']);
  });

  it('lists no setting that does not exist', () => {
    const listed = [...reference.matchAll(/^- `([a-zA-Z]+)` — /gm)].map((m) => m[1]);
    const known = new Set<string>([...Object.keys(THEME_SETTINGS), ...SPECIAL_SETTINGS]);
    expect(listed.filter((key) => !known.has(key))).toEqual([]);
  });

  it('names every family, type role, component key, surface image and display axis', () => {
    for (const name of [
      ...SEMANTIC_FAMILIES,
      ...PALETTE_HUES,
      ...TYPE_ROLES,
      ...Object.keys(TYPE_ROLE_KEYS),
      ...COMPONENT_THEME_KEYS,
      ...SURFACE_IMAGE_ROLES,
      ...DISPLAY_AXES.map((axis) => axis.key),
    ]) {
      expect(named(reference, name), name).toBe(true);
    }
  });
});

describe('docs/architecture/theming.md', () => {
  const doc = readFileSync(resolve(__dirname, '../../../../docs/architecture/theming.md'), 'utf8');

  it('names every family, type role, component key and display axis', () => {
    for (const name of [
      ...SEMANTIC_FAMILIES,
      ...PALETTE_HUES,
      ...TYPE_ROLES,
      ...COMPONENT_THEME_KEYS,
      ...DISPLAY_AXES.map((axis) => axis.key),
    ]) {
      expect(named(doc, name), name).toBe(true);
    }
  });

  it('names no theme setting that does not exist, nor does THEME_AUTHORING.md', () => {
    // A name shaped like a setting is a claim about the vocabulary: `primaryHue`, `surfaceShadow`.
    const shaped =
      /`([a-z]+(?:Hue|Saturation|Lightness|Radius|Padding|PaddingX|Gap|Intensity|Width|Family|Scale|Opacity))`/g;
    const authoring = readFileSync(resolve(__dirname, '../THEME_AUTHORING.md'), 'utf8');
    const claimed = [...doc.matchAll(shaped), ...authoring.matchAll(shaped)].map((m) => m[1]);
    const known = new Set<string>([...Object.keys(THEME_SETTINGS), ...SPECIAL_SETTINGS]);
    expect(claimed.filter((key) => !known.has(key))).toEqual([]);
  });
});
