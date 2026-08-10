import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import type { Content } from '../types.ts';

export interface StatChipOptions {
  icon: string;
  /** A number to show, abbreviated — for "12 Conversations". Mutually exclusive with `value`. */
  count?: SchemaProp;
  /** A value to show after the label — for "Access: Shared". Mutually exclusive with `count`. */
  value?: Content;
  /** The noun after a count, or the name before a value. */
  label: Content;
  iconColor?: string;
}

/**
 * A small icon-led fact, sized to sit in a wrapping row of them at the foot of a card.
 *
 * Two shapes, because cards state two kinds of fact and they read the same way: a count with its
 * noun ("12 Conversations") and a property with its value ("Access: Shared"). Passing `count` gets
 * the first — through `we-number`, so large counts abbreviate — and `value` gets the second.
 *
 * `flex: 'none'` is the point of the fragment as much as the layout is: without it these shrink
 * unevenly when the row wraps, and a count ends up on a different line from its noun.
 */
export function statChip(opts: StatChipOptions): SchemaNode {
  const isCount = opts.count !== undefined;

  return {
    type: 'Row',
    props: { gap: '100', ay: 'center', flex: 'none' },
    children: [
      { type: 'we-icon', props: { name: opts.icon, size: 'sm', color: opts.iconColor ?? 'neutral-600' } },
      ...(isCount
        ? [
            { type: 'we-number', props: { value: opts.count, shorten: true } } as SchemaNode,
            { type: 'we-text', props: { color: 'neutral-600' }, children: [opts.label] } as SchemaNode,
          ]
        : [
            { type: 'we-text', props: { color: 'neutral-600' }, children: [`${String(opts.label)}:`] } as SchemaNode,
            { type: 'we-text', props: { color: 'neutral-800' }, children: [opts.value] } as SchemaNode,
          ]),
    ],
  };
}
