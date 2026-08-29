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

vi.mock('@we/entities', () => ({
  asFileField: (fileData: unknown) => fileData,
  dataURIToFileData: (uri: string, name: string) => ({
    data_base64: uri.slice(uri.indexOf(',') + 1),
    name,
    file_type: uri.slice(5, uri.indexOf(';')),
  }),
  runEntityTransaction: (_dataset: unknown, fn: (tx: { batchId: string }) => unknown) => fn({ batchId: 'batch-1' }),
  getFileStore: () => ({
    store: async (_dataset: unknown, file: { name: string; file_type: string; data_base64: string }) => {
      stored.push(file);
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
import { createBlocks, reconcileBlocks, resolveExpressionAddresses } from '../src/serialization';
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
