import { $isListItemNode } from '@lexical/list';
import { $isHeadingNode, $isQuoteNode } from '@lexical/rich-text';
import { mergeRegister } from '@lexical/utils';
import {
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { useLexicalComposerContext } from 'lexical-solid';
import { createEffect, onCleanup } from 'solid-js';

import styles from './PlaceholdersPlugin.module.scss';

export default function PlaceholdersPlugin() {
  const [editor] = useLexicalComposerContext();

  createEffect(() => {
    function updatePlaceholders() {
      editor.getEditorState().read(() => {
        const nodeMap = editor._editorState._nodeMap;
        const selection = $getSelection();

        // Get the key of the currently focused node
        let focusedNodeKey = null;
        if ($isRangeSelection(selection)) {
          focusedNodeKey = selection.focus.getNode().getKey();
          // Walk up the tree to find the nearest element node
          let node = selection.focus.getNode();
          while ((node && !$isElementNode(node)) || $isRootNode(node)) node = node.getParent()!;
          if (node && $isElementNode(node) && !$isRootNode(node)) focusedNodeKey = node.getKey();
        }

        // Process all block nodes
        for (const [key, node] of nodeMap.entries()) {
          if ($isElementNode(node) && !$isRootNode(node)) {
            const element = editor.getElementByKey(key);
            if (!element) continue;

            const isEmpty = node.getChildrenSize() === 0 || node.getFirstChild()?.getTextContent() === '\u200B';

            if (isEmpty) {
              // Add classes
              element.classList.add('we-block-placeholder-empty');
              if (key === focusedNodeKey) element.classList.add('we-block-placeholder-focused');
              else element.classList.remove('we-block-placeholder-focused');

              // Set appropriate placeholder text based on node type
              let placeholderText = '';
              if ($isParagraphNode(node)) placeholderText = "Type or press '/' for commands...";
              else if ($isListItemNode(node)) placeholderText = 'List item';
              else if ($isQuoteNode(node)) placeholderText = 'Quote';
              else if ($isHeadingNode(node)) {
                const tag = node.getTag();
                placeholderText = `Heading ${tag.substring(1)}`;
              }

              element.setAttribute('data-placeholder', placeholderText);
            } else {
              // Remove classes
              element.classList.remove('we-block-placeholder-empty');
              element.classList.remove('we-block-placeholder-focused');
              element.removeAttribute('data-placeholder');
            }
          }
        }
      });
    }

    const unregister = mergeRegister(
      // Register an update listener to update placeholders on editor updates
      editor.registerUpdateListener(() => requestAnimationFrame(updatePlaceholders)),

      // Register a command listener to update placeholders on selection changes
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          requestAnimationFrame(updatePlaceholders);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );

    // Cleanup when the component is destroyed
    onCleanup(() => {
      unregister();
    });
  });

  return null;
}
