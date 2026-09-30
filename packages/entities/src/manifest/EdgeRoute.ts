import type { CoreEntityDef } from './defs';

/**
 * How a connection is *drawn*, on one board.
 *
 * {@link Placement} is the same record for a card: where a node sits is a fact about a **pair** —
 * this view, this node — rather than about either alone. A connection's shape is the same kind of
 * fact. The same `Relationship` can appear on two boards, and the route that keeps it clear of the
 * cards on one says nothing about the other, so the route lives on the pair.
 *
 * Which is also why it is not on `Relationship` itself. A relationship is a **claim** — arguable,
 * ratable, authored as a statement. Where its line leaves a card is not part of the claim, and
 * storing it there would make one board's tidying follow the connection everywhere it is shown.
 *
 * ## Why `Ad4mModel` rather than `WeNode`
 *
 * Bookkeeping about a view, exactly as a placement is. Nobody wants to comment on a bend; somebody
 * who wants to argue with the connection argues with the `Relationship`, which is already a
 * `WeNode`. See `Placement` for the longer form of the same reasoning.
 *
 * ## Anchors
 *
 * An anchor pins which **side** of a card the line leaves or arrives on — `n`, `e`, `s`, `w`, or
 * empty for "work it out from where the two cards are", which is what every connection does until
 * somebody says otherwise.
 *
 * A side rather than a point along it, on purpose: a side survives the card being resized, matches
 * the four handles a card already offers, and is a fraction of the fiddliness. "40% along the top"
 * is more expressive and nobody has wanted it.
 *
 * Deliberately *not* set by which handle a connection was dragged out of. Today you grab whichever
 * of the four dots is nearest and the edge still routes sensibly; pinning that silently would give
 * people connectors leaving the top of a card and looping around, having done nothing but pick the
 * closest handle. Anchoring is an explicit act — drag the end of an existing line around the card's
 * rim — and the handles stay hints.
 */
export const EdgeRoute: CoreEntityDef = {
  base: 'Ad4mModel',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://edge_route' },
    properties: {
      /**
       * Side of the source card the line leaves from: `n`, `e`, `s`, `w`. Empty is unset.
       *
       * Empty rather than absent because that is what a control can *write*: `Ad4mModel`'s update
       * skips `''` exactly as it skips `undefined`, so clearing an anchor is a delete of the record
       * rather than a write of nothing. See `PLACEMENT_UNSET` for where the same shape needed a
       * named sentinel instead — here there is nothing to distinguish, since a route with no anchors
       * and no waypoints has nothing left to say and is deleted.
       */
      sourceAnchor: { type: 'string', predicate: 'we://source_anchor', default: '' },
      /** Side of the target card the line arrives on. Empty is unset. See {@link sourceAnchor}. */
      targetAnchor: { type: 'string', predicate: 'we://target_anchor', default: '' },
      /**
       * Points the line is bent through, as JSON: `[{ along, across }, …]`, in order.
       *
       * **In the edge's own frame, not the world.** `along` runs from the source (0) to the target
       * (1) and `across` is perpendicular in the same units, so a bend keeps its proportions when
       * either card moves. World coordinates were the obvious choice and the wrong one: the first
       * time somebody tidied a board every hand-drawn route would dogleg through empty space, and a
       * route that becomes litter on the first rearrangement is worse than no route at all.
       *
       * A blob rather than rows, on `TextBlock.marks`' precedent: nobody ever asks which connectors
       * bend near a place, so this is rendered from and never filtered on. Rows would also make the
       * order a stored field on each, which is a second thing to keep right.
       *
       * Each point may carry `in`/`out` tangents later, for per-point curve handles. Absent means
       * derived from the neighbours, which is what the spline does today — so that is an addition
       * rather than a migration.
       */
      points: { type: 'json', predicate: 'we://route_points', default: '' },
    },
    relations: {
      /**
       * The connection this routes. Untyped, because what a board draws lines between is the
       * community's decision — `Relationship` is what WE passes, and a space that names its own
       * connection model gets routes on it for nothing.
       *
       * Read as a bare URI rather than hydrated, for the reason `Placement.node` is: an untyped
       * relation has no target class to hydrate into, and the id is what the board wants anyway.
       */
      connection: { target: '', cardinality: 'one', predicate: 'we://routed_connection' },
    },
  },
};
