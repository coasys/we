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

import { buildValidationContext, validateSemantic, withEntities } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { type Cartridge, fieldGuide, toolLibrary } from './index.ts';

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
