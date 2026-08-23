import type { SchemaNode } from '@we/schema-shared';

/**
 * The second door into a space's settings — the first being the spaces list in chrome.
 *
 * This template used to carry a whole `/settings` section of its own, which put a space's
 * configuration inside the very thing being configured. That is fine until the template is the thing
 * you want to change: a community that installs a shell offering no settings page would have had no
 * way back. With sections installable, that stops being a hypothetical and becomes the common case.
 *
 * So the page moved out to chrome, where it exists for every space including one whose template
 * never thought to provide it, and this is the shortcut back to it. `openShellView` takes a path
 * *inside* the overlay's own memory router, so the same page opens already keyed to the space you
 * are standing in — one page, two ways in, and the browser URL is untouched either way.
 *
 * A gear rather than a labelled tab, and outside the section strip rather than the last item in it:
 * the sections are places in the space, and settings is not one. Putting it back in the list would
 * re-create the thing the section list is now free of — a fixed entry no community can remove,
 * reorder, or replace.
 */
export const spaceSettingsButton: SchemaNode = {
  type: 'we-button',
  props: {
    variant: 'ghost',
    square: true,
    title: 'Space settings',
    // `/space/:spaceId/...` — segment 1 is the space, the same one the section strip reads segment 2
    // of. Built with `$concat` because `$action` args resolve tokens but do not interpolate strings.
    onClick: {
      $action: 'shellStore.openShellView',
      args: ['settings', { $concat: ['/spaces/', { $store: 'routeStore.segments.1' }] }],
    },
  },
  children: [{ type: 'we-icon', props: { name: 'gear' } }],
};
