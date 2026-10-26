import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import type { Content } from '../types.ts';

export interface TreeRowOptions {
  /** What the row stands for, as the tree reports it when chosen. */
  value: SchemaProp;
  label: Content;
  /** A Phosphor glyph before the label. Ignored when `avatar` is given. */
  icon?: SchemaProp;
  /** A face before the label instead of a glyph — a person, a space. `hash` seeds its colour. */
  avatar?: { src: SchemaProp; name: SchemaProp; hash: SchemaProp };
  /** Something small after the label: a count, a "Live" tag. */
  badge?: SchemaNode;
  /** Quieter than an ordinary row — a heading over a group rather than a thing. */
  heading?: boolean;
  /**
   * Rows under this one, drawn while it is open. Each is a `treeRow` with `nested`, or an `$each` or
   * `$if` producing them. Present means the row has a caret.
   */
  children?: SchemaNode[];
  /** This row sits under another — it goes in its parent's `children` slot. */
  nested?: boolean;
  /** Whether the rows under it are showing. Held by the caller; see `onOpenChange`. */
  open?: SchemaProp;
  /** Asked when somebody opens or closes it: `event.detail.open` is what they asked for. */
  onOpenChange?: SchemaProp;
  /** A caret before any rows under it have loaded — for rows whose children are read on opening. */
  expandable?: SchemaProp;
}

/**
 * One row of a `we-tree`: its glyph or face, its label and a badge, and the rows under it.
 *
 * The primitive owns the behaviour — the keyboard, the caret, focus and the ARIA tree — and this owns
 * the arrangement inside a row, which every tree draws the same way. Rows under it go in the item's
 * `children` slot, which each says for itself with `nested` — a slot is an attribute of the element,
 * so a row an `$each` draws has to carry it. A caller reading them lazily puts its query inside an
 * `$if` on the same `open`, so nothing is read for a row nobody has opened.
 */
/**
 * How wide the lead `treeRow` draws is — its 24px glyph or face. A tree of these rows passes it as
 * `we-tree`'s `lead`, so with the caret at the end its levels indent by it and its guides fall at its
 * centre.
 */
export const TREE_LEAD = '24px';

export function treeRow(opts: TreeRowOptions): SchemaNode {
  const lead: SchemaNode[] = opts.avatar
    ? [
        {
          type: 'we-avatar',
          props: { size: 'xs', image: opts.avatar.src, initials: opts.avatar.name, hash: opts.avatar.hash },
        },
      ]
    : opts.icon
      ? [{ type: 'we-icon', props: { name: opts.icon, size: 'sm', color: 'text-faint' } }]
      : [];
  const nested = opts.children ?? [];
  return {
    type: 'we-tree-item',
    ...(opts.nested ? { slot: 'children' } : {}),
    props: {
      value: opts.value,
      ...(opts.open !== undefined ? { open: opts.open } : {}),
      ...(opts.onOpenChange ? { onOpenChange: opts.onOpenChange } : {}),
      ...(opts.expandable !== undefined ? { expandable: opts.expandable } : nested.length ? { expandable: true } : {}),
    },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'center', minWidth: '0', width: '100%' },
        children: [
          ...lead,
          {
            type: 'we-text',
            props: {
              truncate: true,
              flex: '1',
              minWidth: '0',
              ...(opts.heading ? { variant: 'footnote', color: 'text-muted', fontWeight: 'medium' } : {}),
            },
            children: [opts.label],
          },
          ...(opts.badge ? [opts.badge] : []),
        ],
      },
      ...nested,
    ],
  };
}
