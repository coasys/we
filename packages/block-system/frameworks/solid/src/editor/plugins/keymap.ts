/**
 * The composer's keyboard, in one place.
 *
 * Block behaviours first (lists, selected blocks, indentation), then the marks, then history, then
 * ProseMirror's base keymap for everything else — chained so the first command that handles a key
 * wins. The base keymap already moves the caret onto a selectable block with the arrow keys and
 * removes a selected block with Backspace/Delete; what it does not know is WE's list model, which
 * is where most of this file goes.
 */
import { chainCommands, joinBackward, selectNodeBackward, toggleMark } from 'prosemirror-commands';
import { baseKeymap } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Schema } from 'prosemirror-model';
import type { Command, Plugin } from 'prosemirror-state';

import {
  deleteSelectedNode,
  liftToParagraph,
  paragraphAfterSelectedNode,
  shiftLevel,
  splitListItem,
} from '../commands';

export interface KeymapHooks {
  /** Mod-K: open the link prompt for the current selection. */
  requestLink?: () => void;
}

export function composerKeymap(schema: Schema, hooks: KeymapHooks = {}): Plugin {
  const link: Command = () => {
    hooks.requestLink?.();
    return !!hooks.requestLink;
  };
  return keymap({
    Enter: chainCommands(paragraphAfterSelectedNode, splitListItem),
    Backspace: chainCommands(deleteSelectedNode, liftToParagraph, joinBackward, selectNodeBackward),
    Delete: deleteSelectedNode,
    Tab: shiftLevel(1),
    'Shift-Tab': shiftLevel(-1),
    'Mod-b': toggleMark(schema.marks.strong),
    'Mod-i': toggleMark(schema.marks.em),
    'Mod-u': toggleMark(schema.marks.underline),
    'Mod-Shift-s': toggleMark(schema.marks.strike),
    'Mod-e': toggleMark(schema.marks.code),
    'Mod-k': link,
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
  });
}

/**
 * The keys of a composer that is one line — see `compact` on the composer's props. Enter sends;
 * Shift+Enter breaks the line where the caret is, inside the same block, which is the only way a line
 * holds more than one.
 */
export function compactKeymap(schema: Schema, submit: () => boolean): Plugin {
  const lineBreak: Command = (state, dispatch) => {
    dispatch?.(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
    return true;
  };
  return keymap({ Enter: () => submit(), 'Shift-Enter': lineBreak });
}

export function baseKeymapPlugin(): Plugin {
  return keymap(baseKeymap);
}
