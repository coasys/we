import type { SchemaNode } from '@we/schema-shared';

export interface PeopleTooltipOptions {
  /** What to wrap — the avatars *and* whatever count or label sits beside them. */
  children: SchemaNode[];
  /** The people to list. Any array expression: a store accessor, or a field on the current item. */
  items: unknown;
  /** Context key for each person inside the list. Must not collide with an outer `$each`. */
  as?: string;
  /** Expression for a row's picture, in terms of `as`. */
  image: unknown;
  /** Expression for a row's identicon seed — a DID, so a face is stable per agent. */
  hash: unknown;
  /** Expression for a row's name. A row that resolves to nothing shows a face and no label. */
  name: unknown;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * The roster behind a group of faces: everyone in it, one per line, with a picture and a name.
 *
 * ## Why this is a helper and not a prop on `AvatarStack`
 *
 * It was the latter first, and the seam was in the wrong place. What a reader hovers is not the row
 * of avatars — it is the avatars *and the count beside them*, which together are the thing that says
 * "seven members". Owning the tooltip inside the stack meant hovering the words "7 Members" produced
 * nothing, and the tooltip's own box interfered with the layout of a component whose only job is to
 * draw a row.
 *
 * Composing it here also keeps `AvatarStack` presentational, which is what lets it stay in
 * `@we/components` at all: a roster needs names, `@we/components` cannot look up a profile, and the
 * alternative was every caller feeding names *through* the stack for it to hand back.
 *
 * ## Why it lists everyone
 *
 * The stack caps at `max` and shows a `+N` chip for the rest. Those hidden people are exactly the
 * ones a reader cannot find out about any other way, so the list is built from the full `items`
 * rather than from what the stack drew.
 */
export function peopleTooltip(opts: PeopleTooltipOptions): SchemaNode {
  const as = opts.as ?? 'person';

  return {
    type: 'we-tooltip',
    props: { placement: opts.placement ?? 'top' },
    children: [
      {
        /*
          A native `div` carries the slot assignment, and it has to be a native one.

          `slot` is spread onto whatever the node renders. For a web component or an HTML tag that
          lands as a real attribute, which is what shadow DOM matches on — but a layer-4 component
          like `Column` is a Solid function, so it receives `slot` as a prop and drops it on the
          floor. The content then has no slot name, falls into the tooltip's *default* slot beside
          the trigger, and renders as permanently visible chrome while the tooltip itself shows its
          empty `title` fallback. Which is exactly how it looked.

          So the assignment goes on a plain element and `Column` does the layout inside it.
        */
        type: 'div',
        slot: 'content',
        children: [
          {
            type: 'Column',
            props: { gap: '200', textAlign: 'left' },
            children: [
              {
                type: '$each',
                props: { items: opts.items, as },
                children: [
                  {
                    type: 'Row',
                    props: { ay: 'center', gap: '200' },
                    children: [
                      { type: 'we-avatar', props: { size: 'xs', image: opts.image, hash: opts.hash } },
                      { type: 'we-text', props: { fontSize: '200' }, children: [opts.name] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      ...opts.children,
    ],
  } as SchemaNode;
}
