import type { PerspectiveProxy } from '@coasys/ad4m';
import { Block, CollectionBlock, ImageBlock, TextBlock } from '@we/models';

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

  const blockWrapper = new Block(perspective, undefined);
  blockWrapper.type = blockType;
  await blockWrapper.save(batchId);

  if (blockType === 'collection') {
    const collectionBlock = new CollectionBlock(perspective, undefined);
    collectionBlock.type = node.type || '';
    collectionBlock.display = node.display || '';
    collectionBlock.direction = node.direction || '';
    collectionBlock.format = node.format || '';
    collectionBlock.indent = node.indent || 0;
    collectionBlock.version = node.version || 0;
    await collectionBlock.save(batchId);
  }

  if (blockType === 'text') {
    const textBlock = new TextBlock(perspective, undefined);
    textBlock.type = node.type || '';
    textBlock.direction = node.direction || '';
    textBlock.format = node.format || '';
    textBlock.indent = node.indent || 0;
    textBlock.textFormat = node.textFormat || 0;
    textBlock.textStyle = node.textStyle || '';
    textBlock.listType = node.listType || '';
    textBlock.start = node.start || 0;
    textBlock.tag = node.tag || '';
    textBlock.text = node.text || '';
    textBlock.version = node.version || 0;
    await textBlock.save(batchId);
  }

  if (node.type === 'image') {
    const imageBlock = new ImageBlock(perspective, undefined);
    imageBlock.type = node.type || '';
    imageBlock.src = node.src || '';
    imageBlock.altText = node.altText || '';
    imageBlock.width = node.width || 0;
    imageBlock.height = node.height || 0;
    imageBlock.version = node.version || 0;
    await imageBlock.save(batchId);
  }

  if (node.children) {
    node.baseExpression = blockWrapper.baseExpression;
    for (const child of node.children) {
      await createBlocks(perspective, child, node, batchId);
    }
  }

  if (!existingBatchId) {
    await perspective.commitBatch(batchId);
  }
}
