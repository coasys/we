/**
 * Z-INDEX TOKEN DEFINITIONS
 * Defines named stacking layers for the design system.
 *
 * Layer ordering (low → high):
 *   dropdown → sticky → modal → popover → toast → tooltip
 *
 * Usage:
 *   - `dropdown`: Dropdowns, selects, autocomplete menus (page-level)
 *   - `sticky`:   Sticky headers/footers
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
 */

export type ZIndexLayer = 'dropdown' | 'sticky' | 'modal' | 'popover' | 'toast' | 'tooltip';
export type ZIndexValue = ZIndexLayer | number | (string & {});

export const zIndex = {
  dropdown: '100',
  sticky: '200',
  modal: '300',
  popover: '400',
  toast: '500',
  tooltip: '600',
} satisfies Record<ZIndexLayer, string>;
