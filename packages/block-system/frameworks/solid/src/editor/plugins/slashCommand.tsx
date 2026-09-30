/**
 * `/` in an empty text block opens the block-type menu for that block.
 */
import { Plugin } from 'prosemirror-state';

import type { EditorContext } from '../context';

export function slashCommandPlugin(ctx: EditorContext): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return false;
        const { $from, empty } = view.state.selection;
        if (!empty || !$from.parent.isTextblock || $from.parent.content.size > 0) return false;
        const pos = $from.before();
        const dom = view.nodeDOM(pos) as HTMLElement | null;
        if (!dom) return false;
        event.preventDefault();
        const rect = dom.getBoundingClientRect();
        ctx.openBlockMenu(pos, { top: rect.bottom + 5, left: rect.left });
        return true;
      },
    },
  });
}
