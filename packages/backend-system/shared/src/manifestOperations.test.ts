/**
 * Declared operations as the manifest carries them: kept through validation, and their structure
 * refused when it is not the format's.
 */
import { describe, expect, it } from 'vitest';

import { type EntityManifest, stepVerb, validateManifest } from './manifest';

const manifest = (operations: unknown) => ({
  version: '1',
  entities: { Note: { properties: { text: { type: 'string' } }, relations: {} } },
  operations,
});

const VOTE = {
  description: 'Vote on a note.',
  params: { note: { type: 'string', required: true }, value: { type: 'number' } },
  errors: { closed: 'Voting has closed.' },
  steps: [
    { find: { as: 'mine', entity: 'Note', where: { author: { $: 'invoker' } }, one: false } },
    { check: { condition: { $: 'value > 0' }, error: 'closed' } },
    {
      forEach: {
        in: { $: 'mine' },
        as: 'old',
        steps: [{ delete: { entity: 'Note', id: { $: 'old.id' } } }],
      },
    },
    { create: { as: 'made', entity: 'Note', fields: { text: 'hi' } }, when: { $: 'value != 0' } },
  ],
  returns: { $: 'made.id' },
};

const paths = (input: unknown) => {
  const result = validateManifest(input);
  return result.valid ? [] : result.errors.map((e) => e.path);
};

describe('operations in the manifest', () => {
  it('survive validation whole', () => {
    const result = validateManifest(manifest({ vote: VOTE }));
    expect(result.valid).toBe(true);
    const kept = (result as { manifest: EntityManifest }).manifest.operations;
    expect(kept).toEqual({ vote: VOTE });
    expect(kept!.vote.steps.map(stepVerb)).toEqual(['find', 'check', 'forEach', 'create']);
  });

  it('refuse a step with an unknown verb, rather than dropping it', () => {
    expect(paths(manifest({ vote: { ...VOTE, steps: [{ upsert: { entity: 'Note' } }] } }))).toEqual([
      'operations.vote.steps.0',
    ]);
  });

  it('refuse a key a step does not have, so a misspelt guard is not silently ignored', () => {
    const step = { delete: { entity: 'Note', id: 'x' }, whenn: true };
    expect(paths(manifest({ vote: { ...VOTE, steps: [step] } }))).toEqual(['operations.vote.steps.0']);
  });

  it('refuse a step missing a value it cannot run without', () => {
    expect(paths(manifest({ vote: { ...VOTE, steps: [{ delete: { entity: 'Note' } }] } }))).toEqual([
      'operations.vote.steps.0.delete.id',
    ]);
  });

  it('refuse a call that does not name a namespace', () => {
    const step = { call: { operation: 'vote', args: {} } };
    expect(paths(manifest({ vote: { ...VOTE, steps: [step] } }))).toEqual(['operations.vote.steps.0.call.operation']);
  });

  it('refuse a param of a type the format does not have', () => {
    const bad = { ...VOTE, params: { note: { type: 'record' } } };
    expect(paths(manifest({ vote: bad }))).toEqual(['operations.vote.params.note.type']);
  });

  it('are optional', () => {
    expect(validateManifest(manifest(undefined)).valid).toBe(true);
  });
});
