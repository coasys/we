/**
 * The space store's content part: a post with no anchor goes in the space collection, a reply is
 * threaded under what it answers, content made on the space's own canvas lives in that collection,
 * and a file is stored and named by its URL.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { type ContentBlock, contentHash, decodeEditorState, registerCoreBlocks } from '@we/block-shared';
import { CollectionBlock, Space, TaskBlock } from '@we/entities';
import type { Setter } from '@we/reactivity';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/*
  What the part lends the modules, recorded: the board hook goes to them from here, and the only way
  to see a slice published is to be the place it is published to.
*/
const lent = vi.hoisted(() => ({ slices: [] as Record<string, unknown>[] }));
vi.mock('../src/shared/registries/moduleHostServices', async (original) => {
  const real = await original<typeof import('../src/shared/registries/moduleHostServices')>();
  return {
    ...real,
    provideModuleHostServices: (slice: Record<string, unknown>) => {
      lent.slices.push(slice);
      const takeBack = real.provideModuleHostServices(slice as never);
      return () => {
        lent.slices.splice(lent.slices.indexOf(slice), 1);
        takeBack();
      };
    },
  };
});

import { createSpaceContent, type SpaceContent } from '../src/shared/stores/space/content';
import type { TaskStateView } from '../src/shared/stores/space/types';
import { reactivityPorts } from './support/engines';
import { flush, type SpaceHarness, spaceHarness } from './support/spaceParts';

const paragraph = (text: string): ContentBlock => ({ _type: 'block', text });
const ids = (value: unknown) =>
  (Array.isArray(value) ? value : []).map((v) => (typeof v === 'string' ? v : (v as { id: string }).id));

beforeAll(() => registerCoreBlocks());

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  interface Built {
    h: SpaceHarness;
    content: SpaceContent;
    setRoot: Setter<string>;
    setOffered: Setter<TaskStateView[]>;
    reloads: { count: number };
    homes: () => { forCanvas: (canvas: string) => string; root: () => string } | null;
  }

  async function build(): Promise<Built> {
    const h = await spaceHarness(makePort(), [{ id: 'ds-a', name: 'Allotment' }]);
    const { reactivity } = h;
    let homes: { forCanvas: (canvas: string) => string; root: () => string } | null = null;
    let content!: SpaceContent;
    let setRoot!: Setter<string>;
    let setOffered!: Setter<TaskStateView[]>;
    const reloads = { count: 0 };
    disposers.push(
      reactivity.root(() => {
        const [root, writeRoot] = reactivity.signal('');
        setRoot = writeRoot;
        const [offered, writeOffered] = reactivity.signal<TaskStateView[]>([]);
        setOffered = writeOffered;
        content = createSpaceContent({
          ...h.ctx,
          recordStore: {
            provideContentHomes: (given) => {
              homes = given;
              return () => (homes = null);
            },
          },
          navigation: {
            members: { root, landmarks: () => ({ canvas: 'canvas-of-the-space' }) as never },
            reloadSpaceStructure: () => Promise.resolve(void reloads.count++),
          },
          taskStates: {
            offeredTaskStates: offered,
            boardWorkflow: {
              enabled: () => false,
              needsAgreement: () => false,
              stateOf: () => undefined,
              move: () => Promise.resolve('moved'),
              entryFor: (to) => to,
            },
          },
        });
      }),
    );
    h.datasets.show('ds-a');
    await flush();
    return { h, content, setRoot, setOffered, reloads, homes: () => homes };
  }

  it('puts a post with no anchor in the space collection, and a reply under what it answers', async () => {
    const { h, content, setRoot } = await build();
    const handle = (await h.datasets.get('ds-a')).handle;
    const root = await CollectionBlock.create(handle, { kind: 'space' });
    setRoot(root.id);
    const post = await content.members.createPost([paragraph('First')]);
    expect(post).toBeTruthy();
    expect(ids((await CollectionBlock.findOne(handle, { where: { id: root.id } }))?.children)).toContain(post);
    const reply = await content.members.createPost([paragraph('Agreed')], {
      kind: 'reply',
      parentId: post,
      relation: 'responses',
    });
    expect(ids((await CollectionBlock.findOne(handle, { where: { id: post! } }))?.responses)).toEqual([reply]);
    await content.members.deleteCollection(reply!);
    expect(await CollectionBlock.findOne(handle, { where: { id: reply! } })).toBeFalsy();
  });

  it('tells the record layer that what is made on the space’s canvas lives in its collection', async () => {
    const { setRoot, homes } = await build();
    expect(homes()?.forCanvas('canvas-of-the-space')).toBe('canvas-of-the-space');
    setRoot('the-space-collection');
    expect(homes()?.forCanvas('canvas-of-the-space')).toBe('the-space-collection');
    expect(homes()?.forCanvas('another-canvas')).toBe('another-canvas');
    expect(homes()?.root()).toBe('the-space-collection');
  });

  it('stores a file and names it by its URL', async () => {
    const { h, content } = await build();
    const url = await content.members.uploadFile(new File(['hello'], 'hello.txt', { type: 'text/plain' }));
    expect(typeof url).toBe('string');
    expect(url).not.toBe('');
    expect(h.toasts.said).toEqual([]);
  });

  const state = (slug: string, name: string) => ({ slug, name, id: slug, semantic: 'open' }) as TaskStateView;
  const read = async (h: SpaceHarness, id: string) =>
    CollectionBlock.findOne((await h.datasets.get('ds-a')).handle, { where: { id } });
  const columnsOf = async (h: SpaceHarness, boardId: string) =>
    Promise.all(ids((await read(h, boardId))?.children).map(async (id) => [(await read(h, id))?.slug, id] as const));

  it('makes the space’s board from the states on offer, and keeps its columns with the vocabulary', async () => {
    const { h, content, setOffered, reloads } = await build();
    const handle = (await h.datasets.get('ds-a')).handle;
    const root = await CollectionBlock.create(handle, { kind: 'space' });
    await Space.create(handle, { uuid: 'ds-a', name: 'The Allotment', root: root.id });
    setOffered([state('todo', 'To do'), state('done', 'Done')]);
    const board = await content.members.openBoardFor();
    expect(board).toBeTruthy();
    expect(reloads.count).toBe(1);
    expect((await columnsOf(h, board)).map(([slug]) => slug)).toEqual(['todo', 'done']);
    // Pressed again, the same board, and nothing more for navigation to read.
    expect(await content.members.openBoardFor()).toBe(board);
    expect(reloads.count).toBe(1);

    await content.members.addStateToSpaceBoard('blocked', 'Blocked');
    const columns = await columnsOf(h, board);
    expect(columns.map(([slug]) => slug)).toEqual(['todo', 'done', 'blocked']);
    await content.members.removeBoardColumn(board, columns[2][1]);
    expect((await columnsOf(h, board)).map(([slug]) => slug)).toEqual(['todo', 'done']);
  });

  it('adds a task to a column in its state, and a move between columns changes the state', async () => {
    const { h, content, setOffered } = await build();
    const handle = (await h.datasets.get('ds-a')).handle;
    const root = await CollectionBlock.create(handle, { kind: 'space' });
    await Space.create(handle, { uuid: 'ds-a', name: 'The Allotment', root: root.id });
    setOffered([state('todo', 'To do'), state('done', 'Done')]);
    const board = await content.members.openBoardFor();
    const [[, todo], [, done]] = await columnsOf(h, board);
    await content.members.addTaskToColumn(todo, 'Weed the beds');
    const [task] = (await TaskBlock.findAll(handle, { where: { title: 'Weed the beds' } })) as TaskBlock[];
    expect(task.status).toBe('todo');
    await content.members.moveCardToColumn(todo, done, task.id);
    expect((await TaskBlock.findOne(handle, { where: { id: task.id } }))?.status).toBe('done');
    expect(h.toasts.said).toEqual([]);
  });

  it('gives a collection with no task no board, and lends the modules that hook until disposed', async () => {
    const { h, content } = await build();
    const handle = (await h.datasets.get('ds-a')).handle;
    const call = await CollectionBlock.create(handle, { kind: 'call' });
    expect(await content.members.ensureBoardFor(call.id)).toBe('');
    const slice = lent.slices.find((given) => 'ensureBoardFor' in given);
    expect(slice?.ensureBoardFor).toBe(content.members.ensureBoardFor);
    for (const dispose of disposers.splice(0)) dispose();
    expect(lent.slices.some((given) => 'ensureBoardFor' in given)).toBe(false);
  });

  it('saves an edit to a post, and says so when somebody else changed it meanwhile', async () => {
    const { h, content } = await build();
    const post = await content.members.createPost([paragraph('First')]);
    // The hash of the post as an editor would have loaded it: the blocks it stores.
    const loaded = async () => contentHash(decodeEditorState((await read(h, post!))?.editorState) ?? []);
    await content.members.updatePost(post!, {
      _type: 'document',
      blocks: [paragraph('First, edited')],
      baseHash: await loaded(),
    });
    expect(h.toasts.said).toEqual([]);
    // Loaded as something the post no longer holds: the save still lands, and the person is told.
    await content.members.updatePost(post!, {
      _type: 'document',
      blocks: [paragraph('Second')],
      baseHash: contentHash([paragraph('What was there before')]),
    });
    expect(h.toasts.said).toHaveLength(1);
    expect(h.toasts.said[0]).toMatch(/^warning: .*changed by someone else/);
  });
});
