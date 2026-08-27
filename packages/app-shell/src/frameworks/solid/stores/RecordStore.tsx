/**
 * RecordStore — creating one instance of a model, whatever the model turns out to be.
 *
 * The counterpart to {@link ShapeStore}, and deliberately not part of it. That store is about
 * *defining* a model: an occasional, deliberate, admin-shaped act performed by whoever is shaping a
 * community's vocabulary. This one is about *using* one, which is an everyday act performed by
 * everybody. They share a manifest and nothing else — different audiences, different lifetimes, and
 * a wizard whose draft is a list of field declarations has nothing in common with a form whose
 * draft is a list of values.
 *
 * ## Why the draft lives in a store rather than in `$localState`
 *
 * Because the fields come from data. `$localState` names are fixed when a template is written, so a
 * form over a model chosen at runtime has no names to declare, and no `$setLocal` can address a
 * field nobody knew about. That is the same wall the shape wizard hit, and it is why `shapeDraft`
 * sits in a store too — not a preference about where state goes.
 *
 * ## Why it does not create posts
 *
 * A post is composed, not filled in: it is a `CollectionBlock` holding a tree of blocks, authored
 * through `BlockComposer`, which produces a serialized document rather than a set of field values.
 * A surface that offers both should offer the composer for that case and this for the rest — one
 * entry point, two bodies. Folding a document editor into a generated form would serve neither.
 */
import type { EntitySchema } from '@we/backend-shared';
import { createBlocks } from '@we/block-shared';
import { toastService } from '@we/components/solid';
import { PLACEMENT_UNSET } from '@we/graph-expanders';
import { getModel, Placement, PREDICATES, runModelTransaction, TypeStyle } from '@we/models';
import { CORE_MANIFEST } from '@we/models/manifest';
import { Accessor, batch, createContext, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import { dropAllPending, dropPending, holdPending, type PendingWrites } from '../../../shared/shapes/pendingWrites';
import { displayFor, type RecordDisplay } from '../../../shared/shapes/recordDisplay';
import {
  asEntityName,
  emptyRecordDraft,
  type RecordDraft,
  recordDraftErrors,
  recordDraftFields,
  writeFieldValue,
} from '../../../shared/shapes/recordDraft';
import { useDatasetStore } from './DatasetStore';
import { BLOCK_ICONS, useShapeStore } from './ShapeStore';

/** A `we-select` row: the model's name, drawn with its icon and grouped by where it comes from. */
export interface CreatableEntity {
  label: string;
  value: string;
  icon: string;
  group: string;
}

/** The two records a connection joins, exactly as the graph's `onEdgeCreate` reports them. */
export interface PendingLink {
  sourceId: string;
  sourceType: string;
  targetId: string;
  targetType: string;
  /** Display labels for the two ends, so the form can say what is being connected. */
  sourceLabel?: string;
  targetLabel?: string;
}

/** The model a drawn connection is written as. Named once, so the store and the form agree. */
const RELATIONSHIP = 'Relationship';

/**
 * Write one placement, node reference included, inside whatever write group the caller is in.
 *
 * The reference goes in as a **one-element array**, which is what makes it part of the same commit.
 * The ORM skips a relation field handed a plain value — that is the trap `Relationship`'s endpoints
 * hit — and the generated `setNode` accessor takes no batch, so linking afterwards would commit
 * separately and reintroduce the intermediate state. An array value routes through
 * `setRelationValues` *with* the batch, which is the documented path and the only one that composes.
 */
async function createPlacement(
  dataset: unknown,
  parent: { id: string; predicate: string },
  nodeId: string,
  nodeType: string,
  at: { x: number; y: number },
  batchId?: string,
): Promise<void> {
  await Placement.create(
    dataset as never,
    { nodeType, x: at.x, y: at.y, node: [nodeId] } as never,
    { parent, ...(batchId ? { batchId } : {}) } as never,
  );
}

export interface RecordStore {
  /**
   * Models a person can create an instance of here — this space's own first, then WE's own.
   *
   * Built in the store because a schema can `$map` a store array into options but cannot merge two
   * sources and group them, and because the answer changes with the space: a community that has
   * defined three models should see three more entries than one that has defined none.
   */
  creatableEntities: Accessor<CreatableEntity[]>;
  /**
   * The open form's draft, or null while closed — its non-nullness is what mounts the modal, the
   * same shape `shapeStore.shapeDraft` uses.
   */
  recordDraft: Accessor<RecordDraft | null>;
  /**
   * Whether the open form holds anything worth keeping — what a "discard this?" guard reads.
   *
   * Here rather than in the template because the fields come from the *model*: a shape a community
   * defined this morning has properties no schema was written against, so there is no set of
   * `$local` names for an expression to test. The store is the only place that can see them.
   *
   * A pristine form — opened and not typed in — closes without ceremony. Asking there would train
   * the answer out of anyone, which costs them the one time it was about something real.
   */
  recordDraftDirty: Accessor<boolean>;
  /**
   * How to show an instance of each model a person can create here, keyed by entity name — the
   * read-side counterpart of `recordDraft`, derived from the same declarations.
   *
   * What lets a template render a record of a type it was not written for: `displays[type]` says
   * which property is the title, which the summary, which the picture, and which fields to list
   * and how. A community shape defined this morning renders in a feed that has never heard of it,
   * which is the whole point — a content type that is manifest + fragments needs no component.
   */
  displays: Accessor<Record<string, RecordDisplay>>;
  /** Validation errors from the last save attempt. */
  recordErrors: Accessor<string[]>;
  savingRecord: Accessor<boolean>;
  /**
   * The id of the last record created, empty before the first.
   *
   * Read by a surface that wants to do something with what was just made — select the new node on a
   * graph, scroll to the new row. Kept rather than passed to a callback because `$action`'s
   * `onSuccess` can read a store and cannot hold a value.
   */
  lastCreatedId: Accessor<string>;

  /**
   * The two records a pending connection joins, or null when the open form is an ordinary one.
   *
   * Read by a form that wants to name what is being connected — "Post → Sighting" above the label
   * field is the difference between filling in a form and knowing what you are asserting.
   */
  pendingLink: Accessor<PendingLink | null>;

  /**
   * Open the form: on the named model, or on the first one this space offers.
   *
   * Takes `unknown` rather than `string | undefined` because a template writing
   * `{ $action: 'recordStore.openRecordForm' }` with no `args` hands it the DOM event — anything
   * that is not a model name is treated as "no model named".
   */
  openRecordForm: (entity?: unknown) => void;
  /**
   * Open the form on a `Relationship` joining these two records.
   *
   * Takes the `onEdgeCreate` payload as it arrives. The same form and the same save path as any
   * other record — a relationship is one, and its `authoring` declaration already names the two
   * fields a person fills in — with the endpoints held here rather than in the draft, because they
   * came from a gesture rather than from typing and nothing should offer to edit them.
   */
  connectNodes: (link: PendingLink) => void;
  /** Switch which model is being created, discarding the values typed against the last one. */
  setRecordEntity: (entity: string) => void;
  /** Set one field's value. Takes the field name, so one action serves every control. */
  setRecordField: (name: string, value: string | number | boolean) => void;
  /**
   * Which named kind the pending connection is, or empty for one carrying only a label.
   *
   * Held beside the draft rather than in it, because `relationshipTypeId` is deliberately absent
   * from `Relationship.authoring.fields`: the kinds are a list to pick from, and a generated form
   * would render the field as a text box asking somebody to type an id.
   */
  relationshipKind: Accessor<string>;
  setRelationshipKind: (id: unknown) => void;
  cancelRecordForm: () => void;
  /** Validate and create. Errors land in `recordErrors`; success closes the form. */
  saveRecord: () => Promise<void>;

  /**
   * Put a record at a position on a board, or move one already there.
   *
   * An upsert, because dragging the same card twice must not leave two coordinates for it. The
   * board is the parent; a record can be placed on as many boards as somebody puts it on, each with
   * its own position, which is the whole reason a coordinate is not a field on the record.
   */
  placeOnBoard: (board: string, nodeId: string, nodeType: string, x: number, y: number) => Promise<void>;
  /**
   * Take a record off a board, leaving the record itself alone.
   *
   * Deleting the placement and nothing else — which is the whole payoff of placement being
   * membership. Being on a board was never what made a record exist, so coming off one cannot be
   * what ends it: a task removed from a board is still owned by the call it came out of, and a card
   * the board owns survives as an unplaced one in the tray, where it can be dragged back or deleted
   * outright.
   */
  removeFromBoard: (board: string, nodeId: string) => Promise<void>;
  /**
   * Resize a card on a board. Takes the graph's `onNodeResize` payload as it arrives.
   *
   * The size goes on the placement, beside the position, for the reason the position is there: it is
   * a fact about a pair. Shrinking a post to fit six of them on a wall is not editing the post, and
   * the same post on somebody else's board must not change size because of it.
   */
  resizeOnBoard: (board: string, payload: unknown) => Promise<void>;
  /**
   * Set one presentation property of one card on one board — colour, shape, content scale.
   *
   * Takes the property name, so one action serves every control, which is the only shape that works
   * when a swatch, a picker and a slider all write to the same record. Nothing here touches the
   * record being displayed: every one of these is undone by taking the card off the board.
   */
  setCardStyle: (board: string, nodeId: string, field: string, value: unknown) => Promise<void>;
  /**
   * Placement fields written but not yet read back, keyed by the placed record's id.
   *
   * The optimistic half of every board gesture that writes presentation. A resize, a colour or a
   * shape is answered by a record, and the answer comes back through a subscription and a re-read —
   * a round trip at best, and a re-seed of the whole board after it. A slider that lags that far
   * behind the finger reads as broken rather than as slow, so the change is drawn immediately and
   * this is what says so.
   *
   * Cleared by {@link confirmPending} once the graph is drawing the real value, so the optimistic
   * value and the stored one are never both authoritative for longer than that. A failed write
   * clears it too, which is what makes the card snap back to the truth rather than lying about a
   * change that did not happen.
   */
  pendingCardStyle: Accessor<PendingWrites>;
  /**
   * Forget the pending fields for these records — whatever draws them now has the real values.
   *
   * Called by whoever draws on the store's behalf, which is the graph host today. Reported from the
   * drawing rather than judged here, because a read landing is not the same moment as a card being
   * redrawn from it: clearing on the read put the old value back for the rest of the seed, so an
   * edit flashed to its new size, snapped back, and arrived again.
   */
  confirmPending: (recordIds: readonly string[]) => void;
  /**
   * Show a presentation change without writing it — for a control that reports while it is moving.
   *
   * The half of `setCardStyle` that costs nothing: a slider emits continuously as it is dragged and
   * a write per frame would be absurd, but waiting for the release to see the result means choosing
   * a size blind. So the drag previews and the release writes, and because both go through the same
   * pending map the card never jumps between them.
   */
  previewCardStyle: (nodeId: string, field: string, value: unknown) => void;
  /**
   * Set the colour every card of one type is drawn in, on one board.
   *
   * The board's key, made writable. A colour per *type* rather than per card because that is what a
   * legend is: "tasks are amber here" is a fact about the board, said once, and re-deciding it on
   * every card somebody adds is the thing a key exists to avoid. Per board rather than per type,
   * because two boards in the same space legitimately disagree about which question they are
   * colouring by. An empty colour clears it.
   */
  setTypeColor: (board: string, nodeType: string, color: unknown) => Promise<void>;
  /**
   * Open the create form, and place whatever it makes onto this board.
   *
   * The counterpart to `connectNodes`: the same form and the same save path, with an intent held
   * beside it. Without this, creating a model instance from a board makes a real record that simply
   * does not appear on the board it was made from — which is the confusion the button was hidden to
   * avoid, and hiding it was the wrong answer.
   */
  createOnBoard: (board: string, x?: number, y?: number) => void;
  /**
   * Compose a card onto a board, and record where it sits — as one write.
   *
   * The composer's counterpart to `createOnBoard`, and one action rather than two because two would
   * be two commits. Anything watching the data layer sees every commit, so a card written first and
   * positioned second is a card the board draws unpositioned and then moves.
   *
   * `at` omitted — the toolbar's "Card", which names no point — creates the card and no placement,
   * so it lands in the tray. That is the honest answer to "nobody said where", and the tray is where
   * it is recoverable from.
   */
  createCardOnBoard: (editorState: unknown, options: { board: string; at?: { x: number; y: number } }) => Promise<void>;
}

const RecordStoreContext = createContext<RecordStore>();

export function RecordStoreProvider(props: ParentProps) {
  const datasetStore = useDatasetStore();
  const shapeStore = useShapeStore();

  const [recordDraft, setRecordDraft] = createSignal<RecordDraft | null>(null);
  const [recordErrors, setRecordErrors] = createSignal<string[]>([]);
  const [savingRecord, setSavingRecord] = createSignal(false);
  const [lastCreatedId, setLastCreatedId] = createSignal('');
  const [pendingLink, setPendingLink] = createSignal<PendingLink | null>(null);
  const [pendingBoard, setPendingBoard] = createSignal('');
  const [relationshipKind, setKind] = createSignal('');
  const [pendingPoint, setPendingPoint] = createSignal<{ x: number; y: number } | null>(null);

  /**
   * WE's own authorable models, read straight off the core manifest.
   *
   * Derived rather than listed, so a model that gains an `authoring` declaration appears here with
   * no second edit in a different package — the failure mode a hardcoded table has is that it is
   * correct on the day it is written and silently stale afterwards.
   */
  const coreEntities = createMemo<CreatableEntity[]>(() =>
    Object.entries(CORE_MANIFEST.entities)
      .filter(([name, entity]) => entity.authoring?.fields.length && name !== RELATIONSHIP)
      .map(([name]) => ({ label: name, value: name, icon: BLOCK_ICONS[name] ?? 'cube', group: 'Built in' }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  /** Models this community defined. Healthy ones only — a shape that failed adoption is not queryable. */
  const shapeEntities = createMemo<CreatableEntity[]>(() =>
    shapeStore
      .spaceShapes()
      .filter((shape) => shape.manifest && !shape.problems.length)
      .map((shape) => ({
        label: shape.name,
        value: shape.name,
        icon: shape.icon || 'cube',
        group: 'This space',
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  // This space's own first: a community that has modelled its vocabulary means those models, and
  // WE's built-ins are the fallback rather than the headline.
  const creatableEntities = createMemo<CreatableEntity[]>(() => [...shapeEntities(), ...coreEntities()]);

  /**
   * The schema behind a name, and whether every property of it belongs to the author.
   *
   * A community shape carries its own manifest and is authorable in full; a core entity is offered
   * only the fields it declared. Shapes are consulted first so a space that names a model after one
   * of WE's own gets its own, which is the same precedence the graph host uses in reverse and for
   * the same reason — whichever is more local should win where the two can collide.
   */
  function schemaFor(entity: string): { schema: EntitySchema; authorable: boolean; icon: string } | undefined {
    const shape = shapeStore.spaceShapes().find((row) => row.name === entity && row.manifest);
    const fromShape = shape?.manifest?.entities[entity];
    if (fromShape) return { schema: fromShape, authorable: true, icon: shape?.icon || 'cube' };

    const core = CORE_MANIFEST.entities[entity];
    if (core) return { schema: core, authorable: false, icon: BLOCK_ICONS[entity] ?? 'cube' };
    return undefined;
  }

  /*
    One display per creatable model, from the same declarations the forms come from.

    A map rather than a lookup action because a template reads it in a value position — a feed
    indexes it by each row's type — and `$action` cannot return a value. Recomputed when the
    space's shapes change, so a model defined a moment ago has a display a moment later.
  */
  const displays = createMemo<Record<string, RecordDisplay>>(() => {
    const out: Record<string, RecordDisplay> = {};
    for (const entity of creatableEntities()) {
      const found = schemaFor(entity.value);
      if (!found) continue;
      out[entity.value] = displayFor({
        entity: entity.value,
        label: entity.label,
        icon: found.icon,
        schema: found.schema,
        authorable: found.authorable,
      });
    }
    return out;
  });

  /*
    `entity` is typed loosely because of how `$action` calls a store method.

    A token with no `args` forwards the handler's own arguments, so
    `{ $action: 'recordStore.openRecordForm' }` on a button arrives here holding a `PointerEvent`.
    That is right for the common case — it is how `onChange: { $action: … }` passes a value through —
    and it means *any* store method with an optional leading parameter can be handed an event by a
    template that was written the obvious way. It surfaced as a toast reading
    `No model named "[object PointerEvent]" in this space`, which at least said what had happened.

    Guarded here as well as at the call site, because the trap belongs to `$action` rather than to
    any one template, and there will be more call sites than there are stores.
  */
  function openRecordForm(entity?: unknown): void {
    const named = asEntityName(entity);
    batch(() => {
      setRecordErrors([]);
      setRecordDraft(null);
      // A form opened from a button is not a connection, and is not aimed at a board, whatever the
      // last one was. Left set, the next ordinary record created would silently be linked to two
      // nodes somebody connected earlier, or land on a board they had closed — a wrong write with
      // nothing on screen to suggest it happened.
      setPendingLink(null);
      setPendingBoard('');
      setKind('');
      setPendingPoint(null);
    });
    // Opening on the first offered model rather than on an empty picker: in a space with one
    // vocabulary that is the only answer, and in a space with several it is still a better start
    // than a form with nothing in it.
    const target = named || creatableEntities()[0]?.value;
    if (target) setRecordEntity(target);
  }

  function setRecordEntity(entity: string): void {
    const found = schemaFor(entity);
    if (!found) {
      // Nothing here can render a form for a model this space does not have, and a modal that opens
      // empty is worse than one that says why.
      toastService.error(`No model named "${entity}" in this space.`);
      return;
    }
    batch(() => {
      setRecordErrors([]);
      setRecordDraft(
        emptyRecordDraft({ entity, schema: found.schema, authorable: found.authorable, icon: found.icon }),
      );
    });
  }

  /**
   * Write one field's value in place, and deliberately do not touch the signal.
   *
   * `$each` renders rows with Solid's `<For>`, which keys on **object identity**. Replacing the
   * draft on every keystroke made every row a new object, so every control was torn down and
   * rebuilt — and the input being typed into lost focus after a single character.
   *
   * The shape wizard already solved this, and its comment says so: typed fields are mutated without
   * touching the draft signal "so inputs keep focus". An earlier version of this function dismissed
   * that as a cost the wizard paid for reasons that did not apply here, on the grounds that nothing
   * downstream derives from a value. That reasoning was beside the point — `<For>` does not care
   * what a value is *for*, only whether the object holding it is the same one as last time.
   *
   * Nothing has to be published, which is what makes the mutation safe rather than merely expedient:
   * which control a row renders comes from `field.control`, validation runs at save, and the typed
   * text is already in the DOM. The wizard needs `commitDraft` because its rows *do* derive things
   * from what is typed; this one has nothing to keep in step.
   */
  function setRecordField(name: string, value: string | number | boolean): void {
    writeFieldValue(recordDraft(), name, value);
  }

  /** Takes `unknown` for the reason `openRecordForm` does — a picker's event can arrive here. */
  function setRelationshipKind(id: unknown): void {
    setKind(asEntityName(id));
  }

  function connectNodes(link: PendingLink): void {
    if (!link.sourceId || !link.targetId) return;
    batch(() => {
      setPendingLink(link);
      setRecordEntity(RELATIONSHIP);
    });
  }

  /**
   * Anything typed into the open form.
   *
   * Compared against the field's *empty* value rather than against what it was seeded with, because
   * this form only ever creates — there is no edit path through it, so "seeded" is the default the
   * model declares and changing it away from that is the author's doing. A boolean is deliberately
   * not counted: a checkbox starts false and toggling it back is not work worth a dialog.
   */
  const recordDraftDirty = createMemo(() => {
    const draft = recordDraft();
    if (!draft) return false;
    return draft.fields.some((f) =>
      typeof f.value === 'string' ? f.value.trim() !== '' : typeof f.value === 'number',
    );
  });

  function cancelRecordForm(): void {
    batch(() => {
      setRecordDraft(null);
      setRecordErrors([]);
      setPendingLink(null);
      setPendingBoard('');
      setKind('');
      setPendingPoint(null);
    });
  }

  function createOnBoard(board: string, x?: number, y?: number): void {
    if (!board) return;
    openRecordForm();
    batch(() => {
      setPendingBoard(board);
      // A point only when somebody chose one — a double-click on the canvas has one, a toolbar
      // button does not. Inventing `(0, 0)` for the second case is what made a new record appear at
      // the world origin, which is wherever the reader is not looking.
      setPendingPoint(x !== undefined && y !== undefined ? { x, y } : null);
    });
  }

  /**
   * Compose a card onto a board and place it, in one write group.
   *
   * `createBlocks` transacts internally, so it takes the batch rather than opening its own — see
   * `runModelTransaction`'s `join`. Everything here lands as a single commit, which is the whole
   * point: the board never observes a card that exists but is not yet anywhere.
   */
  async function createCardOnBoard(
    editorState: unknown,
    options: { board: string; at?: { x: number; y: number } },
  ): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !options.board) return;
    const parent = { id: options.board, predicate: PREDICATES.CHILDREN };

    try {
      await runModelTransaction(dataset.handle, async (tx) => {
        const root = (await createBlocks(dataset.handle as never, editorState as never, {
          kind: 'card',
          anchor: parent,
          batchId: tx.batchId,
        })) as { id?: string } | undefined;

        if (!options.at || !root?.id) return;
        await createPlacement(dataset.handle, parent, root.id, 'CollectionBlock', options.at, tx.batchId);
      });
    } catch (error) {
      console.error('RecordStore: creating a card on a board failed', error);
      toastService.error('Could not add that card.');
    }
  }

  /**
   * Upsert the coordinate for one node on one board.
   *
   * Read-then-write rather than blind create, because dragging a card twice must not leave two
   * placements for it — and a board that accumulated one per drag would slow down in exactly
   * proportion to how much anybody used it.
   *
   * The read is scoped to the board's own children rather than filtered across every placement in
   * the space: the parent link is what makes a placement belong to a board, so asking the board is
   * both cheaper and the only phrasing that stays correct when the same record sits on two.
   */
  async function placeOnBoard(board: string, nodeId: string, nodeType: string, x: number, y: number): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !board || !nodeId) return;
    const parent = { id: board, predicate: PREDICATES.CHILDREN };

    try {
      const existing = (await Placement.findAll(dataset.handle, { parent } as Record<string, unknown>)) as {
        id: string;
        node?: string;
      }[];

      const already = existing.find((row) => row.node === nodeId);
      if (already) {
        await Placement.update(dataset.handle, already.id, { x, y });
        return;
      }

      await createPlacement(dataset.handle, parent, nodeId, nodeType, { x, y });
    } catch (error) {
      console.error('RecordStore: placing a record on a board failed', error);
      toastService.error('Could not save that position.');
    }
  }

  /** The presentation a placement may carry, and the only keys `setCardStyle` will write. */
  const CARD_STYLE_FIELDS = ['width', 'height', 'contentScale', 'color', 'cardShape'] as const;

  const [pendingCardStyle, setPendingCardStyle] = createSignal<PendingWrites>({});

  const hold = (nodeId: string, patch: Record<string, unknown>) =>
    setPendingCardStyle((current) => holdPending(current, nodeId, patch));
  const drop = (nodeId: string) => setPendingCardStyle((current) => dropPending(current, nodeId));

  function confirmPending(recordIds: readonly string[]): void {
    if (!Object.keys(pendingCardStyle()).length) return;
    setPendingCardStyle((current) => dropAllPending(current, recordIds));
  }

  /**
   * Patch the placement for one node on one board.
   *
   * Refuses rather than creating one, and says so: a node with no placement is an unplaced card in
   * the tray, and a placement minted here would have to invent a position — putting the card at the
   * board's origin as a side effect of choosing a colour.
   */
  async function stylePlacement(board: string, nodeId: string, patch: Record<string, unknown>): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !board || !nodeId || !Object.keys(patch).length) return;
    // Before the write, not after it: the point is that the card changes on the gesture rather than
    // on the round trip. Dropped again below if the write turns out not to be possible.
    hold(nodeId, patch);
    try {
      const existing = (await Placement.findAll(dataset.handle, {
        parent: { id: board, predicate: PREDICATES.CHILDREN },
      } as Record<string, unknown>)) as { id: string; node?: string }[];
      const already = existing.find((row) => row.node === nodeId);
      if (!already) {
        drop(nodeId);
        toastService.error('Drag this onto the board first — how a card looks is saved with where it sits.');
        return;
      }
      await Placement.update(dataset.handle, already.id, patch);
    } catch (error) {
      drop(nodeId);
      console.error('RecordStore: styling a card on a board failed', error);
      toastService.error('Could not save that.');
    }
  }

  async function resizeOnBoard(board: string, payload: unknown): Promise<void> {
    const event = (payload ?? {}) as { recordId?: string; width?: number; height?: number; x?: number; y?: number };
    if (!event.recordId || !event.width || !event.height) return;
    // Position travels with the size. Resizing from one edge anchors the other, and a card drawn
    // from its centre has to move that centre to hold an edge still — so writing only the size would
    // slide the card sideways by half the change every time.
    await stylePlacement(board, event.recordId, {
      width: Math.round(event.width),
      height: Math.round(event.height),
      ...(typeof event.x === 'number' ? { x: Math.round(event.x) } : {}),
      ...(typeof event.y === 'number' ? { y: Math.round(event.y) } : {}),
    });
  }

  /**
   * One presentation field, as a value the placement can hold.
   *
   * Accepts an event or a raw value: a `we-slider` hands back `$event.detail`, but a swatch button
   * has no detail to pass and sends the value itself. Reading both means the template says what it
   * means at every call site instead of choosing between an action per control and a wrapper.
   *
   * The empty string becomes {@link PLACEMENT_UNSET}, because an empty string cannot be *stored*: the
   * ORM's update skips `''` exactly as it skips `undefined`, so "no colour of its own" would be
   * unwritable — a card could be given an override and never have it taken away. A named value the
   * board seed drops is the same trick `SpacePreference` uses for its two sentinels.
   */
  function cardStyleValue(field: string, value: unknown): string | number | undefined {
    if (!(CARD_STYLE_FIELDS as readonly string[]).includes(field)) {
      console.warn(`RecordStore: "${field}" is not a card presentation property`);
      return undefined;
    }
    const raw =
      value !== null && typeof value === 'object' && 'detail' in value ? (value as { detail: unknown }).detail : value;
    if (typeof raw === 'number') return raw;
    return typeof raw === 'string' && raw ? raw : PLACEMENT_UNSET;
  }

  function previewCardStyle(nodeId: string, field: string, value: unknown): void {
    const scalar = cardStyleValue(field, value);
    if (scalar === undefined || !nodeId) return;
    hold(nodeId, { [field]: scalar });
  }

  async function setCardStyle(board: string, nodeId: string, field: string, value: unknown): Promise<void> {
    const scalar = cardStyleValue(field, value);
    if (scalar === undefined) return;
    await stylePlacement(board, nodeId, { [field]: scalar });
  }

  async function setTypeColor(board: string, nodeType: string, color: unknown): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !board || !nodeType) return;
    const raw =
      color !== null && typeof color === 'object' && 'detail' in color ? (color as { detail: unknown }).detail : color;
    // The same sentinel a card's own colour uses, and for the same reason: `''` cannot be stored, so
    // without it a type could be given a colour and never have it taken away.
    const value = typeof raw === 'string' && raw ? raw : PLACEMENT_UNSET;
    const parent = { id: board, predicate: PREDICATES.CHILDREN };

    try {
      // An upsert against the board's own children, exactly as a placement is: the parent link is
      // what makes a style belong to a board, and colouring a type twice must not leave two records
      // disagreeing about it.
      const existing = (await TypeStyle.findAll(dataset.handle, { parent } as Record<string, unknown>)) as {
        id: string;
        nodeType?: string;
      }[];
      const already = existing.find((row) => row.nodeType === nodeType);
      if (already) {
        await TypeStyle.update(dataset.handle, already.id, { color: value });
        return;
      }
      // Nothing to clear that was never set.
      if (value === PLACEMENT_UNSET) return;
      await TypeStyle.create(dataset.handle as never, { nodeType, color: value } as never, { parent } as never);
    } catch (error) {
      console.error('RecordStore: colouring a type on a board failed', error);
      toastService.error('Could not save that colour.');
    }
  }

  async function removeFromBoard(board: string, nodeId: string): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !board || !nodeId) return;
    try {
      const existing = (await Placement.findAll(dataset.handle, {
        parent: { id: board, predicate: PREDICATES.CHILDREN },
      } as Record<string, unknown>)) as { id: string; node?: string }[];
      // Every placement for this node, not the first: a duplicate should not survive the removal and
      // silently put the thing back on the board at the next refresh.
      for (const row of existing.filter((placement) => placement.node === nodeId)) {
        await Placement.delete(dataset.handle, row.id);
      }
    } catch (error) {
      console.error('RecordStore: removing a record from a board failed', error);
      toastService.error('Could not remove that.');
    }
  }

  async function saveRecord(): Promise<void> {
    const draft = recordDraft();
    const dataset = datasetStore.currentDataset();
    if (!draft || !dataset) return;

    const errors = recordDraftErrors(draft);
    if (errors.length) {
      setRecordErrors(errors);
      return;
    }

    setSavingRecord(true);
    try {
      const Model = getModel(draft.entity);
      const link = pendingLink();
      /*
        The endpoint *types* go in with the fields; the endpoints themselves are linked after.

        They are two different kinds of write. `sourceType` is an ordinary property, and the ORM
        writes those from the create payload. A relation is not: `innerUpdate` explicitly skips a
        relation field holding a plain value, so `create(p, { source: uri })` typechecks, runs, and
        writes no link at all — which would leave a relationship record with no ends, drawn nowhere
        and findable only by looking for it.
      */
      const fields = recordDraftFields(draft);
      if (link) {
        Object.assign(fields, { sourceType: link.sourceType, targetType: link.targetType });
        // Only when one was chosen: an empty string would write a reference to a kind that does not
        // exist, and the ORM cannot later clear it — see `recordDraftFields` on blank optionals.
        if (relationshipKind()) Object.assign(fields, { relationshipTypeId: relationshipKind() });
      }

      /*
        Created *inside* the board when there is one, not merely positioned on it.

        A board holds things by containment and positions them by placement — two facts, and it
        needs both. Writing only the placement made a record that existed, had a coordinate, and was
        invisible: the board's seed asks for each type among the board's own children, and a record
        created loose in the space is nobody's child. It turned up in the cards route, which asks the
        space rather than the board, which is exactly the shape of that bug from the outside.
      */
      const board = pendingBoard();
      const created = (await Model.create(
        dataset.handle,
        fields,
        board ? { parent: { id: board, predicate: PREDICATES.CHILDREN } } : undefined,
      )) as {
        id?: string;
        setSource?: (value: string) => Promise<unknown>;
        setTarget?: (value: string) => Promise<unknown>;
      };

      if (link) {
        await created.setSource?.(link.sourceId);
        await created.setTarget?.(link.targetId);
      }

      /*
        Placed only where somebody chose a point, and after the record exists.

        After, because a placement points at something and placing first would leave a coordinate for
        nothing. Only-where-chosen, because a record with no placement is *unplaced* — the layout
        parks it in a tray in view, which is a state a person can see and act on. Writing `(0, 0)`
        instead dressed "nobody said" up as an answer, and put the card at the world origin.
      */
      const at = pendingPoint();
      if (board && at && created?.id) await placeOnBoard(board, created.id, draft.entity, at.x, at.y);

      batch(() => {
        setLastCreatedId(created?.id ?? '');
        setRecordDraft(null);
        setRecordErrors([]);
        setPendingLink(null);
        setPendingBoard('');
        setKind('');
        setPendingPoint(null);
      });
      toastService.success(`${draft.label} created.`);
    } catch (error) {
      // Reported into the form rather than only as a toast: the modal stays open holding what was
      // typed, so a failure is something to correct rather than something that loses the work.
      const message = error instanceof Error ? error.message : String(error);
      setRecordErrors([message]);
      console.error('RecordStore: creating a record failed', error);
    } finally {
      setSavingRecord(false);
    }
  }

  const store: RecordStore = {
    creatableEntities,
    recordDraft,
    recordDraftDirty,
    displays,
    recordErrors,
    savingRecord,
    lastCreatedId,
    pendingLink,
    openRecordForm,
    connectNodes,
    createOnBoard,
    createCardOnBoard,
    placeOnBoard,
    removeFromBoard,
    pendingCardStyle,
    confirmPending,
    previewCardStyle,
    resizeOnBoard,
    setCardStyle,
    setTypeColor,
    setRecordEntity,
    setRecordField,
    relationshipKind,
    setRelationshipKind,
    cancelRecordForm,
    saveRecord,
  };

  return <RecordStoreContext.Provider value={store}>{props.children}</RecordStoreContext.Provider>;
}

export function useRecordStore(): RecordStore {
  const ctx = useContext(RecordStoreContext);
  if (!ctx) throw new Error('useRecordStore must be used within RecordStoreProvider');
  return ctx;
}

// Re-exported so a consumer needs one import for the store and the shape of what it holds.
export type { RecordDraft, RecordField } from '../../../shared/shapes/recordDraft';
