import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import type { Content } from '../types.ts';

export interface PickerPopoverOptions {
  /** The rail button's icon. */
  icon: SchemaProp;
  tooltip: string;
  searchPlaceholder: string;
  /**
   * The grouped rows, written by the caller.
   *
   * Deliberately not an option: templates arrive pre-grouped from one store array, themes as three
   * separate ones, and a `groups` option able to describe both would be two shapes behind one name.
   * The chrome around the list is what repeated, so the chrome is what this owns.
   *
   * Filter against `{ $local: 'pickerSearch' }` — declared here, readable from anywhere inside.
   */
  body: Content;
  /** Actions below the list, off the end of the scroll area — "New", a scope toggle. */
  footer?: Content;
  /** Which side of the trigger the surface opens on. Defaults to `left`, for a right-edge rail. */
  side?: 'left' | 'right';
  width?: string;
}

/**
 * A rail button, and the picker that opens beside it.
 *
 * Replaces the two dropdowns that hung off the old design toolbar's chips. They were the same
 * surface written twice and had already diverged in a way that mattered: the template list scrolled
 * with `we-scroll-area`, while the theme list set `overflowY`, which is not a design-system prop —
 * so a long theme list simply overflowed its box. One surface, one scroll area, one bug fewer.
 *
 * ## What it declares
 *
 * `$localState` on the wrapper, so both are readable from `body` and `footer`:
 * - `pickerOpen` (boolean) — the surface is up. Toggled by the trigger, cleared by the backdrop.
 * - `pickerSearch` (string) — what is typed in the search box.
 *
 * Sibling pickers do not collide: each call returns its own wrapper, and `$localState` scopes to it.
 * A caller's rows should clear `pickerOpen` themselves on select — a picker that stays open over the
 * change it just made reads as a click that did not land.
 *
 * ## Why a backdrop rather than a document listener
 *
 * Dismissal has to be expressible as data. A full-bleed node that clears the flag on click is the
 * data spelling of "click outside to close"; the alternative lives in a `createEffect`, which is
 * what made this chrome code in the first place. The cost is that Escape does not close it —
 * a key needs a listener, and that belongs in a primitive rather than here.
 */
export function pickerPopover(opts: PickerPopoverOptions): SchemaNode {
  const close = { $setLocal: 'pickerOpen', value: false };

  return {
    type: 'Column',
    props: { position: 'relative' },
    $localState: {
      pickerOpen: { type: 'boolean', initial: false },
      pickerSearch: { type: 'string', initial: '' },
    },
    children: [
      {
        type: 'we-tooltip',
        props: { title: opts.tooltip, placement: opts.side === 'right' ? 'right' : 'left' },
        children: [
          {
            type: 'we-button',
            props: {
              variant: { $if: { condition: { $local: 'pickerOpen' }, then: 'secondary', else: 'ghost' } },
              square: true,
              onClick: { $toggleLocal: 'pickerOpen' },
            },
            children: [{ type: 'we-icon', props: { name: opts.icon } }],
          },
        ],
      },

      // Catches the click that closes it. Fixed and full-bleed, and *before* the surface in document
      // order so the surface paints over it — both are in this wrapper's stacking context, so order
      // is the whole of the z-index story here.
      {
        type: '$if',
        props: {
          condition: { $local: 'pickerOpen' },
          then: {
            type: 'Column',
            props: { position: 'fixed', top: '0', right: '0', bottom: '0', left: '0', onClick: close },
          },
        },
      },

      {
        type: '$if',
        props: {
          condition: { $local: 'pickerOpen' },
          enterTransition: [
            { type: 'fade', duration: 120 },
            { type: 'scale', duration: 120 },
          ],
          then: {
            type: 'Column',
            props: {
              position: 'absolute',
              top: '0',
              ...(opts.side === 'right' ? { left: '100%', ml: '200' } : { right: '100%', mr: '200' }),
              minWidth: opts.width ?? '300px',
              bg: 'neutral-0',
              border: '1px solid neutral-200',
              r: 'var(--we-theme-surface-radius, var(--we-radius-400))',
              shadow: 'md',
              overflow: 'hidden',
            },
            children: [
              {
                type: 'Search',
                props: {
                  placeholder: opts.searchPlaceholder,
                  value: { $local: 'pickerSearch' },
                  onSearch: { $setLocal: 'pickerSearch', from: '$arg' },
                  m: '200',
                },
              },
              { type: 'we-divider' },
              {
                type: 'we-scroll-area',
                props: { maxHeight: '320px' },
                children: [{ type: 'Column', props: { p: '200', gap: '100' }, children: [opts.body] }],
              },
              ...(opts.footer
                ? [{ type: 'we-divider' }, { type: 'Column', props: { p: '200', gap: '100' }, children: [opts.footer] }]
                : []),
            ],
          },
        },
      },
    ],
  };
}
