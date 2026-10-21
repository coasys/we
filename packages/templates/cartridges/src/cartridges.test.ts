/**
 * The cartridges, judged as the validator would judge any template — and with what it cannot know.
 *
 * A cartridge's sections query kinds of record the cartridge defines itself. The validator learns
 * entity names from the generated context, which knows WE's own models and nothing a space defines,
 * so it reports every one of those queries as an unknown entity. This test says what is left once
 * the cartridge's own shapes are counted as known: the errors that are really the template's.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildValidationContext, bundleThemes, readBundle, validateSemantic, withEntities } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { bundleFileName, type Cartridge, cartridgeBundles, coasys, fieldGuide, toolLibrary } from './index.ts';

const contextData = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../ai-context/context.json'), 'utf-8'));

function errorsFor(cartridge: Cartridge, withShapes: boolean): string[] {
  const base = buildValidationContext(contextData);
  const context = withShapes
    ? withEntities(
        base,
        cartridge.shapes.map((shape) => shape.name),
      )
    : base;
  return [cartridge.shell, ...cartridge.sections].flatMap((template) =>
    validateSemantic(template, context)
      .errors.filter((e) => e.severity === 'error')
      .map((e) => `${template.id}: ${e.path}: ${e.message}`),
  );
}

describe.each([fieldGuide, toolLibrary])('the $name cartridge', (cartridge) => {
  it('is valid once its own shapes are known', () => {
    expect(errorsFor(cartridge, true)).toEqual([]);
  });

  it('is reported as broken by a validator that does not know them — the gap this records', () => {
    const errors = errorsFor(cartridge, false);
    expect(errors.length).toBeGreaterThan(0);
    for (const shape of cartridge.shapes) expect(errors.join('\n')).toContain(shape.name);
  });
});

describe('the Coasys cartridge', () => {
  /*
    It defines no kinds of record of its own, so there is no gap to record: every template it brings
    must validate as it stands — the app around every space and the space template with its pages.
  */
  it('is valid as it stands', () => {
    const context = buildValidationContext(contextData);
    const errors = [coasys.app!, coasys.shell].flatMap((template) =>
      validateSemantic(template, context)
        .errors.filter((e) => e.severity === 'error')
        .map((e) => `${template.id}: ${e.path}: ${e.message}`),
    );
    expect(errors).toEqual([]);
  });

  it('brings its own name, mark, sign-in screen and theme', () => {
    const bundle = cartridgeBundles().find((b) => b.id === 'coasys')!;
    expect(bundle.brand?.name).toBe('Coasys');
    expect(bundle.brand?.mark).toMatch(/^<svg/);
    expect(JSON.stringify(bundle.bootScreen)).toContain('CredentialField');
    const [coasysTheme] = bundleThemes(bundle);
    expect(bundle.app?.meta.themeId).toBe(coasysTheme.id);
    expect(Object.keys(coasysTheme.overrides)).toEqual(expect.arrayContaining(['light', 'dark']));
  });

  it('offers Glow beside its own theme, carrying its font rather than fetching it', () => {
    const bundle = cartridgeBundles().find((b) => b.id === 'coasys')!;
    const themes = bundleThemes(bundle);
    expect(themes.map((t) => t.name)).toEqual(['Coasys', 'Coasys Glow']);
    expect(bundle.app?.meta.themeIds).toEqual(themes.map((t) => t.id));
    const glow = themes[1];
    expect(glow.css).toContain("url('data:font/woff2;base64,");
    expect(glow.css).not.toMatch(/url\((?!'data:)/);
  });
});

describe('the lookup that read every tool as available', () => {
  /*
    The catalogue first found an item's open loan with `find(local.loans, { item: it.id })`. Its
    query includes `item`, so `item` was the record, the lookup matched nothing, and every tool
    showed "available" with no error. The validator now says so; this puts the original back into a
    copy of the catalogue to keep it saying so.
  */
  it('is reported by the validator', () => {
    const broken = JSON.parse(
      JSON.stringify(toolLibrary.sections[0]).replaceAll(
        'local.loans.find(l, l.item.id == it.id)',
        'find(local.loans, { item: it.id })',
      ),
    );
    const context = withEntities(
      buildValidationContext(contextData),
      toolLibrary.shapes.map((s) => s.name),
    );
    const warnings = validateSemantic(broken, context).errors.filter((e) =>
      e.message.includes('compares the included item'),
    );
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('the cartridges as bundles', () => {
  const bundlesDir = resolve(import.meta.dirname, '../../../../bundles');

  it.each(cartridgeBundles().map((bundle) => [bundle.id, bundle] as const))(
    '%s is checked in as `pnpm --filter @we/template-cartridges bundle` writes it',
    (id, bundle) => {
      const onDisk = JSON.parse(readFileSync(resolve(bundlesDir, bundleFileName(id)), 'utf-8'));
      expect(onDisk).toEqual(JSON.parse(JSON.stringify(bundle)));
    },
  );

  it.each(cartridgeBundles().map((bundle) => [bundle.id, bundle] as const))('%s reads as a bundle', (_id, bundle) => {
    expect(readBundle(JSON.parse(JSON.stringify(bundle))).problems).toEqual([]);
  });

  it('carries a cartridge’s modules where an install screen finds them, and no sample content', () => {
    const fieldGuideBundle = cartridgeBundles().find((bundle) => bundle.id === 'field-guide')!;
    const shell = fieldGuideBundle.templates!.find((template) => template.id === 'shell')!;
    expect(shell.meta.requires?.modules).toContain('globe');
    expect(JSON.stringify(fieldGuideBundle)).not.toContain('Levels Naturalists');
  });
});
