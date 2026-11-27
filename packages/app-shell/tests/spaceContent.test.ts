/**
 * The space store's content part: a post with no anchor goes in the space collection, a reply is
 * threaded under what it answers, content made on the space's own canvas lives in that collection,
 * and a file is stored and named by its URL.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { type ContentBlock, registerCoreBlocks } from '@we/block-shared';
import { CollectionBlock } from '@we/entities';
import type { Setter } from '@we/reactivity';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createSpaceContent, type SpaceContent } from '../src/shared/stores/space/content';
import type { TaskStateView } from '../src/shared/stores/space/types';
import { flush, reactivityPorts, type SpaceHarness, spaceHarness } from './support/spaceParts';

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
    homes: () => { forCanvas: (canvas: string) => string; root: () => string } | null;
  }

  async function build(): Promise<Built> {
    const h = await spaceHarness(makePort(), [{ id: 'ds-a', name: 'Allotment' }]);
    const { reactivity } = h;
    let homes: { forCanvas: (canvas: string) => string; root: () => string } | null = null;
    let content!: SpaceContent;
    let setRoot!: Setter<string>;
    disposers.push(
      reactivity.root(() => {
        const [root, writeRoot] = reactivity.signal('');
        setRoot = writeRoot;
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
            reloadSpaceStructure: () => Promise.resolve(),
          },
          taskStates: {
            offeredTaskStates: () => [] as TaskStateView[],
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
    return { h, content, setRoot, homes: () => homes };
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
});
