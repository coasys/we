import type { ModelInstance } from '@we/backend-shared';
import type { FileData } from '@we/models';
import { asFileField, dataURIToFileData, getFileStore, runModelTransaction } from '@we/models';
import { CORE_MANIFEST } from '@we/models/manifest';

import type { CollectionMode } from './modes';
import { isReconcilable } from './modes';
import { getBlockRegistration, getRegisteredBlockModels } from './registry';
import type { SerializedBlockNode } from './types';

/**
 * The dataset a block tree persists into — whatever handle the connected backend takes. This
 * module speaks only the neutral model contract: metadata that used to come from decorator
 * introspection comes from the manifest, transactions and file storage from the runners the
 * backend registered, and the model calls from the entity proxies. Nothing here names a backend.
 */
type BlockDataset = unknown;

/** A block instance as this module handles it: the contract base plus whatever fields its type declares. */
type BlockModel = ModelInstance & Record<string, unknown>;

/** The manifest's answer to "which of this entity's fields hold file-stored content". */
function fileFieldNames(entity: string | undefined): string[] {
  if (!entity) return [];
  const properties = CORE_MANIFEST.entities[entity]?.properties ?? {};
  return Object.keys(properties).filter((name) => properties[name].format === 'file');
}

/** The manifest's answer to "which fields does this entity declare at all". */
function propertyNames(entity: string): string[] {
  return Object.keys(CORE_MANIFEST.entities[entity]?.properties ?? {});
}

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

/** Lexical paragraph/heading/quote types that contain inline text runs */
const TEXT_CONTAINER_TYPES = new Set(['paragraph', 'heading', 'quote', 'listitem']);

/**
 * Extract concatenated text content from a node's inline children.
 */
export function extractInlineText(children: SerializedBlockNode[]): string {
  return children
    .filter((c) => INLINE_TYPES.has(c.type))
    .map((c) => (c as Record<string, unknown>).text ?? (c.type === 'linebreak' ? '\n' : ''))
    .join('');
}

/**
 * Lexical inline node type for an @-mention. Carries the mentioned agent's DID in `did`, and its
 * display text — a handle at the time of writing — in `text`, like any other inline run.
 *
 * Not in {@link INLINE_TYPES}: a mention is text, so it must flow into `extractInlineText` and the
 * search index alongside the run it sits in. Its presence here is only for {@link extractMentions}
 * to recognise.
 */
const MENTION_TYPE = 'mention';

/**
 * Every DID mentioned anywhere in a composed tree, de-duplicated, in document order.
 *
 * Reads the `did` off mention nodes rather than parsing `@handle` out of text, which is the whole
 * point of the edge: handles are mutable and not unique, so a text scan matches the wrong agent
 * whenever two people share a display name and misses one who has since renamed. The editor knows
 * exactly who was picked from the autocomplete; this preserves that.
 *
 * De-duplicated because the relation is a set — mentioning someone three times in a post is one
 * fact about that post — and ordered because a set built from document order at least reads
 * predictably when displayed.
 */
export function extractMentions(node: SerializedBlockNode): string[] {
  const dids = new Set<string>();

  function walk(n: SerializedBlockNode): void {
    if (n.type === MENTION_TYPE) {
      const did = (n as Record<string, unknown>).did;
      if (typeof did === 'string' && did) dids.add(did);
    }
    // A collection's sub-editor content is embedded rather than linked, so mentions inside a
    // nested gallery or column belong to the post that contains it.
    if (n.type === 'collection' && n.childEditorState) {
      walk(n.childEditorState as SerializedBlockNode);
    }
    if (n.children) for (const child of n.children) walk(child);
  }

  walk(node);
  return [...dids];
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
export function extractTextContent(node: SerializedBlockNode): string {
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

/** Block model instance that has a children to-many relation */
interface BlockWithChildren extends ModelInstance {
  children: string[];
  // Promise<unknown>, matching the neutral accessor contract — a caller of addChildren gets a
  // completion signal, not a value.
  addChildren: (id: string, batch?: string) => Promise<unknown>;
}

/** Block model instance with loaded child blocks attached */
interface BlockWithLoadedChildren extends ModelInstance {
  children: string[];
  _loadedChildren?: BlockModel[];
}

function hasChildrenRelation(block: ModelInstance): block is BlockWithChildren {
  return 'addChildren' in block && typeof (block as BlockWithChildren).addChildren === 'function';
}

function hasChildren(block: ModelInstance): block is BlockWithChildren {
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
async function preUploadFileAssets(perspective: BlockDataset, node: SerializedBlockNode): Promise<SerializedBlockNode> {
  // Shallow-copy so we don't mutate the original Lexical JSON
  const patched: SerializedBlockNode = { ...node };
  const assetNames = patched.__assetNames as Record<string, string> | undefined;
  delete patched.__assetNames;

  // Which of this node's fields hold file content is the manifest's knowledge; where the bytes go
  // is the registered file store's. A backend that registered none keeps content inline — the blob
  // is bigger, nothing is lost.
  const fileStore = getFileStore();
  const registration = getBlockRegistration(node.type);
  if (registration && fileStore) {
    for (const propName of fileFieldNames(registration.entity)) {
      const value = patched[propName];
      const fileData = isFileData(value)
        ? value
        : typeof value === 'string' && value.startsWith('data:')
          ? dataURIToFileData(value, assetNames?.[propName] ?? propName)
          : undefined;
      if (fileData) {
        patched[propName] = await fileStore.store(perspective, fileData);
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
  perspective: BlockDataset,
  node: SerializedBlockNode,
): Promise<SerializedBlockNode> {
  const patched: SerializedBlockNode = { ...node };

  const fileStore = getFileStore();
  const registration = getBlockRegistration(node.type);
  if (registration && fileStore) {
    for (const propName of fileFieldNames(registration.entity)) {
      const val = patched[propName];
      // Only attempt resolution for values holding an address — the "://" is its hallmark, and it
      // is also what skips inline data URIs from a backend that stores nothing out-of-band.
      if (typeof val === 'string' && val.includes('://')) {
        try {
          const data = await fileStore.fetch(perspective, val);
          if (data) {
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
export function extractBlockData(entity: string, node: SerializedBlockNode): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const propName of propertyNames(entity)) {
    if (propName in node && node[propName] !== undefined) {
      data[propName] = node[propName];
    }
  }

  return data;
}

/** A model exposing `WeNode`'s mentions relation — every block root does, but the type is erased. */
interface NodeWithMentions {
  mentions: string[];
  addMentions(target: string | string[], batch?: string): Promise<void>;
  removeMentions(target: string | string[], batch?: string): Promise<void>;
}

function hasMentions(model: unknown): model is ModelInstance & NodeWithMentions {
  return typeof (model as NodeWithMentions)?.addMentions === 'function';
}

/**
 * Reconcile a root's `we://mention` edges against the mentions in its composed tree.
 *
 * A read-modify-write, which every other relation on `WeNode` avoids — and correct here for the
 * reason the field's docstring gives: the author owns the text, so they own every mention in it,
 * and there is no second writer to race. Contrast `participants`, where each agent appends only
 * itself precisely because a rewrite would drop whoever lost.
 *
 * Diffed rather than cleared-and-rewritten so that editing a post's wording does not churn links
 * for the mentions it kept — each removed link is a network write, and an unchanged edge should
 * cost nothing.
 */
async function writeMentions(root: ModelInstance, node: SerializedBlockNode, batchId?: string): Promise<void> {
  if (!hasMentions(root)) return;

  const wanted = extractMentions(node);
  const current = Array.isArray(root.mentions) ? root.mentions : [];
  if (!wanted.length && !current.length) return;

  const added = wanted.filter((did) => !current.includes(did));
  const removed = current.filter((did) => !wanted.includes(did));

  if (added.length) await root.addMentions(added, batchId);
  if (removed.length) await root.removeMentions(removed, batchId);
}

/**
 * Where a newly-created composition attaches, as a raw predicate link.
 *
 * A predicate rather than a relation name because the two anchors that matter mean different
 * things and live on different models: `we://children` puts a message *inside* a channel
 * (composition — what a container is made of), `we://comment` hangs a reply *off* any `WeNode`
 * (discourse — what was said about it). A relation-name API would have to resolve the name against
 * the anchor's class, which the block system does not have and should not need: it is persisting a
 * document, and where that document belongs is the caller's knowledge.
 */
export interface BlockAnchor {
  /** Id of the existing node the new root links from. */
  id: string;
  /** The predicate to link through — `'we://children'`, `'we://comment'`. */
  predicate: string;
}

export interface CreateBlocksOptions {
  /** Free label stamped onto the root saying what it is for — see the discussion below. */
  kind?: string;
  /**
   * Who owns the root's children (`'document'` | `'feed'` | `'collaborative'`).
   *
   * Defaults to `'document'` **when a `kind` is given**, because everything this function creates
   * is a composed artifact: it persists an editor's tree, which is the definition of document
   * mode. A feed container is not made here — it is made with `model.create` and named by its
   * template — so the default is right for every caller of this function and wrong for none.
   *
   * Left unset when no `kind` is given, so a caller that opts out of the whole vocabulary writes
   * neither field and reads back as legacy.
   */
  mode?: CollectionMode;
  /** Attach the root to something that already exists. See {@link BlockAnchor}. */
  anchor?: BlockAnchor;
}

/**
 * Recursively creates AD4M block models from a serialized block tree.
 * Runs in one write group via runModelTransaction — if any block
 * creation or linking fails, commitBatch() is never called.
 *
 * Parent-child relationships are established via the `children` @HasMany
 * on CollectionBlock (and any other container blocks).
 *
 * `kind` stamps the semantic type onto the root — `'post'` for a post. Optional and supplied by the
 * caller rather than assumed here, because not every root composition is a post: the block system
 * knows how to persist a document, not what the document is for.
 *
 * Why this exists at all: `type: 'root'` has been doing double duty as *the* post discriminator,
 * which conflates the Lexical node type with what the collection means. Writing `kind` on new roots
 * starts the changeover without a backfill — reads still key on `type: 'root'`, and can switch once
 * the legacy set stops mattering. There is no coordinated migration point in a P2P system, so a bulk
 * rewrite is not available; converging one record at a time as they are created is.
 */
export async function createBlocks(
  perspective: BlockDataset,
  node: SerializedBlockNode,
  options: CreateBlocksOptions = {},
): Promise<BlockModel | undefined> {
  const { kind, mode = kind ? 'document' : undefined, anchor } = options;
  return runModelTransaction(perspective, async (tx) => {
    const root = await persistNode(perspective, tx.batchId, node, undefined, undefined, anchor);
    // Assigned before the blob write below so both land in that one `save`, rather than costing a
    // second round trip for one string.
    const stampKind = root && kind && 'kind' in root;
    if (stampKind) root.kind = kind;
    const stampMode = root && mode && 'mode' in root;
    if (stampMode) root.mode = mode;

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
      root.editorState = asFileField({
        data_base64: base64,
        name: 'editor-state.json',
        file_type: 'application/json',
      });
      root.textContent = extractTextContent(patchedNode);
      await root.save(tx.batchId);
    } else if (stampKind || stampMode) {
      // A root with no `editorState` skips the blob write entirely, so `kind`/`mode` would
      // otherwise be assigned to an instance nobody saves.
      await root!.save(tx.batchId);
    }

    // After the save: `addMentions` writes links, which is a separate operation from the property
    // write above and has nothing to add to that round trip.
    if (root) await writeMentions(root, node, tx.batchId);

    return root;
  });
}

/**
 * Recursively creates AD4M block models from a serialized block tree,
 * mutating `node` in place with the `id` of each created block. Shared by
 * `createBlocks` (no parent — first call) and `reconcileBlocks` (parent is
 * an existing, already-persisted root).
 *
 * `anchor` applies to the **root call only** — it is the incoming link that attaches this whole
 * artifact to something that already exists (a channel, or the node a reply answers). Not passed
 * down: descendants are attached to their in-tree parent through `addChildren`, and an anchor
 * inherited downward would link every block in the post to the channel as well.
 */
async function persistNode(
  perspective: BlockDataset,
  batchId: string | undefined,
  node: SerializedBlockNode,
  parent?: ModelInstance,
  inherited?: Record<string, unknown>,
  anchor?: BlockAnchor,
): Promise<BlockModel | undefined> {
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

  const registration = getBlockRegistration(node.type);
  let block: BlockModel | undefined;

  if (registration) {
    const data = extractBlockData(registration.entity, node);

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

    block = (await registration.model.create(perspective, data, {
      batchId,
      ...(anchor && { parent: { id: anchor.id, predicate: anchor.predicate } }),
    })) as BlockModel;
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
 * Resolve an arbitrary block id to a hydrated instance of its concrete type.
 *
 * Class-scoped `findOne` per registered block model: a find by id under class X answers null when
 * the record is not an X — every block carries a discriminating flag, and the backend's query
 * machinery filters on it — so the first non-null answer is both the classification and the
 * instance, in one call. This replaced an AD4M-specific `isSubjectInstance` ASK followed by a
 * second fetch; a backend with a cheaper classification primitive can grow a port for it if the
 * per-class probes ever show up in a profile.
 */
async function resolveBlockInstance(perspective: BlockDataset, uri: string): Promise<BlockModel | undefined> {
  for (const registration of getRegisteredBlockModels()) {
    const block = await registration.model.findOne(perspective, { where: { id: uri } });
    if (block) return block as BlockModel;
  }
  return undefined;
}

/**
 * Reconstruct a block tree from AD4M.
 *
 * Takes a root block URI, resolves its model class, hydrates it, then
 * recursively loads children via the `children` @HasMany relationship.
 */
export async function loadBlocks(perspective: BlockDataset, rootUri: string): Promise<BlockModel | undefined> {
  async function loadNode(uri: string): Promise<BlockModel | undefined> {
    const block = await resolveBlockInstance(perspective, uri);
    if (!block) return undefined;

    // Recursively load children if this block has a children relation
    if (hasChildren(block)) {
      const childUris: string[] = block.children;
      const loadedChildren: BlockModel[] = [];

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
export async function deleteBlocks(perspective: BlockDataset, rootUri: string): Promise<void> {
  await runModelTransaction(perspective, async (tx) => {
    async function deleteNode(uri: string): Promise<void> {
      const block = await resolveBlockInstance(perspective, uri);
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
async function collectDescendants(perspective: BlockDataset, childUris: string[]): Promise<Map<string, BlockModel>> {
  const result = new Map<string, BlockModel>();

  async function walk(uri: string): Promise<void> {
    const block = await resolveBlockInstance(perspective, uri);
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
 *
 * ## Document-mode only
 *
 * Every sentence above assumes the incoming tree is the **whole truth** about this collection's
 * contents — which is true of an artifact one agent authored and just re-saved, and false of a
 * container many agents append to. Run this against a channel and the orphan pass deletes every
 * message the editing agent's tree does not mention, which is all of them but their own.
 *
 * So it refuses anything whose `kind` is registered as a non-document mode (see `kinds.ts`; the
 * check is an allow-list, and legacy `kind`-less posts pass). Loud, because the alternative
 * failure is silent and destroys other people's content.
 */
export async function reconcileBlocks(
  perspective: BlockDataset,
  existingRoot: BlockWithChildren,
  node: SerializedBlockNode,
): Promise<ModelInstance> {
  // Read structurally rather than through `CollectionBlock`: the parameter is typed as a generic
  // block root, and `Partial<CollectionBlock>` does not overlap it enough for a direct cast.
  const root = existingRoot as BlockWithChildren & { kind?: string; mode?: string };
  if (!isReconcilable(root.mode)) {
    throw new Error(
      `reconcileBlocks refused: collection '${root.kind || 'untitled'}' is in '${root.mode}' mode, not 'document'. ` +
        'Reconciling it would delete every child the incoming tree omits, which in a container ' +
        "many agents write to is everyone else's content. Append with createBlocks({ anchor }) instead.",
    );
  }

  return runModelTransaction(perspective, async (tx) => {
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

      const registration = getBlockRegistration(node.type);
      if (!registration) {
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

      const data = extractBlockData(registration.entity, node);
      if (inherited) {
        for (const [k, v] of Object.entries(inherited)) {
          if (!(k in data) || !data[k]) data[k] = v;
        }
      }
      if (node.children && node.children.some((c: SerializedBlockNode) => INLINE_TYPES.has(c.type))) {
        data.text = extractInlineText(node.children);
      }

      const existingId = typeof node.id === 'string' ? node.id : undefined;
      let block: BlockModel | undefined;
      if (existingId && !claimed.has(existingId)) {
        block = existing.get(existingId);
        if (block) {
          claimed.add(existingId);
          Object.assign(block, data);
          await block.save(tx.batchId);
        }
      }
      if (!block) {
        block = (await registration.model.create(perspective, data, { batchId: tx.batchId })) as BlockModel;
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
    const rootRecord = existingRoot as BlockWithChildren & Record<string, unknown>;
    rootRecord.editorState = asFileField({
      data_base64: base64,
      name: 'editor-state.json',
      file_type: 'application/json',
    });
    rootRecord.textContent = extractTextContent(patchedNode);
    await existingRoot.save(tx.batchId);

    // Edits add and remove mentions like any other content, so the edge set is reconciled here for
    // the same reason `textContent` is rewritten: both are projections of the tree that just changed.
    await writeMentions(existingRoot, node, tx.batchId);

    return existingRoot;
  });
}
