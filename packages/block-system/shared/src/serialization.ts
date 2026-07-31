import type { PerspectiveProxy } from '@coasys/ad4m';
import { Ad4mModel, getPropertiesMetadata } from '@coasys/ad4m';
import type { CollectionBlock, FileData } from '@we/models';
import { asFileField, dataURIToFileData } from '@we/models';

import { getBlockModel, getRegisteredBlockModels } from './registry';
import type { SerializedBlockNode } from './types';

/**
 * Lexical inline node types — these are text runs inside paragraph/heading
 * nodes that should be merged into the parent's `text` property rather than
 * persisted as separate AD4M models.
 */
const INLINE_TYPES = new Set(['text', 'linebreak']);

/**
 * Container-only node types that don't persist as their own model.
 * Their metadata is carried onto child nodes instead.
 * e.g. Lexical "list" wraps "listitem" children — we store listType/tag/start
 * on each listitem and link them directly to the parent CollectionBlock.
 */
const PASSTHROUGH_TYPES = new Set(['list']);

/**
 * Extract concatenated text content from a node's inline children.
 */
function extractInlineText(children: SerializedBlockNode[]): string {
  return children
    .filter((c) => INLINE_TYPES.has(c.type))
    .map((c) => (c as Record<string, unknown>).text ?? (c.type === 'linebreak' ? '\n' : ''))
    .join('');
}

/** Text properties to extract per block type for the textContent search index. */
const TEXT_FIELDS_BY_TYPE: Record<string, string[]> = {
  link: ['title', 'description'],
  code: ['title'],
  task: ['title', 'description'],
  callout: ['text'],
  audio: ['title'],
  video: ['title'],
  file: ['title', 'name'],
  event: ['title', 'description', 'location'],
  location: ['name', 'address'],
  tag: ['name'],
  image: ['altText'],
};

const TEXT_CONTENT_MAX_CHARS = 5000;

/**
 * Walk a serialized block node tree and concatenate all human-readable text
 * into a single normalised string suitable for full-text search indexing.
 * Whitespace is collapsed to single spaces and the result is capped at
 * TEXT_CONTENT_MAX_CHARS, truncated at the nearest word boundary.
 */
function extractTextContent(node: SerializedBlockNode): string {
  const parts: string[] = [];

  function walk(n: SerializedBlockNode): void {
    if (INLINE_TYPES.has(n.type)) return;

    if (TEXT_CONTAINER_TYPES.has(n.type)) {
      if (n.children) {
        const text = extractInlineText(n.children).trim();
        if (text) parts.push(text);
      }
      return;
    }

    if (n.type === 'root' || n.type === 'collection') {
      if (n.type === 'collection' && n.childEditorState) {
        walk(n.childEditorState as SerializedBlockNode);
      }
      if (n.children) {
        for (const child of n.children) walk(child);
      }
      return;
    }

    // list passthrough — recurse into listitems
    if (PASSTHROUGH_TYPES.has(n.type)) {
      if (n.children) {
        for (const child of n.children) walk(child);
      }
      return;
    }

    // Leaf blocks — extract typed text properties
    const fields = TEXT_FIELDS_BY_TYPE[n.type] ?? [];
    for (const field of fields) {
      const val = (n as Record<string, unknown>)[field];
      if (typeof val === 'string' && val.trim()) parts.push(val.trim());
    }

    // Recurse into any non-inline children (e.g. future composite blocks)
    if (n.children) {
      for (const child of n.children) {
        if (!INLINE_TYPES.has(child.type)) walk(child);
      }
    }
  }

  walk(node);

  // Collapse all whitespace runs (including newlines) to a single space
  const normalised = parts.join(' ').replace(/\s+/g, ' ').trim();

  if (normalised.length <= TEXT_CONTENT_MAX_CHARS) return normalised;

  // Truncate at nearest word boundary below the cap
  const truncated = normalised.slice(0, TEXT_CONTENT_MAX_CHARS);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
}

/** Block model instance that has a children @HasMany relation */
interface BlockWithChildren extends Ad4mModel {
  children: string[];
  addChildren: (id: string, batchId?: string) => Promise<void>;
}

/** Block model instance with loaded child blocks attached */
interface BlockWithLoadedChildren extends Ad4mModel {
  children: string[];
  _loadedChildren?: Ad4mModel[];
}

function hasChildrenRelation(block: Ad4mModel): block is BlockWithChildren {
  return 'addChildren' in block && typeof (block as BlockWithChildren).addChildren === 'function';
}

function hasChildren(block: Ad4mModel): block is BlockWithChildren {
  return Array.isArray((block as BlockWithChildren).children);
}

/** Returns true if a value looks like a FileData object (data_base64 + file_type). */
function isFileData(value: unknown): value is FileData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data_base64' in value &&
    'file_type' in value &&
    typeof (value as FileData).data_base64 === 'string'
  );
}

/**
 * Walk a serialized block node tree, upload any FileData values (or data:
 * URIs round-tripped from resolveExpressionAddresses — see dataURIToFileData
 * from @we/models) on resolveLanguage properties to file-storage, and return
 * a patched copy where those values are replaced with the resulting
 * expression addresses (e.g. "QmLang://QmHash"). This keeps the editorState
 * blob small (CIDs instead of raw base64 payloads) and ensures the AD4M
 * model's create() path receives a string it can store directly rather than
 * a FileData object.
 *
 * For an unchanged asset round-tripped through resolveExpressionAddresses,
 * __assetNames (stamped there) carries the *original* upload name forward —
 * required because file storage is content-addressed on name + size +
 * file_type + data_base64, so re-uploading identical bytes under a
 * different name would produce a different address than the original,
 * orphaning the old one for no reason.
 */
async function preUploadFileAssets(
  perspective: PerspectiveProxy,
  node: SerializedBlockNode,
): Promise<SerializedBlockNode> {
  // Shallow-copy so we don't mutate the original Lexical JSON
  const patched: SerializedBlockNode = { ...node };
  const assetNames = patched.__assetNames as Record<string, string> | undefined;
  delete patched.__assetNames;

  // Resolve the model class for this node type (if registered)
  const ModelClass = getBlockModel(node.type);
  if (ModelClass) {
    const propsMeta = getPropertiesMetadata(ModelClass);
    for (const [propName, meta] of Object.entries(propsMeta)) {
      if (!meta.resolveLanguage) continue;
      const value = patched[propName];
      const fileData = isFileData(value)
        ? value
        : typeof value === 'string' && value.startsWith('data:')
          ? dataURIToFileData(value, assetNames?.[propName] ?? propName)
          : undefined;
      if (fileData) {
        // Upload the file and replace the FileData with the expression address
        const expressionAddress = await perspective.createExpression(fileData, meta.resolveLanguage);
        patched[propName] = expressionAddress;
      }
    }
  }

  // Recurse into children
  if (Array.isArray(node.children)) {
    patched.children = await Promise.all(
      node.children.map((child: SerializedBlockNode) => preUploadFileAssets(perspective, child)),
    );
  }

  // Recurse into collection block child editor state
  if (node.childEditorState && typeof node.childEditorState === 'object') {
    patched.childEditorState = await preUploadFileAssets(perspective, node.childEditorState as SerializedBlockNode);
  }

  return patched;
}

/**
 * Walk a serialized block node tree and resolve any expression-address strings
 * on resolveLanguage properties to data URIs via the perspective.
 * This is the read-side counterpart to preUploadFileAssets — called by
 * BlockRenderer before loading the editorState blob into Lexical so that
 * stored CIDs (e.g. "QmLang://QmHash") are replaced with renderable data URIs.
 */
export async function resolveExpressionAddresses(
  perspective: PerspectiveProxy,
  node: SerializedBlockNode,
): Promise<SerializedBlockNode> {
  const patched: SerializedBlockNode = { ...node };

  const ModelClass = getBlockModel(node.type);
  if (ModelClass) {
    const propsMeta = getPropertiesMetadata(ModelClass);
    for (const [propName, meta] of Object.entries(propsMeta)) {
      const val = patched[propName];
      // Only attempt resolution for resolveLanguage properties that hold a
      // non-empty string containing "://" — the hallmark of an expression address.
      if (meta.resolveLanguage && typeof val === 'string' && val.includes('://')) {
        try {
          const expr = await perspective.getExpression(val);
          if (expr?.data) {
            const data = typeof expr.data === 'string' ? JSON.parse(expr.data) : expr.data;
            if (data?.data_base64 && data?.file_type) {
              patched[propName] = `data:${data.file_type};base64,${data.data_base64}`;
              // Carry the original upload name forward — preUploadFileAssets
              // needs it to reuse this exact address if the asset goes
              // unchanged through an edit round trip (see its doc comment).
              if (typeof data.name === 'string') {
                patched.__assetNames = {
                  ...(patched.__assetNames as Record<string, string> | undefined),
                  [propName]: data.name,
                };
              }
            }
          }
        } catch {
          // Leave original value if resolution fails (e.g. offline / bad address)
        }
      }
    }
  }

  if (Array.isArray(node.children)) {
    patched.children = await Promise.all(
      node.children.map((child: SerializedBlockNode) => resolveExpressionAddresses(perspective, child)),
    );
  }

  // Recurse into collection block child editor state so sub-renderers receive
  // pre-resolved data URIs and don't need their own perspective reference.
  if (node.childEditorState && typeof node.childEditorState === 'object') {
    patched.childEditorState = await resolveExpressionAddresses(
      perspective,
      node.childEditorState as SerializedBlockNode,
    );
  }

  return patched;
}

/**
 * Extract property values from a serialized node for a given model class.
 * Only includes properties that exist on both the node and the model.
 */
function extractBlockData(ModelClass: typeof Ad4mModel, node: SerializedBlockNode): Record<string, unknown> {
  const propsMeta = getPropertiesMetadata(ModelClass);
  const data: Record<string, unknown> = {};

  for (const propName of Object.keys(propsMeta)) {
    if (propName in node && node[propName] !== undefined) {
      data[propName] = node[propName];
    }
  }

  return data;
}

/**
 * Recursively creates AD4M block models from a serialized block tree.
 * Uses Ad4mModel.transaction() for atomic persistence — if any block
 * creation or linking fails, commitBatch() is never called.
 *
 * Parent-child relationships are established via the `children` @HasMany
 * on CollectionBlock (and any other container blocks).
 */
export async function createBlocks(
  perspective: PerspectiveProxy,
  node: SerializedBlockNode,
): Promise<Ad4mModel | undefined> {
  return Ad4mModel.transaction(perspective, async (tx) => {
    const root = await persistNode(perspective, tx.batchId, node);

    // Store the full Lexical serialized JSON as a file-storage blob on the
    // root CollectionBlock for lossless roundtrip. preUploadFileAssets runs
    // *after* persistNode (rather than before, against the original node) so
    // its per-node shallow copies pick up the `id` fields persistNode just
    // stamped onto `node` — giving every block a stable id in the blob for
    // free, which edit-time reconciliation (reconcileBlocks) depends on to
    // tell "this still exists, update it" apart from "this is brand new".
    if (root && 'editorState' in root) {
      const patchedNode = await preUploadFileAssets(perspective, node);
      const jsonStr = JSON.stringify(patchedNode);
      const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
      (root as CollectionBlock).editorState = asFileField({
        data_base64: base64,
        name: 'editor-state.json',
        file_type: 'application/json',
      });
      (root as CollectionBlock).textContent = extractTextContent(patchedNode);
      await root.save(tx.batchId);
    }

    return root;
  });
}

/**
 * Recursively creates AD4M block models from a serialized block tree,
 * mutating `node` in place with the `id` of each created block. Shared by
 * `createBlocks` (no parent — first call) and `reconcileBlocks` (parent is
 * an existing, already-persisted root).
 */
async function persistNode(
  perspective: PerspectiveProxy,
  batchId: string,
  node: SerializedBlockNode,
  parent?: Ad4mModel,
  inherited?: Record<string, unknown>,
): Promise<Ad4mModel | undefined> {
  // Pass-through containers (e.g. "list"): don't create a model,
  // carry metadata down to children
  if (PASSTHROUGH_TYPES.has(node.type)) {
    const meta: Record<string, unknown> = {};
    if ((node as Record<string, unknown>).listType) meta.listType = (node as Record<string, unknown>).listType;
    if ((node as Record<string, unknown>).tag) meta.tag = (node as Record<string, unknown>).tag;
    if ((node as Record<string, unknown>).start) meta.start = (node as Record<string, unknown>).start;
    if (node.children) {
      for (const child of node.children) {
        await persistNode(perspective, batchId, child, parent, meta);
      }
    }
    return undefined;
  }

  const ModelClass = getBlockModel(node.type);
  let block: Ad4mModel | undefined;

  if (ModelClass) {
    const data = extractBlockData(ModelClass, node);

    // Apply inherited metadata from pass-through parents (e.g. list → listitem)
    if (inherited) {
      for (const [k, v] of Object.entries(inherited)) {
        if (!(k in data) || !data[k]) data[k] = v;
      }
    }

    // Merge inline text children (e.g. Lexical "text" nodes inside a paragraph)
    // into the parent block's `text` property instead of creating separate models.
    if (node.children && node.children.some((c: SerializedBlockNode) => INLINE_TYPES.has(c.type))) {
      data.text = extractInlineText(node.children);
    }

    block = await ModelClass.create(perspective, data, { batchId });
    node.id = block.id;

    if (parent && block && hasChildrenRelation(parent)) {
      await parent.addChildren(block.id, batchId);
    }
  }

  // Special handling for collection blocks: the childEditorState is the
  // sub-editor content embedded inline in the parent blob. Recurse into it
  // to create AD4M models for the blocks inside (e.g. images, files).
  if (node.type === 'collection' && block && node.childEditorState) {
    const childRoot = node.childEditorState as SerializedBlockNode;
    // Recurse into the ROOT's CHILDREN directly rather than passing the root
    // node itself through persistNode(). The root node has type='root' which
    // maps to CollectionBlock — persisting it would create a ghost
    // CollectionBlock that appears as a duplicate post in queries filtered
    // by { type: 'root' }.
    if (childRoot.children) {
      for (const child of childRoot.children) {
        if (!INLINE_TYPES.has(child.type)) {
          await persistNode(perspective, batchId, child, block);
        }
      }
    }
    // No separate editorState blob — it's embedded in the parent's blob.
    return block;
  }

  // Only recurse into non-inline children (skip text/linebreak nodes)
  if (node.children) {
    for (const child of node.children) {
      if (!INLINE_TYPES.has(child.type)) {
        await persistNode(perspective, batchId, child, block ?? parent);
      }
    }
  }

  return block;
}

/**
 * Resolve the AD4M model class for an arbitrary block expression.
 *
 * Every block model carries a `@Flag({ through: 'we://flag', value: ... })`
 * property identifying its concrete type, and flags are always required
 * triples — so `isSubjectInstance` reliably discriminates between block
 * classes via a real SPARQL ASK rather than a loose "has any links" check.
 * This replaced an older `we://type`-link classifier that only worked for
 * CollectionBlock/TextBlock (the two models that repurpose `we://type` for
 * their own internal subtype field) and silently failed for every leaf
 * block (ImageBlock, VideoBlock, etc.), which have no `type` property.
 */
async function resolveBlockModel(perspective: PerspectiveProxy, uri: string): Promise<typeof Ad4mModel | undefined> {
  for (const ModelClass of getRegisteredBlockModels()) {
    const className = (ModelClass as unknown as { className: string }).className;
    if (await perspective.isSubjectInstance(uri, className)) return ModelClass;
  }
  return undefined;
}

/**
 * Reconstruct a block tree from AD4M.
 *
 * Takes a root block URI, resolves its model class, hydrates it, then
 * recursively loads children via the `children` @HasMany relationship.
 */
export async function loadBlocks(perspective: PerspectiveProxy, rootUri: string): Promise<Ad4mModel | undefined> {
  async function loadNode(uri: string): Promise<Ad4mModel | undefined> {
    const ModelClass = await resolveBlockModel(perspective, uri);
    if (!ModelClass) return undefined;

    // Hydrate the block with the correct concrete class
    const block = await ModelClass.findOne(perspective, { where: { id: uri } });
    if (!block) return undefined;

    // Recursively load children if this block has a children relation
    if (hasChildren(block)) {
      const childUris: string[] = block.children;
      const loadedChildren: Ad4mModel[] = [];

      for (const childUri of childUris) {
        const child = await loadNode(childUri);
        if (child) loadedChildren.push(child);
      }

      (block as BlockWithLoadedChildren)._loadedChildren = loadedChildren;
    }

    return block;
  }

  return loadNode(rootUri);
}

/**
 * Recursively delete a block tree rooted at rootUri.
 *
 * Mirrors loadBlocks' traversal: resolve each node's model class via its
 * `we://flag`, hydrate it, delete descendants before their parent so each
 * `delete()` call only ever has to clean up links to blocks that still
 * exist. Runs inside a transaction so a failure partway through doesn't
 * leave the tree half-deleted.
 */
export async function deleteBlocks(perspective: PerspectiveProxy, rootUri: string): Promise<void> {
  await Ad4mModel.transaction(perspective, async (tx) => {
    async function deleteNode(uri: string): Promise<void> {
      const ModelClass = await resolveBlockModel(perspective, uri);
      if (!ModelClass) return;

      const block = await ModelClass.findOne(perspective, { where: { id: uri } });
      if (!block) return;

      if (hasChildren(block)) {
        for (const childUri of block.children) {
          await deleteNode(childUri);
        }
      }

      await block.delete(tx.batchId);
    }

    await deleteNode(rootUri);
  });
}

/**
 * Hydrates every descendant of `childUris` (recursively), keyed by id.
 * Shared by `reconcileBlocks` for both matching (does this id still exist?)
 * and cleanup (delete whatever never got claimed) without resolving each
 * instance's model class twice.
 */
async function collectDescendants(perspective: PerspectiveProxy, childUris: string[]): Promise<Map<string, Ad4mModel>> {
  const result = new Map<string, Ad4mModel>();

  async function walk(uri: string): Promise<void> {
    const ModelClass = await resolveBlockModel(perspective, uri);
    if (!ModelClass) return;

    const block = await ModelClass.findOne(perspective, { where: { id: uri } });
    if (!block) return;

    result.set(uri, block);

    if (hasChildren(block)) {
      for (const childUri of block.children) {
        await walk(childUri);
      }
    }
  }

  for (const uri of childUris) {
    await walk(uri);
  }

  return result;
}

/**
 * Reconciles an existing post's block tree against a freshly-edited
 * serialized tree, instead of deleting and recreating everything.
 *
 * `node` is expected to carry `id` fields on every block that already
 * existed — round-tripped through Lexical's `__props` for our custom block
 * nodes (see createBlocks/persistNode, which stamps them in at creation
 * time), and through Lexical's NodeState mechanism for the built-in text
 * node types (ParagraphNode, HeadingNode, QuoteNode, ListItemNode), which
 * don't preserve arbitrary extra JSON fields the way our custom nodes do —
 * see block-system/frameworks/solid/src/nodes/blockIdState.ts. Anything
 * without an `id`, or whose id is already claimed by an earlier node in
 * this same save (e.g. a copy/pasted duplicate), is treated as brand new
 * and gets a freshly created instance instead of reusing one. Existing
 * descendants whose id is never claimed during the walk are deleted. Each
 * parent's `children` relation is overwritten outright with the final
 * ordered id list once its subtree is reconciled — relation assignment
 * fully replaces the link set, so reordering and reparenting fall out for
 * free without needing a separate move/diff step.
 */
export async function reconcileBlocks(
  perspective: PerspectiveProxy,
  existingRoot: Ad4mModel & BlockWithChildren,
  node: SerializedBlockNode,
): Promise<Ad4mModel> {
  return Ad4mModel.transaction(perspective, async (tx) => {
    const existing = await collectDescendants(perspective, existingRoot.children);
    const claimed = new Set<string>();

    // Returns the ids this node contributes to its caller's children list:
    // a single id for a real block, the flattened ids of its own children
    // for a pass-through/unrecognized node (mirrors persistNode's shape).
    async function reconcileNode(node: SerializedBlockNode, inherited?: Record<string, unknown>): Promise<string[]> {
      if (PASSTHROUGH_TYPES.has(node.type)) {
        const meta: Record<string, unknown> = {};
        if ((node as Record<string, unknown>).listType) meta.listType = (node as Record<string, unknown>).listType;
        if ((node as Record<string, unknown>).tag) meta.tag = (node as Record<string, unknown>).tag;
        if ((node as Record<string, unknown>).start) meta.start = (node as Record<string, unknown>).start;
        const ids: string[] = [];
        if (node.children) {
          for (const child of node.children) {
            ids.push(...(await reconcileNode(child, meta)));
          }
        }
        return ids;
      }

      const ModelClass = getBlockModel(node.type);
      if (!ModelClass) {
        // Unrecognized type — same treatment as persistNode: contribute
        // children's ids upward without creating anything for this node.
        const ids: string[] = [];
        if (node.children) {
          for (const child of node.children) {
            if (!INLINE_TYPES.has(child.type)) ids.push(...(await reconcileNode(child, inherited)));
          }
        }
        return ids;
      }

      const data = extractBlockData(ModelClass, node);
      if (inherited) {
        for (const [k, v] of Object.entries(inherited)) {
          if (!(k in data) || !data[k]) data[k] = v;
        }
      }
      if (node.children && node.children.some((c: SerializedBlockNode) => INLINE_TYPES.has(c.type))) {
        data.text = extractInlineText(node.children);
      }

      const existingId = typeof node.id === 'string' ? node.id : undefined;
      let block: Ad4mModel | undefined;
      if (existingId && !claimed.has(existingId)) {
        block = existing.get(existingId);
        if (block) {
          claimed.add(existingId);
          Object.assign(block, data);
          await block.save(tx.batchId);
        }
      }
      if (!block) {
        block = await ModelClass.create(perspective, data, { batchId: tx.batchId });
      }
      node.id = block.id;

      // Collection blocks keep their nested content in childEditorState
      // rather than Lexical-level children — mirrors persistNode.
      if (node.type === 'collection' && node.childEditorState) {
        const childRoot = node.childEditorState as SerializedBlockNode;
        const childIds: string[] = [];
        if (childRoot.children) {
          for (const child of childRoot.children) {
            if (!INLINE_TYPES.has(child.type)) childIds.push(...(await reconcileNode(child)));
          }
        }
        if (hasChildrenRelation(block)) {
          block.children = childIds;
          await block.save(tx.batchId);
        }
        return [block.id];
      }

      if (node.children) {
        const childIds: string[] = [];
        for (const child of node.children) {
          if (!INLINE_TYPES.has(child.type)) childIds.push(...(await reconcileNode(child)));
        }
        if (hasChildrenRelation(block)) {
          block.children = childIds;
          await block.save(tx.batchId);
        }
      }

      return [block.id];
    }

    const topLevelIds: string[] = [];
    if (node.children) {
      for (const child of node.children) {
        if (!INLINE_TYPES.has(child.type)) topLevelIds.push(...(await reconcileNode(child)));
      }
    }
    existingRoot.children = topLevelIds;

    for (const [id, block] of existing) {
      if (!claimed.has(id)) await block.delete(tx.batchId);
    }

    const patchedNode = await preUploadFileAssets(perspective, node);
    const jsonStr = JSON.stringify(patchedNode);
    const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
    (existingRoot as CollectionBlock).editorState = asFileField({
      data_base64: base64,
      name: 'editor-state.json',
      file_type: 'application/json',
    });
    (existingRoot as CollectionBlock).textContent = extractTextContent(patchedNode);
    await existingRoot.save(tx.batchId);

    return existingRoot;
  });
}

// ---------------------------------------------------------------------------
// Fallback: reconstruct Lexical JSON from an AD4M block tree
// ---------------------------------------------------------------------------

/** Lexical paragraph/heading/quote types that contain inline text runs */
const TEXT_CONTAINER_TYPES = new Set(['paragraph', 'heading', 'quote', 'listitem']);

/** Properties added by AD4M that aren't part of Lexical's JSON format */
const AD4M_ONLY_PROPS = new Set([
  'id',
  'children',
  'author',
  'createdAt',
  'updatedAt',
  'display',
  'columns',
  'gap',
  'textStyle',
  'editorState',
  'comments',
  'reactions',
]);

/**
 * Convert a loaded block model (from `loadBlocks`) into Lexical-compatible
 * serialized JSON. This is the **lossy fallback** used when the root
 * CollectionBlock has no `editorState` blob (e.g. cross-community content,
 * or data created before blob storage was added).
 *
 * Inline text formatting (bold/italic/underline) is reduced to a single
 * format value per paragraph — span-level detail is lost because
 * `extractInlineText` merges all inline children at save time.
 */
function blockToLexical(block: Record<string, unknown>): Record<string, unknown> {
  const node: Record<string, unknown> = {};

  for (const key of Object.keys(block)) {
    if (key.startsWith('_') || AD4M_ONLY_PROPS.has(key)) continue;
    const val = block[key];
    if (Array.isArray(val) && val.length === 0) continue;
    if (val !== undefined && val !== null) node[key] = val;
  }

  const blockType = node.type as string;
  const blockText = block.text as string | undefined;

  if (TEXT_CONTAINER_TYPES.has(blockType) && blockText) {
    node.children = [
      {
        type: 'text',
        text: blockText,
        detail: 0,
        format: (block.textFormat as number) || 0,
        mode: 'normal',
        style: (block.textStyle as string) || '',
        version: 1,
      },
    ];
    delete node.text;
    delete node.textFormat;

    if (blockType === 'listitem') {
      delete node.listType;
      delete node.tag;
      delete node.start;
      node.value = (block.start as number) || 1;
    }
  } else {
    const loadedChildren = (block as Record<string, unknown>)._loadedChildren;
    if (Array.isArray(loadedChildren) && loadedChildren.length) {
      const converted = loadedChildren.map(blockToLexical);
      node.children = groupListItems(converted);
    } else if (!node.children) {
      node.children = [];
    }
  }

  return node;
}

/**
 * Group consecutive listitem nodes into Lexical list wrapper nodes.
 * e.g. [paragraph, listitem, listitem, paragraph] →
 *      [paragraph, list{children:[listitem, listitem]}, paragraph]
 */
function groupListItems(nodes: Record<string, unknown>[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  let currentList: Record<string, unknown> | null = null;

  for (const node of nodes) {
    if (node.type === 'listitem') {
      if (!currentList) {
        currentList = {
          type: 'list',
          listType: (node as Record<string, unknown>).listType || 'bullet',
          tag: (node as Record<string, unknown>).tag || 'ul',
          start: 1,
          direction: (node as Record<string, unknown>).direction || 'ltr',
          format: '',
          indent: 0,
          version: 1,
          children: [],
        };
        result.push(currentList);
      }
      (currentList.children as Record<string, unknown>[]).push(node);
    } else {
      currentList = null;
      result.push(node);
    }
  }

  return result;
}

/**
 * Best-effort conversion of a loaded AD4M block tree back to Lexical JSON.
 *
 * Used as a fallback when `editorState` blob is absent. The result is
 * formatting-lossy (inline bold/italic spans collapsed to a single format
 * per paragraph) but structurally correct.
 */
export function blocksToLexicalJSON(rootBlock: Ad4mModel): SerializedBlockNode {
  return blockToLexical(rootBlock as unknown as Record<string, unknown>);
}
