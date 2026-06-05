import { mergeRegister } from '@lexical/utils';
import {
  $createNodeSelection,
  $createParagraphNode,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
} from 'lexical';
import { useLexicalComposerContext } from 'lexical-solid';
import { createEffect, onCleanup } from 'solid-js';

/**
 * Keyboard integration for decorator block nodes.
 *
 * - Arrow Down/Up: navigates the cursor into a decorator block instead of
 *   skipping over it, and navigates out when a block is already selected.
 * - Enter: inserts a new paragraph after the selected decorator block.
 * - Backspace/Delete: removes the selected decorator block and positions
 *   the cursor on the nearest adjacent paragraph.
 */
export default function BlockKeyboardPlugin() {
  const [editor] = useLexicalComposerContext();

  createEffect(() => {
    const unregister = mergeRegister(
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event: KeyboardEvent) => {
          const selection = $getSelection();

          // Decorator is already NodeSelected → move cursor to the block below
          if ($isNodeSelection(selection)) {
            const nodes = selection.getNodes();
            if (nodes.length === 1 && $isDecoratorNode(nodes[0])) {
              const next = nodes[0].getNextSibling();
              if (!next) return false;
              event.preventDefault();
              if ($isDecoratorNode(next)) {
                const ns = $createNodeSelection();
                ns.add(next.getKey());
                $setSelection(ns);
              } else if ($isElementNode(next)) {
                next.selectStart();
              }
              return true;
            }
          }

          // Cursor is in a text block whose next sibling is a decorator
          if ($isRangeSelection(selection) && selection.isCollapsed()) {
            const anchor = selection.anchor;
            const anchorNode = anchor.getNode();
            const topLevel = anchorNode.getTopLevelElement();
            if (!topLevel) return false;

            const next = topLevel.getNextSibling();
            if (!$isDecoratorNode(next)) return false;

            // Only intercept when the cursor is at the very end of the block
            const lastDescendant = topLevel.getLastDescendant();
            if (
              lastDescendant !== null &&
              (anchorNode !== lastDescendant || anchor.offset !== anchorNode.getTextContentSize())
            ) {
              return false;
            }

            event.preventDefault();
            const ns = $createNodeSelection();
            ns.add(next.getKey());
            $setSelection(ns);
            return true;
          }

          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),

      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event: KeyboardEvent) => {
          const selection = $getSelection();

          // Decorator is already NodeSelected → move cursor to the block above
          if ($isNodeSelection(selection)) {
            const nodes = selection.getNodes();
            if (nodes.length === 1 && $isDecoratorNode(nodes[0])) {
              const prev = nodes[0].getPreviousSibling();
              if (!prev) return false;
              event.preventDefault();
              if ($isDecoratorNode(prev)) {
                const ns = $createNodeSelection();
                ns.add(prev.getKey());
                $setSelection(ns);
              } else if ($isElementNode(prev)) {
                prev.selectEnd();
              }
              return true;
            }
          }

          // Cursor is in a text block whose previous sibling is a decorator
          if ($isRangeSelection(selection) && selection.isCollapsed()) {
            const anchor = selection.anchor;
            const anchorNode = anchor.getNode();
            const topLevel = anchorNode.getTopLevelElement();
            if (!topLevel) return false;

            const prev = topLevel.getPreviousSibling();
            if (!$isDecoratorNode(prev)) return false;

            // Only intercept when the cursor is at the very start of the block
            const firstDescendant = topLevel.getFirstDescendant();
            if (firstDescendant !== null && (anchorNode !== firstDescendant || anchor.offset !== 0)) {
              return false;
            }

            event.preventDefault();
            const ns = $createNodeSelection();
            ns.add(prev.getKey());
            $setSelection(ns);
            return true;
          }

          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),

      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event: KeyboardEvent) => {
          const selection = $getSelection();
          if (!$isNodeSelection(selection)) return false;

          const nodes = selection.getNodes();
          if (nodes.length !== 1 || !$isDecoratorNode(nodes[0])) return false;

          event.preventDefault();
          const paragraph = $createParagraphNode();
          nodes[0].insertAfter(paragraph);
          paragraph.select();
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),

      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event: KeyboardEvent) => {
          const selection = $getSelection();
          if (!$isNodeSelection(selection)) return false;

          const nodes = selection.getNodes();
          if (nodes.length !== 1 || !$isDecoratorNode(nodes[0])) return false;

          event.preventDefault();
          const node = nodes[0];
          const prev = node.getPreviousSibling();
          const next = node.getNextSibling();
          node.remove();

          if (prev && $isElementNode(prev)) prev.selectEnd();
          else if (next && $isElementNode(next)) next.selectStart();
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),

      editor.registerCommand(
        KEY_DELETE_COMMAND,
        (event: KeyboardEvent) => {
          const selection = $getSelection();
          if (!$isNodeSelection(selection)) return false;

          const nodes = selection.getNodes();
          if (nodes.length !== 1 || !$isDecoratorNode(nodes[0])) return false;

          event.preventDefault();
          const node = nodes[0];
          const next = node.getNextSibling();
          const prev = node.getPreviousSibling();
          node.remove();

          if (next && $isElementNode(next)) next.selectStart();
          else if (prev && $isElementNode(prev)) prev.selectEnd();
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    );

    onCleanup(unregister);
  });

  return null;
}
