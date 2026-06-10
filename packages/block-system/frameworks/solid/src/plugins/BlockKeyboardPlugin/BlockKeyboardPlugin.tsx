import { mergeRegister } from '@lexical/utils';
import {
  $createNodeSelection,
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  SELECTION_CHANGE_COMMAND,
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
    /**
     * Tracks the most recently NodeSelected decorator key.
     *
     * Clicking a contentEditable=false block causes the browser to fire
     * `selectionchange` (atom selection) before our mousedown handler's
     * editor.update() commits, creating a race that can leave $getSelection()
     * null by the time keyboard commands run.
     *
     * We use SELECTION_CHANGE_COMMAND (Lexical's authoritative selection event)
     * to maintain this key independently of that race. Keyboard handlers fall
     * back to it when $getSelection() is null so click-then-key always works.
     *
     * Cleared when selection moves to a non-null non-NodeSelection (i.e. user
     * moved the cursor to a text block). Kept on null selection so the fallback
     * survives the transient clearing caused by the atom-selection race.
     */
    let lastSelectedDecoratorKey: string | null = null;

    /** Returns the single selected decorator, or falls back to the last known one. */
    function getTargetDecorator(): LexicalNode | null {
      const sel = $getSelection();
      if ($isNodeSelection(sel)) {
        const nodes = sel.getNodes();
        return nodes.length === 1 && $isDecoratorNode(nodes[0]) ? nodes[0] : null;
      }
      // Only use fallback when selection is null (DOM race), not when cursor is
      // legitimately in a text block (RangeSelection).
      if (sel === null && lastSelectedDecoratorKey !== null) {
        const node = $getNodeByKey(lastSelectedDecoratorKey);
        return node && $isDecoratorNode(node) ? node : null;
      }
      return null;
    }

    const unregister = mergeRegister(
      // Maintain lastSelectedDecoratorKey via SELECTION_CHANGE_COMMAND.
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          const sel = $getSelection();
          if ($isNodeSelection(sel)) {
            const nodes = sel.getNodes();
            lastSelectedDecoratorKey =
              nodes.length === 1 && $isDecoratorNode(nodes[0]) ? nodes[0].getKey() : null;
          } else if (sel !== null) {
            // Cursor moved to a text block — clear the fallback.
            lastSelectedDecoratorKey = null;
          }
          // null selection: keep lastSelectedDecoratorKey so the fallback
          // survives the transient clearing from the atom-selection race.
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event: KeyboardEvent) => {
          const selection = $getSelection();
          const selectedDecorator = getTargetDecorator();

          // Decorator is selected → move cursor to the block below
          if (selectedDecorator !== null) {
            const next = selectedDecorator.getNextSibling();
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
          const selectedDecorator = getTargetDecorator();

          // Decorator is selected → move cursor to the block above
          if (selectedDecorator !== null) {
            const prev = selectedDecorator.getPreviousSibling();
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
          const targetNode = getTargetDecorator();
          if (!targetNode) return false;

          event.preventDefault();
          const paragraph = $createParagraphNode();
          targetNode.insertAfter(paragraph);
          paragraph.select();
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),

      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event: KeyboardEvent) => {
          const node = getTargetDecorator();
          if (!node) return false;

          event.preventDefault();
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
          const node = getTargetDecorator();
          if (!node) return false;

          event.preventDefault();
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
