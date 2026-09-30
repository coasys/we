/**
 * The editor's panels, as docks.
 *
 * ## Why they moved
 *
 * They were a second panel system. `RightPanelContainer` owned a rail per panel, each panel's width,
 * its open/close animation and its position at the right edge — while the shell owned exactly the
 * same things for module panels a few pixels away. Two arbiters at one edge, each reading a custom
 * property the other published: the editor offset itself by `--we-dock-right`, the shell offset docks
 * by `--we-editor-right`, and with both open they dodged each other into an overlap with a gap beside
 * it. Every fix for that class was another term in one of the two calculations.
 *
 * There is one arbiter now. The shell places these exactly as it places a call stage: a grip to drag
 * them by, eight snap targets, resize from any edge or corner, maximise, and a remembered position
 * per device. What stays in `@we/editor` is the only part that was ever editor-specific — what goes
 * *inside* each panel.
 *
 * ## Why the rails went with them
 *
 * Each panel had a 32px strip of icon on its left, which both toggled it and resized it. The resize
 * half is the dock frame's now, and it works on every edge rather than one. The toggle half moved to
 * the editing bar, beside the mode and history controls — where the other things you do to a session
 * already are, and where a control is visible before its panel is open rather than being a sliver at
 * the edge of the screen.
 *
 * ## Registered here rather than contributed
 *
 * A module registers docks through `defineModule`. The editor is not a module — it is host chrome, in
 * a package the shell already mounts directly — so its docks are registered alongside the core slots,
 * and their keys resolve against `hostDockStores.editor` rather than a module store.
 */
import type { SchemaNode } from '@we/schema-shared';

import { dockFrame, dockRegistry } from './dockRegistry';
import { slotRegistry } from './slotRegistry';

/** The id every editor dock reads its keys from. See `hostDockStores`. */
export const EDITOR_STORE_ID = 'editor';

/**
 * One panel: its component, and the store keys the host reads to place it.
 *
 * `open` is the whole of a panel's own state now. Where it sits, how big it is and whether it takes
 * room are the user's, held by the shell, remembered per device — so a panel that was dragged to the
 * left edge and made to displace content opens there again next time, with nothing in this package
 * aware that it did.
 */
interface EditorDock {
  id: string;
  component: string;
  /** Key on `editorStore` returning the edge to open at, or null while the panel is closed. */
  edge: string;
  /** Key on `editorStore` that closes it — the host's titlebar button. */
  close: string;
  order: number;
}

const PANELS: EditorDock[] = [
  // Properties first, then code, then chat — the order they were in at the right edge, which is also
  // roughly how close each one is to the thing being edited.
  // The inspector closes by toggling, which has no separate close: the button only exists on a
  // titlebar, and a panel with a titlebar is open by definition.
  {
    id: 'editor:inspector',
    component: 'EditorInspectorPanel',
    edge: 'visualDockEdge',
    close: 'toggleVisualPanel',
    order: 20,
  },
  { id: 'editor:code', component: 'EditorCodePanel', edge: 'codeDockEdge', close: 'closeCodePanel', order: 21 },
  { id: 'editor:ai', component: 'AiPanel', edge: 'aiDockEdge', close: 'close', order: 22 },
  { id: 'editor:theme', component: 'EditorThemePanel', edge: 'themeDockEdge', close: 'closeThemePanel', order: 23 },
];

/**
 * Register the editor's panels as docks.
 *
 * Called once at start-up, beside `registerCoreSlots`. The nodes are plain schema — a component name
 * and nothing else — because the frame around them, and every gesture that moves or sizes them, is
 * the host's.
 */
export function registerEditorDocks(): void {
  for (const panel of PANELS) {
    const node: SchemaNode = { type: panel.component };
    dockRegistry.register({
      id: panel.id,
      moduleId: EDITOR_STORE_ID,
      edge: panel.edge,
      size: 'editorDockSize',
      float: 'editorDockFloat',
      close: panel.close,
      // Not a module, so its store is not under `modules.<id>` — see `DockEntry.storeRef`.
      storeRef: 'editorStore',
      node,
      order: panel.order,
    });
    slotRegistry.register({
      anchor: 'dock-right',
      order: panel.order,
      id: `dock:${panel.id}`,
      node: dockFrame(dockRegistry.get(panel.id)!, node),
    });
  }
}
