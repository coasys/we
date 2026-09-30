import type { SchemaNode } from '@we/schema-shared';

import type { Content } from '../types.ts';

export interface AttributeRowOptions {
  icon: string;
  iconColor?: string;
  /** The attribute's name. Rendered with its colon, so pass it without one. */
  label: string;
  /** The current value, as a string or an expression. */
  value: Content;
  /** A line under the pair explaining what the value means. */
  description?: Content;
  /** A switch, a button pair, an editor — placed at the far right, which turns the row into a setting. */
  control?: SchemaNode;
}

/**
 * One property of a space, stated: an icon, `Label: Value`, and a line saying what that implies.
 *
 * The same row appears read-only on the About page and with a switch on Settings, which is why the
 * control is a slot rather than a second fragment — the two had drifted into describing the same
 * property differently ("Listed" on one page, "Appears on the WE discovery globe" on the other),
 * which is the kind of divergence nobody chooses and everybody ships.
 */
export function attributeRow(opts: AttributeRowOptions): SchemaNode {
  const stack: SchemaNode = {
    type: 'Row',
    props: { ay: 'center', gap: '400', py: '100' },
    children: [
      { type: 'we-icon', props: { name: opts.icon, color: opts.iconColor ?? 'accent-text' } },
      {
        type: 'Column',
        props: { gap: '100' },
        children: [
          {
            type: 'Row',
            props: { gap: '300' },
            children: [
              { type: 'we-text', props: { fontWeight: 'bold', color: 'text' }, children: [`${opts.label}:`] },
              { type: 'we-text', props: { fontWeight: 'bold' }, children: [opts.value] },
            ],
          },
          ...(opts.description !== undefined
            ? [{ type: 'we-text', props: { variant: 'body' }, children: [opts.description] } as SchemaNode]
            : []),
        ],
      },
    ],
  };

  if (!opts.control) return stack;

  return {
    type: 'Row',
    props: { ay: 'center', ax: 'between', wrap: true },
    children: [stack, opts.control],
  };
}
