/**
 * The record store's tree: a card dragged to another place in a canvas read as a hierarchy, and the
 * structure that drag means written — a connection moved, made or taken away, or a model relation's
 * link pointed at a new parent — with the ranks that order its row, as one undoable act.
 *
 * The counterpart of the canvas part's `dragOnCanvas`. There the position *is* the data, so a drag
 * writes a coordinate; here the layout derives the position, so a drag writes the structure the layout
 * reads. The rules it reads the data by are `shared/canvas/treeDrops.ts`, and where a card is seated in
 * its row is the `treeRanks` kernel.
 */
import { isOperationError, Placement } from '@we/entities';
import { type FollowedRelation, followedRelations, idsAt } from '@we/graph-expanders';
import { heldByChild } from '@we/graph-protocol';

import { drawnAmong, type PlacementRow } from '../../canvas/placements';
import { endsOf, ranksOf, spineIndex, type SpineLink } from '../../canvas/treeDrops';
import { toEntityShape } from '../../graphEntityShape';
import { isUnder, rowFor, seatInRow } from '../../kernels/treeRanks';
import { modelManifestEntries, parseSpine, type Spine } from '../../sources/treeSpines';
import type { RecordStore } from '../RecordStore';
import type { ShapeStore } from '../ShapeStore';
import type { RecordCanvas, StyleChange } from './canvas';
import type { RecordConnections } from './connections';
import { canvasChildren, entityNamed, type RecordContext, RELATIONSHIP } from './context';
import type { RecordKinds } from './kinds';

export interface RecordTreeDeps extends RecordContext {
  /** The space's own models, whose relations a tree may follow. */
  shapeStore: Pick<ShapeStore, 'spaceShapes'>;
  kinds: Pick<RecordKinds, 'entityClass'>;
  connections: Pick<RecordConnections, 'withHold' | 'connect' | 'keyFor'>;
  canvas: Pick<RecordCanvas, 'history' | 'stylePlacement' | 'retargetOnCanvas' | 'hold' | 'done' | 'drop'>;
}

export type RecordTree = Pick<RecordStore, 'arrangeOnTree'>;

export function createRecordTree(deps: RecordTreeDeps): RecordTree {
  const { toasts, datasetStore, shapeStore, runOp, kinds, connections } = deps;
  const { history, stylePlacement, retargetOnCanvas, hold, done, drop } = deps.canvas;
  const { entityClass } = kinds;

  /** The placements on a canvas, as read for a drop. */
  const placementsOn = async (handle: unknown, canvas: string) =>
    (await Placement.findAll(handle, { parent: canvasChildren(canvas) })) as unknown as PlacementRow[];

  /**
   * Every connection of one community-named kind.
   *
   * One query rather than three. An arrange has to know the card's own parent, its prospective
   * parent's children, and where the target sits among them — and asking separately is three round
   * trips on a gesture that happens when somebody lets go of a mouse.
   */
  async function spineLinks(handle: unknown, relationshipTypeId: string): Promise<SpineLink[]> {
    const rows = (await entityNamed(RELATIONSHIP).findAll(handle, {
      where: { relationshipTypeId },
    } as never)) as unknown as SpineLink[];
    return rows.filter((row) => row && typeof row.id === 'string');
  }

  /**
   * Take a card out of its tree, unless that would throw away something somebody said.
   *
   * Removing the claim means deleting the record, and a deleted record's links go with it: re-creating
   * one earns a new id that nothing pointing at the old one can follow. So the line is drawn at whether
   * anything would be lost — and where nothing would, an undo re-creating the connection loses nothing
   * either, which is why a tree drop that detached a card can still be taken back.
   *
   * A connection is a `WeNode`, so it carries comments and reactions — an argument about the very claim
   * being rearranged — and one that carries either is refused, with a toast naming the reason and the way
   * to do it deliberately. A connection nobody has said anything about is deleted, which is the
   * overwhelmingly common case and exactly what the gesture means. The workshop's tree tells its gesture
   * the same rule, so the preview refuses before the drop rather than this after it.
   */
  async function detachSpine(handle: unknown, linkId: string): Promise<boolean> {
    const Model = entityNamed(RELATIONSHIP);
    const row = (await Model.findOne(handle, {
      where: { id: linkId },
      include: { $responses: { from: 'responses', count: true }, $signals: { from: 'signals', count: true } },
    } as never)) as unknown as { $responses?: number; $signals?: number } | null;
    if (!row) return false;

    if (Number(row.$responses ?? 0) > 0 || Number(row.$signals ?? 0) > 0) {
      toasts.info('People have discussed that connection. Select the line itself to remove it.');
      return false;
    }
    try {
      await connections.withHold({ kind: 'removed', id: linkId }, () =>
        runOp('core.detachConnection', { connection: linkId }, handle),
      );
    } catch (error) {
      // Discussed between the read above and the write: the operation's own check, said the same way.
      if (isOperationError(error) && error.code === 'discussed') {
        toasts.info(error.message);
        return false;
      }
      throw error;
    }
    return true;
  }

  /**
   * A new connection of the spine kind, from `parent` to `card` — answering with its id.
   *
   * Written here rather than through `connectNodesNow`, which mints a connection carrying no kind at all —
   * right for a line somebody draws and then labels, and wrong for this: a connection that is not of the
   * spine kind is invisible to the tree it was just dragged into, so the card would snap straight back to
   * the unconnected zone.
   */
  async function createSpine(
    handle: unknown,
    relationshipTypeId: string,
    parent: { id: string; type: string },
    card: { id: string; type: string },
    /*
      Whether to draw the new line ahead of the write. Not for a drop: the graph is already drawing that
      one from the card it is holding, and a second promise between the same two cards would be drawn
      beside it. An undo or a redo has nobody holding anything, so it holds its own.
    */
    hold = true,
  ): Promise<string> {
    const write = async () =>
      connections.connect(
        handle,
        { source: parent.id, sourceType: parent.type, target: card.id, targetType: card.type },
        { key: await connections.keyFor(handle, parent, card), kind: relationshipTypeId || undefined },
      );
    if (!hold) return write();
    return connections.withHold(
      {
        kind: 'added',
        source: parent.id,
        target: card.id,
        ...(relationshipTypeId ? { data: { relationshipTypeId } } : {}),
      },
      write,
    );
  }

  /**
   * What a tree drop did to the spine, for an undo to put back.
   *
   * `link` is the connection concerned, and changes on a replay that re-creates it — a re-created
   * connection is a new record, so the entry keeps up with it rather than holding an id nothing answers to.
   */
  type TreeStep =
    | { kind: 'moved'; link: string; from: { id: string; type: string }; to: { id: string; type: string } }
    | { kind: 'created'; link: string; parent: { id: string; type: string } }
    | { kind: 'detached'; link: string; parent: { id: string; type: string } }
    | { kind: 'none' };

  /**
   * Record a tree drop as one undoable act: the change to the spine, and the ranks it wrote.
   *
   * Each replay reads the spine first and applies its half only if the card's connection is still where
   * this entry left it. `HistoryEntry.stale` cannot ask — it is synchronous, and the spine is a query — so
   * the check is made inside, and a card a peer has moved since is left where they put it rather than
   * pulled back. The ranks go through `stylePlacement` with what they are expected to hold, which makes the
   * same check for each card.
   */
  function rememberTreeDrop(
    canvas: string,
    handle: unknown,
    relationshipTypeId: string,
    card: { id: string; type: string },
    step: TreeStep,
    ranks: StyleChange[],
  ): void {
    if (!canvas || (step.kind === 'none' && !ranks.length)) return;
    const connection = async () =>
      (await spineLinks(handle, relationshipTypeId)).find((link) => link.target === card.id);
    const retarget = (link: string, to: { id: string; type: string }) =>
      retargetOnCanvas(canvas, {
        recordId: link,
        recordType: RELATIONSHIP,
        end: 'source',
        nodeId: to.id,
        nodeType: to.type,
      });
    history.push({
      scope: canvas,
      label: step.kind === 'detached' ? 'take card out of tree' : 'move card in tree',
      undo: async () => {
        const now = await connection();
        if (step.kind === 'moved' && now?.id === step.link && now.source === step.to.id)
          await retarget(step.link, step.from);
        if (step.kind === 'created' && now?.id === step.link && now.source === step.parent.id) {
          await detachSpine(handle, step.link);
        }
        if (step.kind === 'detached' && !now)
          step.link = await createSpine(handle, relationshipTypeId, step.parent, card);
        for (const change of ranks) await stylePlacement(canvas, change.nodeId, change.before, change.after);
      },
      redo: async () => {
        const now = await connection();
        if (step.kind === 'moved' && now?.id === step.link && now.source === step.from.id)
          await retarget(step.link, step.to);
        if (step.kind === 'created' && !now)
          step.link = await createSpine(handle, relationshipTypeId, step.parent, card);
        if (step.kind === 'detached' && now?.id === step.link && now.source === step.parent.id) {
          await detachSpine(handle, step.link);
        }
        for (const change of ranks) await stylePlacement(canvas, change.nodeId, change.after, change.before);
      },
    });
  }

  /**
   * The relations a tree follows, by the rule the canvas seed draws them by — `followedRelations` over
   * the merged manifest the spine picker lists (core, then the space's shapes, then the foreign schemas
   * it installed). Forward only, typed, never WE's bookkeeping: a drop can only write a link the tree
   * would draw, and which end is the parent is `heldByChild` from `@we/graph-protocol`, as the seed's is.
   */
  function treeRelations(): FollowedRelation[] {
    return followedRelations(
      modelManifestEntries({
        shapes: shapeStore.spaceShapes(),
        foreign: datasetStore.currentDatasetEntities(),
      }).map(toEntityShape),
    );
  }

  /**
   * Where a card hangs through one relation — its parent's id, or '' — read off the data rather than
   * remembered. A to-one answers from the card's own field; a to-many from the row of the holding
   * class that lists the card, which is a scan of that class and the only spelling of "who lists me"
   * a list leaves.
   *
   * A card can be listed by more than one holder, so the parent the tree drew it under is passed as
   * `holder` where it is known (the edge a drop reports, or the parent an undo entry left it under):
   * it is answered if that one row still lists the card, by a read of that row alone. Only when it
   * does not — or no holder is known, as for an ancestor walked up — is the class scanned.
   */
  async function parentThrough(
    handle: unknown,
    relation: FollowedRelation,
    cardId: string,
    holder?: string,
  ): Promise<string> {
    const Model = entityClass(relation.holder, handle);
    if (heldByChild(relation)) {
      const record = (await Model.findOne(handle, { where: { id: cardId } } as never)) as Record<
        string,
        unknown
      > | null;
      return record ? (idsAt(record, relation.name)[0] ?? '') : '';
    }
    if (holder) {
      const row = (await Model.findOne(handle, {
        where: { id: holder },
        include: { [relation.name]: true },
      } as never)) as Record<string, unknown> | null;
      if (row && idsAt(row, relation.name).includes(cardId)) return holder;
    }
    const rows = (await Model.findAll(handle, { include: { [relation.name]: true } } as never)) as unknown as Record<
      string,
      unknown
    >[];
    const found = rows.find((row) => idsAt(row, relation.name).includes(cardId));
    return typeof found?.id === 'string' ? found.id : '';
  }

  /**
   * Write the one link a tree move is, through the relation it stands for: point the card at `parent`,
   * off `from`. `parent` null takes it off `from` and points it nowhere. Answers whether it was written.
   *
   * A to-one is the child's own field, written as an edit of the card (`core.editRecord`), `''` to
   * clear it, which every backend reads as "remove this field's links". The parent is spelled as the
   * card's model takes it: a one-element list where the field is a relation with accessors of its
   * own, the id itself where it is a plain property holding one — which is how an installed schema's
   * single-valued relation arrives on some backends, and the common case there, not an edge one.
   *
   * A to-many is the parent's list: off the old holder's, onto the new one's, in one write
   * (`core.moveUnder`), so no reader sees the card on neither list or on both.
   */
  async function writeLink(
    handle: unknown,
    relation: FollowedRelation,
    cardId: string,
    parent: string | null,
    from: string,
  ): Promise<boolean> {
    if (!heldByChild(relation)) {
      await runOp(
        'core.moveUnder',
        {
          holder: relation.holder,
          relation: relation.name,
          record: cardId,
          ...(from ? { from } : {}),
          ...(parent ? { to: parent } : {}),
        },
        handle,
      );
      return true;
    }
    const record = (await entityClass(relation.holder, handle).findOne(handle, {
      where: { id: cardId },
    } as never)) as Record<string, unknown> | null;
    // A card deleted between the drop and the write: nothing to point, which is not a failure.
    if (!record) return false;
    const suffix = relation.name.charAt(0).toUpperCase() + relation.name.slice(1);
    const accessed = typeof record[`set${suffix}`] === 'function' || typeof record[`add${suffix}`] === 'function';
    const value = parent ? (accessed ? [parent] : parent) : '';
    await runOp('core.editRecord', { entity: relation.holder, id: cardId, fields: { [relation.name]: value } }, handle);
    return true;
  }

  /**
   * Undo for a model-relation move — the relation half of {@link rememberTreeDrop}, on the same terms:
   * replayed forwards, and only while the link is still where this entry left it, so a card a peer has
   * moved since is left where they put it. One relation either way: a drop moves the link the card
   * hangs by and never another, so its undo is the same link pointed back.
   */
  function rememberRelationDrop(
    canvas: string,
    handle: unknown,
    relation: FollowedRelation,
    cardId: string,
    from: string,
    to: string,
    ranks: StyleChange[],
  ): void {
    if (!canvas || (from === to && !ranks.length)) return;
    const replay = async (target: string, leaving: string, direction: 'undo' | 'redo') => {
      if (target !== leaving && !(await writeLink(handle, relation, cardId, target || null, leaving))) {
        // The card is gone (or the link cannot be written): a silent no-op would read as the undo having
        // landed, so it is said.
        toasts.info('Could not take that move back — the record cannot be written from here.');
      }
      // A rank written back, expecting what this entry left there — as `rememberTreeDrop`'s are.
      for (const change of ranks) {
        if (direction === 'undo') await stylePlacement(canvas, change.nodeId, change.before, change.after);
        else await stylePlacement(canvas, change.nodeId, change.after, change.before);
      }
    };
    history.push({
      scope: canvas,
      label: to ? 'move card in tree' : 'take card out of tree',
      undo: async () => {
        if ((await parentThrough(handle, relation, cardId, to)) !== to) return;
        await replay(from, to, 'undo');
      },
      redo: async () => {
        if ((await parentThrough(handle, relation, cardId, from)) !== from) return;
        await replay(to, from, 'redo');
      },
    });
  }

  /**
   * Write a tree row's new ranks, all in one transaction (`core.rankCards`).
   *
   * Every rank is held before any is written and written together, so the tree reads the whole new
   * order at once: written one by one, a row being renumbered would pass through each half-written
   * order on its way, and take a round trip per card to get there. Each lands on the placement the
   * canvas draws for its card, picked from the rows the drop has already read.
   */
  async function writeRanks(
    handle: unknown,
    placements: readonly PlacementRow[],
    writes: ReadonlyMap<string, number>,
  ): Promise<void> {
    const ranks: { placement: string; rank: number }[] = [];
    let unplaced = false;
    for (const [nodeId, rank] of writes) {
      const { drawn } = drawnAmong(placements, nodeId);
      if (drawn) ranks.push({ placement: drawn.id, rank });
      else unplaced = true;
    }
    if (unplaced) toasts.error('Drag this onto the canvas first — how a card looks is saved with where it sits.');
    if (!ranks.length) return;
    const held = [...writes].filter(([nodeId]) => drawnAmong(placements, nodeId).drawn);
    for (const [nodeId, rank] of held) hold(nodeId, { rank });
    try {
      await runOp('core.rankCards', { ranks }, handle);
      for (const [nodeId, rank] of held) done(nodeId, { rank });
    } catch (error) {
      for (const [nodeId, rank] of held) drop(nodeId, { rank });
      console.error('RecordStore: ordering cards in a tree failed', error);
      toasts.error('Could not save that.');
    }
  }

  /**
   * Drag a card to another place in a tree along a *model relation* — the link a class declares — and
   * write that link.
   *
   * Which relation: the one the card hangs by, as the edge the drop reports names it
   * (`data.relation`, `Class.prop`) — a drop moves the link that made the card a child, whatever the
   * spine. A card that hangs by nothing takes the relation the spine names, or under "All model
   * relations" the first the two classes are joined by. The relation decides the classes a move may
   * join: a parent it cannot reach is refused rather than answered with some other field, which would
   * leave the card hanging by two links at once.
   */
  async function arrangeOnRelationTree(
    canvas: string,
    handle: unknown,
    spine: Spine,
    event: {
      recordId?: string;
      recordType?: string;
      pending?: boolean;
      changed?: boolean;
      edge?: { type?: string; data?: Record<string, unknown> };
      into?: 'child' | 'sibling' | 'loose';
      targetId?: string;
      targetType?: string;
      before?: boolean;
      order?: string[];
    },
  ): Promise<void> {
    const cardId = event.recordId!;
    const cardType = event.recordType!;

    /*
      A card still awaiting acceptance, or carrying a change nobody has saved, is not moved: the
      drop would write the record's field as if that record were settled, and there is no earlier
      settled state an undo could return it to.
      Whether one agent may rewrite *another* agent's record by dragging its card is intentionally
      not asked here — that is an open product question for Nico and Josh, and this guard waits on
      it rather than guessing.
    */
    if (event.pending || event.changed) {
      toasts.info(
        event.pending
          ? 'That card is still a suggestion — accept or discard it before moving it.'
          : 'Save or discard that card’s changes before moving it.',
      );
      return;
    }

    const followed = treeRelations();
    const byName = (name: string) => followed.find((relation) => `${relation.holder}.${relation.name}` === name);
    const hungBy =
      event.edge?.type === 'relation' && typeof event.edge.data?.relation === 'string' ? event.edge.data.relation : '';
    const named = hungBy || (spine.kind === 'relation' && spine.class ? `${spine.class}.${spine.prop}` : '');
    let relation = named ? byName(named) : undefined;
    /*
      The parent the tree drew the card under, when the edge it was dragged by is this relation's: a
      card a to-many lists from two holders hangs under each of them, and the drop moves the one it
      was picked up from.
    */
    const edgeHolder = (through: FollowedRelation) =>
      hungBy === `${through.holder}.${through.name}` && typeof event.edge?.data?.holder === 'string'
        ? event.edge.data.holder
        : undefined;
    if (named && !relation) {
      toasts.info('The tree does not follow that relation, so a card cannot be moved along it.');
      return;
    }

    if (event.into === 'loose') {
      if (!relation) return;
      const from = await parentThrough(handle, relation, cardId, edgeHolder(relation));
      // A card dragged around the zone it is already in has nothing to write.
      if (!from) return;
      if (!(await writeLink(handle, relation, cardId, null, from))) {
        toasts.info('That card could not be taken out of its tree — edit the record itself.');
        return;
      }
      rememberRelationDrop(canvas, handle, relation, cardId, from, '', []);
      return;
    }

    const targetId = event.targetId!;
    const targetType = event.targetType ?? '';
    /*
      Who the drop lands the card under. `child` names it; `sibling` asks where the sibling hangs — by
      the card's relation where it has one, else by whichever relation the sibling hangs by, which is
      the one the card would share with it. A sibling hanging by nothing is a root: dropping beside one
      would take the card out of its tree as a side effect.
    */
    let parentId = '';
    let parentType = '';
    if (event.into === 'child') {
      parentId = targetId;
      parentType = targetType;
    } else {
      for (const candidate of relation ? [relation] : followed) {
        if (endsOf(candidate).childType !== targetType) continue;
        const up = await parentThrough(handle, candidate, targetId);
        if (!up) continue;
        parentId = up;
        parentType = endsOf(candidate).parentType;
        relation ??= endsOf(candidate).childType === cardType ? candidate : undefined;
        break;
      }
      if (!parentId) {
        toasts.info('Drop a card in the unconnected area to take it out of its tree.');
        return;
      }
    }
    if (!parentId || parentId === cardId) return;

    relation ??= followed.find(
      (candidate) => endsOf(candidate).childType === cardType && endsOf(candidate).parentType === parentType,
    );
    if (!relation || endsOf(relation).childType !== cardType || endsOf(relation).parentType !== parentType) {
      toasts.info(`${cardType} has no relation that points at ${parentType || 'that record'}.`);
      return;
    }

    // A walk up the same relation, so a drop cannot put a card inside itself.
    const seen = new Set<string>([cardId]);
    let at = parentId;
    while (at && !seen.has(at) && endsOf(relation).childType === endsOf(relation).parentType) {
      seen.add(at);
      at = await parentThrough(handle, relation, at);
    }
    if (at === cardId) {
      toasts.info('That would put a card inside itself.');
      return;
    }

    const from = await parentThrough(handle, relation, cardId, edgeHolder(relation));
    // A drop beside its own siblings moves nothing but its place in the row — the ranks below still run.
    if (from !== parentId && !(await writeLink(handle, relation, cardId, parentId, from))) return;

    /*
      Siblings for the rank row — the children the drop lands beside, through the same relation: a
      child's own field asks its class for the rows pointing at the parent; a parent's list is read off
      the parent.
    */
    const Model = entityClass(relation.holder, handle);
    let siblings: string[] = [];
    if (heldByChild(relation)) {
      const rows = (await Model.findAll(handle, { where: { [relation.name]: parentId } } as never)) as unknown as {
        id?: string;
      }[];
      siblings = rows.map((row) => row.id).filter((id): id is string => typeof id === 'string');
    } else {
      const parent = (await Model.findOne(handle, {
        where: { id: parentId },
        include: { [relation.name]: true },
      } as never)) as Record<string, unknown> | null;
      siblings = parent ? idsAt(parent, relation.name) : [];
    }
    siblings = siblings.filter((id) => id !== cardId);

    const placements = await placementsOn(handle, canvas);
    // Only cards with a placement can hold a rank — see `ranksOf`.
    const { ranks, placed } = ranksOf(placements);
    const { row, index } = rowFor({
      card: cardId,
      siblings,
      ranks,
      order: event.order,
      target: targetId,
      into: event.into === 'child' ? 'child' : 'sibling',
      before: event.before,
    });
    const writes = new Map(
      seatInRow(row, cardId, index)
        .filter((write) => placed.has(write.id))
        .map((write) => [write.id, write.rank] as const),
    );
    await writeRanks(handle, placements, writes);
    rememberRelationDrop(
      canvas,
      handle,
      relation,
      cardId,
      from,
      parentId,
      [...writes].map(([nodeId, rank]) => ({ nodeId, before: { rank: ranks[nodeId] ?? 0 }, after: { rank } })),
    );
  }

  /**
   * Drag a card to another place in a tree, and write what that meant.
   *
   * The counterpart of `dragOnCanvas` for a canvas being read as a hierarchy. There the position *is*
   * the data, so a drag writes a coordinate; here the layout derives the position, so a drag writes
   * the structure the layout reads. The spine says which kind of connection the tree follows, which
   * the store cannot know: what makes a parent a parent is the community's own vocabulary and the
   * reader's current choice. A card hanging by a model relation — or by nothing, under a model-relation
   * spine — is moved by {@link arrangeOnRelationTree}.
   *
   * ## Reparenting moves the connection rather than replacing it
   *
   * A card already under a parent keeps the same `Relationship`, with its source moved — which is
   * exactly what `retargetOnCanvas` does when somebody drags a connection's end, and it is what keeps
   * whatever has been said about the connection rather than deleting an argument about the very claim
   * being rearranged.
   *
   * The cost, stated because it is real: the record keeps its original author, so the claim now reads
   * as that person having connected two things, one of which they did not choose. That is the tradeoff
   * dragging a connection's end already makes here, and the alternative loses the thread.
   *
   * ## Reordering beside a root is not a detach
   *
   * Dropping a card beside a tree's own root would make it a root too, which means taking it out of
   * its tree — and that is the one thing a drop must not do as a side effect. It is refused, with a
   * toast pointing at the unconnected zone, where the same act is explicit.
   */
  async function arrangeOnTree(canvas: string, spineValue: Spine | string, payload: unknown): Promise<void> {
    /*
      The spine as a typed value — `treeSpine` hands one over, and an older caller's spelling is read
      by the one codec. A connection spine is its kind's id, and "any" or a model relation is the empty
      kind, which the connection path reads as every kind.
    */
    const spine = parseSpine(spineValue);
    const relationshipTypeId = spine.kind === 'relationship' ? spine.id : '';
    const event = (payload ?? {}) as {
      recordId?: string;
      recordType?: string;
      pending?: boolean;
      changed?: boolean;
      edge?: { type?: string; data?: Record<string, unknown> };
      into?: 'child' | 'sibling' | 'loose';
      targetId?: string;
      targetType?: string;
      before?: boolean;
      order?: string[];
    };
    const dataset = datasetStore.currentDataset();
    /*
      The kind may be empty, and that is an answer rather than a missing argument: the tree is
      following every kind of connection, so this follows every kind too and mints a kindless one where it
      has to create a parent. A connection with no kind is what the canvas's own connect gesture already
      writes, and the layout draws it like any other — so refusing here would make the two disagree about
      what the tree is, which is what the toast about the unconnected area was really reporting.
    */
    if (!dataset || !canvas || !event.recordId || !event.recordType) return;
    if (event.into !== 'loose' && !event.targetId) return;
    // A card dropped on itself is a gesture that went nowhere, not a claim about anything.
    if (event.targetId === event.recordId) return;

    const handle = dataset.handle;
    const cardId = event.recordId;

    try {
      /*
        A `rel:` spine follows a model relation rather than a kind of connection, and the write is a
        field on the data rather than a record — a different path, kept out of the connection logic.
      */
      /*
        A drop moves the link the card hangs by. A card hanging by a model relation moves that field,
        whatever the spine — "Any connection" included — and one hanging by nothing under a model
        relation spine takes the spine's. Everything else is a connection somebody drew.
      */
      if (event.edge?.type === 'relation' || spine.kind === 'relation') {
        await arrangeOnRelationTree(canvas, handle, spine, event);
        return;
      }
      const { parentOf, childrenOf, parents } = spineIndex(await spineLinks(handle, relationshipTypeId));

      const card = { id: cardId, type: event.recordType };
      if (event.into === 'loose') {
        const held = parentOf.get(cardId);
        // A card dragged around the zone it is already in has nothing to write.
        if (held?.source && (await detachSpine(handle, held.id))) {
          const parent = { id: held.source, type: held.sourceType ?? '' };
          rememberTreeDrop(canvas, handle, relationshipTypeId, card, { kind: 'detached', link: held.id, parent }, []);
        }
        return;
      }

      const targetId = event.targetId!;
      const parentId = event.into === 'child' ? targetId : (parentOf.get(targetId)?.source ?? '');
      if (!parentId) {
        toasts.info('Drop a card in the unconnected area to take it out of its tree.');
        return;
      }
      if (parentId === cardId) return;
      if (isUnder(parentId, cardId, parents)) {
        toasts.info('That would put a card inside itself.');
        return;
      }

      /** The parent's entity name — named by the drop for a `child`, and read off the spine otherwise. */
      const parentType = event.into === 'child' ? (event.targetType ?? '') : (parentOf.get(targetId)?.sourceType ?? '');

      const held = parentOf.get(cardId);
      const parent = { id: parentId, type: parentType };
      let step: TreeStep = { kind: 'none' };
      if (held) {
        if (held.source !== parentId) {
          // Where it was, read before the write that moves it.
          const from = { id: held.source ?? '', type: held.sourceType ?? '' };
          await retargetOnCanvas(canvas, {
            recordId: held.id,
            recordType: RELATIONSHIP,
            end: 'source',
            nodeId: parentId,
            nodeType: parentType,
          });
          step = { kind: 'moved', link: held.id, from, to: parent };
        }
      } else {
        step = { kind: 'created', link: await createSpine(handle, relationshipTypeId, parent, card, false), parent };
      }

      const placements = await placementsOn(handle, canvas);
      const { ranks } = ranksOf(placements);
      const siblings = (childrenOf.get(parentId) ?? []).filter((id) => id !== cardId);

      /*
        The row as the reader saw the card land in it, when the drop says — see `order` on the event,
        and `rowFor` for why it is taken from the drop rather than worked out again here.
      */
      const { row, index } = rowFor({
        card: cardId,
        siblings,
        ranks,
        order: event.order,
        target: targetId,
        into: event.into === 'child' ? 'child' : 'sibling',
        before: event.before,
      });
      const writes = new Map(seatInRow(row, cardId, index).map((write) => [write.id, write.rank] as const));
      await writeRanks(handle, placements, writes);
      rememberTreeDrop(
        canvas,
        handle,
        relationshipTypeId,
        card,
        step,
        [...writes].map(([nodeId, rank]) => ({ nodeId, before: { rank: ranks[nodeId] ?? 0 }, after: { rank } })),
      );
    } catch (error) {
      console.error('RecordStore: arranging a card in a tree failed', error);
      toasts.error('Could not move that card.');
    }
  }

  return { arrangeOnTree };
}
