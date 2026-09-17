/**
 * The datasets the host makes for itself, named once.
 *
 * ## Two of them are the agent's, and they hold different things
 *
 * - **`we-root`** is the app's configuration: settings, installed templates and themes, per-space
 *   preferences, read markers, the mute list. Everything in it is rebuilt or re-derivable, and the
 *   host treats it that way — its schema is reinstalled on every boot, and a repair or a reset is
 *   free to touch it.
 * - **`we-personal`** is what this agent *made or kept*: notes, the Pocket. It carries the ordinary
 *   space schema, so the composer, the card renderer, search and file storage work there unchanged,
 *   and nothing that repairs configuration ever reaches it. It is also the one to publish, when
 *   somebody's own things should follow them between devices, without their per-machine settings
 *   coming too.
 *
 * Neither is a space anyone else can see, and neither belongs in the sidebar.
 *
 * `we-test` is the development sandbox.
 *
 * The names were literals in five places, in three of which the list was quietly different — the
 * sidebar ordering knew about `we-global`, the space loader did not know about `we-test`. One list
 * is what makes a new system dataset a change here rather than a hunt.
 */

export const SYSTEM_DATASET_NAMES = {
  root: 'we-root',
  personal: 'we-personal',
  test: 'we-test',
} as const;

/** Every dataset the host creates for itself — none of them a space, none of them listed as one. */
export const SYSTEM_DATASETS: readonly string[] = Object.values(SYSTEM_DATASET_NAMES);

/** Whether a dataset, by name, is one the host made for itself rather than a space. */
export const isSystemDataset = (name: string | undefined): boolean => !!name && SYSTEM_DATASETS.includes(name);
