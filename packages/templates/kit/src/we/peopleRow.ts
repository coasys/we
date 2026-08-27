import { peopleTooltip } from '@we/schema-kit';
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

export interface PeopleRowOptions {
  /** The people. Profile objects by default; bare DIDs when `dids` is set. */
  items: SchemaProp;
  /**
   * The items are DIDs rather than profiles, so pictures and names are joined from
   * `profileStore.profiles`.
   *
   * The join happens per row rather than as a filter over the cache, because the order has to
   * follow *this* list — and because `$filter` has no set-membership operator to express "profiles
   * whose did is in this list" with.
   */
  dids?: boolean;
  /** Singular noun for the count beside the faces. Omit for faces alone. */
  noun?: string;
  /** The plural, when it is not `${noun}s`. */
  nounPlural?: string;
  max?: number;
  size?: string;
  /** Context key for one person inside the roster tooltip. */
  as?: string;
  /**
   * A height floor for the row.
   *
   * `AvatarStack` is a flex container over its avatars, so with none it has no children and no
   * height. People resolve on their own path, later than the record they belong to, so a row
   * without this collapses and then pushes everything below it down a second time. A fixed floor
   * is right rather than a workaround: the row holds fixed-size avatars, so its height depends on
   * neither the count nor any font metric.
   */
  minHeight?: string;
  /** Extra props on the outer Row — margins, mostly. */
  rowProps?: Record<string, SchemaProp>;
}

/**
 * A group of faces and how many there are, with the full roster on hover.
 *
 * The count is inside the hover target, not beside it: "7 Members" and the faces are one statement,
 * and a reader who hovers the words expects the same answer as one who hovers the pictures. That
 * was the bug that moved the tooltip out of `AvatarStack` in the first place — see
 * [peopleTooltip](./peopleTooltip.ts).
 *
 * `AvatarStack` stays a component because it does real work (overlap maths, ring, sizing); what
 * this adds around it — the join, the count, the noun — is arrangement, and stays data.
 */
export function peopleRow(opts: PeopleRowOptions): SchemaNode {
  const as = opts.as ?? 'person';
  /**
   * Join a DID to one field of its cached profile. Takes the context ref because the same join runs
   * in two scopes: the stack's `$map` addresses a person as `$item`, the roster rows as `$<as>`.
   */
  const lookup = (ref: string, field: string) => ({
    $find: { items: { $store: 'profileStore.profiles' }, where: { did: ref }, select: field },
  });
  const count = { $count: { items: opts.items } };

  return peopleTooltip({
    items: opts.items,
    as,
    image: opts.dids ? lookup(`$${as}`, 'avatar') : `$${as}.avatar`,
    hash: opts.dids ? { $concat: [`$${as}`] } : `$${as}.did`,
    name: opts.dids ? lookup(`$${as}`, 'name') : `$${as}.name`,
    children: [
      {
        type: 'Row',
        props: {
          gap: '300',
          ay: 'center',
          ...(opts.minHeight && { minHeight: opts.minHeight }),
          ...opts.rowProps,
        },
        children: [
          {
            type: 'AvatarStack',
            props: {
              avatars: {
                $map: {
                  items: opts.items,
                  select: opts.dids
                    ? {
                        image: lookup('$item', 'avatar'),
                        /*
                          Wrapped rather than written as a bare `'$item'`. `$map`'s `select`
                          resolves a string only when it starts with `'$item.'`; a bare one is a
                          literal, so the hash would be the five characters `$item` for everybody
                          and every generated avatar in the row would come out identical.

                          Set unconditionally, never as a fallback for a missing `image`: it seeds
                          an avatar that is stable per agent, so somebody whose profile has not
                          arrived is still visually distinct from everybody else whose profile has
                          not arrived. A real picture wins where there is one.
                        */
                        hash: { $: '`${item}`' },
                      }
                    : { image: '$item.avatar', hash: '$item.did' },
                },
              },
              max: opts.max ?? 5,
              size: opts.size ?? 'sm',
              ring: '0 0 0 2px var(--we-ring-color)',
            },
          },
          ...(opts.noun
            ? [
                {
                  type: 'Row',
                  props: { gap: '100', ay: 'center' },
                  children: [
                    { type: 'we-number', props: { value: count, shorten: true } },
                    {
                      /*
                        The count and its noun are one phrase, so they never break across lines.

                        Worth stating rather than leaving to chance: this row is a fixed-size
                        ornament sitting beside content that is not, so whenever the two compete
                        for width this is the shrinkable one and flexbox takes the squeeze out of
                        it first. In the space header that surfaced as "1 online / now" on two
                        lines, caused entirely by a nav strip elsewhere in the row.
                      */
                      type: 'we-text',
                      props: { whiteSpace: 'nowrap' },
                      children: [{ $plural: { count, one: opts.noun, other: opts.nounPlural ?? `${opts.noun}s` } }],
                    },
                  ],
                } as SchemaNode,
              ]
            : []),
        ],
      },
    ],
  });
}
