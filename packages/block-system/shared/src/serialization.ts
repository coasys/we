import type { PerspectiveProxy } from '@coasys/ad4m';
import { Ad4mModel, getPropertiesMetadata, LinkQuery } from '@coasys/ad4m';

import { getBlockModel, getBlockRegistration } from './registry';
import type { SerializedBlockNode } from './types';

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
    async function persist(node: SerializedBlockNode, parent?: Ad4mModel): Promise<Ad4mModel | undefined> {
      const ModelClass = getBlockModel(node.type);
      let block: Ad4mModel | undefined;

      if (ModelClass) {
        const data = extractBlockData(ModelClass, node);
        block = await ModelClass.create(perspective, data, { batchId: tx.batchId });

        if (parent && block && hasChildrenRelation(parent)) {
          await parent.addChildren(block.id, tx.batchId);
        }
      }

      if (node.children) {
        for (const child of node.children) {
          await persist(child, block ?? parent);
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
  const links = await perspective.get(new LinkQuery({ source: uri, predicate: 'rdf://type' }));
  if (links.length > 0) {
    return links[0].data.target;
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
