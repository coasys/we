import type { PerspectiveProxy } from '@coasys/ad4m';

import { CollectionBlock, ImageBlock, TextBlock } from './models';

import type { SerializedBlockNode } from './types';

/**
 * Determines the block type string from a serialized node's type field.
 */
export function resolveBlockType(nodeType: string): string {
  if (nodeType === 'root') return 'collection';
  if (['text', 'paragraph', 'heading', 'quote', 'list', 'listitem'].includes(nodeType)) return 'text';
  if (nodeType === 'image') return 'image';
  return '';
}

/**
 * Recursively creates AD4M block models from a serialized block tree (e.g., Lexical editor state).
 * Handles batching — creates a new batch if none is provided, commits when done.
 */
export async function createBlocks(
  perspective: PerspectiveProxy,
  node: SerializedBlockNode,
  _parent?: SerializedBlockNode,
  existingBatchId?: string,
): Promise<void> {
  const blockType = resolveBlockType(node.type);

  const batchId = existingBatchId || (await perspective.createBatch());

  let block: CollectionBlock | TextBlock | ImageBlock | undefined;

  if (blockType === 'collection') {
    block = new CollectionBlock(perspective, undefined);
    block.type = node.type || '';
    block.display = node.display || '';
    block.direction = node.direction || '';
    block.format = node.format || '';
    block.indent = node.indent || 0;
    block.version = node.version || 0;
    await block.save(batchId);
  }

  if (blockType === 'text') {
    block = new TextBlock(perspective, undefined);
    block.type = node.type || '';
    block.direction = node.direction || '';
    block.format = node.format || '';
    block.indent = node.indent || 0;
    block.textFormat = node.textFormat || 0;
    block.textStyle = node.textStyle || '';
    block.listType = node.listType || '';
    block.start = node.start || 0;
    block.tag = node.tag || '';
    block.text = node.text || '';
    block.version = node.version || 0;
    await block.save(batchId);
  }

  if (blockType === 'image') {
    block = new ImageBlock(perspective, undefined);
    block.type = node.type || '';
    block.src = node.src || '';
    block.altText = node.altText || '';
    block.width = node.width || 0;
    block.height = node.height || 0;
    block.version = node.version || 0;
    await block.save(batchId);
  }

  if (block && node.children) {
    node.baseExpression = block.baseExpression;
    for (const child of node.children) {
      await createBlocks(perspective, child, node, batchId);
    }
  }

  if (!existingBatchId) {
    await perspective.commitBatch(batchId);
  }
}
