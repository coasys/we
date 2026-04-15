import type { PerspectiveProxy } from '@coasys/ad4m';
import { Ad4mModel, getPropertiesMetadata, LinkQuery, Literal } from '@coasys/ad4m';

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

    return persist(node);
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
