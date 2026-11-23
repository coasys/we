/**
 * Codegen forwards a manifest's `abstract` and `extends`.
 *
 * `def.base` stays the fallback, so a core definition that names neither still emits the class it
 * emits today. A declaration that names them emits those, including the parent import.
 */
import { CORE_DEFS } from '@we/entities/manifest';
import { describe, expect, it } from 'vitest';

import { renderEntity } from '../scripts/generateClasses.mjs';

describe('class emission of abstract and extends', () => {
  it('keeps a core class on its base, and does not mark that base abstract', () => {
    const muted = renderEntity('MutedAgent', CORE_DEFS.MutedAgent);
    expect(muted).toContain("@Model({ name: 'MutedAgent' })");
    expect(muted).toContain('export class MutedAgent extends WeNode {');
    expect(muted).toContain("import { WeNode } from './WeNode';");
    expect(muted).not.toContain('abstract:');

    const settings = renderEntity('AgentSettings', CORE_DEFS.AgentSettings);
    expect(settings).toContain('export class AgentSettings extends Ad4mModel {');
    expect(settings).not.toContain('abstract:');
  });

  it('emits a declared abstract class and imports the parent it names', () => {
    const source = renderEntity('Chick', {
      base: 'Ad4mModel',
      entity: {
        abstract: true,
        extends: 'BirdBase',
        properties: { species: { type: 'string', predicate: 'we://species' } },
        relations: {},
      },
    });
    expect(source).toContain("@Model({ name: 'Chick', abstract: true })");
    expect(source).toContain("import { BirdBase } from './BirdBase';");
    expect(source).toContain('export class Chick extends BirdBase {');
    expect(source).not.toContain('WeNode');
  });
});
