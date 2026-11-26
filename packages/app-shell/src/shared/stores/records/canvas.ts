/**
 * The record store's canvas: where each card sits and how it looks, a connection's route on one canvas,
 * cards taken off and records deleted — each drawn before it lands, and each but the delete undoable.
 *
 * **Placement is membership.** A record is on a canvas because a `Placement` parented to the canvas
 * names it, with its coordinate and its presentation beside it — facts about the pair, not the record,
 * so the same record on two canvases sits and looks differently on each. Every write here is a declared
 * operation over those rows (`core.placeCard` …), drawn before it lands as the host draws every one;
 * the undo stays here, and so does a preview, which is drawn the same way with nothing written.
 *
 * **Undo is this agent's own forward writes**, scoped to the canvas on screen (`@we/history`): a move,
 * a resize, a colour, a card taken off. Each entry replays as a new write guarded by what it expects to
 * find, so a peer's change in between is left alone.
 */
import { type ContentInput, planPost } from '@we/block-shared';
import { COMPOSE_CARD_POST, EdgeRoute, heldRows, Placement, predict, predictionLanded } from '@we/entities';
import { PLACEMENT_UNSET, resolvePlacement } from '@we/graph-expanders';
import { createHistory, type History } from '@we/history';

import {
  cardStyleValue,
  colorValue,
  drawnAmong,
  placementFieldsOf,
  type PlacementRow,
  sameSpot,
  type Spot,
  spotOf,
  stillHolds,
  styleBaseline,
} from '../../canvas/placements';
import { rerouteWrite, routeWrite } from '../../edgeRoute';
import { heldFirst, heldRecord } from '../../heldFirst';
import { invokeOperation } from '../../invokeOperation';
import type { RecordStore } from '../RecordStore';
import type { RecordConnections } from './connections';
import { canvasChildren, entityNamed, type RecordContext, RELATIONSHIP } from './context';

export interface RecordCanvasDeps extends RecordContext {
  connections: Pick<RecordConnections, 'keyFor'>;
  /** Where content made on `canvas` lives — see `RecordStore.provideContentHomes`. */
  contentHome: (canvas?: string) => string | undefined;
}

/** One card's presentation before and after a gesture — what an undo of it replays. */
export type StyleChange = { nodeId: string; before: Record<string, unknown>; after: Record<string, unknown> };

/** One card's move, with where it came from — `from` is null for a card that was not on the canvas. */
type CardMove = { recordId: string; recordType: string; from: Spot | null; to: Spot };

export interface RecordCanvas extends Pick<
  RecordStore,
  | 'createCardOnCanvas'
  | 'placeOnCanvas'
  | 'dragOnCanvas'
  | 'removeFromCanvas'
  | 'deleteRecords'
  | 'canvasHistory'
  | 'undoCanvas'
  | 'redoCanvas'
  | 'previewCardStyle'
  | 'resizeOnCanvas'
  | 'anchorOnCanvas'
  | 'rerouteOnCanvas'
  | 'retargetOnCanvas'
  | 'setCardStyle'
  | 'setTypeColor'
> {
  /** What this agent has done to the canvas on screen — for a part whose gestures are undoable too. */
  history: History;
  /**
   * Write where one card sits — an upsert, guarded by `expect` on a replay — and answer with the move
   * it made, or null when it made none. Records no undo entry: the caller decides whether there is one.
   */
  writePlacement: (
    canvas: string,
    nodeId: string,
    nodeType: string,
    x: number,
    y: number,
    expect?: Spot | null,
  ) => Promise<{ from: Spot | null; to: Spot } | null>;
  /**
   * Patch the placement for one card, guarded by `expect` on a replay, and answer with what each field
   * held before — or undefined where nothing was written.
   */
  stylePlacement: (
    canvas: string,
    nodeId: string,
    patch: Record<string, unknown>,
    expect?: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | undefined>;
}

export function createRecordCanvas(deps: RecordCanvasDeps): RecordCanvas {
  const { reactivity, toasts, datasetStore, sessionStore, runOp, connections, contentHome } = deps;

  /**
   * The placement the canvas draws for a card, and the ones it outranks — as the canvas on screen
   * holds them where it does, so the write after it is drawn on the gesture rather than a round trip
   * later.
   */
  async function drawnPlacement(handle: unknown, canvas: string, nodeId: string) {
    const query = { parent: canvasChildren(canvas) };
    const rows = await heldFirst('Placement', handle, query, () => Placement.findAll(handle, query));
    return drawnAmong(rows as unknown as PlacementRow[], nodeId);
  }

  /**
   * What this agent has done to the canvas on screen, so it can be put back.
   *
   * Scoped to one canvas and cleared when that changes — see `@we/history` for why undo on shared,
   * last-write-wins data is a stack of forward writes rather than a set of snapshots, and why it is
   * private to this agent rather than shared with the space.
   *
   * **Arrangement only.** A move, a resize, a colour, a card taken off the canvas: all of these are
   * scalar upserts on a `Placement`, which the write path already reads before it writes, so the
   * value an undo needs is in hand for nothing. Deleting a *record* is not here and will not be —
   * a delete drops the record's links, a re-create earns a new id, and everything pointing at the old
   * one breaks silently. `deleteRecords` says as much in the host's own confirmation.
   */
  const history = createHistory(reactivity.signal);

  /**
   * Compose a card onto a canvas and place it, as one write — `core.composeCard`, which calls
   * `core.createPost` for the card and makes its placement beside it, so the canvas never observes
   * a card that exists but is not yet anywhere. The post is planned as any other (`planPost`), with
   * its blocks' ids derived where that call sits.
   */
  async function createCardOnCanvas(
    editorState: unknown,
    options: { canvas: string; at?: { x: number; y: number } },
  ): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !options.canvas) return;
    const invoker = sessionStore.me()?.did;
    try {
      if (!invoker) throw new Error('core.composeCard: nobody is signed in');
      const { invocationId, args } = await planPost(dataset.handle, editorState as ContentInput, {
        kind: 'card',
        within: COMPOSE_CARD_POST,
      });
      await invokeOperation(
        'core.composeCard',
        {
          root: args.root,
          blocks: args.blocks,
          mentions: args.mentions,
          // The card lives wherever this canvas's content lives; its placement is the canvas's own.
          home: contentHome(options.canvas) ?? options.canvas,
          canvas: options.canvas,
          ...(options.at ? { at: options.at } : {}),
        },
        { dataset: dataset.handle, invoker, invocationId },
      );
    } catch (error) {
      console.error('RecordStore: creating a card on a canvas failed', error);
      toasts.error('Could not add that card.');
    }
  }

  /**
   * One card moved, with the coordinate it had before — which is what makes the move undoable.
   *
   * Read-then-write rather than blind create, because dragging a card twice must not leave two
   * placements for it — and a canvas that accumulated one per drag would slow down in exactly
   * proportion to how much anybody used it. The read is scoped to the canvas's own children: the
   * parent link is what makes a placement belong to a canvas, so asking the canvas is both cheaper and
   * the only phrasing that stays correct when the same record sits on two.
   *
   * The baseline costs nothing: the value an undo would put back is in hand at the moment of writing.
   *
   * `expect` is the concurrency guard, and it is *here* rather than in `@we/history` because this is
   * the only place that reads the current value. An undo says "put it back, if it is still where I
   * left it"; a peer who has moved the card since means the answer is no, and the press does nothing
   * rather than teleporting the card out from under them. Folding the check into the write is what
   * keeps an undo one round trip instead of two.
   */
  async function writePlacement(
    canvas: string,
    nodeId: string,
    nodeType: string,
    x: number,
    y: number,
    expect?: Spot | null,
  ): Promise<{ from: Spot | null; to: Spot } | null> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !canvas || !nodeId) return null;

    try {
      const { drawn: already, duplicates } = await drawnPlacement(dataset.handle, canvas, nodeId);
      const before = already ? spotOf(already) : null;

      if (expect !== undefined) {
        const matches = expect === null ? already === undefined : before !== null && sameSpot(before, expect);
        if (!matches) return null;
      }

      // Edited where the canvas draws one, made where it has none, and its duplicates gone, together.
      const moved = await runOp<{ from: Record<string, unknown> | null }>(
        'core.placeCard',
        { canvas, node: nodeId, nodeType, fields: { x, y }, placement: already?.id, duplicates },
        dataset.handle,
      );
      return { from: moved.from ? spotOf(moved.from) : null, to: { x, y } };
    } catch (error) {
      console.error('RecordStore: placing a record on a canvas failed', error);
      toasts.error('Could not save that position.');
      return null;
    }
  }

  /** Replay a set of moves in one direction, skipping any card a peer has moved since. */
  async function replayMoves(canvas: string, moves: CardMove[], direction: 'undo' | 'redo'): Promise<void> {
    for (const move of moves) {
      const [expect, at] = direction === 'undo' ? [move.to, move.from] : [move.from, move.to];
      // A card that was not on the canvas before goes back to not being on it — the undo of
      // "something was dropped here" is not a placement at the origin.
      if (at) await writePlacement(canvas, move.recordId, move.recordType, at.x, at.y, expect);
      else await clearPlacement(canvas, move.recordId, expect ?? undefined);
    }
  }

  /**
   * Record a gesture's moves as one undoable act.
   *
   * One entry however many cards moved: twelve dragged together have to come back on one press.
   * Nothing is recorded for a gesture that moved nothing, so a drag the data refused does not leave
   * an entry whose undo would do nothing either.
   */
  function rememberMoves(canvas: string, moves: CardMove[]): void {
    if (!canvas || !moves.length) return;
    history.push({
      scope: canvas,
      label: moves.length > 1 ? `move ${moves.length} cards` : 'move card',
      undo: () => replayMoves(canvas, moves, 'undo'),
      redo: () => replayMoves(canvas, moves, 'redo'),
    });
  }

  /**
   * Record a presentation gesture as one undoable act.
   *
   * Shared by every write that lands on a placement's *look* rather than its position — a colour, a
   * shape, a content scale, a resize — so each of them is undoable by existing rather than by
   * remembering to say so. `resizeOnCanvas` was the one that had not.
   */
  function rememberStyle(canvas: string, changes: StyleChange[], label: string): void {
    if (!canvas || !changes.length) return;
    history.push({
      scope: canvas,
      label,
      undo: async () => {
        for (const change of changes) await stylePlacement(canvas, change.nodeId, change.before, change.after);
      },
      redo: async () => {
        for (const change of changes) await stylePlacement(canvas, change.nodeId, change.after, change.before);
      },
    });
  }

  async function placeOnCanvas(canvas: string, nodeId: string, nodeType: string, x: number, y: number): Promise<void> {
    const moved = await writePlacement(canvas, nodeId, nodeType, x, y);
    if (moved) rememberMoves(canvas, [{ recordId: nodeId, recordType: nodeType, ...moved }]);
  }

  /**
   * One drag, written: every card that travelled, and whatever a fold was holding.
   *
   * Sequential rather than in parallel, and that is deliberate. Each placement is a read-then-write
   * against the same canvas's children, so issuing them together would have every one of them read
   * the state before any of the others wrote — which is exactly how a canvas ends up with two
   * placements for one card. A drag holds a handful of cards, so the cost is a handful of round
   * trips on a gesture that happens when somebody lets go of a mouse.
   *
   * A carried card whose write fails leaves the rest where they were dropped and that card where it
   * was; `writePlacement` says so once per failure. Better than the alternative of unwinding the
   * lot, which would move cards back out from under the reader's cursor.
   *
   * **One history entry for the whole gesture.** Twelve cards dragged as one have to come back as
   * one press — a stack that recorded them separately would need twelve, which is not undo, it is
   * counting.
   */
  async function dragOnCanvas(
    canvas: string,
    payload: {
      recordId?: string;
      recordType?: string;
      x: number;
      y: number;
      opened?: boolean;
      carried?: { recordId: string; recordType: string; x: number; y: number }[];
    },
  ): Promise<void> {
    if (!payload?.recordId || !payload.recordType) return;
    /*
      A card only an opening put here — a note's blocks, opened out of it — is moved and not written.
      A placement is the canvas's membership, so writing one made the card a member in its own right:
      it stayed on the canvas when the note closed, cut off from it, and came back on every load.
    */
    if (payload.opened) return;
    const cards = [
      { recordId: payload.recordId, recordType: payload.recordType, x: payload.x, y: payload.y },
      ...(payload.carried ?? []).filter((card) => card?.recordId && card.recordType),
    ];

    const moves: CardMove[] = [];
    for (const card of cards) {
      const moved = await writePlacement(canvas, card.recordId, card.recordType, card.x, card.y);
      if (moved) moves.push({ recordId: card.recordId, recordType: card.recordType, ...moved });
    }
    rememberMoves(canvas, moves);
  }

  /**
   * Patch the placement for one node on one canvas.
   *
   * Refuses rather than creating one, and says so: a node with no placement is an unplaced card in
   * the tray, and a placement minted here would have to invent a position — putting the card at the
   * canvas's origin as a side effect of choosing a colour.
   */
  async function stylePlacement(
    canvas: string,
    nodeId: string,
    patch: Record<string, unknown>,
    expect?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !canvas || !nodeId || !Object.keys(patch).length) return undefined;
    try {
      const { drawn: already, duplicates } = await drawnPlacement(dataset.handle, canvas, nodeId);
      if (!already) {
        toasts.error('Drag this onto the canvas first — how a card looks is saved with where it sits.');
        return undefined;
      }
      // The baseline an undo puts back, costing nothing because the read has already happened.
      const before = styleBaseline(already, patch);

      /*
        The concurrency guard, and the same bargain `writePlacement` strikes for a position.

        A replay says "put this back, if it is still what I left"; a peer who has recoloured the
        card since means the answer is no, and the press leaves their colour alone rather than
        overwriting it. Only a *replay* passes `expect` — a fresh gesture is somebody deciding now,
        and deciding now beats whatever was there.
      */
      if (expect && !stillHolds(already, expect)) return undefined;

      await runOp(
        'core.placeCard',
        { canvas, node: nodeId, fields: patch, placement: already.id, duplicates, create: false },
        dataset.handle,
      );
      return before;
    } catch (error) {
      console.error('RecordStore: styling a card on a canvas failed', error);
      toasts.error('Could not save that.');
      return undefined;
    }
  }

  /**
   * Pin which side of a card a connection leaves or arrives on, for this canvas.
   *
   * Takes the graph's `onEdgeAnchor` payload as it arrives, the way `resizeOnCanvas` takes
   * `onNodeResize`'s. An empty `side` clears that end, and a route with neither end pinned and no
   * bends is deleted rather than left as a record saying nothing — the way back has to leave nothing
   * behind, or a canvas accumulates a route per connection anybody ever touched. A route still holding
   * bends is not saying nothing, which is why the test asks about all three.
   *
   * Per canvas, on an `EdgeRoute` parented to it, for the reason a placement is: how a connection is
   * drawn is a fact about a *view*. Putting it on the `Relationship` would make one canvas's tidying
   * follow the connection into every other canvas it appears on.
   */
  async function anchorOnCanvas(canvas: string, payload: unknown): Promise<void> {
    const event = (payload ?? {}) as { recordId?: string; end?: 'source' | 'target'; side?: string };
    const dataset = datasetStore.currentDataset();
    if (!dataset || !canvas || !event.recordId || !event.end) return;
    const side = typeof event.side === 'string' ? event.side : '';

    try {
      const existing = (await EdgeRoute.findAll(dataset.handle, { parent: canvasChildren(canvas) })) as {
        id: string;
        connection?: string;
        sourceAnchor?: string;
        targetAnchor?: string;
        points?: unknown;
      }[];
      const already = existing.find((row) => row.connection === event.recordId);
      // The rule itself lives in `routeWrite`, where it can be tested — every branch of it is a
      // quiet refusal or a rewrite, which is precisely the kind of thing that stops working without
      // anything failing. Discarding somebody's bends is how it stopped working the first time.
      const write = routeWrite(already, event.end, side);

      if (write.action === 'none') return;
      await runOp(
        'core.writeEdgeRoute',
        {
          canvas,
          connection: event.recordId,
          route: already?.id,
          action: write.action,
          ...('fields' in write ? { fields: write.fields } : {}),
        },
        dataset.handle,
      );
    } catch (error) {
      console.error('RecordStore: anchoring a connection on a canvas failed', error);
      toasts.error('Could not save that.');
    }
  }

  /**
   * Move one end of a connection onto a different record.
   *
   * The *claim* changes here, not the view. `anchorOnCanvas` and `rerouteOnCanvas` write to an
   * `EdgeRoute` parented to one canvas, so the same connection shown elsewhere is untouched; this
   * rewrites the `Relationship` itself, so it changes on every canvas, in the knowledge map, and for
   * every member. That is the right answer for "this actually goes there" and it is a different kind
   * of edit from the two beside it — which is why it is its own action rather than a branch inside
   * one of them.
   *
   * The endpoint and its type are written together. `sourceType` is an ordinary property; the
   * endpoint is a to-one relation, written as the one id it points at.
   *
   * That end's **anchor is cleared**, and the waypoints are left alone. A side pinned against the
   * card that used to be there is a decision about something no longer in the picture, and applying
   * it to whatever arrived would be somebody's choice used for a thing they never chose it for. The
   * points are stored in the connection's own frame, so they follow the new geometry rather than
   * becoming litter — see `EdgeWaypoint`.
   */
  async function retargetOnCanvas(canvas: string, payload: unknown): Promise<void> {
    const event = (payload ?? {}) as {
      recordId?: string;
      recordType?: string;
      end?: 'source' | 'target';
      nodeId?: string;
      nodeType?: string;
    };
    const dataset = datasetStore.currentDataset();
    if (!dataset || !event.recordId || !event.end || !event.nodeId || !event.nodeType) return;

    try {
      const entity = event.recordType || RELATIONSHIP;
      const Model = entityNamed(entity);
      // As the canvas holds the line, so the end moves on the gesture rather than a round trip later.
      const record = await heldRecord<Record<string, unknown>>(entity, dataset.handle, event.recordId, () =>
        Model.findOne(dataset.handle, { where: { id: event.recordId } }),
      );
      if (!record) return;

      /*
        The key moves with the end. It names both ends, so left alone it would tell the next extraction
        pass the connection still joins the pair it was drawn between — and a pass reusing that key, as
        its hint asks of the same claim, would write the old end back. Only for a `Relationship`: this
        gesture moves the ends of any record shaped like one, and only that one carries a key.
      */
      const moved = (event.recordType || RELATIONSHIP) === RELATIONSHIP;
      const otherId = record[event.end === 'source' ? 'target' : 'source'];
      const otherType = record[event.end === 'source' ? 'targetType' : 'sourceType'];
      const other = {
        id: typeof otherId === 'string' ? otherId : '',
        type: typeof otherType === 'string' ? otherType : '',
      };
      const to = { id: event.nodeId, type: event.nodeType };
      if (moved) {
        // The end, its type and the key, as one write — `core.retargetConnection`.
        const key = other.id
          ? event.end === 'source'
            ? await connections.keyFor(dataset.handle, to, other, record.label)
            : await connections.keyFor(dataset.handle, other, to, record.label)
          : undefined;
        await runOp(
          'core.retargetConnection',
          { connection: event.recordId, end: event.end, node: event.nodeId, nodeType: event.nodeType, key },
          dataset.handle,
        );
      } else {
        /*
          A record shaped like a connection that is not one — a foreign model's — carries no key, so
          its move is an edit of it: the end and its type, as one write. The end as a one-element
          list, the spelling every backend writes a to-one from in an edit.
        */
        await runOp(
          'core.editRecord',
          {
            entity: event.recordType,
            id: event.recordId,
            fields:
              event.end === 'source'
                ? { sourceType: event.nodeType, source: event.nodeId }
                : { targetType: event.nodeType, target: event.nodeId },
          },
          dataset.handle,
        );
      }

      // The anchor for the end that moved, dropped — see the note above. Reusing the same action a
      // person's own clear goes through, so there is one path that knows how to unset one.
      if (canvas) await anchorOnCanvas(canvas, { recordId: event.recordId, end: event.end, side: '' });
    } catch (error) {
      console.error('RecordStore: re-attaching a connection failed', error);
      toasts.error('Could not move that connection.');
    }
  }

  /**
   * Write the whole shape of one connection's route on this canvas — see `rerouteWrite` for why the
   * whole list, and when the route goes. {@link anchorOnCanvas} is the other half of the same record.
   */
  async function rerouteOnCanvas(canvas: string, payload: unknown): Promise<void> {
    const event = (payload ?? {}) as { recordId?: string; points?: unknown };
    const dataset = datasetStore.currentDataset();
    if (!dataset || !canvas || !event.recordId || !Array.isArray(event.points)) return;

    try {
      const existing = (await EdgeRoute.findAll(dataset.handle, { parent: canvasChildren(canvas) })) as {
        id: string;
        connection?: string;
        sourceAnchor?: string;
        targetAnchor?: string;
      }[];
      const already = existing.find((row) => row.connection === event.recordId);
      const write = rerouteWrite(already, event.points);
      if (write.action === 'none') return;
      await runOp(
        'core.writeEdgeRoute',
        {
          canvas,
          connection: event.recordId,
          route: already?.id,
          action: write.action,
          ...('fields' in write ? { fields: write.fields } : {}),
        },
        dataset.handle,
      );
    } catch (error) {
      console.error('RecordStore: rerouting a connection on a canvas failed', error);
      toasts.error('Could not save that.');
    }
  }

  async function resizeOnCanvas(canvas: string, payload: unknown): Promise<void> {
    const event = (payload ?? {}) as { recordId?: string; width?: number; height?: number; x?: number; y?: number };
    if (!event.recordId || !event.width || !event.height) return;
    // Position travels with the size. Resizing from one edge anchors the other, and a card drawn
    // from its centre has to move that centre to hold an edge still — so writing only the size would
    // slide the card sideways by half the change every time.
    const after = {
      width: Math.round(event.width),
      height: Math.round(event.height),
      ...(typeof event.x === 'number' ? { x: Math.round(event.x) } : {}),
      ...(typeof event.y === 'number' ? { y: Math.round(event.y) } : {}),
    };
    const before = await stylePlacement(canvas, event.recordId, after);
    // Undoable like every other placement write. It was not, which is the sort of gap that only
    // shows up as "undo does not cover the thing I just did" — the four fields go back together.
    if (before) rememberStyle(canvas, [{ nodeId: event.recordId, before, after }], 'resize card');
  }

  /** One presentation field as a placement holds it — see `cardStyleValue` — warning about one a card lacks. */
  function styleValue(field: string, value: unknown): string | number | undefined {
    const scalar = cardStyleValue(field, value);
    if (scalar === undefined) console.warn(`RecordStore: "${field}" is not a card presentation property`);
    return scalar;
  }

  /**
   * Draw a presentation field on cards as though it were written, writing nothing — a colour under
   * the pointer in a picker.
   *
   * Drawn as a write is: a prediction over every placement of the card on screen, so the canvas
   * shows it through the same reads a real write reaches. Marked landed at once, since there is no
   * run to wait for, so it is drawn until the data moves past it — the colour picked, or anybody
   * else's — and the backstop retires one nothing ever answers. One per card and field, so the next
   * preview replaces the last.
   */
  function previewCardStyle(node: string | string[], field: string, value: unknown): void {
    const scalar = styleValue(field, value);
    const dataset = datasetStore.currentDataset();
    if (scalar === undefined || !dataset) return;
    for (const nodeId of (Array.isArray(node) ? node : [node]).filter(Boolean)) {
      const placements = heldRows('Placement', dataset.handle, { node: nodeId });
      if (!placements.length) continue;
      const id = `preview\u0000${nodeId}\u0000${field}`;
      predict(
        dataset.handle,
        id,
        placements.map((row) => ({
          kind: 'edit' as const,
          entity: 'Placement',
          id: row.id,
          fields: { [field]: scalar },
        })),
      );
      predictionLanded(id);
    }
  }

  /**
   * Set one presentation property on one card — or on a whole selection.
   *
   * A list rather than a second action named for the plural, the same choice `removeFromCanvas`
   * makes: one card is not a special case of several, and a template holding a selection should not
   * have to find a different action to hand it to.
   *
   * One history entry for the gesture, holding each card's own previous value — so undoing a colour
   * applied to nine cards puts nine different colours back rather than one.
   */
  async function setCardStyle(canvas: string, node: string | string[], field: string, value: unknown): Promise<void> {
    const scalar = styleValue(field, value);
    if (scalar === undefined) return;
    const nodeIds = (Array.isArray(node) ? node : [node]).filter(Boolean);
    if (!nodeIds.length) return;

    const after = { [field]: scalar };
    const changed: StyleChange[] = [];
    for (const nodeId of nodeIds) {
      const before = await stylePlacement(canvas, nodeId, after);
      // `undefined` is a write that did not happen — an unplaced card, or one the write failed for.
      if (before) changed.push({ nodeId, before, after });
    }
    rememberStyle(canvas, changed, changed.length > 1 ? `restyle ${changed.length} cards` : 'restyle card');
  }

  async function setTypeColor(canvas: string, nodeType: string, color: unknown): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !canvas || !nodeType) return;
    // The same sentinel a card's own colour uses, and for the same reason: `''` cannot be stored, so
    // without it a type could be given a colour and never have it taken away.
    const value = colorValue(color);

    try {
      // An upsert against the canvas's own children, exactly as a placement is: the parent link is
      // what makes a style belong to a canvas, and colouring a type twice must not leave two records
      // disagreeing about it. Nothing to clear that was never set, so a clear makes no style where
      // there is none.
      await runOp(
        'core.colorCanvasType',
        { canvas, nodeType, color: value, create: value !== PLACEMENT_UNSET },
        dataset.handle,
      );
    } catch (error) {
      console.error('RecordStore: colouring a type on a canvas failed', error);
      toasts.error('Could not save that colour.');
    }
  }

  /**
   * Take one card off a canvas, answering with everything it was wearing.
   *
   * The whole row rather than its coordinate, because the undo has to put the card back as it was —
   * its size, colour, shape and stacking live on the placement too, and a restore that returned a
   * card to the right spot stripped of its presentation is a worse outcome than not offering the
   * undo at all.
   *
   * `expect` refuses where the card has moved since, the same guard `writePlacement` carries.
   */
  async function clearPlacement(canvas: string, nodeId: string, expect?: Spot): Promise<PlacementRow | null> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !canvas || !nodeId) return null;
    try {
      const existing = (await Placement.findAll(dataset.handle, {
        parent: canvasChildren(canvas),
      })) as unknown as PlacementRow[];
      const rows = existing.filter((placement) => placement.node === nodeId);
      if (!rows.length) return null;

      const drawn = resolvePlacement(rows) ?? rows[0];
      if (expect && !sameSpot(spotOf(drawn), expect)) return null;

      // Every placement for this node, not the first: a duplicate should not survive the removal and
      // silently put the thing back on the canvas at the next refresh.
      await runOp('core.clearPlacements', { placements: rows.map((row) => row.id) }, dataset.handle);
      return drawn;
    } catch (error) {
      console.error('RecordStore: removing a record from a canvas failed', error);
      toasts.error('Could not remove that.');
      return null;
    }
  }

  /**
   * Put a card back exactly as it came off — position, size, colour, shape, stacking — from the row
   * `clearPlacement` answered with (`placementFieldsOf`). A fresh record, so it carries a new id:
   * nothing points at a placement, so there is nothing for that to break — which is exactly why *this*
   * is reversible where deleting a record is not.
   */
  async function restorePlacement(canvas: string, nodeId: string, row: PlacementRow): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset) return;
    try {
      /*
        Not if somebody has already put it back.

        The guard the other replays make, in the only shape this one can take: there is no stored
        value to compare against, so the question is whether a placement exists at all. A peer who
        dragged the card back on has a position of their own, and a second placement beside it would
        be two rows disagreeing about where the card is.
      */
      if ((await drawnPlacement(dataset.handle, canvas, nodeId)).drawn) return;
      await runOp('core.placeCard', { canvas, node: nodeId, fields: placementFieldsOf(row) }, dataset.handle);
    } catch (error) {
      console.error('RecordStore: putting a card back on a canvas failed', error);
      toasts.error('Could not put that back.');
    }
  }

  /**
   * Take a card — or a whole selection — off a canvas, leaving the records themselves alone.
   *
   * One action for one and for many rather than a second named for the plural: the argument is the
   * only thing that differs, a selection of one is not a special case, and a template that has a
   * list in hand should not have to find a different action to pass it to.
   *
   * Reversible, and deliberately the thing the Delete key does. Tidying a canvas is what a
   * rubber-band selection is nearly always for, and "remove these from here" is a decision about an
   * arrangement that somebody can take back — where deleting the records is a decision about a
   * community's content that nobody can.
   */
  async function removeFromCanvas(canvas: string, node: string | string[]): Promise<void> {
    const nodeIds = (Array.isArray(node) ? node : [node]).filter(Boolean);
    if (!canvas || !nodeIds.length) return;

    const removed: { nodeId: string; row: PlacementRow }[] = [];
    for (const nodeId of nodeIds) {
      const row = await clearPlacement(canvas, nodeId);
      if (row) removed.push({ nodeId, row });
    }
    if (!removed.length) return;

    history.push({
      scope: canvas,
      label: removed.length > 1 ? `remove ${removed.length} cards` : 'remove card',
      undo: async () => {
        for (const { nodeId, row } of removed) await restorePlacement(canvas, nodeId, row);
      },
      redo: async () => {
        // Where the undo put it back, so a card a peer has since moved is left where they put it.
        for (const { nodeId, row } of removed) await clearPlacement(canvas, nodeId, spotOf(row));
      },
    });
  }

  /**
   * Delete several records, for everyone, as one act.
   *
   * The whole reason this exists rather than a template looping `record.delete`: the host's
   * confirmation is modal and phrased per record, so a loop stacks one dialog per card. This is
   * marked `destructive` like any other delete, so the host raises **one** question — and
   * `describeDestructive` counts what is in the list, which is the number somebody about to answer
   * it actually needs.
   *
   * **Not undoable, and deliberately outside the history.** A delete removes the record's links; a
   * re-create earns a new id, so every relation pointing at the old record breaks with nothing to
   * say it did. Taking a card *off a canvas* is the reversible neighbour of this and is what the
   * Delete key does; this is the one a person has to ask for.
   *
   * One write (`core.deleteRecords`), so a canvas of peers sees the set go at once rather than
   * thinning out over a second — and so a failure part-way leaves nothing half-done.
   */
  async function deleteRecords(records: { recordId?: string; recordType?: string }[] | undefined): Promise<void> {
    const dataset = datasetStore.currentDataset();
    const rows = (records ?? []).filter((row) => row?.recordId && row.recordType);
    if (!dataset || !rows.length) return;

    // Drawn gone at once, connections among them included: the host draws an invoked operation's
    // deletes before they land. What stays here is the undo history, which only this store holds.
    try {
      await runOp(
        'core.deleteRecords',
        { records: rows.map((row) => ({ entity: row.recordType, id: row.recordId })) },
        dataset.handle,
      );
      /*
        Anything undone-able that mentioned these is now a lie.

        A move entry naming a record that no longer exists would replay into nothing — or worse,
        write a placement for a deleted record and put a card nobody can open back on the canvas. The
        cheap, correct answer is to forget the arrangement history rather than to filter it: a delete
        is rare, and a lost undo stack is a smaller surprise than an undo that resurrects a ghost.
      */
      history.clear();
    } catch (error) {
      console.error('RecordStore: deleting records failed', error);
      toasts.error('Could not delete those.');
    }
  }

  return {
    createCardOnCanvas,
    placeOnCanvas,
    dragOnCanvas,
    removeFromCanvas,
    deleteRecords,
    canvasHistory: () => history.state(),
    /*
      Scoped on the way in, every time.

      A canvas passes its own id with the press, so the stack cannot be replaying somewhere the
      reader has left — and `scopeTo` is idempotent, so the overwhelmingly common case (pressing
      undo twice on the same canvas) costs a string comparison.
    */
    undoCanvas: async (canvas: string) => {
      history.scopeTo(canvas);
      await history.undo();
    },
    redoCanvas: async (canvas: string) => {
      history.scopeTo(canvas);
      await history.redo();
    },
    previewCardStyle,
    resizeOnCanvas,
    anchorOnCanvas,
    rerouteOnCanvas,
    retargetOnCanvas,
    setCardStyle,
    setTypeColor,
    history,
    writePlacement,
    stylePlacement,
  };
}
