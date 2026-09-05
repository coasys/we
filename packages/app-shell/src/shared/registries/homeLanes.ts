/**
 * The `$panels` outlets on screen — where a template has said sections may live.
 *
 * A home lane is a lane in the template's own flow, and the shell has to know where each one is for
 * the same reason it knows where every edge is: to offer it as a place to drop a panel. An edge is
 * geometry the shell computes; an outlet is an element the template rendered, so the outlet says
 * where it is by registering itself, and the shell measures it while a drag is on.
 *
 * Its own registry rather than `dockRegistry`, because an outlet is not a dock — it holds docks. Its
 * own change channel rather than `createRegistry`'s, because nothing reactive hangs off *which*
 * outlets exist: they are only ever read during a drag, when the store measures whatever is there.
 */

export interface HomeLane {
  /** Its name, as `meta.panels` entries name it in `home`. */
  lane: string;
  /** The element the sections are laid out in, for measuring where its seams are. */
  el: HTMLElement;
  /** Which way the sections run — down a column, or across a row. */
  direction: 'column' | 'row';
  /**
   * Which sections it will take, by panel id. Empty means any.
   *
   * What lets a sidebar refuse the feed. The same shape `we-drop-zone` gives `accepts`, and for the
   * same reason: a template writing `"accepts": "trending,people"` needs no expression.
   */
  accepts: readonly string[];
}

const lanes = new Map<string, HomeLane>();

/** Publish an outlet. Returns the unregister. Re-registering a name replaces it. */
export function registerHomeLane(entry: HomeLane): () => void {
  lanes.set(entry.lane, entry);
  return () => {
    if (lanes.get(entry.lane) === entry) lanes.delete(entry.lane);
  };
}

/** Every outlet on screen. */
export function homeLanes(): HomeLane[] {
  return [...lanes.values()];
}

/** The attribute the outlet puts on each section's box, so its seams can be measured. */
export const HOME_SECTION_ATTR = 'data-we-section';
