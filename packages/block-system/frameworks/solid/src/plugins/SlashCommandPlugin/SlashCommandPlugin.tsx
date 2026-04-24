import { mergeRegister } from '@lexical/utils';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  LexicalNode,
} from 'lexical';
import { useLexicalComposerContext } from 'lexical-solid';
import { createEffect, createSignal, JSX, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';

import BlockMenu from '../../components/BlockMenu';
import { findNodeType, TRANSFORM_BLOCK_COMMAND, transformBlock } from '../../helpers';

export const SHOW_SLASH_MENU = createCommand('SHOW_SLASH_MENU');
export const SLASH_KEY_COMMAND = createCommand<LexicalNode>('SLASH_KEY_COMMAND');

export default function SlashCommandPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const [position, setPosition] = createSignal({ top: 200, left: 200 });
  const [nodeData, setNodeData] = createSignal({ key: '', type: '' });
  const [showMenu, setShowMenu] = createSignal(false);

  function closeMenu() {
    setShowMenu(false);
    editor.focus();
  }

  function selectType(type: string) {
    editor.dispatchCommand(TRANSFORM_BLOCK_COMMAND, { editor, newNodeType: type, nodeKey: nodeData().key });
  }

  function slashKeyPress(node: LexicalNode) {
    editor.update(() => {
      const element = editor.getElementByKey(node.getKey());
      if (element) {
        // Update state & display menu
        const rect = element.getBoundingClientRect();
        setPosition({ top: rect.bottom + window.scrollY + 5, left: rect.left + window.scrollX });
        setNodeData({ key: node.getKey(), type: findNodeType(node) });
        setShowMenu(true);
        return true;
      }
      return false;
    });
    return true;
  }

  createEffect(() => {
    const unregisterCommands = mergeRegister(
      // Register the transform block command
      editor.registerCommand(TRANSFORM_BLOCK_COMMAND, transformBlock, COMMAND_PRIORITY_EDITOR),

      // Register the slash key command
      editor.registerCommand(SLASH_KEY_COMMAND, slashKeyPress, COMMAND_PRIORITY_NORMAL),
    );

    // Register keyboard listener for slash key
    const unregisterRootListener = editor.registerRootListener((rootElement: HTMLElement | null) => {
      if (rootElement !== null) {
        const handleKeyDown = (event: KeyboardEvent) => {
          if (event.key === '/') {
            // Check the selection is empty
            editor.getEditorState().read(() => {
              const selection = $getSelection();
              if ($isRangeSelection(selection)) {
                const node = selection.anchor.getNode();
                const isEmpty = node.getTextContent().trim() === '';
                if (isEmpty) {
                  event.preventDefault();
                  editor.dispatchCommand(SLASH_KEY_COMMAND, node);
                }
              }
            });
          }
        };

        rootElement.addEventListener('keydown', handleKeyDown);

        // Cleanup the event listener
        onCleanup(() => {
          rootElement.removeEventListener('keydown', handleKeyDown);
        });
      }
    });

    // Cleanup commands and listeners when the component is destroyed
    onCleanup(() => {
      unregisterCommands();
      unregisterRootListener();
    });
  });

  return (
    <>
      {showMenu() && (
        <Portal>
          <BlockMenu position={position()} nodeType={nodeData().type} selectType={selectType} close={closeMenu} />
        </Portal>
      )}
    </>
  );
}
