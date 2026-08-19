/**
 * The generation loop over the backend transport — the node's own language model, reached through
 * the language-model port. The Anthropic path shares every part of this loop except the fetch, so
 * these tests cover the loop itself: parsing what models actually return, and the repair turns
 * that feed validation errors back.
 */
import { describe, expect, it } from 'vitest';

import { generateShapeDraft } from '../src/shared/ai/shapeGeneration';

const VALID = {
  name: 'Sighting',
  description: 'A bird sighting.',
  icon: 'binoculars',
  classHint: 'A specific observation of a bird.',
  identityField: 'species',
  properties: [{ name: 'species', type: 'text', required: true, hint: 'The common name.' }],
  relationships: [],
};

/** A port whose replies are scripted, recording what it was asked. */
function scriptedPort(replies: string[]) {
  const calls: { system: string; input: string }[] = [];
  return {
    calls,
    port: {
      prompt: async (system: string, input: string) => {
        calls.push({ system, input });
        const reply = replies.shift();
        if (reply === undefined) throw new Error('scripted port ran dry');
        return reply;
      },
    },
  };
}

const OPTS = { existingEntities: ['TaskBlock'], referenceTargets: ['ImageBlock'] };

describe('generation through the backend model', () => {
  it('accepts a clean JSON reply', async () => {
    const { port } = scriptedPort([JSON.stringify(VALID)]);
    const result = await generateShapeDraft('we log bird sightings', { transport: { kind: 'backend', port }, ...OPTS });
    expect(result.remainingProblems).toEqual([]);
    expect(result.draft.name).toBe('Sighting');
    expect(result.draft.members.map((m) => m.name)).toEqual(['species']);
  });

  it('forgives code fences and prose around the object', async () => {
    const { port } = scriptedPort(['Here you go:\n```json\n' + JSON.stringify(VALID) + '\n```\nHope that helps!']);
    const result = await generateShapeDraft('birds', { transport: { kind: 'backend', port }, ...OPTS });
    expect(result.draft.name).toBe('Sighting');
  });

  it('sends the validation errors back and takes the corrected answer', async () => {
    // First reply claims a taken name; the loop must complain and accept the fix.
    const { port, calls } = scriptedPort([
      JSON.stringify({ ...VALID, name: 'TaskBlock' }),
      JSON.stringify(VALID),
    ]);
    const result = await generateShapeDraft('birds', { transport: { kind: 'backend', port }, ...OPTS });
    expect(result.draft.name).toBe('Sighting');
    expect(result.remainingProblems).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls[1].input).toMatch(/refused/);
    expect(calls[1].input).toMatch(/TaskBlock/);
  });

  it('carries the output contract in the system prompt, since text is all the port speaks', async () => {
    const { port, calls } = scriptedPort([JSON.stringify(VALID)]);
    await generateShapeDraft('birds', { transport: { kind: 'backend', port }, ...OPTS });
    expect(calls[0].system).toMatch(/ONLY a JSON object/);
    expect(calls[0].system).toMatch(/"properties"/);
  });

  it('returns its best candidate with the surviving problems when repairs run out', async () => {
    const taken = JSON.stringify({ ...VALID, name: 'TaskBlock' });
    const { port } = scriptedPort([taken, taken, taken]);
    const result = await generateShapeDraft('birds', { transport: { kind: 'backend', port }, ...OPTS });
    expect(result.remainingProblems.length).toBeGreaterThan(0);
  });
});
