import type { PerspectiveProxy } from '@coasys/ad4m';
import { Ad4mModel, getPropertiesMetadata } from '@coasys/ad4m';

import { getBlockModel } from './registry';
import type { SerializedBlockNode } from './types';

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
 * Uses the block registry to resolve node types to model classes
 * and AD4M property metadata for generic serialization.
 */
export async function createBlocks(
  perspective: PerspectiveProxy,
  node: SerializedBlockNode,
  _parent?: SerializedBlockNode,
  existingBatchId?: string,
): Promise<void> {
  const ModelClass = getBlockModel(node.type);

  const batchId = existingBatchId || (await perspective.createBatch());

  let block: Ad4mModel | undefined;

  if (ModelClass) {
    const data = extractBlockData(ModelClass, node);
    block = await ModelClass.create(perspective, data, { batchId });
  }

  if (block && node.children) {
    node.id = block.id;
    for (const child of node.children) {
      await createBlocks(perspective, child, node, batchId);
    }
  }

  if (!existingBatchId) {
    await perspective.commitBatch(batchId);
  }
}
