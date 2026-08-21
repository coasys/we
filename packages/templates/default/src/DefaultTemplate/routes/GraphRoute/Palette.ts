import type { SchemaNode, SchemaProp } from '@we/schema-shared';

/**
 * The colours a board can be painted with, and the row that picks one.
 *
 * Shared between the card's own colour and the key's colour-per-type, because they are the same
 * choice made about different things — and a palette that drifted between the two would let somebody
 * colour a card in a shade no type could ever be given, so the key could never account for it.
 *
 * ## Why tokens rather than a colour picker
 *
 * A token keeps meaning the same thing when the theme changes; a hex chosen against a light theme is
 * a hole in a dark one. A board is a shared artifact that outlives whichever theme it was made
 * under, and every other colour in WE already answers to the theme — a card that did not would be
 * the one thing on screen that ignores it.
 *
 * The empty token is a *swatch*, not a Reset button beside them. It has to be pickable, because it
 * is the way back to being coloured by the rules — for a card, by its type; for a type, by the
 * board's defaults — and a control that can only ever add an override is a one-way door.
 */
export const SWATCHES = [
  { token: '' },
  { token: 'primary-100' },
  { token: 'primary-300' },
  { token: 'success-100' },
  { token: 'warning-100' },
  { token: 'danger-100' },
  { token: 'neutral-100' },
  { token: 'neutral-300' },
];

/**
 * A row of swatches, one of which is marked as current.
 *
 * `pick` is handed the token as a context reference rather than a value, because the row is one
 * `$each` over the palette: the caller says what picking *means* and the loop says which colour it
 * happened to. Both call sites end up writing to a store, one per card and one per type.
 */
export function swatchRow(options: { current: SchemaProp; pick: (token: string) => SchemaProp }): SchemaNode {
  return {
    type: 'Row',
    props: { gap: '200', ay: 'center', wrap: true, width: '100%' },
    children: [
      {
        type: '$each',
        props: { items: SWATCHES, as: 'swatch' },
        children: [
          {
            // `bare` rather than `ghost`: the swatch supplies its own affordance, and ghost's hover
            // background would paint a rectangle around each colour. Still a real button, so the
            // palette is reachable from the keyboard.
            type: 'we-button',
            props: {
              variant: 'bare',
              title: { $if: { condition: '$swatch.token', then: '$swatch.token', else: 'Default' } },
              onClick: options.pick('$swatch.token'),
            },
            children: [
              {
                type: 'Column',
                props: {
                  width: '22px',
                  height: '22px',
                  r: '200',
                  ax: 'center',
                  ay: 'center',
                  bg: { $if: { condition: '$swatch.token', then: '$swatch.token', else: 'surface' } },
                  border: {
                    $if: {
                      condition: { $eq: [options.current, '$swatch.token'] },
                      then: '2px solid primary-600',
                      else: '1px solid neutral-300',
                    },
                  },
                },
                children: [
                  // The default swatch has no colour to show, so it says so with a mark — otherwise
                  // it reads as white, which is a colour somebody might have meant to choose.
                  {
                    type: '$if',
                    props: {
                      condition: { $not: '$swatch.token' },
                      then: { type: 'we-icon', props: { name: 'x', size: 'xs', color: 'text-faint' } },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}
