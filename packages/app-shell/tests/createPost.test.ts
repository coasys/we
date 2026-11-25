/**
 * `core.createPost`, as the composer and an agent's `write_post` both reach it through `writePost`,
 * against the in-memory backend: the post and its blocks land together with the ids the stored
 * document names, a reply is threaded under its subject and is a child of nothing, and a post that
 * cannot be written leaves nothing behind.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { type ContentBlock, decodeEditorState, planPost, registerCoreBlocks, writePost } from '@we/block-shared';
import {
  COMPOSE_CARD_POST,
  getEntity,
  isOperationError,
  registerOperations,
  runOperation,
  threadSubject,
  unregisterOperations,
} from '@we/entities';
import { FEED_MANIFEST } from '@we/module-feed';
import { pollsModule } from '@we/module-polls';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { documentAccess } from '../src/shared/agentData';
import { createModuleStoreDeps } from '../src/shared/registries/moduleHostServices';
import { moduleRegistry } from '../src/shared/registries/moduleRegistry';

const ME = 'did:test:me';

interface Row {
  id: string;
  [field: string]: unknown;
}
type Model = {
  findAll(d: unknown, q?: Record<string, unknown>): Promise<Row[]>;
  findOne(d: unknown, q: Record<string, unknown>): Promise<Row | null>;
  create(d: unknown, data: Record<string, unknown>, o?: Record<string, unknown>): Promise<Row>;
};
const model = (name: string) => getEntity(name) as unknown as Model;
const read = async (entity: string, id: string) => (await model(entity).findOne(dataset, { where: { id } }))!;
const ids = (value: unknown) => (Array.isArray(value) ? value : []).map((v) => (typeof v === 'string' ? v : v.id));

let dataset: unknown;
let ports: ReturnType<typeof createInMemoryBackendPorts>;
let channel: Row;

beforeAll(() => registerCoreBlocks());

beforeEach(async () => {
  ports = createInMemoryBackendPorts(
    { selfId: () => ME },
    { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-posts', name: 'Posts' }] },
  );
  dataset = (await ports.lifecycle.get('ds-posts'))!.handle;
  channel = await model('CollectionBlock').create(dataset, { kind: 'channel', mode: 'feed' });
});

const paragraph = (text: string): ContentBlock => ({ _type: 'block', text });

describe('core.createPost', () => {
  it('writes the post and its blocks in a collection, and names every block by the id it was given', async () => {
    const blocks: ContentBlock[] = [
      paragraph('first'),
      { _type: 'collection', content: [paragraph('inside')] } as ContentBlock,
      paragraph('last'),
    ];
    const id = await writePost(dataset, blocks, { invoker: ME, kind: 'post', container: channel.id });

    const post = await read('CollectionBlock', id);
    expect(post).toMatchObject({ kind: 'post', mode: 'document', textContent: 'first inside last', author: ME });
    expect(ids((await read('CollectionBlock', channel.id)).children)).toEqual([id]);

    // The composer's blocks were stamped with their records' ids, in order, nested under their collection.
    const [first, nested, last] = blocks;
    expect(ids(post.children)).toEqual([first._key, nested._key, last._key]);
    const inner = (nested as unknown as { content: ContentBlock[] }).content[0];
    expect(ids((await read('CollectionBlock', nested._key!)).children)).toEqual([inner._key]);
    expect((await read('TextBlock', inner._key!)).text).toBe('inside');

    // The stored document names the same ids, so a reader reaches each block from the root alone.
    const stored = decodeEditorState(post.editorState) ?? [];
    expect(stored.map((b) => b._key)).toEqual([first._key, nested._key, last._key]);
  });

  it('threads a reply under the post it answers, and a reply to that reply under the same post', async () => {
    const post = await writePost(dataset, [paragraph('a post')], { invoker: ME, kind: 'post', container: channel.id });
    const reply = await writePost(dataset, [paragraph('a reply')], { invoker: ME, kind: 'reply', respondsTo: post });
    const answer = await writePost(dataset, [paragraph('an answer')], {
      invoker: ME,
      kind: 'reply',
      respondsTo: reply,
    });

    const subject = await read('CollectionBlock', post);
    expect(ids(subject.responses)).toEqual([reply]);
    expect(ids(subject.thread).sort()).toEqual([reply, answer].sort());
    expect(ids((await read('CollectionBlock', reply)).responses)).toEqual([answer]);
    // A response is a child of nothing.
    expect(ids((await read('CollectionBlock', channel.id)).children)).toEqual([post]);
  });

  it('threads a reply to one block of a post under that block', async () => {
    const blocks = [paragraph('the line')];
    await writePost(dataset, blocks, { invoker: ME, kind: 'post', container: channel.id });
    const line = blocks[0]._key!;
    const reply = await writePost(dataset, [paragraph('about that')], { invoker: ME, kind: 'reply', respondsTo: line });
    expect(ids((await read('TextBlock', line)).thread)).toEqual([reply]);
  });

  it('marks what a model wrote with its run', async () => {
    const run = await model('ModelRun').create(dataset, {});
    const id = await writePost(dataset, [paragraph('drafted')], { invoker: ME, kind: 'post', generatedBy: run.id });
    expect(ids([(await read('CollectionBlock', id)).generatedBy].flat())).toEqual([run.id]);
  });

  it('writes nothing when one block cannot be written', async () => {
    const { invocationId, args } = await planPost(dataset, [paragraph('kept?')], { kind: 'post' });
    const blocks = [...(args.blocks as Record<string, unknown>[]), { key: 'x', entity: 'Policy', fields: {} }];
    const failure = await runOperation('core.createPost', { ...args, blocks }, { dataset, invoker: ME, invocationId })
      .then(() => null)
      .catch((error: unknown) => error);
    expect(isOperationError(failure) && failure.code).toBe('outsideOneOf');
    expect(await model('CollectionBlock').findAll(dataset, { where: { kind: 'post' } })).toEqual([]);
    expect(await model('TextBlock').findAll(dataset)).toEqual([]);
  });

  it('writes a module’s block in a post, and threads a reply to it under it', async () => {
    // The polls module as the host registers it: its entities compiled for the dataset, its block
    // type registered over them, and its manifest in the operations registry under its id.
    const signal = <T>(initial: T): [() => T, (next: T) => void] => {
      let value = initial;
      return [() => value, (next) => void (value = next)];
    };
    const deps = createModuleStoreDeps({ signal, effect: (fn: () => void) => fn() });
    expect(moduleRegistry.register(pollsModule, { backend: 'ad4m', framework: 'solid' }, deps).problems).toEqual([]);
    try {
      moduleRegistry.moduleSchemas(ports.schemas);
      const blocks = [
        paragraph('which?'),
        { _type: 'poll', question: 'Tea or coffee?', options: 'tea,coffee' } as unknown as ContentBlock,
      ];
      const id = await writePost(dataset, blocks, { invoker: ME, kind: 'post', container: channel.id });
      const poll = blocks[1]._key!;
      expect(ids((await read('CollectionBlock', id)).children)).toEqual([blocks[0]._key, poll]);
      expect(await read('Poll', poll)).toMatchObject({ question: 'Tea or coffee?', options: 'tea,coffee' });

      const reply = await writePost(dataset, [paragraph('tea')], { invoker: ME, kind: 'reply', respondsTo: poll });
      expect(ids((await read('Poll', poll)).thread)).toEqual([reply]);
    } finally {
      moduleRegistry.unregister('polls');
    }
  });

  it('writes list items as text blocks carrying their list metadata', async () => {
    const blocks: ContentBlock[] = [
      { _type: 'block', listItem: 'number', text: 'item one' } as ContentBlock,
      { _type: 'block', listItem: 'number', level: 1, text: 'nested' } as ContentBlock,
    ];
    await writePost(dataset, blocks, { invoker: ME, kind: 'post' });
    expect(await read('TextBlock', blocks[0]._key!)).toMatchObject({ listItem: 'number', text: 'item one' });
    expect(await read('TextBlock', blocks[1]._key!)).toMatchObject({ listItem: 'number', level: 1 });
  });

  it('is a document when it says what it is, in the mode given where one is, and neither without a kind', async () => {
    const message = await writePost(dataset, [paragraph('x')], { invoker: ME, kind: 'message' });
    const room = await writePost(dataset, [paragraph('x')], { invoker: ME, kind: 'channel', mode: 'feed' });
    const plain = await writePost(dataset, [paragraph('x')], { invoker: ME });
    expect((await read('CollectionBlock', message)).mode).toBe('document');
    expect((await read('CollectionBlock', room)).mode).toBe('feed');
    // Read back with the entity's empty defaults: neither was written.
    expect(await read('CollectionBlock', plain)).toMatchObject({ kind: '', mode: '' });
  });

  it('mentions each person it names once', async () => {
    const mention = (did: string) => ({ start: 0, end: 2, type: 'mention', did });
    const id = await writePost(
      dataset,
      [
        { _type: 'block', text: '@a', marks: [mention('did:key:alice')] } as ContentBlock,
        { _type: 'block', text: '@a @b', marks: [mention('did:key:alice'), mention('did:key:bob')] } as ContentBlock,
      ],
      { invoker: ME, kind: 'post' },
    );
    expect(ids((await read('CollectionBlock', id)).mentions)).toEqual(['did:key:alice', 'did:key:bob']);
  });

  it('refuses a post that is both in a collection and a reply', async () => {
    const failure = await writePost(dataset, [paragraph('where?')], {
      invoker: ME,
      container: channel.id,
      respondsTo: channel.id,
    }).catch((error: unknown) => error);
    expect(isOperationError(failure) && failure.code).toBe('twoPlaces');
  });
});

describe('core.composeCard', () => {
  it('keeps the card where the canvas’s content lives and places it, in one write, its blocks named as planned', async () => {
    const canvas = await model('CollectionBlock').create(dataset, { kind: 'canvas' });
    const blocks = [paragraph('on the canvas')];
    const { invocationId, args } = await planPost(dataset, blocks, { kind: 'card', within: COMPOSE_CARD_POST });
    const card = (await runOperation(
      'core.composeCard',
      {
        root: args.root,
        blocks: args.blocks,
        mentions: args.mentions,
        home: channel.id,
        canvas: canvas.id,
        at: { x: 40, y: 60 },
      },
      { dataset, invoker: ME, invocationId },
    )) as string;

    expect(ids((await read('CollectionBlock', channel.id)).children)).toEqual([card]);
    const root = await read('CollectionBlock', card);
    expect(root).toMatchObject({ kind: 'card', mode: 'document' });
    expect(ids(root.children)).toEqual([blocks[0]._key]);
    expect(decodeEditorState(root.editorState)?.map((b) => b._key)).toEqual([blocks[0]._key]);
    const placements = await model('Placement').findAll(dataset, {
      parent: { id: canvas.id, relation: 'children', entity: 'CollectionBlock' },
    });
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ nodeType: 'CollectionBlock', x: 40, y: 60, node: card });
  });
});

describe('feed.reply', () => {
  beforeEach(() => registerOperations('feed', FEED_MANIFEST.operations, { version: FEED_MANIFEST.version }));
  afterEach(() => unregisterOperations('feed'));

  it('answers a line with a line: a response to it, threaded under its subject, mentioning whom its marks name', async () => {
    const line = await model('TextBlock').create(dataset, { text: 'who has the venue?', source: 'typed' });
    const reply = async (to: string, text: string, marks?: unknown[]) => {
      const thread = await threadSubject(dataset as never, to);
      return (await runOperation(
        'feed.reply',
        {
          line: to,
          text,
          ...(marks ? { marks } : {}),
          ...(thread ? { thread: thread.id, threadEntity: thread.entity } : {}),
        },
        { dataset, invoker: ME },
      )) as string;
    };
    const first = await reply(line.id, '@Ann does', [{ start: 0, end: 4, type: 'mention', did: 'did:ann' }]);
    const second = await reply(first, 'thanks');

    expect(await read('TextBlock', first)).toMatchObject({ text: '@Ann does', source: 'typed' });
    expect(ids((await read('TextBlock', first)).mentions)).toEqual(['did:ann']);
    expect(ids((await read('TextBlock', line.id)).responses)).toEqual([first]);
    expect(ids((await read('TextBlock', first)).responses)).toEqual([second]);
    // The whole conversation under the line is one read of its thread.
    expect(ids((await read('TextBlock', line.id)).thread).sort()).toEqual([first, second].sort());
  });
});

describe('a message, through the documents a module is lent', () => {
  it('goes in the dataset it names, in its call, says how it arrived, and keeps no stored copy', async () => {
    const elsewhere = { id: 'ds-posts', sharedUri: 'we://shared/posts', handle: dataset } as never;
    const documents = documentAccess(
      (uri) => (uri === 'we://shared/posts' ? elsewhere : null),
      () => ME,
    );
    const written = await documents.create([paragraph('Data, can you take the notes?')], {
      kind: 'message',
      container: channel.id,
      fields: { source: 'spoken', notAField: 'dropped' },
      storeDocument: false,
      dataset: 'we://shared/posts',
    });
    expect(written).not.toBeNull();
    const message = await read('CollectionBlock', written!.id);
    expect(message).toMatchObject({
      kind: 'message',
      mode: 'document',
      source: 'spoken',
      textContent: 'Data, can you take the notes?',
    });
    expect(message.editorState ?? null).toBeNull();
    expect(message).not.toHaveProperty('notAField');
    expect(ids((await read('CollectionBlock', channel.id)).children)).toEqual([written!.id]);
    const [text] = ids(message.children);
    expect((await read('TextBlock', text)).text).toBe('Data, can you take the notes?');

    // A dataset nobody can name is refused, not written to the space on screen.
    expect(await documents.create([paragraph('lost')], { kind: 'message', dataset: 'we://nowhere' })).toBeNull();
  });
});
