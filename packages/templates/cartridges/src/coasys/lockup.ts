import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { RAIL_REVEAL } from '@we/template-kit';

/**
 * The Coasys mark and name, drawn the same on the sign-in screen and at the top of the rail.
 *
 * Signing in takes the sign-in screen away from over the app, so the two marks are seen one after
 * the other in the same corner. Drawn apart, they disagreed by six pixels in size and twenty-six in
 * place, and the mark jumped as the screen faded. Here the rail's closed width decides where the mark
 * sits: centred in a band as tall as the rail is wide, which on the rail is centred in its corner.
 * The sign-in screen draws the same band, with the name always beside the mark; the rail shows the
 * name only while it is open, arriving the way the rail's own labels do.
 */

/** The rail's width when closed — and so the band the mark is centred in, both ways. */
export const COLLAPSED = '72px';

const MARK = '28px';

/**
 * The band: the mark, then the name. Not centred but inset from the start by what centres the mark
 * in a closed rail, so opening the rail adds the name without moving the mark.
 */
export function lockup(opts: {
  alt: string;
  /** Always beside the mark, or only while something holds — the rail's being open. */
  name: 'always' | { while: SchemaProp };
  /** More for the band itself: a press, a width. */
  props?: Record<string, SchemaProp>;
}): SchemaNode {
  const name: SchemaNode = {
    type: 'we-text',
    props: { variant: 'body', fontWeight: 'semibold', letterSpacing: 'tight', truncate: true },
    children: [{ $: 'templateStore.brand.name' }],
  };
  return {
    type: 'Row',
    props: {
      height: COLLAPSED,
      flex: '0 0 auto',
      ay: 'center',
      gap: '300',
      pl: `calc((${COLLAPSED} - ${MARK}) / 2)`,
      minWidth: '0',
      ...opts.props,
    },
    children: [
      {
        type: 'we-image',
        props: { src: { $: 'templateStore.brand.mark' }, alt: opts.alt, width: MARK, height: MARK, flexShrink: 0 },
      },
      opts.name === 'always'
        ? name
        : {
            type: '$if',
            props: {
              condition: opts.name.while,
              enterTransition: RAIL_REVEAL,
              exitTransition: RAIL_REVEAL,
              then: name,
            },
          },
    ],
  };
}
