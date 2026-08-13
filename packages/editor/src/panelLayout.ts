/**
 * Rail geometry and the resize flag, kept apart from the panels themselves.
 *
 * The shell needs these on every render: `TemplateLayout` sizes the canvas around the rails, and
 * both it and `PersistentAppFrames` disable CSS transitions while a drag is in progress. They used
 * to live in `RightPanelContainer`, which imports every panel — so reading a width pulled CodeMirror
 * and Prism into the first bytes of the app. Nothing here imports a panel, which is the point.
 */
import { createSignal } from 'solid-js';

import type { SessionPort } from './host';

export const RAIL_STRIP_WIDTH = 32; // px per strip
export const TOTAL_RAIL_WIDTH = RAIL_STRIP_WIDTH * 3; // all three strips (used by TemplateLayout)
export const TEMPLATE_RAILS_WIDTH = RAIL_STRIP_WIDTH * 2; // code + AI strips only
export const THEME_RAIL_WIDTH = RAIL_STRIP_WIDTH; // theme strip only

/**
 * The custom property the editor publishes its own width on, for chrome it does not know about.
 *
 * The shell's rail sits at the same edge as the editor's panels and has no path to this package's
 * state — the same problem `--we-chrome-transition` solves in the other direction. Without it the
 * rail is simply painted over when editing starts, which is the bug the rail move exists to fix.
 */
export const EDITOR_WIDTH_VAR = '--we-editor-right';

/**
 * True while any panel rail is being dragged to resize. Module-level so TemplateLayout and the
 * editing bar can disable their CSS transitions during drag, keeping the canvas edge in sync
 * with the panel edge.
 */
export const [panelResizing, setPanelResizing] = createSignal(false);

/**
 * How much of the right edge the editor is currently occupying, in pixels.
 *
 * Zero when neither mode is active, because `RightPanelContainer` translates itself off the edge
 * then — the strips exist in the DOM but not on screen, and chrome positioned against a width that
 * counted them would sit in a gap.
 *
 * Shared rather than computed twice: the editing bar positions itself beside these panels and the
 * shell's rail is pushed clear of them, and the two drifting apart is exactly how the toolbar ended
 * up overlapping the thing it was meant to sit next to.
 */
export function editorOccupiedWidth(session: SessionPort): number {
  let width = 0;

  if (session.isEditingTheme()) {
    width += THEME_RAIL_WIDTH;
    if (session.themePanelOpen()) width += session.themePanelWidth();
  }

  if (session.isEditingTemplate()) {
    width += TEMPLATE_RAILS_WIDTH;
    if (session.codePanelOpen()) width += session.codePanelWidth();
    if (session.isOpen()) width += session.aiPanelWidth();
    if (session.contentMode() === 'visual') {
      width += RAIL_STRIP_WIDTH;
      if (session.visualPanelOpen()) width += session.visualPanelWidth();
    }
  }

  return width;
}
