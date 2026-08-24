import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import { railButton } from '../layout/rail.ts';
import type { Content } from '../types.ts';

export interface PickerPopoverOptions {
  /**
   * The boolean `$local` that holds this picker open. **An ancestor must declare it.**
   *
   * Deliberately not private to this fragment. Two pickers side by side each owning their own flag
   * cannot see each other, so opening the second left the first up and the two overlapped. Whoever
   * places them is the only thing that knows they are a set, so that is where the state lives.
   */
  openLocal: string;
  /**
   * Sibling flags to clear whenever this one is toggled — the rest of the set.
   *
   * Cleared unconditionally *after* this one toggles, which is what makes it a correct toggle in
   * both directions. Doing it the other way round, or making either step conditional, runs into
   * event-handler arrays being resolved one entry at a time at call time: a later condition would
   * read the state an earlier entry had just written, and the button would only ever open.
   */
  closeOthers?: string[];
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
 * ## State
 *
 * `openLocal` comes from above, so a rail full of these can keep only one of them up at a time.
 * `pickerSearch` is declared here on the wrapper and is readable from `body` and `footer`; sibling
 * pickers do not collide over it, because each call returns its own wrapper to scope it to.
 *
 * A caller's rows clear `openLocal` themselves on select, and whether they should is a real choice
 * rather than boilerplate. Close when the result of the click is *behind* the surface that made it,
 * or somewhere else entirely — a picker left sitting over its own effect reads as a click that did
 * not land. Stay open when the effect is unmissable and the list is one people work through by
 * comparison: the theme picker repaints the whole window, itself included, so closing after each
 * try turned "look at three of these" into three round trips through the rail button.
 *
 * ## Why a backdrop rather than a document listener
 *
 * Dismissal has to be expressible as data. A full-bleed node that clears the flag on click is the
 * data spelling of "click outside to close"; the alternative lives in a `createEffect`, which is
 * what made this chrome code in the first place. The cost is that Escape does not close it —
 * a key needs a listener, and that belongs in a primitive rather than here.
 */
export function pickerPopover(opts: PickerPopoverOptions): SchemaNode {
  const open = { $local: opts.openLocal };
  const close = { $setLocal: opts.openLocal, value: false };

  return {
    type: 'Column',
    props: { position: 'relative' },
    $localState: {
      pickerSearch: { type: 'string', initial: '' },
    },
    children: [
      /*
        The same button the rest of the rail is made of — see `railButton`. It was written out here,
        which is how the picker triggers and the module launchers beside them came to be three
        separate spellings of one control.

        The tooltip goes opposite the surface: a picker opening to the left is a right-edge rail, and
        a tooltip on that side would be underneath what the click just opened.
      */
      railButton({
        icon: opts.icon,
        tooltip: opts.tooltip,
        active: open,
        tooltipPlacement: opts.side === 'right' ? 'right' : 'left',
        onClick: [
          { $toggleLocal: opts.openLocal },
          ...(opts.closeOthers ?? []).map((field) => ({ $setLocal: field, value: false })),
        ],
      }),

      // Catches the click that closes it. Fixed and full-bleed, and *before* the surface in document
      // order so the surface paints over it — both are in this wrapper's stacking context, so order
      // is the whole of the z-index story here.
      {
        type: '$if',
        props: {
          condition: open,
          then: {
            type: 'Column',
            props: { position: 'fixed', top: '0', right: '0', bottom: '0', left: '0', onClick: close },
          },
        },
      },

      {
        type: '$if',
        props: {
          condition: open,
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
              bg: 'surface-sunken',
              border: '1px solid border',
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
