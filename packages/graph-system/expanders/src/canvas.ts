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
 * So placed records are read **through the placements**. Containment is still read, but only for
 * what the canvas *owns* and nobody has positioned — the tray, which is a recovery surface rather
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
 * Each placement brings its card with it: `node` is an untyped to-one, so it comes back through
 * `include` as one record of its own class, with the `counts` the card carries computed on it. The
 * placements, the canvas's colours and its routes are one read over all three; the tray is a second,
 * beside it; the connections between the cards are the only round that has to wait.
 */
import type { GraphEdge, GraphNode, GraphValue, SeedSource } from '@we/graph-protocol';
import { entityAddress, NODE_TYPE_KEY, parseAddress } from '@we/graph-protocol';

import { rowToNode } from './nodes';
import { placementsFor, resolvePlacement } from './placements';
import { type Pretend, pretendVotes, readVotes, voicesOf, type Vote, weighVotes } from './weighing';

export interface CanvasSeedOptions {
  /** Record id of the canvas. Nothing loads until this is set. */
  canvas: string;
  dataset?: string;
  /** Relation holding the canvas's contents and its placements. */
  via?: string;
  /**
   * Where this canvas's members come from, when they are not its own contents.
   *
   * By default a canvas holds what it shows: its cards are its children, beside its placements. A
   * canvas over a space shows everything top-level in the space, which lives in another record — and
   * that record's children must not have the canvas's placements mixed into them, since they are
   * everything a feed reads. So the placements stay the canvas's own (`canvas`, `via`) and the
   * members are read from here: any record and any relation, so the same seed can draw a space
   * (`{ id: <space collection>, via: 'children' }`) or one call's finds (`{ id: <call>, via:
   * 'extracted' }`).
   */
  members?: { id: string; via: string };
  /**
   * The relation saying where each record came from, read onto its card as `origin` — WE passes
   * `extractedFrom`, so a card knows which conversation produced it.
   *
   * For whatever draws or groups by source: a badge in the colour of the call a card came from, a
   * lens picking out one call's finds, a list of unplaced cards grouped by call. Read in the same query
   * as the card, and only for types that declare the relation.
   */
  origin?: string;
  /**
   * Keep only the records whose `origin` is this — every other card left off, with its lines, as
   * `hidden` leaves them. A reader asking "what came out of Monday's call" and putting the rest
   * away. Needs `origin`; a record with no origin is not from anywhere, so it goes too.
   */
  onlyFrom?: string;
  /** Entity holding coordinates. */
  placementEntity?: string;
  /**
   * Types the canvas may hold, beyond whatever its placements name — what the tray is read for.
   *
   * One read over all of them, so a longer list costs rows rather than round trips, but it still
   * costs rows: it is a list rather than every entity the dataset declares for the bargain the
   * collection expander makes.
   */
  contains?: string[];
  /**
   * Entity to draw as connections between the things on this canvas, if any.
   *
   * Only those with *both* ends on this canvas are drawn — placed, or waiting in the tray. A canvas
   * is a closed surface: a line to a record that is not on it would leave the canvas and end nowhere,
   * and pulling the far end in to fix that would put things on the canvas that nobody put there.
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
   * Read onto the matching node's data as `pending: true`, for a style rule to pick up — and onto a
   * connection's line the same way, since a pass stages connections as well as cards. Ids rather
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
   * Record ids to leave off the canvas altogether — no card, and no line to or from one. A
   * connection's own id here leaves off that one line.
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
   * 'responses']` for "what have people made of this". Connections are counted the same way, onto the
   * edge's data, which is how a gesture can tell a line people have discussed from one nobody has.
   *
   * Counts rather than the rows, because a card is a preview: what it owes a reader is that there is
   * something to open. And counts rather than a query per card, because that is the difference
   * between one more projection on a read the seed already makes and two hundred subscriptions on a
   * canvas somebody dragged three hundred things onto.
   *
   * Only for a relation the type actually declares. A type that cannot answer simply carries no
   * count: cards are read several kinds at a time, where a kind without the relation is left out of
   * the count, and connections alone, where they are asked for only what they declare — since there
   * a count over a missing relation refuses the read, and would take every line off the canvas to
   * save a number.
   *
   * Absent for a count of zero, like every other unset field here, so a rule or a card can ask
   * whether the field is there rather than comparing it.
   */
  counts?: string[];
  /**
   * How much each card *weighs*, worked out from one kind of reaction on it — read onto its data as
   * `weight`, with how many reactions produced it as `weightCount`.
   *
   * ## Why the seed rather than the layout or a metric
   *
   * Three things want this number and none of them can compute it. A layout is handed nodes and
   * returns positions, so it cannot query; a metric sees the graph's shape and the nodes' own data, so
   * it can normalise the number but not fetch what it is made of; and a style rule is data. The one
   * place with the data layer in reach is here — and computing it once, in the read the seed already
   * makes, is also what keeps it affordable: the reactions ride in as a projection rather than as one
   * query per card.
   *
   * Writing it onto the node is what makes it usable by all three at once. `forest` orders siblings by
   * `weight`; `{ metric: 'field', options: { from: 'weight' }, scale: 'heat' }` colours by it, on a
   * freeform canvas as readily as on a tree; and a card can show the tally beside it.
   *
   * ## What it does not decide
   *
   * Whose reactions count, and how much each person's is worth. `excludeAuthors` is here because a
   * reader's muted list is not an opinion about weighting — it is the same filter every other reaction
   * surface in WE applies, and leaving it out would make this the one place a muted agent still counts.
   * Per-agent *weighting* is a larger question (a reputation, a cohort, a slider) and belongs in
   * whatever resolves that, which then passes the answer through here.
   */
  weigh?: {
    /**
     * Record id of the `SignalType` that counts. Nothing is weighed without one, which is what lets a
     * picker start empty.
     */
    signalTypeId: string;
    /**
     * How the values are read as one number.
     *
     * Named by the caller rather than derived from the type's `mode`, deliberately. The rule for
     * reading a reaction type as one number already exists one layer up — a community's own
     * `aggregate` field, with a fallback per mode — and a second copy of it here is the kind of thing
     * that drifts silently: the copy that fell behind would go on netting out a type somebody had
     * switched to averaging. So the template passes the type's own `aggregate` through. Default
     * `count`, which matches the field's own default.
     */
    aggregate?: 'count' | 'sum' | 'mean' | 'median';
    /**
     * The type's `mode`, which decides what a stored `aggregate` that cannot express it is read as — see
     * `effectiveAggregate` in `weighing.ts`. Without it a rating whose type still carries the manifest's default
     * `count` was weighed by how many people rated it rather than by what they gave.
     */
    mode?: string;
    /** DIDs whose reactions are ignored — a reader's muted list. */
    excludeAuthors?: string[];
    /** The reader's DID, so each card also carries what they themselves gave — `weightMine`. */
    me?: string;
    /** The type's range, which a pretend person's made-up answers are drawn from — see `simulate`. */
    rangeMin?: number;
    rangeMax?: number;
    step?: number;
  };
  /**
   * How much each person's voice counts in the weight — `did=50,did=0` in whole percent, as an address
   * holds it, or an object of fractions; anyone not named counts in full. Applied by `derive` to answers
   * already read, so a reader dragging a slider re-weighs the canvas with no query.
   */
  weights?: unknown;
  /**
   * People who are not there, answering on every card — a development tool for trying out weighting
   * without several real agents. See `Pretend` in `weighing.ts`. A production build never passes it.
   */
  simulate?: Pretend;
  limit?: number;
}

/**
 * Types checked for *owned but unplaced* records — the tray.
 *
 * One, deliberately. Everything that is on a canvas is placed; the only way to be owned by one and
 * have no position is to be a card composed onto it before anybody said where, which is always a
 * `CollectionBlock`. Listing more would widen the tray's read, on every load and every refresh,
 * looking for what cannot be there.
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
  /*
    Where the card sits among its siblings when the canvas is read as a tree — see `Placement.rank`.

    Signed, and namespaced like the rest: a community's own model may well have a property called
    `rank`, and a card silently ordered by something it happens to hold is the same class of bug the
    prefix exists to prevent. A layout is told which field to order by, so the name it carries here
    costs nothing.
  */
  signed('rank', 'canvasRank');
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

/**
 * What each person answered on one card, for `derive` to weigh — see `weighing.ts`. Stamped as JSON because
 * a node's data holds only scalars; nothing but the seed's own `derive` reads it.
 */
function answersOn(rows: unknown, type: string): Record<string, GraphValue> {
  const votes = readVotes(rows, type);
  return votes ? { weightType: type, weightVotes: JSON.stringify(votes) } : {};
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
      The options whose change is the same canvas read again — see `refreshOptions` on `SeedSource`.

      `pending` and `changed` stamp a flag on a node that has already been built; `hidden` drops rows,
      and the lines to them, from a set already fetched. `weigh` reads more about cards that are
      already there — their reactions — without changing which cards they are. None of them makes this
      a different graph, which is why a change to one must not throw the graph away.

      `hiddenTypes` is deliberately NOT here, and the difference is the whole point of the list: a
      hidden type is never asked for, so putting a kind away really does change which records the
      canvas is made of.
    */
    refreshOptions: ['pending', 'changed', 'hidden', 'weigh', 'onlyFrom'],
    /*
      Applied to answers already on the cards — see `derive` below. A reader re-weighing voices with a
      slider changes these many times a second, and none of it needs a read.
    */
    deriveOptions: ['weights', 'simulate'],
    /*
      Each card's weight from the answers read onto it: every voice weighed as the reader asked, muted
      ones left out, and any pretend people's answers mixed in first. Also says who answered, and how
      often, for a list of voices beside the canvas.
    */
    derive(fragment, rawOptions) {
      const options = (rawOptions ?? {}) as CanvasSeedOptions;
      const weigh = options.weigh;
      /*
        The cards nobody has placed yet — the tray — with the type and origin each was read with.

        Reported from here because the canvas is the one that decides what is unplaced: it read the
        placements and knows which cards it parked. A list beside the canvas that asked again would
        be a second query that could disagree with the first.
      */
      const unplaced = fragment.nodes
        .filter((node) => node.kind === 'entity' && typeof node.data?.x !== 'number')
        .map((node) => ({
          id: parseAddress(node.id)?.id ?? node.id,
          type: node.type ?? '',
          label: node.label ?? '',
          origin: typeof node.data?.origin === 'string' ? node.data.origin : '',
          pending: node.data?.pending === true,
        }));
      if (!weigh?.signalTypeId) return { ...fragment, summary: { unplaced } };
      const pretend = options.simulate?.people?.length ? options.simulate : undefined;
      const settings = { ...weigh, weights: options.weights, me: pretend?.actingAs || weigh.me };
      const everyone: Vote[][] = [];
      const nodes = fragment.nodes.map((node) => {
        const read = node.data?.weightVotes;
        if (typeof read !== 'string') return node;
        const record = parseAddress(node.id)?.id ?? '';
        const votes = [...(JSON.parse(read) as Vote[]), ...pretendVotes(record, pretend, weigh)];
        everyone.push(votes);
        const { weightVotes: _answers, ...data } = node.data ?? {};
        return { ...node, data: { ...data, ...weighVotes(votes, settings) } };
      });
      return {
        nodes,
        edges: fragment.edges,
        summary: {
          type: weigh.signalTypeId,
          voices: voicesOf(everyone, weigh.excludeAuthors ?? [], pretend),
          unplaced,
        },
      };
    },
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
      // The members' own source where one is named — see `members`. Placements never move with it.
      const membersScope = options.members?.id
        ? { anchor: 'CollectionBlock', via: options.members.via, anchorId: options.members.id }
        : scope;

      const read = (
        entity: string | string[],
        where?: Record<string, unknown>,
        include?: Record<string, unknown>,
        from: typeof scope = scope,
        cap = limit,
      ) =>
        context
          .query({
            entity,
            dataset,
            limit: cap,
            signal,
            ...(include ? { include } : {}),
            ...(where ? { where } : { scope: from }),
          })
          .catch((error: unknown) => {
            const named = Array.isArray(entity) ? entity.join(', ') : entity;
            context.warn(`canvas: cannot read ${named}: ${error instanceof Error ? error.message : String(error)}`);
            return [] as Record<string, unknown>[];
          });

      const declared = (entity: string | undefined): entity is string =>
        Boolean(entity) && shapes.some((s) => s.name === entity);
      /** The entity a row of a read over several was read as. */
      const typeOfRow = (row: Record<string, unknown>): string => {
        const entity = row[NODE_TYPE_KEY];
        return typeof entity === 'string' ? entity : '';
      };

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

      /**
       * What a card is read with beyond its own fields: its counts — see `counts` — and, where a
       * weight is wanted, the reactions themselves.
       *
       * The reactions are hydrated rather than counted, because the *values* are what an aggregate
       * reads: a count says how many people answered, which is only one of the four things a community
       * can mean by a reaction type.
       *
       * Asked of every kind at once, with no check that the kind declares the relation: a card is
       * read through a placement whose `node` may be any kind, or in a read over several kinds, and in
       * both a kind without the relation simply carries no count rather than refusing the read.
       */
      const cardFields = (weighed = true): Record<string, unknown> => ({
        ...Object.fromEntries((options.counts ?? []).map((name) => [`$${name}Count`, { from: name, count: true }])),
        ...(weighed && options.weigh?.signalTypeId ? { signals: true } : {}),
      });
      const orNothing = (fields: Record<string, unknown>) => (Object.keys(fields).length ? fields : undefined);

      /*
        Round one: everything this canvas says about itself, and everything it owns. Two reads, together.

        Every read here is a round trip to a peer-to-peer data layer, and each one is also a standing
        subscription, since the engine watches the reads its seeds make. So what decides how long a
        canvas takes to appear is the number of *sequential* rounds, and what decides what it costs
        while it is open is the number of reads. A canvas used to take three rounds and up to eleven
        reads: its placements, then the records they named one query per kind, then the connections.

        The first read is the canvas's own furniture — its placements, colours and routes — in one
        query over all three. Each placement brings the card it positions, with that card's counts:
        placement is what puts a record on a canvas, so the placements already name every card, and
        asking for the cards again by id was a whole round spent learning what the first one held.

        The second is the tray: what the canvas owns and nobody has positioned, by containment, in
        one query over every kind it can hold. It needs nothing the first one answers, so they go
        together. Only the connections are left for a round of their own, since they cannot be asked
        for until the ends are known.
      */
      const furniture = [...new Set([placementEntity, options.typeStyles, options.routes].filter(declared))];
      const trayTypes = [
        ...new Set(
          (options.contains ?? DEFAULT_CONTAINS).filter(
            // Never the entity drawn as lines: a connection is not also a card. The workshop passes the
            // call's extraction targets here, and a call can extract connections as well as things.
            (entity) =>
              entity !== options.connections &&
              entity !== placementEntity &&
              declared(entity) &&
              !hiddenTypes.has(entity),
          ),
        ),
      ];
      const origin = options.origin ? { [options.origin]: true } : undefined;
      const [furnished, owned] = await Promise.all([
        furniture.length
          ? read(furniture, undefined, { node: { include: cardFields() } }, scope, limit * furniture.length)
          : [],
        trayTypes.length
          ? read(
              trayTypes,
              undefined,
              orNothing({ ...cardFields(), ...origin }),
              membersScope,
              limit * trayTypes.length,
            )
          : [],
      ]);
      const placements = furnished.filter((row) => typeOfRow(row) === placementEntity);
      const styles = furnished.filter((row) => typeOfRow(row) === options.typeStyles);
      const routes = furnished.filter((row) => typeOfRow(row) === options.routes);

      /*
        The one cap worth saying out loud.

        Every read here is bounded, and for most of them hitting the bound means some cards of that
        kind are missing — visible, and obviously a truncation. The placements are not like the
        others: they are the membership, so exceeding the bound does not drop the overflow cards, it
        makes them *invisible to the rest of the load entirely*. Nothing else ever learns they exist.

        What that looks like from the outside is a canvas that silently stops at some number of cards
        and a person wondering where the rest of their work went. A warning cannot fetch them, but it
        can say which of those two things happened — and the status strip already has somewhere to
        put it. The placements share a read with the canvas's colours and routes, so the read coming
        back full says the same thing: something in it was cut, and it may have been a placement.

        Compared with `>=` rather than `>`: a read that came back exactly at its limit is a read that
        was cut off, or one that happened to fill it exactly, and nothing here can tell those apart.
        Saying so on the boundary is the honest side to err on.
      */
      if (placements.length >= limit || (furniture.length && furnished.length >= limit * furniture.length)) {
        context.warn(
          `canvas: stopped at ${limit} placed cards — anything beyond that is not on this canvas. ` +
            `Raise the seed's \`limit\` to see the rest.`,
        );
      }

      /*
        Placements *are* the membership: which records are on this canvas, of what type, and where —
        and, read with their cards, the records themselves.
      */
      const positions = new Map<string, Placed>();
      const placed: { entity: string; row: Record<string, unknown> }[] = [];
      /*
        Grouped and resolved, rather than `find`-ed.

        A node with one placement is every node today, and this is that answer written the long way
        round — see `placements.ts` for why it is worth the extra line now. No tier is passed
        because a seed runs in the data layer and cannot see the box its nodes will be drawn in.
      */
      for (const [node, rows] of placementsFor(placements)) {
        const row = resolvePlacement(rows);
        const card = row?.node;
        // A placement whose node never linked names a type and points at nothing, and one whose card
        // has since been deleted points at a record that is not there. Both are skipped rather than
        // half-drawn, and left for a sweep — the record either meant is not knowable from here.
        if (!row || !card || typeof card !== 'object') continue;
        const record = card as Record<string, unknown>;
        // The kind the card was read as, which is a fact; the one the placement stored is a claim, and
        // only the fallback.
        const entity = typeOfRow(record) || (typeof row.nodeType === 'string' ? row.nodeType : '');
        // A hidden type is not drawn, and a type this dataset does not declare cannot be.
        if (!declared(entity) || hiddenTypes.has(entity) || entity === placementEntity) continue;
        positions.set(node, { x: Number(row.x) || 0, y: Number(row.y) || 0, style: placementStyle(row) });
        placed.push({ entity, row: record });
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

        Read in round one with the placements, because it needs nothing they need: it is keyed by a
        record id, so it can be built long before the connections themselves are read.
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
      /**
       * Record ids drawn on this canvas, so a connection can be checked for having both ends here.
       *
       * Filled as the cards are made rather than from the placements, so it holds exactly what is
       * drawn: the tray as well as the board, and less anything hidden or no longer there. The tray
       * counts because it is on the canvas — a row of cards somebody can see and drag — and it is
       * where everything a call extracts lands. Counting only placed cards meant a connection the
       * extraction drew between two of them was never drawn at all, in either reading of the canvas.
       */
      const onCanvas = new Set<string>();
      /** Record id → its entity name, so a connection's endpoints can be addressed. */
      const typeOf = new Map<string, string>();

      /*
        The type of the card actually drawn wins over the one the connection stored. Both ends are
        known to be on the canvas by the time this is asked, so the drawn type is always there — and
        it is a fact, where the stored one is a claim: a connection an extraction pass wrote carries
        whatever class name the model spelled, and a misspelt one addressed a node that does not
        exist, so the line was silently dropped.
      */
      const addressOf = (declared: unknown, id: string): string | undefined => {
        const entity = typeOf.get(id) ?? (typeof declared === 'string' && declared ? declared : undefined);
        return entity ? entityAddress(dataset, entity, id) : undefined;
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

      /** Where a row came from, as an id — an included record or a bare reference, either way. */
      const originOf = (row: Record<string, unknown>): string | undefined => {
        if (!options.origin) return undefined;
        const value = row[options.origin];
        const id = typeof value === 'string' ? value : (value as { id?: unknown } | null | undefined)?.id;
        return typeof id === 'string' && id ? id : undefined;
      };

      /*
        Rows a row-to-node could make nothing of, counted rather than passed over in silence.

        `rowToNode` returns null for a row with no string `id`, which is the one shape of failure
        that produces an empty canvas out of a successful read — and from outside the walk it is
        indistinguishable from a read that found nothing.
      */
      let dropped = 0;

      /*
        The placed cards first and then the tray, which is what keeps the dedup below meaning what it
        says: a record both placed and owned answers both reads, and the placed one is the one
        carrying a position.
      */
      const cards = [
        ...placed,
        ...owned.flatMap((row) => {
          const entity = typeOfRow(row);
          return entity ? [{ entity, row }] : [];
        }),
      ];
      for (const { entity, row } of cards) {
        const shape = shapes.find((s) => s.name === entity);
        const node = rowToNode(row, entity, dataset, shape, 'canvas');
        if (!node) {
          dropped += 1;
          context.trace?.('canvas:row-dropped', { entity, keys: Object.keys(row).slice(0, 8) });
          continue;
        }
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        if (typeof row.id === 'string' && hidden.has(row.id)) continue;
        // Seen first, so a record answering both reads is still left off by the first.
        if (options.onlyFrom && originOf(row) !== options.onlyFrom) continue;
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
          // Beside the counts, and for the same reason they are before the canvas's own fields: a
          // weight is a fact about the record rather than about this canvas's arrangement of it.
          // What each person answered, weighed by `derive` — see `answersOn`.
          ...(options.weigh?.signalTypeId ? answersOn(row.signals, options.weigh.signalTypeId) : {}),
          ...(typeColor ? { canvasTypeColor: typeColor } : {}),
          // Only when true, so a style rule matching `{ pending: true }` and one matching nothing
          // are the two states — an explicit `false` on every other card would make "not pending"
          // a value a rule could accidentally match on.
          ...(typeof row.id === 'string' && pending.has(row.id) ? { pending: true } : {}),
          ...(typeof row.id === 'string' && changed.has(row.id) ? { changed: true } : {}),
          ...(originOf(row) ? { origin: originOf(row)! } : {}),
          ...(at ? { ...at.style, x: at.x, y: at.y } : {}),
        };
        nodes.push({ ...node, data });
        if (typeof row.id === 'string') {
          onCanvas.add(row.id);
          typeOf.set(row.id, entity);
        }
      }

      /*
        Connections between what is on the canvas.

        No *containment* edges — that would draw a line from an invisible parent to every card, a
        hub-and-spoke diagram rather than the freeform surface the mode exists to be. What is worth
        drawing is what people asserted: a relationship between two cards that are both here.

        Filtered to pairs that are both drawn here, and filtered *here* rather than in the query,
        because "both ends in this set" is not a where-clause. The query narrows by source, which is
        the half a backend can do, and the target check is a set lookup against what was just loaded.
      */
      const edges: GraphEdge[] = [];
      // Round three: the connections, which genuinely could not be asked for until the ends were known.
      const connections = options.connections;
      if (connections && declared(connections) && onCanvas.size) {
        const ends = [...onCanvas];
        /*
          Counted like a card, so a line says what people have made of it too — and so a gesture that would
          remove one can tell, before it is let go, that this one has been discussed. Not weighed: a weight
          is what orders cards, and nothing orders lines.
        */
        // Read alone, so asked only for what the type declares: a count over a relation it does not
        // have refuses a one-entity read, and that would take every line off the canvas to save a number.
        const relations = new Set((shapes.find((s) => s.name === connections)?.relations ?? []).map((r) => r.name));
        const counted = Object.entries(cardFields(false)).filter(([key, spec]) =>
          relations.has(key.startsWith('$') ? (spec as { from: string }).from : key),
        );
        const include = counted.length ? Object.fromEntries(counted) : undefined;
        for (const row of await read(connections, { source: ends }, include)) {
          const source = typeof row.source === 'string' ? row.source : undefined;
          const target = typeof row.target === 'string' ? row.target : undefined;
          if (!source || !target || !onCanvas.has(source) || !onCanvas.has(target)) continue;
          /*
            A connection from a card to itself is left off. A canvas has nothing sensible to draw for
            it, and it is not a claim anybody makes by hand: an extraction pass writes one when dedup
            resolves both ends of a "this leads to that" to the same record. Drawn, it was a line
            looping back into its own card.
          */
          if (source === target) continue;
          /*
            A connection is a record too, so the two flags a card answers to apply to a line as well.
            An extraction pass stages connections just as it stages cards: hidden when the reader has
            put suggestions away, and marked when it is still one, so the line can be drawn as the
            draft it is rather than as a claim somebody agreed to.
          */
          const id = typeof row.id === 'string' ? row.id : String(row.id);
          if (hidden.has(id)) continue;
          const from = addressOf(row.sourceType, source);
          const to = addressOf(row.targetType, target);
          if (!from || !to) continue;
          edges.push({
            id: `canvas-connection|${id}`,
            source: from,
            target: to,
            type: 'relates',
            ...(typeof row.label === 'string' && row.label ? { label: row.label } : {}),
            // The connection's own scalars, then how this canvas draws it. Second, so a canvas's
            // routing wins over a like-named field on the connection — the same order a card's own
            // colour takes over its type's.
            data: {
              ...scalarsOf(row),
              ...countsOf(row),
              ...(pending.has(id) ? { pending: true } : {}),
              ...(changed.has(id) ? { changed: true } : {}),
              ...(routeFor.get(id) ?? {}),
            },
            // Keeps the record reachable, exactly as the reified expander does: clicking the line
            // should be able to open the claim it stands for rather than dead-ending.
            reifiedAs: entityAddress(dataset, connections, id),
          });
        }
      }

      context.trace?.('canvas:built', {
        canvas: options.canvas,
        placements: placements.length,
        rows: Object.fromEntries(
          [...placed.map((card) => card.entity), ...owned.map(typeOfRow)].reduce(
            (tally, entity) => tally.set(entity, (tally.get(entity) ?? 0) + 1),
            new Map<string, number>(),
          ),
        ),
        nodes: nodes.length,
        edges: edges.length,
        routes: routeFor.size,
        dropped,
      });

      return { nodes, edges, total: nodes.length };
    },
  };
}
