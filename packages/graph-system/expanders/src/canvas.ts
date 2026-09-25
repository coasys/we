/**
 * The canvas seed — a container's contents, at the positions somebody put them.
 *
 * Every other seed answers "what is here". This one answers two questions, because a canvas holds
 * three facts that are usually one:
 *
 * - **Ownership** — containment. Where a record *lives*, and what a delete cascades to. A note born
 *   on a canvas is owned by it; a task from a call is owned by the call.
 * - **Membership** — the placement's existence. That it *appears* on this canvas. Many per record,
 *   one per canvas it is on.
 * - **Position** — the placement's coordinates.
 *
 * Letting containment carry both ownership and membership is what made "a note born here" and "a
 * task brought here" impossible to tell apart: putting an existing record on a canvas would have
 * reparented it, and a note the canvas owned could not be removed from view without deleting it.
 *
 * So placed records are fetched **by id**, from the placements. Containment is still read, but only
 * for what the canvas *owns* and nobody has positioned — the tray, which is a recovery surface rather
 * than a third kind of membership: a placement that failed to write, or a card composed before
 * anybody said where it goes.
 *
 * ## Why it is a seed rather than a layout
 *
 * The `manual` layout reads `x`/`y` off each node's own data and is right to: a layout arranges what
 * it is given and must not know how to fetch anything. So the merge happens here, where the data
 * layer is already in reach, and `manual` stays a dozen lines of arithmetic that works the same
 * whether the coordinates came from a placement, a fixture, or a field on the record.
 *
 * ## How it finds what to load without being told
 *
 * `contains` names the types a canvas may hold, and defaults to the block vocabulary — but a
 * community's own models are not in any list a template could have written. The placements supply
 * the rest: every one names the type of the thing it positions, so anything anybody has *placed* is
 * queried whether or not the template anticipated it. The two together are what let a canvas hold a
 * `Sighting` nobody had heard of when this file was written.
 *
 * Placements are read first for that reason, and their node references are read as bare URIs rather
 * than hydrated. An untyped relation has no target class for `include` to hydrate into, and the id
 * is what is wanted anyway: the records come back in one query per type — `where: { id: [...] }`,
 * which is native on AD4M and pushes down to a SPARQL `VALUES` clause — and are matched up here.
 */
import type { GraphEdge, GraphNode, GraphValue, SeedSource } from '@we/graph-protocol';
import { entityAddress } from '@we/graph-protocol';

import { rowToNode } from './nodes';
import { placementsFor, resolvePlacement } from './placements';

export interface CanvasSeedOptions {
  /** Record id of the canvas. Nothing loads until this is set. */
  canvas: string;
  dataset?: string;
  /** Relation holding the canvas's contents and its placements. */
  via?: string;
  /** Entity holding coordinates. */
  placementEntity?: string;
  /**
   * Types the canvas may hold, beyond whatever its placements name.
   *
   * One drill-down query each, so this is a real cost rather than a free "list everything" — the
   * same bargain the collection expander makes, and the reason it is a list rather than every
   * entity the dataset declares.
   */
  contains?: string[];
  /**
   * Entity to draw as connections between the things on this canvas, if any.
   *
   * Only those with *both* ends placed here are drawn. A canvas is a closed surface — a line to a
   * record that is not on it would leave the canvas and end nowhere, and pulling the far end in to
   * fix that would put things on the canvas that nobody placed.
   */
  connections?: string;
  /**
   * Entity holding this canvas's per-type colours, if any — WE passes `TypeStyle`.
   *
   * Read into every node's data as `canvasTypeColor`, for a style rule to pick up. The canvas decides
   * what its kinds look like and each card may still carry its own colour in front of that, which is
   * two layers rather than one because they answer different questions: "tasks are amber here" is a
   * fact about the canvas, and "this one is red" is a fact about the card.
   */
  typeStyles?: string;
  /**
   * Entity holding how this canvas draws its connections, if any — WE passes `EdgeRoute`.
   *
   * Read onto each edge's data as `sourceAnchor` / `targetAnchor`, which is what the router reads
   * (see `anchorsOf`). Per canvas for the reason a placement is: the same connection shown on two
   * canvases is tidied differently on each, and the route that keeps it clear of one canvas's cards
   * says nothing about the other.
   */
  routes?: string;
  /**
   * Record ids whose card stands for something **not yet agreed** — a suggestion awaiting a person.
   *
   * Read onto the matching node's data as `pending: true`, for a style rule to pick up. Ids rather
   * than a query, because what makes a record provisional is not a property of the record: an
   * extraction pass can stage a whole instance, so it is in the graph and answers every query the
   * accepted ones answer, and only the capability that staged it knows which those are. A canvas
   * cannot ask; it can be told.
   *
   * Nothing here decides what provisional *looks* like — that is a `nodeStyle` rule, and an
   * interface is entitled to draw it at half opacity, in a dashed outline, or exactly like the
   * rest. The seed's job is only to make the distinction expressible.
   */
  pending?: string[];
  /**
   * Record ids that are agreed and carry a **suggested change** — a staged edit to a record a person
   * already owns, as distinct from a suggestion of the whole record (`pending`).
   *
   * Read onto the matching node's data as `changed: true`. Kept apart from `pending` because the two
   * want opposite drawings: a suggested record is provisional and may be faded, an agreed one with a
   * change pending is not in doubt and must look like the settled record it is.
   */
  changed?: string[];
  /**
   * Record ids to leave off the canvas altogether — no card, and no line to or from one.
   *
   * For a reader narrowing what is shown ("hide what nobody has agreed to"), where a style rule is
   * not enough: a card at zero opacity still takes a press and keeps its connections drawn.
   */
  hidden?: string[];
  /**
   * Whole types to leave off the canvas — every card of each, and the lines that reach them. A reader
   * putting a kind away from the key ("no images for now"), where `hidden` would need every id.
   */
  hiddenTypes?: string[];
  /**
   * Relations to **count** on each card, read onto its data as `<name>Count` — `['signals',
   * 'comments']` for "what have people made of this".
   *
   * Counts rather than the rows, because a card is a preview: what it owes a reader is that there is
   * something to open. And counts rather than a query per card, because that is the difference
   * between one more projection on a read the seed already makes and two hundred subscriptions on a
   * canvas somebody dragged three hundred things onto.
   *
   * Only for a relation the type actually declares. A count over a relation an entity does not have
   * is a refused query, and the refusal would take that whole type off the canvas — cards, lines and
   * all — to save a number. A type that cannot answer simply carries no count.
   *
   * Absent for a count of zero, like every other unset field here, so a rule or a card can ask
   * whether the field is there rather than comparing it.
   */
  counts?: string[];
  limit?: number;
}

/**
 * Types checked for *owned but unplaced* records — the tray.
 *
 * One, deliberately. Everything that is on a canvas is placed; the only way to be owned by one and
 * have no position is to be a card composed onto it before anybody said where, which is always a
 * `CollectionBlock`. Listing more would cost a drill-down query each, on every load and every
 * refresh, looking for what cannot be there.
 */
const DEFAULT_CONTAINS = ['CollectionBlock'];

interface Placed {
  x: number;
  y: number;
  /**
   * Presentation the placement carries, namespaced on its way into the node's data bag.
   *
   * Namespaced because it lands beside the *record's* own fields, and `width` on an `ImageBlock` is
   * the picture's pixel width — a card silently sized by its image, on the one canvas where nobody
   * had chosen a size, is exactly the kind of bug that gets diagnosed as "the canvas is broken".
   * `x`/`y` need no prefix for the same reason in reverse: no block has them, and the `manual`
   * layout reads them by those names.
   */
  style: Record<string, GraphValue>;
}

/**
 * "Explicitly nothing" — a value the canvas drops as though the field were absent.
 *
 * Needed because an empty string cannot be *stored*: `Ad4mModel`'s update skips `''` exactly as it
 * skips `undefined`, so a card given a colour of its own could never have it taken away, and the
 * control offering that would be a one-way door. A named value the seed drops is the same trick
 * `SpacePreference` uses for "follow the space" and "follow my default", for the same reason.
 *
 * Prefixed so it cannot collide with a design token or a CSS colour, both of which are legitimate
 * values for the fields it appears in.
 */
export const PLACEMENT_UNSET = 'we:unset';

/**
 * The presentation fields a placement carries, named as a node's data bag names them.
 *
 * Unset values are dropped rather than passed through as `0` and `''`: a style rule reading an
 * absent field defers to the rule above it, which is what lets a card with no colour of its own take
 * the one its type was given. A zero would override that with a size no card should have.
 *
 * Exported because a host applying an **optimistic** placement edit — a card resized or recoloured,
 * drawn before the write comes back — has to name those fields the same way this does. Two copies of
 * the naming is exactly the sort of thing that drifts silently: the copy that fell behind would
 * write `canvasColour`, nothing would read it, and the card would simply not change until the round
 * trip landed.
 */
export function placementStyle(row: Record<string, unknown>): Record<string, GraphValue> {
  const style: Record<string, GraphValue> = {};
  const number = (key: string, as: string) => {
    const value = Number(row[key]);
    if (Number.isFinite(value) && value > 0) style[as] = value;
  };
  /*
    The same "0 is unset" rule for a value that may legitimately be negative.

    A card tilted -3° is the ordinary case, and one stacked behind the surface is a real answer too,
    so `> 0` would silently drop half the range of both. Zero still means unset, and costs nothing:
    an unrotated card and one nobody has rotated are the same card.
  */
  const signed = (key: string, as: string) => {
    const value = Number(row[key]);
    if (Number.isFinite(value) && value !== 0) style[as] = value;
  };
  const text = (key: string, as: string) => {
    // The sentinel is dropped exactly as an empty value is — that is what makes it mean "unset".
    if (typeof row[key] === 'string' && row[key] && row[key] !== PLACEMENT_UNSET) style[as] = row[key] as string;
  };
  number('width', 'canvasWidth');
  number('height', 'canvasHeight');
  number('contentScale', 'canvasContentScale');
  signed('rotation', 'canvasRotation');
  signed('z', 'canvasZ');
  text('color', 'canvasColor');
  text('cardShape', 'canvasCardShape');
  return style;
}

/**
 * A placement's coordinate, named as a node's data bag names it.
 *
 * The sibling of {@link placementStyle} and exported for the same reason: a host drawing a move
 * **before** the write comes back has to name the fields exactly as the seed does, and two copies of
 * that naming is the sort of thing that drifts silently. Separate from `placementStyle` because the
 * seed itself wants the coordinate as numbers for its positions map rather than as node data, so
 * folding the two together would have it mapping x and y twice on every card it reads.
 *
 * Unlike the style fields, **zero is a real value here** — a card at the origin is an ordinary card
 * — so only a non-finite coordinate is dropped. Both or neither: a patch carrying one axis would
 * leave `manual` reading the other off stale data and send the card somewhere nobody put it.
 */
export function placementPosition(row: Record<string, unknown>): Record<string, GraphValue> {
  const x = Number(row.x);
  const y = Number(row.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : {};
}

/** A connection's own scalars, for style rules to match on — the same thing `reified` carries. */
function scalarsOf(row: Record<string, unknown>): Record<string, GraphValue> {
  const data: Record<string, GraphValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      data[key] = value as GraphValue;
    }
  }
  return data;
}

export function canvasSeed(): SeedSource {
  return {
    id: 'canvas',
    description: "A container's contents, positioned by the placements recorded against it.",
    /*
      The three that are applied to rows already in hand.

      `pending` and `changed` stamp a flag on a node that has already been built; `hidden` drops
      rows, and the lines to them, from a set already fetched. None of them reaches a query — which
      is exactly why a change to one should not throw the graph away. See `presentationOptions` on
      `SeedSource` for what that cost before this existed.

      `hiddenTypes` is deliberately NOT here, and the difference is the whole point of the list: a
      hidden type is never asked for, so putting a kind away really does change what is fetched and
      really does want a reload.
    */
    presentationOptions: ['pending', 'changed', 'hidden'],
    async seed(rawOptions, context, signal) {
      const options = (rawOptions ?? {}) as CanvasSeedOptions;
      // No canvas chosen yet — a picker whose `$local` is still empty. Loading the types wholesale
      // here would fill the canvas with every card in the space, which is worse than an empty one.
      if (!options.canvas) return { nodes: [], edges: [], total: 0 };

      const dataset = options.dataset ?? context.defaultDataset() ?? '';
      const shapes = context.models(dataset);
      const via = options.via ?? 'children';
      const placementEntity = options.placementEntity ?? 'Placement';
      const limit = options.limit ?? 200;
      const scope = { anchor: 'CollectionBlock', via, anchorId: options.canvas };

      const read = (entity: string, where?: Record<string, unknown>, include?: Record<string, unknown>) =>
        context
          .query({
            entity,
            dataset,
            limit,
            signal,
            ...(include ? { include } : {}),
            ...(where ? { where } : { scope }),
          })
          .catch((error: unknown) => {
            context.warn(`canvas: cannot read ${entity}: ${error instanceof Error ? error.message : String(error)}`);
            return [] as Record<string, unknown>[];
          });

      const declared = (entity: string | undefined) => Boolean(entity) && shapes.some((s) => s.name === entity);

      /*
        Round one: what is on this canvas, and how this canvas draws things.

        Both together, because neither needs the other — and every read here is a round trip to a
        peer-to-peer data layer, so what decides how long a canvas takes to appear is the number of
        *sequential* rounds rather than the number of queries. Three rounds is the floor: what is
        placed, then the records it names, then the connections between them, each genuinely waiting
        on the one before.
      */
      const [placements, styles, routes] = await Promise.all([
        declared(placementEntity) ? read(placementEntity) : [],
        declared(options.typeStyles) ? read(options.typeStyles as string) : [],
        declared(options.routes) ? read(options.routes as string) : [],
      ]);

      /*
        The one cap worth saying out loud.

        Every read here is bounded at `limit`, and for most of them hitting it means some cards of
        that kind are missing — visible, and obviously a truncation. The placements read is not like
        the others: it is what tells round two which records to ask for, so exceeding it does not
        drop the overflow cards, it makes them *invisible to the rest of the load entirely*. Nothing
        else ever learns they exist.

        What that looks like from the outside is a canvas that silently stops at some number of cards
        and a person wondering where the rest of their work went. A warning cannot fetch them, but it
        can say which of those two things happened — and the status strip already has somewhere to
        put it.

        Compared with `>=` rather than `>`: a read that came back exactly at its limit is a read that
        was cut off, or one that happened to fill it exactly, and nothing here can tell those apart.
        Saying so on the boundary is the honest side to err on.
      */
      if (placements.length >= limit) {
        context.warn(
          `canvas: stopped at ${limit} placed cards — anything beyond that is not on this canvas. ` +
            `Raise the seed's \`limit\` to see the rest.`,
        );
      }

      /*
        Which of the records on this canvas are still only suggestions — see `pending` in the options.

        A set rather than the array, because it is asked once per row and a canvas holds hundreds.
      */
      const idSet = (ids: unknown) =>
        new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id !== '') : []);
      const pending = idSet(options.pending);
      const changed = idSet(options.changed);
      /** Left off entirely — see `hidden` in the options. */
      const hidden = idSet(options.hidden);
      /** Types left off entirely — see `hiddenTypes`. */
      const hiddenTypes = idSet(options.hiddenTypes);

      /*
        Placements *are* the membership: which records are on this canvas, of what type, and where.
        Everything after this is looking those records up.
      */
      const positions = new Map<string, Placed>();
      const placedIds = new Map<string, string[]>();
      /*
        Grouped and resolved, rather than `find`-ed.

        A node with one placement is every node today, and this is that answer written the long way
        round — see `placements.ts` for why it is worth the extra line now. No tier is passed
        because a seed runs in the data layer and cannot see the box its nodes will be drawn in.
      */
      for (const [node, rows] of placementsFor(placements)) {
        const row = resolvePlacement(rows);
        const nodeType = typeof row?.nodeType === 'string' ? row.nodeType : '';
        // A placement whose node never linked names a type and points at nothing. Skipped rather
        // than half-drawn, and left for a sweep — the record it meant is not knowable from here.
        if (!row || !nodeType) continue;
        positions.set(node, { x: Number(row.x) || 0, y: Number(row.y) || 0, style: placementStyle(row) });
        placedIds.set(nodeType, [...(placedIds.get(nodeType) ?? []), node]);
      }

      /*
        The canvas's own vocabulary of colour, by type.

        Stamped onto each node as it is built rather than patched on afterwards — cheaper than a
        second pass, and it keeps the rule that a node arrives from the seed complete rather than
        being finished by something that would have to know how nodes are addressed.
      */
      const typeColors = new Map<string, string>();
      for (const row of styles) {
        const color = typeof row.color === 'string' ? row.color : '';
        if (typeof row.nodeType === 'string' && row.nodeType && color && color !== PLACEMENT_UNSET) {
          typeColors.set(row.nodeType, color);
        }
      }

      /*
        How each connection is drawn here, by the connection's own id.

        Loaded in round one with the placements, because it needs nothing they need: it is keyed by a
        record id, so it can be built long before the connections themselves are read. What decides
        how long a canvas takes to appear is the number of *sequential* rounds, and this adds none.
      */
      const routeFor = new Map<string, Record<string, GraphValue>>();
      for (const row of routes) {
        const connection = typeof row.connection === 'string' ? row.connection : undefined;
        if (!connection) continue;
        const anchors: Record<string, GraphValue> = {};
        // Empty is unset, exactly as it is on a placement's colour: a route with one end pinned and
        // the other free is the ordinary case, and passing `''` on would be a side nobody named.
        if (typeof row.sourceAnchor === 'string' && row.sourceAnchor) anchors.sourceAnchor = row.sourceAnchor;
        if (typeof row.targetAnchor === 'string' && row.targetAnchor) anchors.targetAnchor = row.targetAnchor;
        // The waypoints travel as the stored blob. A data bag holds scalars, and parsing here to
        // re-serialise for the edge would be work done twice — `waypointsOf` does it once, where the
        // router needs them.
        if (typeof row.points === 'string' && row.points) anchors.waypoints = row.points;
        if (Object.keys(anchors).length) routeFor.set(connection, anchors);
      }

      const nodes: GraphNode[] = [];
      const seen = new Set<string>();
      /** Record ids on this canvas, so a connection can be checked for having both ends here. */
      // Less what is hidden, so a connection to a card nobody can see is not drawn either.
      const placed = new Set<string>(
        [...placedIds]
          .filter(([entity]) => !hiddenTypes.has(entity))
          .flatMap(([, ids]) => ids)
          .filter((id) => !hidden.has(id)),
      );
      /** Record id → its entity name, so a connection's endpoints can be addressed. */
      const typeOf = new Map<string, string>();
      for (const [entity, ids] of placedIds) for (const id of ids) typeOf.set(id, entity);

      const addressOf = (declared: unknown, id: string): string | undefined => {
        const entity = typeof declared === 'string' && declared ? declared : typeOf.get(id);
        return entity ? entityAddress(dataset, entity, id) : undefined;
      };

      /*
        Two passes, because a canvas answers two questions.

        Placed records come back by id — one query per type, `where: { id: [...] }`, native on AD4M
        and pushed down as a SPARQL `VALUES` clause. By id rather than by containment because
        placement is what puts something on a canvas: a task owned by a call belongs on this canvas
        without being reparented into it, which asking for the canvas's children could never express.

        Owned-but-unplaced records come back by containment, and are the tray.
      */
      const passes: { entity: string; where?: Record<string, unknown> }[] = [
        ...[...placedIds].map(([entity, ids]) => ({ entity, where: { id: ids } })),
        ...(options.contains ?? DEFAULT_CONTAINS).map((entity) => ({ entity })),
      ];

      /*
        Round two: the records themselves, all at once.

        Issued together and consumed in order, which keeps the dedup below meaning what it says — the
        placed pass wins over the owned one — while paying one round trip for the lot instead of one
        each. A canvas holding five kinds of thing was five sequential queries deep before anything
        appeared.
      */
      // A hidden type is not asked for at all — nothing of it is drawn, so there is nothing to read.
      const askable = passes.filter(
        (pass) => pass.entity !== placementEntity && declared(pass.entity) && !hiddenTypes.has(pass.entity),
      );

      /*
        The same question twice is one query.

        `contains` comes from a caller — on the workshop's canvas it is the call's extraction targets,
        which is a stored list — so a repeated entry is a thing that can happen, and every repeat cost
        a round trip *and* a standing subscription, since the engine keys its watches on the read.

        Only exact repeats. A type that is both placed and in `contains` appears twice here on
        purpose and must stay twice: those are two different questions — "the ones positioned here",
        by id, and "the ones this canvas owns", by containment — and the second is what finds a card
        nobody has placed yet. They cannot be merged into one query either, because one is a `where`
        and the other a `scope`, and the grammar has no way to ask for their union. That is a real
        cost and it is an ad4m-side one; this only stops us paying it twice for one question.
      */
      const seenPass = new Set<string>();
      const wanted = askable.filter((pass) => {
        const key = `${pass.entity}|${JSON.stringify(pass.where ?? null)}`;
        if (seenPass.has(key)) return false;
        seenPass.add(key);
        return true;
      });

      /**
       * The count projections one type can answer — see `counts`.
       *
       * Filtered against the type's own declared relations, so a model with no `comments` is asked
       * for none rather than refusing the read and vanishing off the canvas.
       */
      const countsFor = (entity: string): Record<string, unknown> | undefined => {
        const asked = options.counts ?? [];
        if (!asked.length) return undefined;
        const relations = new Set((shapes.find((s) => s.name === entity)?.relations ?? []).map((r) => r.name));
        const projections = Object.fromEntries(
          asked.filter((name) => relations.has(name)).map((name) => [`$${name}Count`, { from: name, count: true }]),
        );
        return Object.keys(projections).length ? projections : undefined;
      };

      /** What those projections answered, named as a card reads them, and only where there is any. */
      const countsOf = (row: Record<string, unknown>): Record<string, GraphValue> => {
        const data: Record<string, GraphValue> = {};
        for (const name of options.counts ?? []) {
          const value = Number(row[`$${name}Count`]);
          if (Number.isFinite(value) && value > 0) data[`${name}Count`] = value;
        }
        return data;
      };

      const results = await Promise.all(wanted.map((pass) => read(pass.entity, pass.where, countsFor(pass.entity))));

      /*
        Rows a row-to-node could make nothing of, counted rather than passed over in silence.

        `rowToNode` returns null for a row with no string `id`, which is the one shape of failure
        that produces an empty canvas out of a successful read — and from outside the walk it is
        indistinguishable from a read that found nothing.
      */
      let dropped = 0;

      for (const [index, pass] of wanted.entries()) {
        const entity = pass.entity;
        const shape = shapes.find((s) => s.name === entity);
        for (const row of results[index]) {
          const node = rowToNode(row, entity, dataset, shape, 'canvas');
          if (!node) {
            dropped += 1;
            context.trace?.('canvas:row-dropped', { entity, keys: Object.keys(row).slice(0, 8) });
            continue;
          }
          // A record both placed and owned answers both passes; the first one wins, and it is the
          // placed one, which is the one carrying a position.
          if (seen.has(node.id)) continue;
          seen.add(node.id);
          if (typeof row.id === 'string' && hidden.has(row.id)) continue;
          const at = typeof row.id === 'string' ? positions.get(row.id) : undefined;
          /*
            Coordinates land in `data`, where the `manual` layout reads them.

            Merged into the node rather than passed beside it because that is the contract a layout
            has: it is handed nodes and returns positions, and a seed that needed its own channel to
            the layout would be a seed only one layout could use.
          */
          // Type colour first, so a card's own colour lands in front of it — and both are dropped
          // when unset, which is what lets a style rule defer to the one above it.
          const typeColor = typeColors.get(entity);
          const data = {
            ...node.data,
            // Before the canvas's own fields: a count is the record's, and nothing a placement
            // carries is named like one, so the order is only a statement of which layer owns what.
            ...countsOf(row),
            ...(typeColor ? { canvasTypeColor: typeColor } : {}),
            // Only when true, so a style rule matching `{ pending: true }` and one matching nothing
            // are the two states — an explicit `false` on every other card would make "not pending"
            // a value a rule could accidentally match on.
            ...(typeof row.id === 'string' && pending.has(row.id) ? { pending: true } : {}),
            ...(typeof row.id === 'string' && changed.has(row.id) ? { changed: true } : {}),
            ...(at ? { ...at.style, x: at.x, y: at.y } : {}),
          };
          nodes.push({ ...node, data });
        }
      }

      /*
        Connections between what is on the canvas.

        No *containment* edges — that would draw a line from an invisible parent to every card, a
        hub-and-spoke diagram rather than the freeform surface the mode exists to be. What is worth
        drawing is what people asserted: a relationship between two cards that are both here.

        Filtered to pairs that are both placed, and filtered *here* rather than in the query, because
        "both ends in this set" is not a where-clause. The query narrows by source, which is the half
        a backend can do, and the target check is a set lookup against what was just loaded.
      */
      const edges: GraphEdge[] = [];
      // Round three: the connections, which genuinely could not be asked for until the ends were known.
      const connections = options.connections;
      if (connections && declared(connections) && placed.size) {
        const ends = [...placed];
        for (const row of await read(connections, { source: ends })) {
          const source = typeof row.source === 'string' ? row.source : undefined;
          const target = typeof row.target === 'string' ? row.target : undefined;
          if (!source || !target || !placed.has(source) || !placed.has(target)) continue;
          const from = addressOf(row.sourceType, source);
          const to = addressOf(row.targetType, target);
          if (!from || !to) continue;
          edges.push({
            id: `canvas-connection|${String(row.id)}`,
            source: from,
            target: to,
            type: 'relates',
            ...(typeof row.label === 'string' && row.label ? { label: row.label } : {}),
            // The connection's own scalars, then how this canvas draws it. Second, so a canvas's
            // routing wins over a like-named field on the connection — the same order a card's own
            // colour takes over its type's.
            data: { ...scalarsOf(row), ...(routeFor.get(String(row.id)) ?? {}) },
            // Keeps the record reachable, exactly as the reified expander does: clicking the line
            // should be able to open the claim it stands for rather than dead-ending.
            reifiedAs: entityAddress(dataset, connections, String(row.id)),
          });
        }
      }

      context.trace?.('canvas:built', {
        canvas: options.canvas,
        placements: placements.length,
        rows: Object.fromEntries(wanted.map((pass, index) => [pass.entity, results[index].length])),
        nodes: nodes.length,
        edges: edges.length,
        routes: routeFor.size,
        dropped,
      });

      return { nodes, edges, total: nodes.length };
    },
  };
}
