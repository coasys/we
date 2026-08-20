/**
 * Z-INDEX TOKEN DEFINITIONS
 * Defines named stacking layers for the design system.
 *
 * Layer ordering (low → high):
 *   dropdown → sticky → chrome → modal → popover → toast → tooltip
 *
 * Usage:
 *   - `dropdown`: Dropdowns, selects, autocomplete menus (page-level)
 *   - `sticky`:   Sticky headers/footers, and a module's docked panel
 *   - `chrome`:   The app's own persistent rails and bars
 *   - `modal`:    Modal backdrop + content, drawers, sidebars
 *   - `popover`:  Popovers, block handles, in-modal floating UI
 *   - `toast`:    Toast notifications
 *   - `tooltip`:  Tooltips (always on top)
 *
 * Components inside a modal that portal to document.body should use `popover`,
 * not `dropdown`, so they render above the modal layer.
 *
 * That last rule only holds where the modal is stacked by z-index at all. `we-modal` and everything
 * else built on `OverlayElement` promote themselves into the browser's **top layer** with
 * `popover="manual"`, which sits above every z-index there is — so a body-appended overlay cannot
 * be raised over one by picking a bigger token. It has to join the top layer too, by being shown as
 * a popover itself (see `promoteToTopLayer` in `we-sortable`, where a drag ghost and drop indicator
 * were painting behind the dialog they were dragging in).
 *
 * The panels that used to depend on these tokens no longer do: `we-select`, `we-date-picker`,
 * `we-icon-picker` and `we-popover` all float through `openFloatingPanel`, which promotes them the
 * same way. Their `dropdown` values are a fallback for runtimes without the Popover API, not the
 * mechanism. Reach for a token here only for something that genuinely stacks *within* the page.
 */

export type ZIndexLayer = 'dropdown' | 'sticky' | 'chrome' | 'modal' | 'popover' | 'toast' | 'tooltip';
export type ZIndexValue = ZIndexLayer | number | (string & {});

export const zIndex = {
  dropdown: '100',
  sticky: '200',
  /*
    Chrome that is always there, above panels that come and go.

    The rule a docked panel and a shell rail need between them, and the one the ladder could not
    state: `sticky` holds both sticky page furniture and a module's docked panel, so a rail wanting
    to stay reachable above one had nothing to ask for. The shell sidebar sat below at a bare `10`
    and lost — docking the call stage on the left left the sidebar's hover-expansion opening
    *behind* the video, which is where this came from.

    Not decoration: chrome is how you get out of whatever a panel is showing you. Docks are placed
    by the host rather than by the modules that own them, so nothing else is in a position to keep
    that true — the right edge does it by sliding the rail inwards out of the panel's way, and this
    is the same statement for chrome that cannot move.
  */
  chrome: '250',
  modal: '300',
  popover: '400',
  toast: '500',
  tooltip: '600',
} satisfies Record<ZIndexLayer, string>;
