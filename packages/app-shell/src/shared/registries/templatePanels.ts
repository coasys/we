/**
 * The panels the interface on screen has declared — what a template asked for, before the host has
 * decided anything about it.
 *
 * ## Why this is not `hostDockStores`
 *
 * A template is data. It cannot register anything, cannot publish a store, and does not know the
 * viewport — so the layer that *mounts* it reads `meta.panels` and puts the declaration here, and
 * the shell reads it back. The same shape `registerHostChromeReserve` uses one level down.
 *
 * ## Why its own change channel
 *
 * `dockRegistry.announce` is what the shell's geometry memo depends on. If declaring a panel
 * announced there, the effect that turns a declaration *into* dock entries would re-run itself
 * forever: register → announce → re-read declarations → register. So declarations change on this
 * channel and registrations on that one, and the loop cannot close.
 */
import type { TemplatePanel } from '@we/schema-shared';

let declared: readonly TemplatePanel[] = [];

/**
 * Which interface the current declaration belongs to — the scope a placement is remembered under.
 *
 * A drag is a fact about *this panel in this interface*, not about the panel everywhere. Without a
 * scope the transcript dragged while trying out one template kept that position under every other
 * one, and silently outranked whatever the next template declared for it — which reads as the
 * declaration being ignored rather than as an older preference winning.
 */
let scope = '';

const listeners = new Set<() => void>();

/** Subscribe to declaration changes. Returns an unsubscribe. */
export function onTemplatePanelsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Publish what the interface on screen declares.
 *
 * Replaces wholesale rather than merging: the declaration *is* the list, so a template that drops a
 * panel has to be able to say so. Called with an empty array when nothing declares any.
 */
export function setTemplatePanels(panels: readonly TemplatePanel[] | undefined, from = ''): void {
  const next = panels ?? [];
  // A template re-rendering with the same declaration must not re-announce: every announcement
  // rebuilds dock entries, and rebuilding them mid-drag would drop the drag.
  if (from === scope && next.length === declared.length && next.every((panel, i) => panel === declared[i])) return;
  declared = next;
  scope = from;
  for (const listener of listeners) listener();
}

/**
 * The layouts holding the declaration — what decides when it is withdrawn.
 *
 * A layout that leaves used to clear the declaration outright, and a layout leaving is very often a
 * layout being *replaced*: the router remounts everything under it when a space's views arrive, a few
 * seconds after a boot. Clearing in between left a moment with nothing declared, in which a panel
 * placed in a template's lane stopped being declared there — space settings dropped out of the
 * Coasys inspector lane to the window's edge, the lane folded, and both came back a moment later,
 * reading as the panel vanishing and sliding in again.
 *
 * So a layout holds the declaration while it is mounted and lets go when it leaves, and it is cleared
 * only if nobody has taken it up again once the current update has finished.
 */
let holders = 0;

/** Hold the declaration while mounted. The returned release lets go of it — see {@link holders}. */
export function holdTemplatePanels(): () => void {
  holders++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders--;
    queueMicrotask(() => {
      if (holders === 0) setTemplatePanels([], '');
    });
  };
}

/** The interface the declaration came from. See {@link scope}. */
export function templatePanelScope(): string {
  return scope;
}

/** What the interface on screen declares, in declaration order. */
export function templatePanels(): readonly TemplatePanel[] {
  return declared;
}

/** The id a template panel's dock is registered under — namespaced so it cannot collide with a module's. */
export function templatePanelDockId(panelId: string): string {
  return `template:${panelId}`;
}

/**
 * The store id those docks read their keys from.
 *
 * One store for every template panel, with per-panel keys, because `DockEntry` names its keys as
 * strings and the set of panels is not known until a template says so. See `hostDockStores`.
 */
export const TEMPLATE_DOCK_STORE_ID = 'template-panels';
