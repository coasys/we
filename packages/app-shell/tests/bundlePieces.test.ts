/**
 * What a bundle lands as, the same for a deployment's built-in bundle and an installed one, and how
 * the app's display policy picks a space's template.
 */
import { bundlePieces } from '@shared/bundles/bundlePieces';
import { appSpaceTemplate, followedTemplateId } from '@shared/bundles/display';
import type { Bundle } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

const meta = (name: string, role?: string, themeId?: string) => ({
  name,
  description: '',
  icon: 'x',
  ...(role ? { role } : {}),
  ...(themeId ? { themeId } : {}),
});

const bundle = {
  format: 'we-bundle',
  formatVersion: 1,
  id: 'field-guide',
  version: '1.2.0',
  name: 'Field guide',
  description: '',
  icon: 'x',
  app: { id: 'app', type: 'Column', meta: meta('App', 'app') },
  templates: [
    { id: 'shell', type: 'Column', meta: meta('Shell', undefined, 'moss') },
    { id: 'other', type: 'Column', meta: meta('Other', undefined, 'light') },
    { id: 'species', type: 'Column', meta: meta('Species', 'view') },
  ],
  theme: { id: 'moss', name: 'Moss', overrides: {} },
  display: { spaces: 'ours', template: 'shell' },
} as unknown as Bundle;

describe('the pieces a bundle lands as', () => {
  const pieces = bundlePieces(bundle);

  it('puts every piece under the bundle’s id', () => {
    expect(pieces.app?.id).toBe('field-guide--app');
    expect(pieces.shells.map((t) => t.id)).toEqual(['field-guide--shell', 'field-guide--other']);
    expect(pieces.sections.map((t) => t.id)).toEqual(['field-guide--species']);
    expect(pieces.themes.map((t) => t.id)).toEqual(['field-guide--moss']);
  });

  it('says where each template came from', () => {
    expect(pieces.sections[0].source).toEqual({ bundle: 'field-guide', version: '1.2.0', piece: 'species' });
  });

  it('rewrites the references a bundle makes to its own pieces, and only those', () => {
    expect(pieces.shells[0].meta.themeId).toBe('field-guide--moss');
    expect(pieces.shells[1].meta.themeId).toBe('light');
    expect(pieces.display).toEqual({ spaces: 'ours', template: 'field-guide--shell' });
  });

  it('leaves the bundle it was given alone', () => {
    expect(bundle.templates![0].id).toBe('shell');
  });

  it('lands every theme a bundle offers, and the list a template names, under the bundle’s id', () => {
    const offering = bundlePieces({
      ...bundle,
      theme: undefined,
      themes: [
        { id: 'flat', name: 'Flat', overrides: {} },
        { id: 'glow', name: 'Glow', overrides: {} },
      ],
      app: { id: 'app', type: 'Column', meta: { ...meta('App', 'app'), themeIds: ['flat', 'glow', 'dark'] } },
    } as unknown as Bundle);
    expect(offering.themes.map((t) => t.id)).toEqual(['field-guide--flat', 'field-guide--glow']);
    expect(offering.app?.meta.themeIds).toEqual(['field-guide--flat', 'field-guide--glow', 'dark']);
  });

  it('lands its pages under the bundle’s id, and points the brand’s About at the landed one', () => {
    const paged = bundlePieces({
      ...bundle,
      pages: [{ id: 'about', type: 'Column', meta: meta('About', 'page') }],
      brand: { name: 'Field Guide', aboutPage: 'about' },
    } as unknown as Bundle);
    expect(paged.pages.map((t) => t.id)).toEqual(['field-guide--about']);
    expect(paged.pages[0].source).toEqual({ bundle: 'field-guide', version: '1.2.0', piece: 'about' });
    expect(paged.brand?.aboutPage).toBe('field-guide--about');
    expect(paged.shells.map((t) => t.id)).not.toContain('field-guide--about');
  });

  it('carries the brand and the sign-in screen as they are', () => {
    const branded = bundlePieces({
      ...bundle,
      brand: { name: 'Field Guide', mark: '<svg/>' },
      bootScreen: { type: 'Column' },
    } as unknown as Bundle);
    expect(branded.brand).toEqual({ name: 'Field Guide', mark: '<svg/>' });
    expect(branded.bootScreen).toEqual({ type: 'Column' });
    expect(pieces.brand).toBeUndefined();
  });

  it('points a starter’s template and theme at the landed pieces, and leaves a built-in’s name alone', () => {
    const started = bundlePieces({
      ...bundle,
      starters: [
        { id: 'own', settings: { defaultTemplateId: 'shell', defaultThemeId: 'moss', autoInterpret: true } },
        { id: 'builtIn', settings: { defaultTemplateId: 'workshop', defaultThemeId: 'dark' } },
      ],
    } as unknown as Bundle);
    expect(started.starters.map((s) => s.settings)).toEqual([
      { defaultTemplateId: 'field-guide--shell', defaultThemeId: 'field-guide--moss', autoInterpret: true },
      { defaultTemplateId: 'workshop', defaultThemeId: 'dark' },
    ]);
    expect(pieces.starters).toEqual([]);
  });
});

describe('the app’s display policy', () => {
  const sources = [bundlePieces(bundle)];

  it('shows every space with the bundle’s template while its app is the one in use', () => {
    expect(appSpaceTemplate('field-guide--app', sources)).toBe('field-guide--shell');
    expect(followedTemplateId('space-own', appSpaceTemplate('field-guide--app', sources))).toBe('field-guide--shell');
  });

  it('leaves spaces their own in any other app, or when the bundle says so', () => {
    expect(appSpaceTemplate('we-app', sources)).toBeUndefined();
    const theirs = bundlePieces({ ...bundle, display: { spaces: 'theirs' } } as Bundle);
    expect(appSpaceTemplate('field-guide--app', [theirs])).toBeUndefined();
    expect(followedTemplateId('space-own', undefined)).toBe('space-own');
  });
});
