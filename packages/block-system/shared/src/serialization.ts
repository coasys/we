import type { PerspectiveProxy } from '@coasys/ad4m';
import { Ad4mModel, getPropertiesMetadata, LinkQuery, Literal } from '@coasys/ad4m';
import type { CollectionBlock, FileData } from '@we/models';

import { getBlockModel, getBlockRegistration } from './registry';
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
 * Walk a serialized block node tree, upload any FileData values on
 * resolveLanguage properties to file-storage, and return a patched copy
 * where those values are replaced with the resulting expression addresses
 * (e.g. "QmLang://QmHash").  This keeps the editorState blob small (CIDs
 * instead of raw base64 payloads) and ensures the AD4M model's create()
 * path receives a string it can store directly rather than a FileData object.
 */
async function preUploadFileAssets(
  perspective: PerspectiveProxy,
  node: SerializedBlockNode,
): Promise<SerializedBlockNode> {
  // Shallow-copy so we don't mutate the original Lexical JSON
  const patched: SerializedBlockNode = { ...node };

  // Resolve the model class for this node type (if registered)
  const ModelClass = getBlockModel(node.type);
  if (ModelClass) {
    const propsMeta = getPropertiesMetadata(ModelClass);
    for (const [propName, meta] of Object.entries(propsMeta)) {
      if (meta.resolveLanguage && isFileData(patched[propName])) {
        // Upload the file and replace the FileData with the expression address
        const expressionAddress = await perspective.createExpression(patched[propName], meta.resolveLanguage);
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
  // Pre-upload FileData values to get expression addresses for the editorState
  // blob only.  The block tree itself is persisted from the original node so
  // that FileData objects hit the deferred setProperty → createExpression →
  // executeAction path, which stores clean URI references in the triple graph.
  // (Passing pre-uploaded strings through initialValues → createSubject would
  // JSON-encode them with quote characters, breaking resolveLanguage resolution.)
  const patchedNode = await preUploadFileAssets(perspective, node);

  return Ad4mModel.transaction(perspective, async (tx) => {
    async function persist(
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
            await persist(child, parent, meta);
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

        block = await ModelClass.create(perspective, data, { batchId: tx.batchId });

        if (parent && block && hasChildrenRelation(parent)) {
          await parent.addChildren(block.id, tx.batchId);
        }
      }

      // Special handling for collection blocks: the childEditorState is the
      // sub-editor content embedded inline in the parent blob. Recurse into it
      // to create AD4M models for the blocks inside (e.g. images, files).
      if (node.type === 'collection' && block && node.childEditorState) {
        const childRoot = node.childEditorState as SerializedBlockNode;
        await persist(childRoot, block);
        // No separate editorState blob — it's embedded in the parent's blob.
        return block;
      }

      // Only recurse into non-inline children (skip text/linebreak nodes)
      if (node.children) {
        for (const child of node.children) {
          if (!INLINE_TYPES.has(child.type)) {
            await persist(child, block ?? parent);
          }
        }
      }

      return block;
    }

    const root = await persist(node);

    // Store the full Lexical serialized JSON as a file-storage blob on the
    // root CollectionBlock for lossless roundtrip. Uses patchedNode (with CIDs
    // instead of raw FileData objects) so the blob stays compact.
    if (root && 'editorState' in root) {
      const jsonStr = JSON.stringify(patchedNode);
      const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
      (root as CollectionBlock).editorState = {
        data_base64: base64,
        name: 'editor-state.json',
        file_type: 'application/json',
      } as any;
      await root.save(tx.batchId);
    }

    return root;
  });
}

/**
 * Resolve the @Model type name for a given AD4M subject URI by querying
 * for its SHACL type link.
 */
async function resolveBlockType(perspective: PerspectiveProxy, uri: string): Promise<string | undefined> {
  const links = await perspective.get(new LinkQuery({ source: uri, predicate: 'we://type' }));
  if (links.length > 0) {
    const target = links[0].data.target;
    try {
      return Literal.fromUrl(target).get().data;
    } catch {
      return target;
    }
  }
  return undefined;
}

/**
 * Reconstruct a block tree from AD4M.
 *
 * Takes a root block URI, resolves its type, hydrates it with the correct
 * model class from the block registry, then recursively loads children
 * via the `children` @HasMany relationship.
 */
export async function loadBlocks(perspective: PerspectiveProxy, rootUri: string): Promise<Ad4mModel | undefined> {
  async function loadNode(uri: string): Promise<Ad4mModel | undefined> {
    // Resolve the model type from the SHACL type link
    const typeName = await resolveBlockType(perspective, uri);
    if (!typeName) return undefined;

    // Look up the model class from the block registry by type name
    const reg = getBlockRegistration(typeName);
    const ModelClass = reg?.model;
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
