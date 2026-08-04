/**
 * Rail geometry and the resize flag, kept apart from the panels themselves.
 *
 * The shell needs these on every render: `TemplateLayout` sizes the canvas around the rails, and
 * both it and `PersistentAppFrames` disable CSS transitions while a drag is in progress. They used
 * to live in `RightPanelContainer`, which imports every panel — so reading a width pulled CodeMirror
 * and Prism into the first bytes of the app. Nothing here imports a panel, which is the point.
 */
import { createSignal } from 'solid-js';

export const RAIL_STRIP_WIDTH = 32; // px per strip
export const TOTAL_RAIL_WIDTH = RAIL_STRIP_WIDTH * 3; // all three strips (used by TemplateLayout)
export const TEMPLATE_RAILS_WIDTH = RAIL_STRIP_WIDTH * 2; // code + AI strips only
export const THEME_RAIL_WIDTH = RAIL_STRIP_WIDTH; // theme strip only

/**
 * True while any panel rail is being dragged to resize. Module-level so TemplateLayout and
 * DesignToolbar can disable their CSS transitions during drag, keeping the canvas edge in sync
 * with the panel edge.
 */
export const [panelResizing, setPanelResizing] = createSignal(false);
