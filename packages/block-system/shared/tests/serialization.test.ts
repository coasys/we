/**
 * The block persistence pipeline, tested against a fake model layer.
 *
 * The pipeline's contract is structural — key-claiming, duplicate detection, three-way membership,
 * relation assignment, the blob projection — none of which needs any backend at all. The fakes
 * implement exactly the neutral surface serialization.ts touches: the model statics and instance
 * methods of the contract, the registered transaction runner (a passthrough), and the manifest
 * entries the field facts are read from.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@we/models', () => ({
  asFileField: (fileData: unknown) => fileData,
  dataURIToFileData: (uri: string, name: string) => ({
    data_base64: uri.slice(uri.indexOf(',') + 1),
    name,
    file_type: uri.slice(5, uri.indexOf(';')),
  }),
  runModelTransaction: (_dataset: unknown, fn: (tx: { batchId: string }) => unknown) => fn({ batchId: 'batch-1' }),
  // No file store registered: these fakes declare no file-format fields, so the upload and
  // resolve passes must short-circuit — which a null store is the honest way to exercise.
  getFileStore: () => null,
}));

vi.mock('@we/models/manifest', () => ({
  CORE_MANIFEST: {
    version: '1',
    entities: {
      TextBlock: {
        properties: {
          style: {},
          listItem: {},
          level: {},
          checked: {},
          align: {},
          direction: {},
          text: {},
          marks: {},
          version: {},
        },
        relations: {},
      },
      CollectionBlock: {
        properties: { type: {}, title: {}, kind: {}, mode: {}, layout: {}, columnCount: {} },
        relations: {},
      },
      ImageBlock: { properties: { src: {}, altText: {} }, relations: {} },
    },
  },
}));

import type { ContentBlock, ContentDocument, TextContentBlock } from '../src/content';
import { type BlockModelStatic, registerBlock } from '../src/registry';
import {
  createBlocks,
  extractBlockData,
  extractMentions,
  extractTextContent,
  loadBlocks,
  reconcileBlocks,
  recordToTextBlock,
  textBlockToRecord,
} from '../src/serialization';
import { decodeEditorState } from '../src/utils';

// ── Fake model layer ────────────────────────────────────────────────────────

let idCounter = 0;
const byId = new Map<string, FakeBlock>();

class FakeBlock {
  static created: FakeBlock[] = [];

  id: string;
  saveCount = 0;
  deleted = false;
  [key: string]: unknown;

  constructor(data: Record<string, unknown>) {
    Object.assign(this, data);
    this.id = `id-${++idCounter}`;
    byId.set(this.id, this);
  }

  async save(_batchId?: string) {
    this.saveCount++;
  }

  async delete(_batchId?: string) {
    this.deleted = true;
    byId.delete(this.id);
  }

  static async create(_p: unknown, data: Record<string, unknown>, opts?: { parent?: unknown }) {
    const block = new this(data);
    // Recorded rather than acted on: the anchor is passed straight to the model's create, so what a
    // test can meaningfully assert is that it arrived, and on the root only.
    block.createdWithParent = opts?.parent;
    FakeBlock.created.push(block);
    return block;
  }

  static async findOne(_p: unknown, opts: { where: { id: string } }) {
    const found = byId.get(opts.where.id);
    return found instanceof this ? found : undefined;
  }
}

class FakeText extends FakeBlock {}
class FakeImage extends FakeBlock {}

class FakeCollection extends FakeBlock {
  children: string[] = [];
  editorState: unknown = undefined;
  textContent = '';
  kind: unknown = undefined;
  mode: unknown = undefined;
  mentions: string[] = [];

  async addChildren(id: string, _batchId?: string) {
    this.children.push(id);
  }

  async addMentions(target: string | string[], _batchId?: string) {
    for (const did of Array.isArray(target) ? target : [target]) this.mentions.push(did);
  }

  async removeMentions(target: string | string[], _batchId?: string) {
    const drop = new Set(Array.isArray(target) ? target : [target]);
    this.mentions = this.mentions.filter((did) => !drop.has(did));
  }
}

registerBlock({ nodeTypes: ['block'], model: FakeText as unknown as BlockModelStatic, entity: 'TextBlock' });
registerBlock({
  nodeTypes: ['root', 'collection'],
  model: FakeCollection as unknown as BlockModelStatic,
  entity: 'CollectionBlock',
});
registerBlock({ nodeTypes: ['image'], model: FakeImage as unknown as BlockModelStatic, entity: 'ImageBlock' });

// The dataset handle is opaque to the pipeline — an empty object is a complete fake.
const perspective = {};

function paragraph(text: string, extra: Partial<TextContentBlock> = {}): TextContentBlock {
  return { _type: 'block', style: 'normal', text, ...extra };
}

/** The blob a root holds, decoded back to blocks. */
function blobOf(root: FakeCollection): ContentBlock[] {
  const file = root.editorState as { data_base64: string };
  return decodeEditorState(`data:application/json;base64,${file.data_base64}`)!;
}

beforeEach(() => {
  idCounter = 0;
  byId.clear();
  FakeBlock.created = [];
});

// ── Pure helpers ────────────────────────────────────────────────────────────

describe('text block ⇄ record', () => {
  it("writes Portable Text's own vocabulary", () => {
    expect(textBlockToRecord(paragraph('hi'))).toMatchObject({
      style: 'normal',
      listItem: '',
      level: 0,
      text: 'hi',
      marks: '',
    });
    expect(textBlockToRecord({ _type: 'block', style: 'h2', text: 't' })).toMatchObject({ style: 'h2' });
    expect(textBlockToRecord({ _type: 'block', style: 'blockquote', text: 'q' })).toMatchObject({
      style: 'blockquote',
    });
    expect(textBlockToRecord({ _type: 'block', listItem: 'number', level: 2, text: 'i' })).toMatchObject({
      listItem: 'number',
      level: 2,
    });
    expect(
      textBlockToRecord({ _type: 'block', listItem: 'check', checked: true, text: 'c', align: 'center' }),
    ).toMatchObject({
      listItem: 'check',
      checked: true,
      align: 'center',
    });
  });

  it('serialises marks as JSON and reads them back', () => {
    const block = paragraph('hi', { marks: [{ start: 0, end: 2, type: 'strong' }] });
    const record = textBlockToRecord(block);
    expect(record.marks).toBe('[{"start":0,"end":2,"type":"strong"}]');
    expect(recordToTextBlock({ ...record, id: 'x' })).toEqual({ ...block, _key: 'x' });
  });

  it('a record with only text is a paragraph — a transcript turn, a note', () => {
    expect(recordToTextBlock({ id: 't', text: 'said' })).toEqual({
      _type: 'block',
      _key: 't',
      style: 'normal',
      text: 'said',
    });
    expect(recordToTextBlock({ style: 'h3', text: 'h' })).toMatchObject({ style: 'h3' });
    expect(recordToTextBlock({ listItem: 'bullet', level: 1, text: 'l' })).toMatchObject({
      listItem: 'bullet',
      level: 1,
    });
    expect(recordToTextBlock({ style: 'nonsense', text: 'x' })).toMatchObject({ style: 'normal' });
  });
});

describe('extractBlockData', () => {
  it('takes only properties present on both the block and the model', () => {
    expect(extractBlockData('ImageBlock', { _type: 'image', src: 'x', unrelated: 'y', width: 10 })).toEqual({
      src: 'x',
    });
  });

  it('never persists the composition-only fields', () => {
    expect(extractBlockData('CollectionBlock', { _type: 'collection', layout: 'grid', content: [] })).toEqual({
      layout: 'grid',
    });
  });
});

describe('extractTextContent', () => {
  it('collects text blocks and custom text fields, collapsing whitespace, nested included', () => {
    const blocks: ContentBlock[] = [
      paragraph('  hello\n world '),
      { _type: 'link', title: 'A title', description: 'A description', url: 'https://x' },
      { _type: 'collection', content: [paragraph('inside')] },
    ];
    expect(extractTextContent(blocks)).toBe('hello world A title A description inside');
  });

  it('caps at 5000 chars, truncating on a word boundary', () => {
    const words = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(' ');
    const result = extractTextContent([paragraph(words)]);
    expect(result.length).toBeLessThanOrEqual(5000);
    expect(words.startsWith(result)).toBe(true);
    expect(words[result.length]).toBe(' ');
  });
});

describe('extractMentions', () => {
  it('reads DIDs off mention marks, de-duplicated, nested included', () => {
    const blocks: ContentBlock[] = [
      paragraph('hi @a', { marks: [{ start: 3, end: 5, type: 'mention', did: 'did:key:a' }] }),
      {
        _type: 'collection',
        content: [
          paragraph('@a @b', {
            marks: [
              { start: 0, end: 2, type: 'mention', did: 'did:key:a' },
              { start: 3, end: 5, type: 'mention', did: 'did:key:b' },
            ],
          }),
        ],
      },
    ];
    expect(extractMentions(blocks)).toEqual(['did:key:a', 'did:key:b']);
  });
});

// ── createBlocks ────────────────────────────────────────────────────────────

describe('createBlocks', () => {
  it('creates the tree, links children, stamps keys, and writes the root blob', async () => {
    const blocks: ContentBlock[] = [paragraph('first'), paragraph('second')];

    const root = (await createBlocks(perspective, blocks, { kind: 'post' })) as FakeCollection;

    expect(root).toBeInstanceOf(FakeCollection);
    expect(root.kind).toBe('post');
    expect(root.type).toBe('root');
    expect(root.children).toHaveLength(2);
    // keys stamped back onto the caller's blocks for later reconciliation
    expect(blocks[0]._key).toBe(root.children[0]);
    expect(blocks[1]._key).toBe(root.children[1]);
    // blob + search index written; the blob is Portable Text with the model ids as keys
    expect(root.editorState).toMatchObject({ name: 'editor-state.json', file_type: 'application/json' });
    expect(blobOf(root).map((b) => b._key)).toEqual(root.children);
    expect(root.textContent).toBe('first second');
  });

  it('persists list items as their own text blocks carrying the list metadata', async () => {
    const root = (await createBlocks(perspective, [
      { _type: 'block', listItem: 'number', text: 'item one' },
      { _type: 'block', listItem: 'number', level: 1, text: 'nested' },
    ])) as FakeCollection;
    const items = FakeBlock.created.filter((b) => b instanceof FakeText);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ style: 'normal', listItem: 'number', level: 0, text: 'item one' });
    expect(items[1]).toMatchObject({ level: 1 });
    expect(root.children).toEqual(items.map((i) => i.id));
  });

  it('persists a nested collection as a child with children of its own', async () => {
    const blocks: ContentBlock[] = [
      {
        _type: 'collection',
        layout: 'grid',
        columnCount: 2,
        content: [{ _type: 'image', src: 'Qm://x' }, paragraph('cap')],
      },
    ];
    const root = (await createBlocks(perspective, blocks, { kind: 'post' })) as FakeCollection;
    const nested = byId.get(root.children[0]) as FakeCollection;
    expect(nested).toBeInstanceOf(FakeCollection);
    expect(nested.layout).toBe('grid');
    expect(nested.children).toHaveLength(2);
    expect(byId.get(nested.children[0])).toBeInstanceOf(FakeImage);
    expect(root.textContent).toBe('cap');
    // keys at every depth
    expect((blocks[0] as { content: ContentBlock[] }).content[0]._key).toBe(nested.children[0]);
  });

  it('refuses content that is not a composition', async () => {
    await expect(
      createBlocks(perspective, { type: 'root', children: [] } as unknown as ContentBlock[], { kind: 'post' }),
    ).rejects.toThrow('not a composition');
  });

  it('defaults mode to document when a kind is given — everything it creates is a composition', async () => {
    const root = (await createBlocks(perspective, [paragraph('x')], { kind: 'message' })) as FakeCollection;
    expect(root.mode).toBe('document');
  });

  it('writes neither kind nor mode when the caller opts out of the vocabulary', async () => {
    const root = (await createBlocks(perspective, [paragraph('x')])) as FakeCollection;
    expect(root.kind).toBeUndefined();
    expect(root.mode).toBeUndefined();
  });

  it('honours an explicit mode over the default', async () => {
    const root = (await createBlocks(perspective, [paragraph('x')], {
      kind: 'channel',
      mode: 'feed',
    })) as FakeCollection;
    expect(root.mode).toBe('feed');
  });

  it('passes the anchor to the root only — descendants attach to their in-tree parent', async () => {
    const anchor = { id: 'channel-1', predicate: 'we://children' };
    const root = (await createBlocks(perspective, [paragraph('first'), paragraph('second')], {
      kind: 'message',
      anchor,
    })) as FakeCollection;
    expect(root.createdWithParent).toEqual(anchor);
    for (const child of FakeBlock.created.filter((b) => b instanceof FakeText)) {
      expect(child.createdWithParent).toBeUndefined();
    }
  });
});

// ── mentions ────────────────────────────────────────────────────────────────

describe('mentions', () => {
  const mention = (did: string, handle: string, at = 0) => ({
    start: at,
    end: at + handle.length,
    type: 'mention',
    did,
  });

  it('writes a mention edge per distinct DID named in the composition', async () => {
    const root = (await createBlocks(
      perspective,
      [
        paragraph('hi @alice', { marks: [mention('did:key:alice', '@alice', 3)] }),
        paragraph('@bob', { marks: [mention('did:key:bob', '@bob')] }),
      ],
      { kind: 'post' },
    )) as FakeCollection;
    expect(root.mentions).toEqual(['did:key:alice', 'did:key:bob']);
  });

  it('de-duplicates — naming someone twice is one fact about the post', async () => {
    const root = (await createBlocks(
      perspective,
      [
        paragraph('@alice', { marks: [mention('did:key:alice', '@alice')] }),
        paragraph('@alice', { marks: [mention('did:key:alice', '@alice')] }),
      ],
      { kind: 'post' },
    )) as FakeCollection;
    expect(root.mentions).toEqual(['did:key:alice']);
  });

  it('reconciles on edit — adds the new, drops the removed, leaves the kept alone', async () => {
    const blocks: ContentBlock[] = [
      paragraph('@alice', { marks: [mention('did:key:alice', '@alice')] }),
      paragraph('@bob', { marks: [mention('did:key:bob', '@bob')] }),
    ];
    const root = (await createBlocks(perspective, blocks, { kind: 'post' })) as FakeCollection;
    expect(root.mentions).toEqual(['did:key:alice', 'did:key:bob']);

    const edited: ContentDocument = {
      _type: 'document',
      base: [blocks[0]._key!, blocks[1]._key!],
      blocks: [
        paragraph('@alice', { _key: blocks[0]._key, marks: [mention('did:key:alice', '@alice')] }),
        paragraph('@dave', { _key: blocks[1]._key, marks: [mention('did:key:dave', '@dave')] }),
      ],
    };
    await reconcileBlocks(perspective, root as never, edited);
    expect(root.mentions).toEqual(['did:key:alice', 'did:key:dave']);
  });
});

// ── reconcileBlocks ─────────────────────────────────────────────────────────

/** Persist an initial two-paragraph post and return its pieces. */
async function seedPost() {
  const blocks: ContentBlock[] = [paragraph('one'), paragraph('two')];
  const root = (await createBlocks(perspective, blocks, { kind: 'post' })) as FakeCollection;
  const [p1, p2] = root.children.map((id) => byId.get(id)!) as FakeText[];
  return { root, p1, p2, blocks };
}

describe('reconcileBlocks', () => {
  it('updates claimed blocks in place, creates unclaimed ones, deletes what the author removed', async () => {
    const { root, p1, p2 } = await seedPost();

    const edited: ContentDocument = {
      _type: 'document',
      base: [p1.id, p2.id],
      blocks: [
        paragraph('two edited', { _key: p2.id }), // kept + moved first
        paragraph('brand new'), // no key → created
      ],
    };

    await reconcileBlocks(perspective, root as never, edited);

    expect(p2.text).toBe('two edited');
    expect(p2.deleted).toBe(false);
    expect(p1.deleted).toBe(true);
    const created = FakeBlock.created.filter((b) => b instanceof FakeText && b.text === 'brand new');
    expect(created).toHaveLength(1);
    // children assigned the final ordered list — reorder falls out
    expect(root.children).toEqual([p2.id, created[0].id]);
    // the new block's key stamped back
    expect(edited.blocks[1]._key).toBe(created[0].id);
    // blob + search index refreshed
    expect(root.textContent).toBe('two edited brand new');
    expect(blobOf(root).map((b) => b._key)).toEqual(root.children);
  });

  it('keeps a block somebody else added while the author was editing — three-way membership', async () => {
    const { root, p1, p2 } = await seedPost();
    // Another agent appends a paragraph after the author loaded the post.
    const theirs = await FakeText.create(perspective, { style: 'normal', text: 'theirs' });
    root.children.push(theirs.id);

    const edited: ContentDocument = {
      _type: 'document',
      base: [p1.id, p2.id], // what the author loaded — `theirs` is not in it
      blocks: [paragraph('one', { _key: p1.id })], // author removed p2
    };
    await reconcileBlocks(perspective, root as never, edited);

    expect(p2.deleted).toBe(true); // the author's own removal
    expect(theirs.deleted).toBe(false); // not theirs to remove
    expect(root.children).toEqual([p1.id, theirs.id]); // kept, after the author's blocks
    // and the blob knows about it too
    expect(blobOf(root).map((b) => (b as TextContentBlock).text)).toEqual(['one', 'theirs']);
    expect(root.textContent).toBe('one theirs');
  });

  it('without a base — a legacy caller — everything unclaimed is treated as removed', async () => {
    const { root, p1, p2 } = await seedPost();
    await reconcileBlocks(perspective, root as never, [paragraph('replacement')]);
    expect(p1.deleted).toBe(true);
    expect(p2.deleted).toBe(true);
    expect(root.children).toHaveLength(1);
  });

  it('treats a duplicate key (copy/paste) as brand new for the second occurrence', async () => {
    const { root, p1, p2 } = await seedPost();

    await reconcileBlocks(perspective, root as never, {
      _type: 'document',
      base: [p1.id, p2.id],
      blocks: [
        paragraph('one', { _key: p1.id }),
        paragraph('one pasted', { _key: p1.id }),
        paragraph('two', { _key: p2.id }),
      ],
    });

    expect(p1.deleted).toBe(false);
    expect(root.children).toHaveLength(3);
    const pasted = byId.get(root.children[1]) as FakeText;
    expect(pasted.id).not.toBe(p1.id);
    expect(pasted.text).toBe('one pasted');
  });

  it('a key unknown to the existing tree is not claimed — a fresh block is created', async () => {
    const { root, p1, p2 } = await seedPost();

    await reconcileBlocks(perspective, root as never, {
      _type: 'document',
      base: [p1.id, p2.id],
      blocks: [paragraph('imported', { _key: 'id-from-somewhere-else' })],
    });

    expect(p1.deleted).toBe(true);
    expect(p2.deleted).toBe(true);
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).not.toBe('id-from-somewhere-else');
    expect((byId.get(root.children[0]) as FakeText).text).toBe('imported');
  });

  it('reconciles inside a nested collection', async () => {
    const blocks: ContentBlock[] = [{ _type: 'collection', layout: 'grid', content: [paragraph('a'), paragraph('b')] }];
    const root = (await createBlocks(perspective, blocks, { kind: 'post' })) as FakeCollection;
    const nested = byId.get(root.children[0]) as FakeCollection;
    const [a, b] = nested.children.map((id) => byId.get(id)!) as FakeText[];

    await reconcileBlocks(perspective, root as never, {
      _type: 'document',
      base: [nested.id, a.id, b.id],
      blocks: [{ _type: 'collection', _key: nested.id, layout: 'row', content: [paragraph('b!', { _key: b.id })] }],
    });

    expect(nested.layout).toBe('row');
    expect(a.deleted).toBe(true);
    expect(b.text).toBe('b!');
    expect(nested.children).toEqual([b.id]);
  });
});

// ── loadBlocks ──────────────────────────────────────────────────────────────

describe('loadBlocks', () => {
  it('rebuilds the composition from the models — the read path the blob is a cache of', async () => {
    const blocks: ContentBlock[] = [
      paragraph('one', { marks: [{ start: 0, end: 3, type: 'em' }] }),
      { _type: 'collection', layout: 'grid', content: [{ _type: 'image', src: 'Qm://x' }] },
    ];
    const root = (await createBlocks(perspective, blocks, { kind: 'post' })) as FakeCollection;

    const loaded = await loadBlocks(perspective, root.id);
    expect(loaded).toEqual([
      { _type: 'block', _key: blocks[0]._key, style: 'normal', text: 'one', marks: [{ start: 0, end: 3, type: 'em' }] },
      {
        _type: 'collection',
        _key: blocks[1]._key,
        layout: 'grid',
        content: [{ _type: 'image', _key: expect.any(String), src: 'Qm://x' }],
      },
    ]);
  });
});

// ── the document-mode guard ─────────────────────────────────────────────────

describe('reconcileBlocks mode guard', () => {
  const emptyEdit: ContentBlock[] = [paragraph('replacement')];

  it('refuses a feed collection — reconciling one deletes other agents content', async () => {
    const { root } = await seedPost();
    root.mode = 'feed';
    await expect(reconcileBlocks(perspective, root as never, emptyEdit)).rejects.toThrow(/not 'document'/);
  });

  it('refuses before touching anything — the children survive the refusal', async () => {
    const { root, p1, p2 } = await seedPost();
    root.mode = 'feed';
    await expect(reconcileBlocks(perspective, root as never, emptyEdit)).rejects.toThrow();
    expect(p1.deleted).toBe(false);
    expect(p2.deleted).toBe(false);
    expect(root.children).toHaveLength(2);
  });

  it('allows collaborative mode — a save materialises the shared session document', async () => {
    const { root } = await seedPost();
    root.mode = 'collaborative';
    await expect(reconcileBlocks(perspective, root as never, emptyEdit)).resolves.toBeDefined();
  });

  it('refuses an unrecognised mode — the check is an allow-list', async () => {
    const { root } = await seedPost();
    root.mode = 'something-later';
    await expect(reconcileBlocks(perspective, root as never, emptyEdit)).rejects.toThrow(/not 'document'/);
  });

  it('allows a document collection', async () => {
    const { root } = await seedPost();
    expect(root.mode).toBe('document');
    await expect(reconcileBlocks(perspective, root as never, emptyEdit)).resolves.toBeDefined();
  });

  it('allows a legacy collection with no mode — every post predating the field', async () => {
    const { root } = await seedPost();
    root.mode = undefined;
    await expect(reconcileBlocks(perspective, root as never, emptyEdit)).resolves.toBeDefined();
  });
});
