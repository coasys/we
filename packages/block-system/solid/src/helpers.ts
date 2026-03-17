import { $createListItemNode, $createListNode, $isListItemNode, $isListNode } from '@lexical/list';
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $getNodeByKey,
  $isElementNode,
  $isParagraphNode,
  createCommand,
  LexicalEditor,
  LexicalNode,
} from 'lexical';

import { $createImageNode, $isImageNode } from './nodes/ImageNode';

type TransformBlockProps = { editor: LexicalEditor; nodeKey: string; newNodeType: string };
type ReorderBlockProps = { editor: LexicalEditor; sourceKey: string; targetKey: string; insertBefore: boolean };

export const TRANSFORM_BLOCK_COMMAND = createCommand<TransformBlockProps>('TRANSFORM_BLOCK_COMMAND');
export const REORDER_BLOCK_COMMAND = createCommand<ReorderBlockProps>('REORDER_BLOCK_COMMAND');

export function findNodeType(node: LexicalNode): string {
  // Used to determine the block type of a node for the block menu
  let type = '';
  if ($isParagraphNode(node)) type = 'p';
  else if ($isQuoteNode(node)) type = 'quote';
  else if ($isImageNode(node)) type = 'image';
  else if ($isHeadingNode(node) || $isListNode(node)) type = node.getTag();
  else if ($isListItemNode(node)) {
    // In the case of list items return the parent list type (ul, ol, cl)
    const parent = node.getParent();
    if (parent && $isListNode(parent)) type = parent.getTag();
  }
  return type;
}

export function transformBlock({ editor, nodeKey, newNodeType }: TransformBlockProps): boolean {
  // Used to transform a block node to another type
  if (!nodeKey) return false;

  editor.update(() => {
    const node = $getNodeByKey(nodeKey);
    if (!node) return;

    // Skip if node is already the desired type
    if (
      (newNodeType === 'p' && $isParagraphNode(node)) ||
      (newNodeType === 'li' && $isListItemNode(node)) ||
      (newNodeType === 'quote' && $isQuoteNode(node)) ||
      (['h1', 'h2', 'h3'].includes(newNodeType) && $isHeadingNode(node) && node.getTag() === newNodeType)
    )
      return;

    // Create the new node based on the desired type
    let newNode;
    if (newNodeType === 'p') newNode = $createParagraphNode();
    else if (newNodeType === 'quote') newNode = $createQuoteNode();
    else if (newNodeType === 'image') newNode = $createImageNode();
    else if (['h1', 'h2', 'h3'].includes(newNodeType)) newNode = $createHeadingNode(newNodeType as 'h1' | 'h2' | 'h3');
    else if (['ul', 'ol', 'cl'].includes(newNodeType)) {
      // If the new block is a list we need to create a list node and append a list item node to it
      const listTypes = { ul: 'bullet', ol: 'number', cl: 'check' } as any;
      const listNode = $createListNode(listTypes[newNodeType]);
      const listItemNode = $createListItemNode();
      if ($isElementNode(node)) node.getChildren().forEach((child) => listItemNode.append(child));
      listNode.append(listItemNode);
      newNode = listNode;
    } else return; // Skip if unsupported block type

    // Transfer content
    if ($isElementNode(node)) {
      if ($isParagraphNode(newNode) || $isQuoteNode(newNode) || $isHeadingNode(newNode)) {
        node.getChildren().forEach((child) => newNode.append(child));
      }
    }

    // Replace the old node with the new one
    node.replace(newNode);
  });

  return true;
}

export function reorderBlock({ editor, sourceKey, targetKey, insertBefore }: ReorderBlockProps): boolean {
  if (!sourceKey || !targetKey) return false;

  editor.update(() => {
    const sourceNode = $getNodeByKey(sourceKey);
    const targetNode = $getNodeByKey(targetKey);

    if (sourceNode && targetNode) {
      if (insertBefore) targetNode.insertBefore(sourceNode);
      else {
        const nextSibling = targetNode.getNextSibling();
        if (nextSibling) nextSibling.insertBefore(sourceNode);
        else targetNode.getParent()?.append(sourceNode);
      }
    }
  });

  return true;
}
