/**
 * The one thing left of the editor's own panel layout: whether a drag is in progress.
 *
 * Everything else here — rail widths, the editor's occupied width, and the custom property it
 * published so the shell's chrome could dodge it — went when the panels became docks. The shell owns
 * where they sit and how wide they are, and publishes `--we-dock-right` for chrome to clear, so the
 * editor no longer describes its own geometry to anybody.
 *
 * This flag stays because `EditorOverlay` suspends its own hit-testing while something is being
 * dragged, and it has no path to the shell's store.
 */
import { createSignal } from 'solid-js';

export const [panelResizing, setPanelResizing] = createSignal(false);
