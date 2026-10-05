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

import { buildValidationContext, validateSemantic } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { type Cartridge, fieldGuide, toolLibrary } from './index.ts';

const contextData = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../ai-context/context.json'), 'utf-8'));

function errorsFor(cartridge: Cartridge, withShapes: boolean): string[] {
  const context = buildValidationContext(contextData);
  if (withShapes) for (const shape of cartridge.shapes) context.entityNames.add(shape.name);
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
