import type { CoreEntityDef } from './defs';

/**
 * Where something sits, on one board.
 *
 * A position is a fact about a **pair** — this view, this node — and not about either one alone.
 * Every design that stores it on one side loses information the moment the other side multiplies:
 * `x`/`y` on a block means a record can be on one board only, and the same note pinned to two
 * boards in two places is the ordinary case rather than the exotic one. So the coordinate lives on
 * the relation, which is what this is.
 *
 * ## Why many small records rather than a map on the board
 *
 * A board holding `{ nodeId: {x, y} }` in one field is a read-modify-write, and a shared board is
 * the worst possible place for one: two people dragging two *different* cards would clobber each
 * other, and the loser would watch their card snap back with no explanation. `MutedAgent` made the
 * same call for the same reason — one record per fact, so two independent changes are two
 * independent writes. Two people dragging the *same* card is a real conflict and last-write-wins is
 * the right answer to it; two people dragging different cards is not a conflict at all and must not
 * be turned into one.
 *
 * ## Why `Ad4mModel` and not `WeNode` — the contrast with `Relationship`
 *
 * A relationship is a **claim**: arguable, ratable, authored as a statement, which is exactly why
 * being a `WeNode` is the whole point of it. A placement is **bookkeeping about a view**. Nobody
 * wants to argue with a coordinate, and somebody who wants to comment on a sticky note comments on
 * the note, which is already a `WeNode`. Making these commentable would double the storage per card
 * to enable a thread nobody will open.
 *
 * It is still authored, because every expression is — which is what makes "everybody shares one
 * arrangement" and "everybody keeps their own" a difference of one `where` clause rather than a
 * migration. Shared is the default, since a board is a shared artifact; per-agent stays free.
 *
 * ## What it does not decide
 *
 * A board is the container today. It should not be the container forever: the general thing is a
 * *saved view*, and a board is its degenerate case — one where every node happens to be placed and
 * the layout is `manual`. The evidence is already in the engine, where pinning a node on a knowledge
 * map holds it exactly until the page reloads. When that becomes durable it wants this record and a
 * different thing on the other end of the parent link, which costs a query rather than a model.
 */
export const Placement: CoreEntityDef = {
  base: 'Ad4mModel',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://placement' },
    properties: {
      /**
       * Entity name of the placed record.
       *
       * The same fact `Relationship` carries beside its endpoints, for the same reason: a graph
       * address is minted from a dataset, a type and an id, and an untyped relation supplies no
       * type. Storing it means the board can work out what to query without first resolving every
       * reference to ask it what it is.
       */
      nodeType: { type: 'string', predicate: 'we://node_type', default: '' },
      x: { type: 'number', predicate: 'we://x', default: 0 },
      y: { type: 'number', predicate: 'we://y', default: 0 },
      /*
        How the card is presented on this board — and only on this board.

        Here rather than on the record for the same reason the coordinate is: this is a fact about a
        pair. Somebody shrinking a post to fit six of them on a wall is not editing the post, and the
        same post on somebody else's board must not change size because of it. It is also what makes
        these safe to offer at all — every one of them is undoable by deleting a placement, and none
        of them can damage the thing being displayed.

        Zero means unset throughout, so the style layer falls back to its default rather than drawing
        a card with no size. A default of `0` rather than the real default because the real default
        lives in one place, in the graph engine, and a copy of it here would be a second place to
        change when a card's proportions are next reconsidered.
      */
      width: { type: 'number', predicate: 'we://width', default: 0 },
      height: { type: 'number', predicate: 'we://height', default: 0 },
      /** Multiplier on the content drawn inside the card. 0 is unset; see `NodeStyle.contentScale`. */
      contentScale: { type: 'number', predicate: 'we://content_scale', default: 0 },
      /** Design token or CSS colour. Empty is unset, so the board's own rules decide. */
      color: { type: 'string', predicate: 'we://color', default: '' },
      /** `note`, `square` or `round`. Empty is unset; anything else is ignored by the renderer. */
      cardShape: { type: 'string', predicate: 'we://card_shape', default: '' },
    },
    relations: {
      /**
       * What is placed. Untyped, because a board holds whatever its community puts on it.
       *
       * Read as a bare URI rather than hydrated — deliberately, and it is why the board never asks
       * for `include` on this. An untyped relation has no target class for the ORM to hydrate into,
       * and the board wants the id anyway: it queries the placed records by type, in batches, and
       * matches them up here.
       */
      node: { target: '', cardinality: 'one', predicate: 'we://placed_node' },
    },
  },
};
