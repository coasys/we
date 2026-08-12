/**
 * The block persistence pipeline, tested against a fake model layer.
 *
 * The pipeline's contract is structural — id-claiming, duplicate detection,
 * orphan deletion, relation overwrite — none of which needs a real AD4M
 * executor. The fakes implement exactly the surface serialization.ts touches:
 * Model.create/findOne/save/delete, the children @HasMany accessors,
 * getPropertiesMetadata, and the perspective's isSubjectInstance /
 * createExpression.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@coasys/ad4m', () => {
  class Ad4mModel {
    static async transaction(_perspective: unknown, fn: (tx: { batchId: string }) => unknown) {
      return fn({ batchId: 'batch-1' });
    }
  }
  return {
    Ad4mModel,
    getPropertiesMetadata: (cls: { propsMeta?: Record<string, unknown> }) => cls.propsMeta ?? {},
  };
});

vi.mock('@we/models', () => ({
  asFileField: (fileData: unknown) => fileData,
  dataURIToFileData: (uri: string, name: string) => ({
    data_base64: uri.slice(uri.indexOf(',') + 1),
    name,
    file_type: uri.slice(5, uri.indexOf(';')),
  }),
}));

import type { Ad4mModel, PerspectiveProxy } from '@coasys/ad4m';

import { registerBlock } from '../src/registry';
import {
  createBlocks,
  extractBlockData,
  extractInlineText,
  extractTextContent,
  reconcileBlocks,
} from '../src/serialization';
import type { SerializedBlockNode } from '../src/types';

// ── Fake model layer ────────────────────────────────────────────────────────

let idCounter = 0;
const byId = new Map<string, FakeBlock>();

class FakeBlock {
  static propsMeta: Record<string, { resolveLanguage?: string }> = {};
  static className = 'FakeBlock';
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
  }

  static async create(_p: unknown, data: Record<string, unknown>, opts?: { parent?: unknown }) {
    const block = new this(data);
    // Recorded rather than acted on: the anchor is passed straight to Ad4mModel.create, so what a
    // test can meaningfully assert is that it arrived, and on the root only.
    block.createdWithParent = opts?.parent;
    FakeBlock.created.push(block);
    return block;
  }

  static async findOne(_p: unknown, opts: { where: { id: string } }) {
    return byId.get(opts.where.id);
  }
}

class FakeText extends FakeBlock {
  static className = 'TextBlock';
  static propsMeta = { type: {}, text: {}, listType: {}, tag: {}, start: {}, textFormat: {} };
}

class FakeCollection extends FakeBlock {
  static className = 'CollectionBlock';
  static propsMeta = { type: {}, title: {}, kind: {}, mode: {} };
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

registerBlock({
  nodeTypes: ['paragraph', 'heading', 'quote', 'listitem'],
  model: FakeText as unknown as typeof Ad4mModel,
});
registerBlock({ nodeTypes: ['root', 'collection'], model: FakeCollection as unknown as typeof Ad4mModel });

const perspective = {
  isSubjectInstance: async (uri: string, className: string) =>
    (byId.get(uri)?.constructor as typeof FakeBlock | undefined)?.className === className,
  createExpression: async () => 'lang://QmFake',
} as unknown as PerspectiveProxy;

function text(t: string): SerializedBlockNode {
  return { type: 'text', text: t, version: 1 };
}
function paragraph(t: string, extra: Record<string, unknown> = {}): SerializedBlockNode {
  return { type: 'paragraph', version: 1, children: [text(t)], ...extra };
}

beforeEach(() => {
  idCounter = 0;
  byId.clear();
  FakeBlock.created = [];
});

// ── Pure helpers ────────────────────────────────────────────────────────────

describe('extractInlineText', () => {
  it('merges text runs and renders linebreaks as newlines', () => {
    expect(extractInlineText([text('a'), { type: 'linebreak', version: 1 }, text('b')])).toBe('a\nb');
  });

  it('ignores non-inline children', () => {
    expect(extractInlineText([text('a'), paragraph('nested')])).toBe('a');
  });
});

describe('extractTextContent', () => {
  it('collects container text and leaf block fields, collapsing whitespace', () => {
    const node: SerializedBlockNode = {
      type: 'root',
      version: 1,
      children: [
        paragraph('  hello\n world '),
        { type: 'link', version: 1, title: 'A title', description: 'A description', url: 'https://x' },
      ],
    };
    expect(extractTextContent(node)).toBe('hello world A title A description');
  });

  it('recurses into collection childEditorState', () => {
    const node: SerializedBlockNode = {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'collection',
          version: 1,
          childEditorState: { type: 'root', version: 1, children: [paragraph('inside')] },
        },
      ],
    };
    expect(extractTextContent(node)).toBe('inside');
  });

  it('caps at 5000 chars, truncating on a word boundary', () => {
    const words = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(' ');
    const result = extractTextContent({ type: 'root', version: 1, children: [paragraph(words)] });
    expect(result.length).toBeLessThanOrEqual(5000);
    expect(result.endsWith(' ')).toBe(false);
    // No word is cut in half: the result is a prefix of the input ending at a space.
    expect(words.startsWith(result)).toBe(true);
    expect(words[result.length]).toBe(' ');
  });
});

describe('extractBlockData', () => {
  it('takes only properties present on both the node and the model', () => {
    const node: SerializedBlockNode = { type: 'paragraph', version: 1, text: 'hi', unrelated: 'x' };
    expect(extractBlockData(FakeText as unknown as typeof Ad4mModel, node)).toEqual({
      type: 'paragraph',
      text: 'hi',
    });
  });

  it('skips undefined values', () => {
    const node: SerializedBlockNode = { type: 'paragraph', version: 1, text: undefined };
    expect(extractBlockData(FakeText as unknown as typeof Ad4mModel, node)).toEqual({ type: 'paragraph' });
  });
});

// ── createBlocks ────────────────────────────────────────────────────────────

describe('createBlocks', () => {
  it('creates the tree, links children, stamps ids, and writes the root blob', async () => {
    const node: SerializedBlockNode = {
      type: 'root',
      version: 1,
      children: [paragraph('first'), paragraph('second')],
    };

    const root = (await createBlocks(perspective, node, { kind: 'post' })) as FakeCollection;

    expect(root).toBeInstanceOf(FakeCollection);
    expect(root.kind).toBe('post');
    expect(root.children).toHaveLength(2);
    // ids stamped back onto the serialized nodes for later reconciliation
    expect(node.id).toBe(root.id);
    expect(node.children?.[0].id).toBe(root.children[0]);
    // blob + search index written
    expect(root.editorState).toMatchObject({ name: 'editor-state.json', file_type: 'application/json' });
    expect(root.textContent).toBe('first second');
  });

  it('carries list metadata onto listitems without creating a model for the list', async () => {
    const node: SerializedBlockNode = {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'list',
          version: 1,
          listType: 'number',
          tag: 'ol',
          start: 1,
          children: [{ type: 'listitem', version: 1, children: [text('item one')] }],
        },
      ],
    };

    const root = (await createBlocks(perspective, node)) as FakeCollection;
    const items = FakeBlock.created.filter((b) => b instanceof FakeText);
    expect(items).toHaveLength(1);
    expect(items[0].listType).toBe('number');
    expect(items[0].tag).toBe('ol');
    expect(items[0].text).toBe('item one');
    expect(root.children).toEqual([items[0].id]);
  });

  it('defaults mode to document when a kind is given — everything it creates is a composition', async () => {
    const node: SerializedBlockNode = { type: 'root', version: 1, children: [paragraph('x')] };
    const root = (await createBlocks(perspective, node, { kind: 'message' })) as FakeCollection;
    expect(root.mode).toBe('document');
  });

  it('writes neither kind nor mode when the caller opts out of the vocabulary', async () => {
    const node: SerializedBlockNode = { type: 'root', version: 1, children: [paragraph('x')] };
    const root = (await createBlocks(perspective, node)) as FakeCollection;
    expect(root.kind).toBeUndefined();
    expect(root.mode).toBeUndefined();
  });

  it('honours an explicit mode over the default', async () => {
    const node: SerializedBlockNode = { type: 'root', version: 1, children: [paragraph('x')] };
    const root = (await createBlocks(perspective, node, { kind: 'channel', mode: 'feed' })) as FakeCollection;
    expect(root.mode).toBe('feed');
  });

  it('passes the anchor to the root only — descendants attach to their in-tree parent', async () => {
    const node: SerializedBlockNode = {
      type: 'root',
      version: 1,
      children: [paragraph('first'), paragraph('second')],
    };
    const anchor = { id: 'channel-1', predicate: 'we://children' };

    const root = (await createBlocks(perspective, node, { kind: 'message', anchor })) as FakeCollection;

    expect(root.createdWithParent).toEqual(anchor);
    for (const child of FakeBlock.created.filter((b) => b instanceof FakeText)) {
      expect(child.createdWithParent).toBeUndefined();
    }
  });
});

// ── mentions ────────────────────────────────────────────────────────────────

/** An inline mention run, as the composer emits it. */
function mention(did: string, handle: string): SerializedBlockNode {
  return { type: 'mention', version: 1, did, text: handle };
}

describe('mentions', () => {
  it('writes a mention edge per distinct DID named in the tree', async () => {
    const node: SerializedBlockNode = {
      type: 'root',
      version: 1,
      children: [
        { type: 'paragraph', version: 1, children: [text('hi '), mention('did:key:alice', '@alice')] },
        { type: 'paragraph', version: 1, children: [mention('did:key:bob', '@bob')] },
      ],
    };

    const root = (await createBlocks(perspective, node, { kind: 'post' })) as FakeCollection;
    expect(root.mentions).toEqual(['did:key:alice', 'did:key:bob']);
  });

  it('de-duplicates — naming someone twice is one fact about the post', async () => {
    const node: SerializedBlockNode = {
      type: 'root',
      version: 1,
      children: [
        { type: 'paragraph', version: 1, children: [mention('did:key:alice', '@alice')] },
        { type: 'paragraph', version: 1, children: [mention('did:key:alice', '@alice again')] },
      ],
    };

    const root = (await createBlocks(perspective, node, { kind: 'post' })) as FakeCollection;
    expect(root.mentions).toEqual(['did:key:alice']);
  });

  it('finds mentions inside a nested collection sub-editor', async () => {
    const node: SerializedBlockNode = {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'collection',
          version: 1,
          childEditorState: {
            type: 'root',
            version: 1,
            children: [{ type: 'paragraph', version: 1, children: [mention('did:key:carol', '@carol')] }],
          },
        },
      ],
    };

    const root = (await createBlocks(perspective, node, { kind: 'post' })) as FakeCollection;
    expect(root.mentions).toContain('did:key:carol');
  });

  it('reconciles on edit — adds the new, drops the removed, leaves the kept alone', async () => {
    const node: SerializedBlockNode = {
      type: 'root',
      version: 1,
      children: [
        { type: 'paragraph', version: 1, children: [mention('did:key:alice', '@alice')] },
        { type: 'paragraph', version: 1, children: [mention('did:key:bob', '@bob')] },
      ],
    };
    const root = (await createBlocks(perspective, node, { kind: 'post' })) as FakeCollection & Ad4mModel;
    expect((root as FakeCollection).mentions).toEqual(['did:key:alice', 'did:key:bob']);

    const edited: SerializedBlockNode = {
      type: 'root',
      version: 1,
      id: root.id,
      children: [
        { type: 'paragraph', version: 1, id: node.children![0].id, children: [mention('did:key:alice', '@alice')] },
        { type: 'paragraph', version: 1, id: node.children![1].id, children: [mention('did:key:dave', '@dave')] },
      ],
    };
    await reconcileBlocks(perspective, root as never, edited);

    expect((root as FakeCollection).mentions).toEqual(['did:key:alice', 'did:key:dave']);
  });
});

// ── reconcileBlocks ─────────────────────────────────────────────────────────

/** Persist an initial two-paragraph post and return its pieces. */
async function seedPost() {
  const node: SerializedBlockNode = {
    type: 'root',
    version: 1,
    children: [paragraph('one'), paragraph('two')],
  };
  const root = (await createBlocks(perspective, node, { kind: 'post' })) as FakeCollection &
    Ad4mModel & { children: string[] };
  const [p1, p2] = root.children.map((id) => byId.get(id)!) as FakeText[];
  return { root, p1, p2 };
}

describe('reconcileBlocks', () => {
  it('updates claimed blocks in place, creates unclaimed ones, deletes orphans', async () => {
    const { root, p1, p2 } = await seedPost();

    const edited: SerializedBlockNode = {
      type: 'root',
      version: 1,
      id: root.id,
      children: [
        paragraph('two edited', { id: p2.id }), // kept + moved first
        paragraph('brand new'), // no id → created
      ],
    };

    await reconcileBlocks(perspective, root as never, edited);

    // p2 claimed and updated in place
    expect(p2.text).toBe('two edited');
    expect(p2.deleted).toBe(false);
    // p1 never claimed → deleted
    expect(p1.deleted).toBe(true);
    // new block created and stamped
    const created = FakeBlock.created.filter((b) => b instanceof FakeText && b.text === 'brand new');
    expect(created).toHaveLength(1);
    // children overwritten with the final ordered list — reorder falls out
    expect(root.children).toEqual([p2.id, created[0].id]);
    // blob + search index refreshed
    expect(root.textContent).toBe('two edited brand new');
  });

  it('treats a duplicate id (copy/paste) as brand new for the second occurrence', async () => {
    const { root, p1, p2 } = await seedPost();

    const edited: SerializedBlockNode = {
      type: 'root',
      version: 1,
      id: root.id,
      children: [
        paragraph('one', { id: p1.id }),
        paragraph('one pasted', { id: p1.id }),
        paragraph('two', { id: p2.id }),
      ],
    };

    await reconcileBlocks(perspective, root as never, edited);

    // First occurrence claims p1; the duplicate gets a fresh instance.
    expect(p1.deleted).toBe(false);
    expect(root.children).toHaveLength(3);
    const pasted = byId.get(root.children[1] as string) as FakeText;
    expect(pasted.id).not.toBe(p1.id);
    expect(pasted.text).toBe('one pasted');
  });

  it('an id unknown to the existing tree is not claimed — a fresh block is created', async () => {
    const { root, p1, p2 } = await seedPost();

    const edited: SerializedBlockNode = {
      type: 'root',
      version: 1,
      id: root.id,
      children: [paragraph('imported', { id: 'id-from-somewhere-else' })],
    };

    await reconcileBlocks(perspective, root as never, edited);

    expect(p1.deleted).toBe(true);
    expect(p2.deleted).toBe(true);
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).not.toBe('id-from-somewhere-else');
    expect((byId.get(root.children[0] as string) as FakeText).text).toBe('imported');
  });
});

// ── the document-mode guard ─────────────────────────────────────────────────

describe('reconcileBlocks mode guard', () => {
  /** A minimal edit of `root` that would delete every child it does not mention. */
  function emptyEditOf(root: FakeCollection): SerializedBlockNode {
    return { type: 'root', version: 1, id: root.id, children: [paragraph('replacement')] };
  }

  it('refuses a feed collection — reconciling one deletes other agents content', async () => {
    const { root } = await seedPost();
    (root as FakeCollection).mode = 'feed';

    await expect(reconcileBlocks(perspective, root as never, emptyEditOf(root))).rejects.toThrow(/not 'document'/);
  });

  it('refuses before touching anything — the children survive the refusal', async () => {
    const { root, p1, p2 } = await seedPost();
    (root as FakeCollection).mode = 'feed';

    await expect(reconcileBlocks(perspective, root as never, emptyEditOf(root))).rejects.toThrow();

    expect(p1.deleted).toBe(false);
    expect(p2.deleted).toBe(false);
    expect(root.children).toHaveLength(2);
  });

  it('refuses collaborative mode too — the check is an allow-list', async () => {
    const { root } = await seedPost();
    (root as FakeCollection).mode = 'collaborative';

    await expect(reconcileBlocks(perspective, root as never, emptyEditOf(root))).rejects.toThrow(/not 'document'/);
  });

  it('allows a document collection', async () => {
    const { root } = await seedPost();
    expect((root as FakeCollection).mode).toBe('document');

    await expect(reconcileBlocks(perspective, root as never, emptyEditOf(root))).resolves.toBeDefined();
  });

  it('allows a legacy collection with no mode — every post predating the field', async () => {
    const { root } = await seedPost();
    (root as FakeCollection).mode = undefined;

    await expect(reconcileBlocks(perspective, root as never, emptyEditOf(root))).resolves.toBeDefined();
  });
});
