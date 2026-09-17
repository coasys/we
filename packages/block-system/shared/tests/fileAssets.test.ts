/**
 * File-backed fields: what the models get, what the blob gets.
 *
 * The model layer runs every file property through the file-storage language, which wants the
 * file's data — hand it an address and the language fails. The blob, a projection nobody writes
 * back through a language, carries the addresses. This suite registers a fake file store and pins
 * that split, plus the one economy that matters: a file the author never touched is not written
 * again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored: Array<{ name: string; file_type: string; data_base64: string }> = [];
/** The dataset each upload went to, in step with `stored`. */
const storedIn: unknown[] = [];

vi.mock('@we/entities', () => ({
  asFileField: (fileData: unknown) => fileData,
  dataURIToFileData: (uri: string, name: string) => ({
    data_base64: uri.slice(uri.indexOf(',') + 1),
    name,
    file_type: uri.slice(5, uri.indexOf(';')),
  }),
  runEntityTransaction: (_dataset: unknown, fn: (tx: { batchId: string }) => unknown) => fn({ batchId: 'batch-1' }),
  getFileStore: () => ({
    store: async (dataset: unknown, file: { name: string; file_type: string; data_base64: string }) => {
      stored.push(file);
      storedIn.push(dataset);
      return `qm://${file.name}@${file.data_base64.length}`;
    },
    fetch: async (_dataset: unknown, address: string) => {
      const name = address.slice('qm://'.length).split('@')[0];
      return { data_base64: 'QUJD', file_type: 'image/png', name };
    },
  }),
}));

vi.mock('@we/entities/manifest', () => ({
  CORE_MANIFEST: {
    version: '1',
    entities: {
      TextBlock: { properties: { style: {}, text: {}, marks: {} }, relations: {} },
      CollectionBlock: { properties: { type: {}, kind: {}, mode: {} }, relations: {} },
      ImageBlock: { properties: { src: { format: 'file' }, altText: {} }, relations: {} },
    },
  },
}));

import type { ContentBlock } from '../src/content';
import { type BlockEntityStatic, registerBlock } from '../src/registry';
import { copyableContent, createBlocks, reconcileBlocks, resolveExpressionAddresses } from '../src/serialization';
import { decodeEditorState } from '../src/utils';

let idCounter = 0;
const byId = new Map<string, Fake>();

class Fake {
  id: string;
  [key: string]: unknown;
  constructor(data: Record<string, unknown>) {
    Object.assign(this, data);
    this.id = `id-${++idCounter}`;
    byId.set(this.id, this);
  }
  async save() {}
  async delete() {
    byId.delete(this.id);
  }
  static async create(_p: unknown, data: Record<string, unknown>) {
    return new this(data);
  }
  static async findOne(_p: unknown, opts: { where: { id: string } }) {
    const found = byId.get(opts.where.id);
    return found instanceof this ? found : undefined;
  }
}
class FakeText extends Fake {}
class FakeImage extends Fake {}
class FakeCollection extends Fake {
  children: string[] = [];
  mentions: string[] = [];
  editorState: unknown = undefined;
  textContent = '';
  async addChildren(id: string) {
    this.children.push(id);
  }
  async addMentions() {}
  async removeMentions() {}
}

registerBlock({ nodeTypes: ['block'], model: FakeText as unknown as BlockEntityStatic, entity: 'TextBlock' });
registerBlock({
  nodeTypes: ['root', 'collection'],
  model: FakeCollection as unknown as BlockEntityStatic,
  entity: 'CollectionBlock',
});
registerBlock({ nodeTypes: ['image'], model: FakeImage as unknown as BlockEntityStatic, entity: 'ImageBlock' });

const perspective = {};
const fileData = { data_base64: 'QUJD', name: 'image-block', file_type: 'image/png' };

beforeEach(() => {
  idCounter = 0;
  byId.clear();
  stored.length = 0;
  storedIn.length = 0;
});

describe('file-backed fields', () => {
  it('hands the model the file data and the blob the address', async () => {
    const blocks: ContentBlock[] = [{ _type: 'image', src: fileData, altText: 'a' }];
    const root = (await createBlocks(perspective, blocks, { kind: 'post' })) as FakeCollection;

    const image = byId.get(root.children[0]) as FakeImage;
    expect(image.src).toEqual(fileData); // the payload — the model layer creates the expression
    expect(blocks[0]._key).toBe(image.id); // the author's copy is stamped too

    const blob = decodeEditorState(
      `data:application/json;base64,${(root.editorState as { data_base64: string }).data_base64}`,
    )!;
    expect(blob[0].src).toBe('qm://image-block@4'); // the address, for the blob alone
    expect(blob[0]._key).toBe(image.id);
  });

  it('turns a loaded data URI back into file data with its original name, and does not rewrite an untouched one', async () => {
    const root = (await createBlocks(perspective, [{ _type: 'image', src: fileData }], {
      kind: 'post',
    })) as FakeCollection;
    const image = byId.get(root.children[0]) as FakeImage;
    // What a reader hydrates: the model resolves the file to a data URI on read.
    image.src = 'data:image/png;base64,QUJD';
    stored.length = 0;

    // The composer loads through resolveExpressionAddresses, which stamps the original name.
    const loaded = await resolveExpressionAddresses(perspective, [
      { _type: 'image', _key: image.id, src: 'qm://image-block@4' },
    ]);
    expect(loaded[0].src).toBe('data:image/png;base64,QUJD');
    expect((loaded[0] as { __assetNames?: Record<string, string> }).__assetNames).toEqual({ src: 'image-block' });

    await reconcileBlocks(perspective, root as never, { _type: 'document', base: [image.id], blocks: loaded });

    // Untouched: the model still holds what it read, nothing was written to it.
    expect(image.src).toBe('data:image/png;base64,QUJD');
    // The blob still needed the address, which is content-addressed under the original name.
    expect(stored.map((f) => f.name)).toEqual(['image-block']);
  });

  it('a changed image reaches the model as file data on edit', async () => {
    const root = (await createBlocks(perspective, [{ _type: 'image', src: fileData }], {
      kind: 'post',
    })) as FakeCollection;
    const image = byId.get(root.children[0]) as FakeImage;
    const replacement = { data_base64: 'WFla', name: 'image-block', file_type: 'image/png' };

    await reconcileBlocks(perspective, root as never, {
      _type: 'document',
      base: [image.id],
      blocks: [{ _type: 'image', _key: image.id, src: replacement }],
    });

    expect(image.src).toEqual(replacement);
  });
});

describe('a composition moving between datasets', () => {
  it('carries its files as payloads, so the destination uploads them into its own storage', async () => {
    const personal = { name: 'personal' };
    const space = { name: 'space' };
    const root = (await createBlocks(
      personal,
      [
        { _type: 'block', text: 'a note with a picture' },
        { _type: 'image', src: fileData, altText: 'a' },
      ],
      { kind: 'post' },
    )) as FakeCollection;
    expect(storedIn).toEqual([personal]);

    const copy = await copyableContent(
      personal,
      `data:application/json;base64,${(root.editorState as { data_base64: string }).data_base64}`,
    );

    // No keys: they are record ids in the dataset it was read from, and name nothing elsewhere.
    expect(copy!.every((block) => block._key === undefined)).toBe(true);
    // A payload, not the personal space's address.
    expect(copy![1].src).toBe('data:image/png;base64,QUJD');

    stored.length = 0;
    storedIn.length = 0;
    const post = (await createBlocks(space, copy!, { kind: 'post' })) as FakeCollection;

    expect(post.id).not.toBe(root.id);
    expect(storedIn).toEqual([space]);
    // Under the name it was first uploaded with — content addressing lands on the same expression.
    expect(stored.map((file) => file.name)).toEqual(['image-block']);
  });

  it('is nothing for a value that is not a composition', async () => {
    expect(await copyableContent({}, undefined)).toBeNull();
    expect(await copyableContent({}, 'not a document')).toBeNull();
  });

  it('takes one block out of a composition by its key, wherever it sits', async () => {
    const root = (await createBlocks(
      {},
      [
        { _type: 'block', text: 'the words around it' },
        { _type: 'image', src: fileData, altText: 'the picture' },
      ],
      { kind: 'post' },
    )) as FakeCollection;
    const imageKey = root.children[1];
    const blob = `data:application/json;base64,${(root.editorState as { data_base64: string }).data_base64}`;

    const picture = await copyableContent({}, blob, imageKey);

    expect(picture).toHaveLength(1);
    expect(picture![0]._type).toBe('image');
    expect(picture![0]._key).toBeUndefined();
    expect(await copyableContent({}, blob, 'no-such-block')).toBeNull();
  });
});
