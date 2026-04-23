import { $getSelection, $isRangeSelection, COMMAND_PRIORITY_EDITOR } from 'lexical';
import { useLexicalComposerContext } from 'lexical-solid';
import { createEffect, onCleanup } from 'solid-js';

import { INSERT_BLOCK_COMMAND } from '../../helpers';
import { blockNodeClassMap } from '../../nodes';
import { $createBlockNode } from '../../nodes/createBlockNodeClass';

/**
 * Generic block insertion plugin. Listens for INSERT_BLOCK_COMMAND and
 * inserts a factory-created decorator node at the current selection.
 * Replaces the old ImageBlockPlugin.
 */
export default function BlockInsertPlugin() {
  const [editor] = useLexicalComposerContext();

  createEffect(() => {
    const unregister = editor.registerCommand(
      INSERT_BLOCK_COMMAND,
      (payload) => {
        const NodeClass = blockNodeClassMap[payload.type];
        if (!NodeClass) return false;

        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            const node = $createBlockNode(NodeClass, payload.props ?? {});
            selection.insertNodes([node]);
          }
        });
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    onCleanup(unregister);
  });

  return null;
}
