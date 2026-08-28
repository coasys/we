/**
 * What the composer's chrome shares.
 *
 * Node views are rendered into their own Solid roots (ProseMirror hands the editor a DOM element
 * per node; Solid's `render` mounts into it), so they cannot reach the composer's component tree
 * through context. Everything a node view or an overlay needs is carried explicitly in one object
 * the composer builds once: the view, a version signal that ticks on every transaction, the block
 * wrapper the pointer last went down in (so a block whose input has focus can show its toolbar
 * without the editor's selection moving into it), the host's dataset and mention source, and the
 * display overrides in force.
 */
import type { MentionCandidate } from '@we/block-shared';
import type { EditorView } from 'prosemirror-view';
import type { Accessor, Component } from 'solid-js';

export interface EditorContext {
  /** The live view, once mounted. */
  view: Accessor<EditorView | null>;
  /** Bumped on every transaction — what overlays re-read the state on. */
  version: Accessor<number>;
  /** The `.we-block` element the pointer last went down inside, for blocks that hold focusable inputs. */
  activeDom: Accessor<HTMLElement | null>;
  /** Who can be mentioned here. */
  mentions: Accessor<MentionCandidate[]>;
  /** Display-component overrides in force where the composer mounted. */
  displayOverrides: Record<string, Component<Record<string, unknown>>>;
  /** Open the block-type menu for the block at `pos`, anchored at viewport coordinates. */
  openBlockMenu: (pos: number, anchor: { top: number; left: number }) => void;
  /** Open the link prompt for the current selection. */
  requestLink: () => void;
}
