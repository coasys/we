/**
 * Which docks a space is allowed to hide.
 *
 * ## The category error this exists to prevent
 *
 * `ShellStore` gates every dock request on "is this module active in this space?", answered by
 * `SpaceStore` from `activeModules`. That is right for module chrome — a notes panel should not
 * reserve 400px in a space that has not enabled notes — and it is the fix for a real bug, where a
 * module's dock *frame* unmounted on a space switch and its *request* did not, so `contentInset`
 * went on reserving room for a panel that was no longer on screen.
 *
 * But `DockEntry.moduleId` is a **store** id, not necessarily a module id. Host chrome registers
 * docks under `hostDockStores` keys: `shell` for the space-settings panel, `editor` for the AI,
 * code, theme and inspector panels. Asking "is the module `shell` enabled here?" is a question with
 * no true answer, and the gate says no — which took the settings panel and all four editor panels
 * off the screen entirely. No edge, no geometry, and the button that opens them silently doing
 * nothing.
 *
 * ## Why a function rather than a condition in the memo
 *
 * Because the condition in the memo could not be tested. The first attempt at this fix shipped with
 * a test that pinned the *premise* — that `shell` and `editor` are not module ids — and the suite
 * stayed green with the bug put back, which is the failure mode this whole audit is about. The
 * decision has to be somewhere a test can call it.
 *
 * `isModule` is injected rather than imported so this file needs no registry, and therefore cannot
 * join the `slotRegistry` ↔ `editorDocks` import cycle that already exists next door.
 */

/**
 * Whether this dock should be offered at all.
 *
 * Host chrome always shows: it is not a module, so nothing about the space's module settings has
 * anything to say about it. Module chrome shows when the gate says the module is active here —
 * which includes `holdsWhen`, the escape hatch that keeps a call's bar in a space that never
 * enabled calls.
 *
 * Discriminated by *presence in the module registry* rather than by a list of host ids, so a host
 * surface added later is right by default rather than by remembering to add it here.
 */
export function dockIsOffered(
  moduleId: string,
  isModule: (id: string) => boolean,
  gate: (id: string) => boolean,
): boolean {
  return isModule(moduleId) ? gate(moduleId) : true;
}
