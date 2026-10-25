import type { SchemaNode } from '@we/schema-shared';

/**
 * Small marks the tree and the views share.
 */

/**
 * Something happening now: a dot in the success colour, lit in its own colour as Nico's "online" and
 * "live call" dots are. `tone` points the glow at the dot's colour; how bright it is, is the theme's.
 */
export const liveDot: SchemaNode = {
  type: 'Column',
  props: { width: '7px', height: '7px', r: 'full', bg: 'success', tone: 'success', shadow: 'glow', flex: '0 0 auto' },
};

/** A count at the end of a row, as a pill. Shown only while there is something to count. */
export const countPill = (expr: string, tone?: string): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: expr },
    then: {
      type: 'we-badge',
      props: { variant: 'soft', size: 'xs', ...(tone ? { tone } : {}) },
      children: [{ $: expr }],
    },
  },
});
