import { peopleTooltip } from '@we/schema-kit';
import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { expr } from '@we/schema-shared';

export interface PeopleAtPathOptions {
  /** The route's absolute path, as `spaceStore.spacePath` builds one. */
  path: SchemaProp;
  max?: number;
  size?: string;
  /**
   * The colour behind the faces, so overlapping ones read as separate — see `AvatarStack.edge`.
   *
   * A nav pill is `surface-raised`, so `var(--we-role-surface-raised)` is the usual answer here.
   */
  edge?: string;
}

/**
 * Who else is looking at one page — a stack of faces, with their names on hover.
 *
 * The other half of live cursors, and the reason the pair is worth having: a cursor that disappears is
 * explained by a face appearing beside another route, rather than by the feature seeming to break. It
 * stands on its own too, in a space nobody has cursors switched on in.
 *
 * ## Why the path is matched as a prefix
 *
 * A route has pages beneath it — a card opened from the canvas, a post opened from a feed — and
 * somebody reading one of those is still on that section as far as a nav strip is concerned. An exact
 * match would drop them the moment they opened anything, which reads as people flickering out of a
 * page they are plainly still on.
 *
 * ## Why it reads `online` rather than `peers`
 *
 * `online` is already scoped to the space on screen and excludes people whose presence has decayed
 * past the point of belief. That first half is load-bearing: a path is only meaningful within a
 * dataset, and two spaces routinely have the same one — so filtering `peers` by path would union
 * people across every space this agent has something live in. `presence.ts` refuses to offer a
 * path-only selector for exactly this reason, and the same trap is reachable from a template.
 *
 * ## Why this agent is left out
 *
 * The strip already says where *you* are, by marking the page you are on. A face for yourself beside
 * it is the same fact twice, and it makes an empty page look occupied.
 */
export function peopleAtPath(opts: PeopleAtPathOptions): SchemaNode {
  const here = expr`presenceStore.online.filter(p, p.did != me.did && startsWith(p.focus.path, ${opts.path}))`;

  const faces: SchemaNode = peopleTooltip({
    items: here,
    as: 'person',
    image: { $: 'person.avatar' },
    hash: { $: 'person.did' },
    name: { $: 'person.name' },
    placement: 'bottom',
    children: [
      {
        type: 'AvatarStack',
        props: {
          // `hash` unconditionally, never as a fallback for a missing picture: it is what keeps two
          // people whose profiles have not arrived from being two identical blank discs.
          avatars: expr`${here}.map(p, { image: p.avatar, hash: p.did })`,
          max: opts.max ?? 3,
          size: opts.size ?? 'xs',
          ...(opts.edge ? { edge: opts.edge } : {}),
        },
      },
    ],
  });

  /*
    Mounted only where there is somebody, and taking no room at all otherwise.

    An `$if` rather than an opacity or a reserved width, and each alternative was tried. `AvatarStack`
    with no avatars is a flex container with no children and so no height, and an empty stack is still in
    the accessibility tree and still found by find-in-page — so it has to be absent rather than
    invisible.

    And **no width is held for it**. Reserving one stops the row changing size as people come and go,
    which sounds right and is wrong in practice: nobody being there is the ordinary state, so the reserve
    is a permanent gap that reads as a rendering fault, in exchange for smoothing a shift that only
    happens when somebody actually moves between pages — which is a real event and worth seeing. If the
    shifting ever becomes the louder problem, it is visible and has an obvious fix; a gap that is always
    there is neither.
  */
  return {
    type: '$if',
    props: { condition: expr`count(${here})`, then: faces },
  };
}
