/**
 * The block flattening kernel: a document's tree as the flat, keyed list `core.createPost` writes.
 * Replayed from its recorded vectors, the contract a second host flattens a document against.
 */
import { describe, expect, it } from 'vitest';

import { type BlockNode, flattenBlocks } from '../src/kernels/flattenBlocks';
import recorded from '../src/kernels/vectors/flattenBlocks.json';

const vectors = recorded as unknown as { name: string; input: BlockNode[]; output: unknown }[];

describe('flattenBlocks', () => {
  it('lists a collection before what is inside it, each child naming its parent by key', () => {
    const flat = flattenBlocks([
      { entity: 'CollectionBlock', fields: {}, content: [{ entity: 'TextBlock', fields: { text: 'a' } }] },
      { entity: 'TextBlock', fields: { text: 'b' } },
    ]);
    expect(flat.map((block) => [block.key, block.parentKey])).toEqual([
      ['0', undefined],
      ['0.0', '0'],
      ['1', undefined],
    ]);
  });

  it('hands back the fields it was given rather than copies', () => {
    const fields = { text: 'a' };
    expect(flattenBlocks([{ entity: 'TextBlock', fields }])[0].fields).toBe(fields);
  });
});

describe('the recorded vectors', () => {
  it.each(vectors.map((vector) => [vector.name, vector] as const))('%s', (_name, vector) => {
    expect(JSON.parse(JSON.stringify(flattenBlocks(vector.input)))).toEqual(vector.output);
  });
});
