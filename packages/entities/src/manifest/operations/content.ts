import type { OperationDefinition } from '@we/backend-shared';

import { deriveRecordId, keySegment } from '../../operations/ids';

/** The entities a composed document's blocks are stored as. */
export const POST_BLOCK_ENTITIES = [
  'AudioBlock',
  'CalloutBlock',
  'CodeBlock',
  'CollectionBlock',
  'DividerBlock',
  'EmbedBlock',
  'EventBlock',
  'FileBlock',
  'ImageBlock',
  'LinkBlock',
  'LocationBlock',
  'TagBlock',
  'TaskBlock',
  'TextBlock',
  'VideoBlock',
];

/**
 * What a thread's subject may be: anything somebody says something in response to — a post, a
 * block in one, a line in a call, a topic, a claimed relationship. Every one is a node, and so
 * carries `thread`.
 */
export const THREAD_SUBJECT_ENTITIES = [...POST_BLOCK_ENTITIES, 'Relationship', 'Topic'];

/** Where the block create sits in `createPost`'s steps: the forEach's index, then the create's inside it. */
const BLOCKS_STEP = 3;
const BLOCK_CREATE_STEP = 0;

/**
 * The id `core.createPost` gives the block with this key, in the invocation with this id.
 *
 * A composed document's stored blob names each block by its record's id, so a reply to one paragraph
 * can find it, and the host encodes that blob before the operation runs. It can, because an
 * operation's ids are derived from the invocation and the step: the host chooses the invocation id,
 * works out each block's id here, and passes the blob in with the blocks. A test runs the operation
 * and checks the records it made carry exactly these ids.
 */
export function postBlockId(invocationId: string, key: string): Promise<string> {
  return deriveRecordId(invocationId, [String(BLOCKS_STEP), keySegment(key), String(BLOCK_CREATE_STEP)]);
}

export const CONTENT_OPERATIONS: Record<string, OperationDefinition> = {
  /*
    A composed document — a post, a message, a reply — and its blocks, written as one.

    The host flattens the composer's document before it calls: uploads its files, works out what the
    root stores about the blocks (the encoded document, its plain text, who it mentions) and lists the
    blocks in document order, each naming the planned id of the collection block it sits in (see
    `postBlockId`); a block at the top level names none and goes in the post. That is what lets a
    reader draw the post from its root alone and still reach each block by id.

    Where it goes is one of two places. In a collection — a channel, the space's top level — it is a
    child, kept in the order it arrives. In response to a record it is that record's response and a
    child of nothing, and it is linked from its thread's subject (the first record above that is not
    itself a response, which the host reads and names), so the whole discussion under a post is one
    read. A subject the host could not place leaves the reply unthreaded rather than unwritten: its
    subject's responses still hold it. See docs/architecture/relations.md.
  */
  createPost: {
    description:
      'Write a composed document — a post, a message or a reply — with its blocks, in a collection or in response to a record, threaded under its subject.',
    params: {
      root: {
        type: 'object',
        required: true,
        description:
          'The root’s own fields: kind, mode, and what it stores about its blocks (editorState, textContent), plus where a copy came from.',
      },
      blocks: {
        type: 'list',
        required: true,
        description:
          'The blocks in document order, each { key, entity, fields, parent } — parent the planned id of the collection block it is in, absent at the top level.',
      },
      mentions: { type: 'list', description: 'The DIDs the document mentions.' },
      container: { type: 'string', description: 'The collection it is a child of.' },
      respondsTo: { type: 'string', description: 'The record it answers.' },
      thread: {
        type: 'string',
        description:
          'The subject of the thread it joins — respondsTo, or the first record above it that is not itself a response.',
      },
      threadEntity: { type: 'string', description: 'The thread subject’s entity.' },
      generatedBy: { type: 'string', description: 'The ModelRun that wrote it, when a model did.' },
    },
    errors: {
      twoPlaces: 'A post goes in a collection or answers a record, not both.',
    },
    steps: [
      { check: { condition: { $: '!(container && respondsTo)' }, error: 'twoPlaces' } },
      {
        create: {
          as: 'post',
          entity: 'CollectionBlock',
          fields: {
            $: 'generatedBy ? merge(root, { mentions: mentions ?? [], generatedBy: [generatedBy] }) : merge(root, { mentions: mentions ?? [] })',
          },
          parent: { id: { $: 'respondsTo' }, relation: 'responses' },
        },
      },
      {
        link: { entity: 'CollectionBlock', id: { $: 'container' }, relation: 'children', target: { $: 'post' } },
        when: { $: 'container' },
      },
      // Index 3 and its create at 0 are what `postBlockId` derives from: keep the two together.
      {
        forEach: {
          in: { $: 'blocks' },
          as: 'block',
          key: { $: 'block.key' },
          steps: [
            {
              create: {
                entity: { $: 'block.entity' },
                oneOf: POST_BLOCK_ENTITIES,
                fields: { $: 'block.fields' },
                parent: { id: { $: 'block.parent ?? post.id' }, relation: 'children', entity: 'CollectionBlock' },
              },
            },
          ],
        },
      },
      {
        link: {
          entity: { $: 'threadEntity' },
          oneOf: THREAD_SUBJECT_ENTITIES,
          id: { $: 'thread' },
          relation: 'thread',
          target: { $: 'post' },
        },
        when: { $: 'respondsTo && thread' },
      },
    ],
    returns: { $: 'post.id' },
  },
};
