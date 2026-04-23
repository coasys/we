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
