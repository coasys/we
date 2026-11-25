/**
 * Record the block flattening kernel's vectors: each case's input, run through the kernel, written
 * beside it as JSON.
 *
 * A second host flattens a document against these, so they are the kernel's contract as much as its
 * code is. The tests replay them; a change that alters an answer fails there until this is run again
 * and the diff to the vectors is reviewed as the behaviour change it is.
 *
 *   pnpm --filter @we/block-shared record:kernels
 *
 * Run by Node directly (it strips the types), which is why the import names its extension.
 */
import { writeFileSync } from 'node:fs';

import { type BlockNode, flattenBlocks } from '../src/kernels/flattenBlocks.ts';

const text = (value: string): BlockNode => ({ entity: 'TextBlock', fields: { text: value } });
const unknown: BlockNode = { fields: {} };

const cases: { name: string; input: BlockNode[] }[] = [
  { name: 'an empty document', input: [] },
  {
    name: 'top-level blocks in order',
    input: [text('one'), text('two'), { entity: 'ImageBlock', fields: { altText: 'a' } }],
  },
  {
    name: 'a collection and what is inside it',
    input: [
      text('intro'),
      { entity: 'CollectionBlock', fields: { kind: 'group' }, content: [text('inside'), text('also inside')] },
      text('outro'),
    ],
  },
  {
    name: 'collections nested two deep',
    input: [
      {
        entity: 'CollectionBlock',
        fields: {},
        content: [{ entity: 'CollectionBlock', fields: {}, content: [text('deep')] }, text('beside')],
      },
    ],
  },
  { name: 'an unknown block keeps its position, so the next key does not move', input: [unknown, text('after')] },
  {
    name: 'an unknown block takes what is under it with it',
    input: [{ fields: {}, content: [text('lost')] }, text('kept')],
  },
  { name: 'an empty collection', input: [{ entity: 'CollectionBlock', fields: { kind: 'group' }, content: [] }] },
];

writeFileSync(
  new URL('../src/kernels/vectors/flattenBlocks.json', import.meta.url),
  `${JSON.stringify(
    cases.map((c) => ({ name: c.name, input: c.input, output: flattenBlocks(c.input) })),
    null,
    2,
  )}\n`,
);
console.log('kernel vectors recorded');
