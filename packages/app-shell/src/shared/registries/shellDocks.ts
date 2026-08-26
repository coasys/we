/**
 * The shell's own panels, as docks.
 *
 * One so far: a space's settings. It is here rather than in `slotRegistry`'s body for the reason
 * `editorDocks.ts` is — a dock is a contract of four store keys and a node, and reading that beside
 * fifteen `slotRegistry.register` calls hides which of them takes room from the app.
 *
 * ## Registered rather than contributed
 *
 * A feature module declares `docks` through `defineModule` and the host wires them up. The shell is
 * not a module — it is the thing modules plug into — so its dock is registered directly, and its
 * keys resolve against `hostDockStores.shell` rather than a module store. Exactly the arrangement
 * the editor's four panels already use; see {@link registerEditorDocks}.
 *
 * ## Why space settings is the shell's and not a module's
 *
 * Because it is the way *back*. It holds the controls that turn modules on, choose the template and
 * pick the theme, so a deployment where it could be uninstalled is one where a space can be
 * configured into a state with no way out of it. Same argument the chrome rail's own docblock makes
 * about the gear being outside the launcher list.
 */
import { spaceSettingsPanel } from '@we/template-shell';

import { dockFrame, dockRegistry } from './dockRegistry';
import { slotRegistry } from './slotRegistry';

/** The id the shell's docks read their keys from. See `hostDockStores`. */
export const SHELL_DOCK_STORE_ID = 'shell';

/** Unique across every dock, module-contributed ones included. */
export const SPACE_SETTINGS_DOCK_ID = 'shell:space-settings';

/**
 * Register the shell's panels as docks.
 *
 * Called from `registerCoreSlots`. The order puts this after the editor's panels and before the
 * chrome rail, which is where it belongs on the right edge: the rail is chrome the panels slide,
 * and a dock's `order` decides only how two panels on one edge break a tie.
 *
 * No `size` key, so the host's `md` applies — 440px, the width every other docked panel opens at.
 * No `float` key either, so it opens displacing: settings are read *alongside* the space they
 * configure, which is the case docking exists for and the whole point of not being an overlay.
 */
export function registerShellDocks(): void {
  dockRegistry.register({
    id: SPACE_SETTINGS_DOCK_ID,
    moduleId: SHELL_DOCK_STORE_ID,
    edge: 'spaceSettingsEdge',
    close: 'closeSpaceSettings',
    // Not a module, so its store is not under `modules.<id>` — see `DockEntry.storeRef`.
    storeRef: 'shellStore',
    node: spaceSettingsPanel,
    order: 24,
  });
  slotRegistry.register({
    anchor: 'dock-right',
    order: 24,
    id: `dock:${SPACE_SETTINGS_DOCK_ID}`,
    node: dockFrame(dockRegistry.get(SPACE_SETTINGS_DOCK_ID)!, spaceSettingsPanel),
  });
}
