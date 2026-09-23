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
import {
  datasetIdOf,
  datasetKey,
  datasetKindOf,
  type EntitySchema,
  formatRef,
  HERE,
  namePropertyOf,
} from '@we/backend-shared';
import { type ContentInput, copyableContent, createBlock, createBlocks, deleteBlocks } from '@we/block-shared';
import { toastService } from '@we/components/solid';
import {
  CollectionBlock,
  compressImageToFileData,
  dataURIToFileData,
  EdgeRoute,
  getEntity,
  getEntityForDataset,
  Placement,
  PREDICATES,
  runEntityTransaction,
  TypeStyle,
} from '@we/entities';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { PLACEMENT_UNSET, resolvePlacement } from '@we/graph-expanders';
import { createHistory, type HistoryState } from '@we/history';
import { createOptimism, keyOf, sameValue } from '@we/optimism';
import { Accessor, batch, createContext, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import { bringIn as decideBringIn, type BringInItem, type BroughtIn } from '../../../shared/bringIn';
import { routeWrite } from '../../../shared/edgeRoute';
import { hostSlot } from '../../../shared/hostSlot';
import { notifyCopiedIn } from '../../../shared/registries/moduleHostServices';
import { displayFor, modelLabel, type RecordDisplay } from '../../../shared/shapes/recordDisplay';
import {
  asEntityName,
  type CreationPath,
  creationPath,
  emptyRecordDraft,
  entryLabel,
  fieldsFor,
  type RecordDraft,
  recordDraftChanged,
  recordDraftErrors,
  recordDraftFields,
  type RecordField,
  type RecordFieldValue,
  type RelationEntry,
  type RelationTargetAbilities,
  withoutRelationEntry,
  withPlace,
  withRelationEntry,
  writeFieldValue,
} from '../../../shared/shapes/recordDraft';
import { type AppDataset, useDatasetStore } from './DatasetStore';
import { useSessionStore } from './SessionStore';
import { BLOCK_ICONS, useShapeStore } from './ShapeStore';

/** A `we-select` row: the model's name, drawn with its icon and grouped by where it comes from. */
export interface CreatableEntity {
  label: string;
  value: string;
  icon: string;
  group: string;
  /** What this kind of thing is, in a line — the manifest's `description`, or the shape's. Empty when neither says. */
  description: string;
  /**
   * How it is made. A surface that can only host a form — the record form's type selector — lists
   * the `form` ones; a surface that can open the composer too (a canvas) lists them all.
   */
  via: CreationPath;
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
 * Models that can be *shown* but are not content anybody creates from a picker — see
 * {@link displayableEntities}. Every core block is shown as well, whether or not it can be made.
 *
 * `Relationship` is drawn between two things rather than filled in from a picker, and it is read
 * constantly all the same: a line on a canvas is one, and clicking it is exactly the moment somebody
 * wants to read it.
 */
const DISPLAY_ONLY = [RELATIONSHIP] as const;

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

/**
 * A stored placement, as this file reads one back.
 *
 * Loose beyond the three fields anything here names, because the interesting use is putting a
 * *whole* placement back: undoing "take these cards off the canvas" has to restore the size, colour,
 * shape and stacking they were wearing, and a type listing those by name would have to be extended
 * every time a placement grows a field — which is precisely the day it would be forgotten and the
 * undo would quietly restore a card stripped of its presentation.
 */
type PlacementRow = { id: string; node?: string; tier?: string } & Record<string, unknown>;

/**
 * The placement a canvas draws for one node — the row a write to that card has to land on.
 *
 * Chosen by `resolvePlacement`, the canvas seed's own rule, rather than by `find`. Two people placing
 * the same card before either placement syncs leave two rows, and a writer taking the first while
 * the canvas drew another sent every later drag to a row nobody saw: the card snapped back, for
 * everyone, however often it was moved.
 *
 * The rows it outranks are deleted. They were never drawn, so nothing visible is lost, and the pick
 * is a function of the rows alone — every peer holding the same rows keeps the same one, so two
 * peers tidying at once cannot each delete the other's survivor. Only rows at the survivor's own
 * tier go: a placement for another breakpoint is not a duplicate of it.
 */
async function drawnPlacement(
  dataset: unknown,
  parent: { id: string; predicate: string },
  nodeId: string,
): Promise<PlacementRow | undefined> {
  const existing = (await Placement.findAll(
    dataset as never,
    { parent } as Record<string, unknown>,
  )) as unknown as PlacementRow[];
  const rows = existing.filter((row) => row.node === nodeId);
  const drawn = resolvePlacement(rows);
  if (!drawn) return undefined;
  for (const row of rows) {
    if (row !== drawn && (row.tier ?? '') === (drawn.tier ?? '')) await Placement.delete(dataset as never, row.id);
  }
  return drawn;
}

/**
 * Field patches waiting to be seen in a read, keyed by the record they were written to.
 *
 * The shape a DRAWER takes, which is all this is now: the holds themselves live per field in
 * `@we/optimism` (a card's colour and its size are written by different gestures and settle at
 * different times, so holding them together means one retires the other). This is assembled from
 * them for the graph host, which draws a node from one patch.
 */
export type PendingWrites = Record<string, Record<string, unknown>>;

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
   * local names for an expression to test. The store is the only place that can see them.
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
  /**
   * SpaceStore supplies the lists a *community* owns, for a property whose declaration names one —
   * see `vocabulary` on a property, and `offeredTaskStates`.
   *
   * Injected rather than read, for the reason `provideAutoInterpretGate` is: the answer lives on
   * records in the space, and SpaceStore mounts below this one. Unset, every display falls back to
   * the declaration's own `options`, which is what they all did before this existed.
   */
  provideVocabularies: (resolve: (vocabulary: string) => string[] | undefined) => () => void;
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
  /**
   * Write the connection straight away, with nothing filled in — and answer with its id.
   *
   * The other half of {@link connectNodes}, and the choice between them is the template's. A
   * knowledge map asks first, because a claim two things are related is the thing that map is *for*
   * and the form is where somebody says what they mean. A canvas beside a live call does not: there,
   * drawing the line **is** the assertion, the arrangement is the work, and a modal per line is a
   * mode change in the middle of it — on the one surface whose every other gesture (drag, resize,
   * bend, re-anchor, and `retargetOnCanvas`, which edits the claim itself) writes silently.
   *
   * Nothing is lost by deferring the words. An unlabelled `Relationship` was always reachable — the
   * form saves with both fields empty — so this creates no state that did not already exist; it
   * stops charging a modal for the state people were reaching anyway. The label and the kind are
   * then edited where the line is read, in the inspector.
   *
   * Returns the new record's id so an `onSuccess` can select it. `lastCreatedId` is set too, for a
   * caller that would rather read it there.
   */
  connectNodesNow: (link: PendingLink) => Promise<string>;
  /** Switch which model is being created, discarding the values typed against the last one. */
  setRecordEntity: (entity: string) => void;
  /**
   * Set one field's value. Takes the field name, so one action serves every control — a file
   * control's `File` included, which is read into the draft as the payload storage takes.
   */
  setRecordField: (name: string, value: unknown) => void;
  /**
   * Pin the draft's place — pass a `we-location-picker`'s `arg.detail`. Writes the latitude, longitude
   * and address the draft asks for, and a name where nobody typed one.
   */
  setRecordPlace: (detail: unknown) => void;
  /**
   * The record being made inline for a relation field — an image for a sighting's `photo` — or null.
   * Its non-nullness mounts the nested form, over the one it belongs to.
   */
  relationDraft: Accessor<RecordDraft | null>;
  /** Validation errors from the nested form's last "Add". */
  relationErrors: Accessor<string[]>;
  /** Open the nested form on a relation field's target model. */
  openRelationForm: (field: string) => void;
  /** Set one field of the nested form. The same shape as `setRecordField`. */
  setRelationField: (name: string, value: unknown) => void;
  /**
   * Add what the nested form holds to its relation field, and close it. Nothing is written yet: the
   * record is made when the outer form saves, so abandoning the outer form leaves nothing behind.
   */
  saveRelationForm: () => void;
  cancelRelationForm: () => void;
  /** Point a relation field at an existing record, by id — what its picker's `onChange` passes. */
  pickRelation: (field: string, id: unknown) => Promise<void>;
  /** Take one entry off a relation field, by its `key`. */
  removeRelationEntry: (field: string, key: string) => void;
  /**
   * Point a location relation at the place a `we-location-picker` reports — pass its `arg.detail`.
   * The place is made when the form saves; its name follows the city unless one was typed.
   */
  setRelationLocation: (field: string, detail: unknown) => void;
  /** Edit one field of a relation entry still to be made — the name or address under a picked place. */
  setRelationEntryField: (field: string, key: string, name: string, value: unknown) => void;
  /** Add a chosen, cropped image to an image relation — pass an `EditableImage`'s `onImageChange` event. */
  addRelationImage: (field: string, file: unknown) => Promise<void>;
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
   * Put a record at a position on a canvas, or move one already there.
   *
   * An upsert, because dragging the same card twice must not leave two coordinates for it. The
   * canvas is the parent; a record can be placed on as many canvases as somebody puts it on, each with
   * its own position, which is the whole reason a coordinate is not a field on the record.
   */
  placeOnCanvas: (canvas: string, nodeId: string, nodeType: string, x: number, y: number) => Promise<void>;
  /**
   * Write where a drag left a card — and everything a **folded** card carried with it.
   *
   * Takes the graph's `onNodeDragEnd` payload whole, the way `resizeOnCanvas` takes `onNodeResize`'s,
   * which is what lets one action cover both cases: an ordinary card is `placeOnCanvas` spelt
   * differently, and a fold is that plus a placement per card hidden under it.
   *
   * It exists because a schema cannot loop. The carried cards arrive as a list whose length nothing
   * knows in advance, and `$action` calls a method once — so "place this, and each of those" has to
   * be one call. Without it, carrying a fold into a corner and unfolding it there scatters the
   * contents back to where they were, which makes a fold a way of hiding rather than of tidying.
   */
  dragOnCanvas: (
    canvas: string,
    payload: {
      recordId?: string;
      recordType?: string;
      x: number;
      y: number;
      carried?: { recordId: string; recordType: string; x: number; y: number }[];
    },
  ) => Promise<void>;
  /**
   * Put something dragged in from elsewhere onto a canvas, where it landed.
   *
   * Takes the graph's `onDrop` payload as it arrives, the way `resizeOnCanvas` takes `onNodeResize`'s.
   * A placement is the canvas's membership, so this is `placeOnCanvas` with two refusals in front of
   * it: a record from another space, which this canvas cannot draw because its seed reads this
   * dataset; and a thing that is not a record here at all — an agent, a space — which has no card
   * to be. Both say so rather than placing a coordinate for nothing.
   */
  dropOnCanvas: (
    canvas: string,
    payload: {
      entity: string;
      id: string;
      dataset?: string;
      x: number;
      y: number;
      label?: string;
      within?: BringInItem['within'];
      preview?: BringInItem['preview'];
    },
  ) => Promise<void>;
  /**
   * Take whatever a drop carried into the space on screen, as posts — the `dropped` event's detail
   * straight from a `we-drop-zone` around a feed.
   *
   * A copy for the author's own things, a quote for anybody else's — see `shared/bringIn.ts`, which
   * holds the table. Things already in this space are left alone. Each new post offers an undo.
   */
  bringIn: (payload: { items?: BringInItem[] } | undefined) => Promise<void>;
  /**
   * Change one property of one record, from a control bound to it.
   *
   * Takes the field name, so one action serves every control the inspector draws — the same shape
   * `setRecordField` has for the draft. The value is coerced by the kind the model declares for
   * that field, since a number input hands back a string and a switch a boolean, and a picker's
   * `{ detail }` is unwrapped. An empty string is not written: the ORM skips it, so clearing a text
   * field leaves the old value, which is a limit of the store beneath rather than a choice here.
   */
  updateRecordField: (entity: string, id: string, field: string, value: unknown) => Promise<void>;
  /**
   * Take a record — or a whole selection — off a canvas, leaving the records themselves alone.
   *
   * Deleting the placement and nothing else, which is the whole payoff of placement being
   * membership. Being on a canvas was never what made a record exist, so coming off one cannot be
   * what ends it: a task removed from a canvas is still owned by the call it came out of, and a card
   * the canvas owns survives as an unplaced one in the tray, where it can be dragged back or deleted
   * outright.
   *
   * Takes one id or a list of them; a selection is not a special case, and it is undoable.
   *
   * ## It is not "get this off my screen", and the difference is not visible from here
   *
   * This deletes the *placement*. Whether that removes the card depends on something this action
   * cannot see: how the record got onto the canvas in the first place.
   *
   * - A record **placed** on a canvas it does not belong to — something dragged in from elsewhere in
   *   the space — really does come off. This is the action for that.
   * - A record the canvas **owns** does not. The canvas seed reads owned-but-unplaced records back
   *   as *the tray* (see `canvas.ts`), so the card returns on the next read and the `manual` layout
   *   parks it in the corner of the view. On the workshop's canvas, where almost every card is
   *   extraction output owned by the call, that is every card: erasing one teleports it to the
   *   top-left rather than removing it.
   *
   * So do **not** offer this as a general "remove" control beside a delete — it was, briefly, and it
   * read as cards vanishing to somewhere nobody could find. A surface that can tell the two cases
   * apart (the inspector knows the record) may reasonably offer it for the first.
   */
  removeFromCanvas: (canvas: string, node: string | string[]) => Promise<void>;
  /**
   * Delete several records, for everyone in the space, asking **once**.
   *
   * Takes the graph's `onDeleteSelection` or `onSelectionAction` records as they arrive. The host
   * raises its own confirmation, as it does for every destructive action a template can name, and
   * that confirmation counts the list — a template looping `record.delete` instead would stack one
   * dialog per card, which is why this exists.
   *
   * Irreversible, and outside the undo history on purpose: an AD4M delete drops the links, and a
   * re-create earns a new id that nothing pointing at the old one would follow. That is also why it
   * is safe to bind to the Delete key despite being irreversible — the host's dialog is in front of
   * it, and there is no reversible neighbour to offer instead (see `removeFromCanvas`).
   */
  deleteRecords: (records: { recordId?: string; recordType?: string }[] | undefined) => Promise<void>;
  /**
   * Whether the canvas on screen has anything to undo or redo, and what — `{ canUndo, canRedo,
   * undoLabel, redoLabel }`.
   *
   * Gate a control on `canUndo` rather than hiding it: a greyed key with a tooltip naming what it
   * would put back says more about the state of the canvas than an absence does.
   */
  canvasHistory: Accessor<HistoryState>;
  /**
   * Put back the last thing this agent did to the arrangement of **this** canvas.
   *
   * Arrangement only — a move, a resize, a colour, a card taken off. It is replayed as a **new
   * write** rather than as a rollback, so a peer's changes in between are not discarded, and a card
   * a peer has moved since is skipped rather than dragged back out from under them. See
   * `@we/history` for why that is the only honest shape on shared data.
   *
   * **The canvas is an argument rather than something the store is told about separately**, and
   * that is the whole of the scoping. Undo is about what the reader can see, so replaying a move
   * onto a canvas they navigated away from is the most confusing thing the key could do — and a
   * separate "point the stack here" action is one a template can forget to wire, with no symptom
   * until somebody switches canvas and presses the key. Passing it at the point of use cannot be
   * forgotten, because there is nothing else to pass.
   */
  undoCanvas: (canvas: string) => Promise<void>;
  /** Do again what `undoCanvas` put back, on the same terms and with the same argument. */
  redoCanvas: (canvas: string) => Promise<void>;
  /**
   * Resize a card on a canvas. Takes the graph's `onNodeResize` payload as it arrives.
   *
   * The size goes on the placement, beside the position, for the reason the position is there: it is
   * a fact about a pair. Shrinking a post to fit six of them on a wall is not editing the post, and
   * the same post on somebody else's canvas must not change size because of it.
   */
  resizeOnCanvas: (canvas: string, payload: unknown) => Promise<void>;
  /**
   * Pin which side of a card a connection leaves or arrives on, for this canvas. Takes the graph's
   * `onEdgeAnchor` payload as it arrives.
   *
   * An empty `side` clears that end, and a route with neither end pinned and no bends is deleted — so
   * the way back out leaves nothing behind. The bends survive a clear either way: one record holds
   * both, and letting go of a side says nothing about the shape somebody drew. Per canvas, like a
   * placement: how a connection is drawn is a fact about a view, and the same connection on somebody
   * else's canvas is unaffected.
   */
  anchorOnCanvas: (canvas: string, payload: unknown) => Promise<void>;
  /**
   * Write the shape of one connection's route on this canvas. Takes the graph's `onEdgeReroute`
   * payload as it arrives.
   *
   * The whole list of points, in the edge's own frame, so a bend keeps its proportions when either
   * card moves. An empty list straightens the line, and a route with no points and no anchors left
   * is deleted.
   */
  rerouteOnCanvas: (canvas: string, payload: unknown) => Promise<void>;
  /**
   * Move one end of a connection onto a different record. Takes the graph's `onEdgeRetarget` payload.
   *
   * Unlike the two above, this changes the **claim** rather than how one canvas draws it: the
   * relationship now says something different, everywhere it is shown. That end's anchor is cleared,
   * since a side pinned against the card that used to be there decides nothing about the one that
   * arrived; the waypoints stay, being stored in the connection's own frame.
   */
  retargetOnCanvas: (canvas: string, payload: unknown) => Promise<void>;
  /**
   * Set one presentation property of one card — or of a whole selection — on one canvas: colour,
   * shape, content scale, rotation, stacking.
   *
   * Takes the property name, so one action serves every control, which is the only shape that works
   * when a swatch, a picker and a slider all write to the same record. Takes one node id or a list
   * of them, so a selection is not a special case. Nothing here touches the record being displayed.
   *
   * Undoable, and each card keeps its own baseline — so putting back a colour applied to nine cards
   * restores nine different colours rather than one.
   */
  setCardStyle: (canvas: string, node: string | string[], field: string, value: unknown) => Promise<void>;
  /**
   * Placement fields written but not yet read back, keyed by the placed record's id.
   *
   * The optimistic half of every canvas gesture that writes presentation. A resize, a colour or a
   * shape is answered by a record, and the answer comes back through a subscription and a re-read —
   * a round trip at best, and a re-seed of the whole canvas after it. A slider that lags that far
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
  previewCardStyle: (node: string | string[], field: string, value: unknown) => void;
  /**
   * Set the colour every card of one type is drawn in, on one canvas.
   *
   * The canvas's key, made writable. A colour per *type* rather than per card because that is what a
   * legend is: "tasks are amber here" is a fact about the canvas, said once, and re-deciding it on
   * every card somebody adds is the thing a key exists to avoid. Per canvas rather than per type,
   * because two canvases in the same space legitimately disagree about which question they are
   * colouring by. An empty colour clears it.
   */
  setTypeColor: (canvas: string, nodeType: string, color: unknown) => Promise<void>;
  /**
   * Set the colour every card of one type is drawn in, everywhere in this space.
   *
   * The space's key — `Space.typeStyles` — which is what a canvas falls back to where it has no
   * opinion of its own. `setTypeColor` answers for one board; this answers for the community, and it
   * is the one the workshop's key writes, since a call's canvas is not a board anybody wants to
   * recolour every meeting.
   *
   * Takes the space's record id rather than reading it, for the reason every canvas action takes a
   * canvas: this store knows datasets, not spaces, and a template has `spaceStore.currentSpace.id` to
   * hand. An empty colour *deletes* the record rather than writing the unset sentinel, so the list a
   * key reads back never carries a row that means nothing.
   */
  setSpaceTypeColor: (spaceId: string, nodeType: string, color: unknown) => Promise<void>;
  /**
   * Open the create form, and place whatever it makes onto this canvas.
   *
   * The counterpart to `connectNodes`: the same form and the same save path, with an intent held
   * beside it. Without this, creating a model instance from a canvas makes a real record that simply
   * does not appear on the canvas it was made from — which is the confusion the button was hidden to
   * avoid, and hiding it was the wrong answer.
   */
  createOnCanvas: (canvas: string, x?: number, y?: number) => void;
  /**
   * Compose a card onto a canvas, and record where it sits — as one write.
   *
   * The composer's counterpart to `createOnCanvas`, and one action rather than two because two would
   * be two commits. Anything watching the data layer sees every commit, so a card written first and
   * positioned second is a card the canvas draws unpositioned and then moves.
   *
   * `at` omitted — the toolbar's "Card", which names no point — creates the card and no placement,
   * so it lands in the tray. That is the honest answer to "nobody said where", and the tray is where
   * it is recoverable from.
   */
  createCardOnCanvas: (
    editorState: unknown,
    options: { canvas: string; at?: { x: number; y: number } },
  ) => Promise<void>;
}

const RecordStoreContext = createContext<RecordStore>();

export function RecordStoreProvider(props: ParentProps) {
  const datasetStore = useDatasetStore();
  const session = useSessionStore();
  const shapeStore = useShapeStore();

  const [recordDraft, setRecordDraft] = createSignal<RecordDraft | null>(null);
  const [recordErrors, setRecordErrors] = createSignal<string[]>([]);
  /*
    Counts writes into a draft's fields, for whatever has to notice them.

    A field is written in place (see `writeFieldValue`) so the control being typed into keeps its row
    and its focus — which also means the draft signal never changes while somebody types. Anything
    derived from the draft saw the form as it opened: `recordDraftDirty` stayed false through a whole
    paragraph, so closing or going Back threw the work away without asking, while a location pin, which
    replaces the draft, did ask. Reading this beside the draft is what makes the two agree.
  */
  const [draftEdits, setDraftEdits] = createSignal(0);
  const [savingRecord, setSavingRecord] = createSignal(false);
  const [lastCreatedId, setLastCreatedId] = createSignal('');
  const [pendingLink, setPendingLink] = createSignal<PendingLink | null>(null);
  const [pendingBoard, setPendingBoard] = createSignal('');
  const [relationshipKind, setKind] = createSignal('');
  const [pendingPoint, setPendingPoint] = createSignal<{ x: number; y: number } | null>(null);
  const [relationDraft, setRelationDraft] = createSignal<RecordDraft | null>(null);
  const [relationFieldName, setRelationFieldName] = createSignal('');
  const [relationErrors, setRelationErrors] = createSignal<string[]>([]);
  let entrySeq = 0;

  /**
   * WE's own content a person can make, read straight off the core manifest — every block there is a
   * way to make, and how. See `creationPath`.
   *
   * Derived rather than listed, so a block that gains a form appears here with no second edit in a
   * different package — the failure mode a hardcoded table has is that it is correct on the day it is
   * written and silently stale afterwards. And by declaration rather than by name: nothing that is not
   * content needs a flag to stay out.
   */
  const coreEntities = createMemo<CreatableEntity[]>(() =>
    Object.entries(CORE_MANIFEST.entities)
      .flatMap(([name, entity]) => {
        const via = creationPath(entity);
        if (!via) return [];
        const icon = BLOCK_ICONS[name] ?? 'cube';
        return [
          { label: modelLabel(name), value: name, icon, group: 'Built in', description: entity.description ?? '', via },
        ];
      })
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
        description: shape.description ?? '',
        via: 'form' as const,
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
  function schemaFor(
    entity: string,
  ): { schema: EntitySchema; authorable: boolean; icon: string; label: string } | undefined {
    const shape = shapeStore.spaceShapes().find((row) => row.name === entity && row.manifest);
    const fromShape = shape?.manifest?.entities[entity];
    if (fromShape) return { schema: fromShape, authorable: true, icon: shape?.icon || 'cube', label: entity };

    const core = CORE_MANIFEST.entities[entity];
    if (core)
      return { schema: core, authorable: false, icon: BLOCK_ICONS[entity] ?? 'cube', label: modelLabel(entity) };
    return undefined;
  }

  /**
   * The class a record of `entity` is written through, in the dataset on screen.
   *
   * `getEntity` alone reads the global registry, which holds WE's own models and the modules'. A
   * model a community defined is registered *per dataset* on AD4M — that is how two spaces can each
   * have a `Sighting` — so saving one through this form failed with "Model "UfoSighting" not found in
   * registry" while the model sat listed in the space's settings. The per-dataset lookup prefers the
   * global class and falls back to the space's own, so every caller here goes through it.
   */
  function entityClass(entity: string, handle: unknown): ReturnType<typeof getEntity> {
    return (getEntityForDataset(entity, handle) ?? getEntity(entity)) as ReturnType<typeof getEntity>;
  }

  /**
   * What a relation field pointing at `target` may do.
   *
   * Make one when the target has a form of its own. Pick an existing one when the target is not a
   * block: an image in a sighting belongs to that sighting, where the species it names is a record
   * many sightings share.
   */
  function relationTarget(target: string): RelationTargetAbilities | undefined {
    const found = schemaFor(target);
    if (!found) return undefined;
    return {
      canCreate: fieldsFor(found.schema, found.authorable).length > 0,
      canPick: !found.schema.blockable,
      label: found.label,
      inline: inlineEditorFor(target, found.schema),
    };
  }

  /*
    One display per creatable model, from the same declarations the forms come from.

    A map rather than a lookup action because a template reads it in a value position — a feed
    indexes it by each row's type — and `$action` cannot return a value. Recomputed when the
    space's shapes change, so a model defined a moment ago has a display a moment later.
  */
  /**
   * Every model that can be *shown*, which is not the same set as every model that can be *made*.
   *
   * `Relationship` is the case that separated them, and the reason this exists. It is excluded from
   * `creatableEntities` on purpose — a connection is drawn between two things rather than filled in
   * from a picker, so offering it in the "new record" list would be offering a form with two
   * endpoints nobody had chosen. But it is a `WeNode` with a label, a description, comments and
   * signals, and clicking the line that stands for it is exactly the moment somebody wants to read
   * all of that.
   *
   * Deriving one list from the other quietly made "cannot be created here" mean "cannot be
   * displayed", so the inspector showed an empty panel for a connector whose name was drawn on the
   * line beside it. Two questions, two lists — and `CollectionBlock` is the second name it needed:
   * every note on a canvas is one, and every one of them opened that same empty panel.
   *
   * A space's own model named after one of these is left alone: it is already in `creatableEntities`
   * with its own icon and label, and a display derived from the community's shape is the one that
   * should win.
   */
  const displayableEntities = createMemo<Omit<CreatableEntity, 'via' | 'description'>[]>(() => {
    const named = new Set(creatableEntities().map((entity) => entity.value));
    /*
      Every core block too, including the ones there is no way to make — a divider still appears in a
      post, and a quote dropped on a canvas is an embed. The key and the inspector read a kind's name
      and glyph from here.
    */
    const blocks = Object.entries(CORE_MANIFEST.entities)
      .filter(([, entity]) => entity.blockable)
      .map(([name]) => name);
    const extra = [...new Set([...DISPLAY_ONLY, ...blocks])]
      .filter((name) => !named.has(name) && CORE_MANIFEST.entities[name])
      .map((name) => ({
        label: modelLabel(name),
        value: name,
        icon: BLOCK_ICONS[name] ?? 'cube',
        group: 'Built in',
      }));
    return extra.length ? [...creatableEntities(), ...extra] : creatableEntities();
  });

  const vocabularies = hostSlot<(vocabulary: string) => string[] | undefined>();

  const displays = createMemo<Record<string, RecordDisplay>>(() => {
    const out: Record<string, RecordDisplay> = {};
    for (const entity of displayableEntities()) {
      const found = schemaFor(entity.value);
      if (!found) continue;
      out[entity.value] = displayFor({
        entity: entity.value,
        label: entity.label,
        icon: found.icon,
        schema: found.schema,
        authorable: found.authorable,
        vocabularyFor: (vocabulary) => vocabularies.get()?.(vocabulary),
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
      // A form opened from a button is not a connection, and is not aimed at a canvas, whatever the
      // last one was. Left set, the next ordinary record created would silently be linked to two
      // nodes somebody connected earlier, or land on a canvas they had closed — a wrong write with
      // nothing on screen to suggest it happened.
      setPendingLink(null);
      setPendingBoard('');
      setKind('');
      setPendingPoint(null);
    });
    // Opening on the first model with a form rather than on an empty picker: in a space with one
    // vocabulary that is the only answer, and in a space with several it is still a better start
    // than a form with nothing in it. A composed one has no form to open on.
    const target = named || creatableEntities().find((entity) => entity.via === 'form')?.value;
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
    // A composed kind has no form to open — a note is written in the composer. Every picker that
    // offers one opens that instead; this is the guard for one that did not.
    if (!found.authorable && creationPath(found.schema) === 'composer') {
      toastService.error(`A ${found.label.toLowerCase()} is written in the composer, not a form.`);
      return;
    }
    batch(() => {
      setRecordErrors([]);
      setRecordDraft(
        emptyRecordDraft({
          entity,
          // The model's name as a person reads it — "Location", not `LocationBlock`.
          label: found.label,
          schema: found.schema,
          authorable: found.authorable,
          icon: found.icon,
          relationTarget,
        }),
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
  function setRecordField(name: string, value: unknown): void {
    writeInto(recordDraft, name, value);
  }

  function setRecordPlace(detail: unknown): void {
    const current = recordDraft();
    const next = current ? withPlace(current, detail) : null;
    if (next) setRecordDraft(next);
  }

  /**
   * Write a control's value into whichever draft it belongs to.
   *
   * A file control reports a `File` (or a list of one), which is read here into the payload the
   * file-storage language takes — compressed first when it is a picture, as every other upload in
   * WE is. Asynchronous, and written into the draft that is open when it finishes, so a form closed
   * in the meantime is not written into. A file-backed model that also asks for a `name` has it
   * filled from the file when nobody has typed one.
   */
  function writeInto(draft: Accessor<RecordDraft | null>, name: string, value: unknown): void {
    const file = Array.isArray(value) ? value[0] : value;
    if (typeof File === 'undefined' || !(file instanceof File)) {
      writeFieldValue(draft(), name, value === null || value === undefined ? '' : (value as RecordFieldValue));
      setDraftEdits((n) => n + 1);
      return;
    }
    const opened = draft();
    void readFile(file)
      .then((payload) => {
        if (draft() !== opened) return;
        writeFieldValue(opened, name, payload);
        setDraftEdits((n) => n + 1);
        const named = opened?.fields.find((field) => field.name === 'name' && field.control === 'text');
        if (named && typeof named.value === 'string' && !named.value.trim()) named.value = file.name;
      })
      .catch((error) => {
        console.error('RecordStore: reading a file failed', error);
        toastService.error('Could not read that file.');
      });
  }

  async function readFile(file: File): Promise<RecordFieldValue> {
    if (file.type.startsWith('image/')) return compressImageToFileData(file, file.name);
    const uri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    return dataURIToFileData(uri, file.name);
  }

  /**
   * Whether a relation's target is better made where the relation is than in a form of its own.
   *
   * A place is picked on a map, and a picture is chosen and cropped — neither is a list of fields.
   * The generic nested form asked for a location as two number boxes and showed nothing of an image
   * once it was chosen. So those two targets get the controls WE already has for them, inline: the
   * location picker (with its name and address beneath, as the profile page has) and the image
   * editor with its cropper and a preview.
   */
  function inlineEditorFor(target: string, schema: EntitySchema): RelationTargetAbilities['inline'] {
    if (target === 'LocationBlock') return 'location';
    const properties = schema.properties;
    const picture = imagePropertyOf(schema);
    return picture && properties[picture]?.required ? 'image' : '';
  }

  /** The property that holds a target's picture — a file whose name reads as one. */
  function imagePropertyOf(schema: EntitySchema): string {
    return (
      Object.keys(schema.properties).find(
        (name) =>
          schema.properties[name].format === 'file' &&
          /image|avatar|photo|picture|thumbnail|cover|poster|src/i.test(name),
      ) ?? ''
    );
  }

  function setRelationLocation(field: string, detail: unknown): void {
    const relation = relationFieldOf(field);
    const found = relation ? schemaFor(relation.target) : undefined;
    const current = recordDraft();
    if (!relation || !found || !current || !detail || typeof detail !== 'object') return;
    const picked = detail as Record<string, unknown>;
    if (typeof picked.latitude !== 'number' || typeof picked.longitude !== 'number') return;

    const existing = relation.many ? undefined : relation.entries[0];
    // Only what the target declares: a picker reporting a field the model lacks is not a write.
    const fields: Record<string, unknown> = { ...(existing?.fields ?? {}) };
    for (const key of ['latitude', 'longitude', 'city', 'country', 'countryCode', 'address']) {
      if (found.schema.properties[key] && picked[key] !== undefined) fields[key] = picked[key];
    }
    // A name the author typed survives moving the pin; otherwise the place names itself.
    if (found.schema.properties.name && !(typeof fields.name === 'string' && fields.name.trim())) {
      const named = picked.city ?? picked.address;
      if (typeof named === 'string' && named) fields.name = named;
    }
    const label =
      (typeof fields.name === 'string' && fields.name) ||
      `${(picked.latitude as number).toFixed(4)}, ${(picked.longitude as number).toFixed(4)}`;
    setRecordDraft(
      withRelationEntry(current, field, {
        key: existing?.key ?? `new-${++entrySeq}`,
        label,
        entity: relation.target,
        fields,
      }),
    );
  }

  /**
   * Edit one field of an entry still to be made — the name under a picked place.
   *
   * In place, as a typed form field is, so the input keeps focus; the chip's label follows the name.
   */
  function setRelationEntryField(field: string, key: string, name: string, value: unknown): void {
    const entry = relationFieldOf(field)?.entries.find((candidate) => candidate.key === key);
    if (!entry?.fields) return;
    entry.fields[name] = value;
    if (name === 'name' && typeof value === 'string' && value.trim()) entry.label = value.trim();
  }

  async function addRelationImage(field: string, file: unknown): Promise<void> {
    const relation = relationFieldOf(field);
    const found = relation ? schemaFor(relation.target) : undefined;
    const property = found ? imagePropertyOf(found.schema) : '';
    const picked = Array.isArray(file) ? file[0] : file;
    if (!relation || !property || typeof File === 'undefined' || !(picked instanceof File)) return;
    try {
      const payload = (await readFile(picked)) as { data_base64: string; file_type: string; name: string };
      const current = recordDraft();
      if (!current) return;
      setRecordDraft(
        withRelationEntry(current, field, {
          key: `new-${++entrySeq}`,
          label: picked.name,
          entity: relation.target,
          fields: { [property]: payload },
          preview: `data:${payload.file_type};base64,${payload.data_base64}`,
        }),
      );
    } catch (error) {
      console.error('RecordStore: reading an image failed', error);
      toastService.error('Could not read that image.');
    }
  }

  function relationFieldOf(name: string): RecordField | undefined {
    return recordDraft()?.fields.find((field) => field.name === name && field.control === 'relation');
  }

  function openRelationForm(field: string): void {
    const relation = relationFieldOf(field);
    const found = relation ? schemaFor(relation.target) : undefined;
    if (!relation || !found) return;
    batch(() => {
      setRelationErrors([]);
      setRelationFieldName(field);
      // No `relationTarget`: a nested form offers no relations of its own. One level is a form
      // inside a form; two is a maze, and nothing a community models needs it to say what it means.
      setRelationDraft(
        emptyRecordDraft({
          entity: relation.target,
          label: relation.targetLabel,
          schema: found.schema,
          authorable: found.authorable,
          icon: found.icon,
        }),
      );
    });
  }

  function setRelationField(name: string, value: unknown): void {
    writeInto(relationDraft, name, value);
  }

  function saveRelationForm(): void {
    const nested = relationDraft();
    const parent = recordDraft();
    if (!nested || !parent) return;
    const errors = recordDraftErrors(nested);
    if (errors.length) {
      setRelationErrors(errors);
      return;
    }
    const found = schemaFor(nested.entity);
    const entry: RelationEntry = {
      key: `new-${++entrySeq}`,
      label: entryLabel(nested, found ? namePropertyOf(found.schema) : '', nested.label),
      entity: nested.entity,
      fields: recordDraftFields(nested),
    };
    batch(() => {
      setRecordDraft(withRelationEntry(parent, relationFieldName(), entry));
      setRelationDraft(null);
      setRelationErrors([]);
    });
  }

  function cancelRelationForm(): void {
    batch(() => {
      setRelationDraft(null);
      setRelationErrors([]);
    });
  }

  async function pickRelation(field: string, id: unknown): Promise<void> {
    const picked = asEntityName(id);
    const relation = relationFieldOf(field);
    const dataset = datasetStore.currentDataset();
    if (!picked || !relation) return;
    // Named as it is everywhere else, read off the record — a picker's `onChange` carries only the id.
    let label = picked;
    const found = schemaFor(relation.target);
    const nameProperty = found ? namePropertyOf(found.schema) : '';
    if (dataset && nameProperty) {
      try {
        const row = (await entityClass(relation.target, dataset.handle).findOne(dataset.handle, {
          where: { id: picked },
        })) as Record<string, unknown> | null;
        const name = row?.[nameProperty];
        if (typeof name === 'string' && name.trim()) label = name.trim();
      } catch (error) {
        console.warn('RecordStore: could not read the picked record for its name', error);
      }
    }
    const current = recordDraft();
    if (current)
      setRecordDraft(withRelationEntry(current, field, { key: picked, id: picked, label, entity: relation.target }));
  }

  function removeRelationEntry(field: string, key: string): void {
    const current = recordDraft();
    if (current) setRecordDraft(withoutRelationEntry(current, field, key));
  }

  /**
   * Point a saved record's relations at what the form chose — making the records that were filled in
   * inline first. After the create because a relation in a create payload is skipped by the ORM.
   *
   * A to-many is written through the contract's `setRelation`. A to-one has no neutral write yet —
   * the contract refuses to guess between "point at" and "membership" — so it goes through the
   * instance's own accessor, the way a relationship's endpoints do above.
   */
  async function linkRelations(
    draft: RecordDraft,
    created: { id?: string } & Record<string, unknown>,
    handle: unknown,
  ): Promise<void> {
    if (!created.id) return;
    const Model = entityClass(draft.entity, handle);
    for (const field of draft.fields) {
      if (field.control !== 'relation' || !field.entries.length) continue;
      const ids: string[] = [];
      for (const entry of field.entries) {
        if (entry.id) {
          ids.push(entry.id);
          continue;
        }
        const made = (await entityClass(entry.entity, handle).create(handle, entry.fields ?? {})) as { id?: string };
        if (made?.id) ids.push(made.id);
      }
      if (!ids.length) continue;
      if (field.many) {
        await Model.setRelation(handle, created.id, field.name, ids);
        continue;
      }
      const suffix = field.name.charAt(0).toUpperCase() + field.name.slice(1);
      const setter = (created[`set${suffix}`] ?? created[`add${suffix}`]) as
        ((id: string) => Promise<unknown>) | undefined;
      if (setter) await setter.call(created, ids[0]);
    }
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
   * The same connection, written immediately — see the interface for why a template chooses.
   *
   * Deliberately not routed through the draft. A draft exists so a person can fill one in, and
   * mounting one here only to save it unread would put the modal on screen for a frame and make the
   * discard guard reachable with nothing to discard. The write is the two steps `saveRecord` makes
   * for a relationship and no others: the endpoint *types* go in with the fields, because the ORM
   * writes an ordinary property from the create payload, and the endpoints themselves are linked
   * after, because `innerUpdate` skips a relation field holding a plain value — `create(p, { source:
   * uri })` typechecks, runs, and writes no link at all.
   *
   * No canvas parent, and none is needed: the canvas seed asks for connections whose `source` is
   * among the records it has placed, rather than for its own children, so a relationship drawn here
   * is found by the canvas that drew it and by any other showing both ends.
   */
  async function connectNodesNow(link: PendingLink): Promise<string> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !link?.sourceId || !link?.targetId) return '';
    try {
      const created = (await getEntity(RELATIONSHIP).create(dataset.handle, {
        sourceType: link.sourceType,
        targetType: link.targetType,
      })) as {
        id?: string;
        setSource?: (value: string) => Promise<unknown>;
        setTarget?: (value: string) => Promise<unknown>;
      };
      await created.setSource?.(link.sourceId);
      await created.setTarget?.(link.targetId);
      const id = created?.id ?? '';
      setLastCreatedId(id);
      return id;
    } catch (error) {
      // A toast rather than `recordErrors`: there is no form on screen holding what somebody typed,
      // so the only place a failure can be reported is the one that does not need one.
      console.error('RecordStore: connecting two records failed', error);
      toastService.error('Could not draw that connection.');
      return '';
    }
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
    // Tracked, not used: a field written in place changes nothing the memo would otherwise see.
    draftEdits();
    if (!draft) return false;
    /*
      Changed from what it started as — not "holds something".

      Every field is seeded: a number to `0`, a select to whatever the model declares
      (`TaskBlock.status` is `'todo'`). Asking whether a field held anything therefore answered yes
      for a form nobody had touched, so closing an untouched Task form raised "discard your
      changes?". `field.initial` is the seed, kept beside the value when the draft is built.

      Strings are trimmed on both sides so typing a space and deleting it is not work; other kinds
      compare directly, since a boolean or a number is only ever set deliberately.
    */
    return recordDraftChanged(draft);
  });

  function cancelRecordForm(): void {
    batch(() => {
      setRecordDraft(null);
      setRelationDraft(null);
      setRelationErrors([]);
      setRecordErrors([]);
      setPendingLink(null);
      setPendingBoard('');
      setKind('');
      setPendingPoint(null);
    });
  }

  function createOnCanvas(canvas: string, x?: number, y?: number): void {
    if (!canvas) return;
    openRecordForm();
    batch(() => {
      setPendingBoard(canvas);
      // A point only when somebody chose one — a double-click on the canvas has one, a toolbar
      // button does not. Inventing `(0, 0)` for the second case is what made a new record appear at
      // the world origin, which is wherever the reader is not looking.
      setPendingPoint(x !== undefined && y !== undefined ? { x, y } : null);
    });
  }

  /**
   * Compose a card onto a canvas and place it, in one write group.
   *
   * `createBlocks` transacts internally, so it takes the batch rather than opening its own — see
   * `runEntityTransaction`'s `join`. Everything here lands as a single commit, which is the whole
   * point: the canvas never observes a card that exists but is not yet anywhere.
   */
  async function createCardOnCanvas(
    editorState: unknown,
    options: { canvas: string; at?: { x: number; y: number } },
  ): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !options.canvas) return;
    const parent = { id: options.canvas, predicate: PREDICATES.CHILDREN };

    try {
      await runEntityTransaction(dataset.handle, async (tx) => {
        const root = (await createBlocks(dataset.handle as never, editorState as never, {
          kind: 'card',
          anchor: parent,
          batchId: tx.batchId,
        })) as { id?: string } | undefined;

        if (!options.at || !root?.id) return;
        await createPlacement(dataset.handle, parent, root.id, 'CollectionBlock', options.at, tx.batchId);
      });
    } catch (error) {
      console.error('RecordStore: creating a card on a canvas failed', error);
      toastService.error('Could not add that card.');
    }
  }

  /**
   * Upsert the coordinate for one node on one canvas.
   *
   * Read-then-write rather than blind create, because dragging a card twice must not leave two
   * placements for it — and a canvas that accumulated one per drag would slow down in exactly
   * proportion to how much anybody used it.
   *
   * The read is scoped to the canvas's own children rather than filtered across every placement in
   * the space: the parent link is what makes a placement belong to a canvas, so asking the canvas is
   * both cheaper and the only phrasing that stays correct when the same record sits on two.
   */
  /**
   * One card moved, with the coordinate it had before — which is what makes the move undoable.
   *
   * The baseline costs nothing. This is a read-then-write already (a card dragged twice must not
   * leave two placements), so the value an undo would put back is in hand at the moment of writing
   * and no extra round trip is paid for keeping it.
   *
   * `expect` is the concurrency guard, and it is *here* rather than in `@we/history` because this is
   * the only place that reads the current value. An undo says "put it back, if it is still where I
   * left it"; a peer who has moved the card since means the answer is no, and the press does nothing
   * rather than teleporting the card out from under them. Folding the check into the write is what
   * keeps an undo one round trip instead of two.
   *
   * Answers with the move it made, or null when it made none.
   */
  async function writePlacement(
    canvas: string,
    nodeId: string,
    nodeType: string,
    x: number,
    y: number,
    expect?: { x: number; y: number } | null,
  ): Promise<{ from: { x: number; y: number } | null; to: { x: number; y: number } } | null> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !canvas || !nodeId) return null;
    const parent = { id: canvas, predicate: PREDICATES.CHILDREN };

    /*
      Held before the read, not after it.

      The whole value of this on an undo is that the card moves on the keystroke; holding after the
      read would put a round trip in front of the very thing the hold exists to hide. Dropped again
      below if the guard refuses or the write fails, so the only cost of being eager is that a
      refused undo shows the card moving and coming back — which is the honest drawing of what
      happened.
    */
    hold(nodeId, { x, y });
    try {
      const already = await drawnPlacement(dataset.handle, parent, nodeId);
      const from = already ? { x: Number(already.x) || 0, y: Number(already.y) || 0 } : null;

      if (expect !== undefined) {
        const matches = expect === null ? already === undefined : from !== null && sameSpot(from, expect);
        if (!matches) {
          drop(nodeId, { x, y });
          return null;
        }
      }

      if (already) await Placement.update(dataset.handle, already.id, { x, y });
      else await createPlacement(dataset.handle, parent, nodeId, nodeType, { x, y });
      done(nodeId, { x, y });
      return { from, to: { x, y } };
    } catch (error) {
      drop(nodeId, { x, y });
      console.error('RecordStore: placing a record on a canvas failed', error);
      toastService.error('Could not save that position.');
      return null;
    }
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
      carried?: { recordId: string; recordType: string; x: number; y: number }[];
    },
  ): Promise<void> {
    if (!payload?.recordId || !payload.recordType) return;
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

  /** The presentation a placement may carry, and the only keys `setCardStyle` will write. */
  const CARD_STYLE_FIELDS = ['width', 'height', 'contentScale', 'rotation', 'z', 'color', 'cardShape'] as const;

  /*
    A card's presentation, held per FIELD rather than per record.

    A card's colour and its size are written by different gestures that land at different times, so
    holding them together means one settling retires the other — the key is `<nodeId>\0<field>`, and
    each answers for itself. The patch-per-record shape survives only as {@link pendingCardStyle},
    which is what the graph host draws from.
  */
  const cardStyle = createOptimism<unknown>(createSignal, { same: sameValue });

  const hold = (nodeId: string, patch: Record<string, unknown>) => {
    for (const [field, value] of Object.entries(patch)) cardStyle.hold(keyOf(nodeId, field), value);
  };
  const done = (nodeId: string, patch: Record<string, unknown>) => {
    for (const field of Object.keys(patch)) cardStyle.done(keyOf(nodeId, field));
  };
  const drop = (nodeId: string, patch?: Record<string, unknown>) => {
    const fields = patch ? Object.keys(patch) : fieldsHeldFor(nodeId);
    for (const field of fields) cardStyle.release(keyOf(nodeId, field));
  };

  const fieldsHeldFor = (nodeId: string): string[] =>
    Object.keys(cardStyle.holds())
      .filter((key) => key.startsWith(`${nodeId}\u0000`))
      .map((key) => key.slice(nodeId.length + 1));

  // ─── Undo, for a canvas ──────────────────────────────────────────────────────

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
   * an AD4M delete drops the links, a re-create earns a new id, and everything pointing at the old
   * one breaks silently. `deleteRecords` says as much in the host's own confirmation.
   */
  const history = createHistory(createSignal);

  /** One card's move, with where it came from — `from` is null for a card that was not on the canvas. */
  type CardMove = {
    recordId: string;
    recordType: string;
    from: { x: number; y: number } | null;
    to: { x: number; y: number };
  };

  /**
   * Two coordinates within a pixel of each other.
   *
   * Exact equality is the wrong test against a value that has been through a float, a JSON encode
   * and a peer: a card that came back as 400.00000000000006 is a card nobody moved, and an undo
   * that refused because of it would be refusing for a reason no person could see.
   */
  const sameSpot = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;

  /**
   * Whether a stored presentation value is the one a replay expects to find.
   *
   * Normalised the same way `stylePlacement` records a baseline, because the two have to agree: a
   * field that holds nothing is recorded as the value the canvas seed reads as *absent* — the
   * sentinel for text, `0` for a number — so a redo expecting "it was unset" has to match a row
   * where the field is genuinely missing.
   *
   * Numbers compare with a pixel of tolerance, for the reason `sameSpot` does: a width that came
   * back as 300.00000000000006 is a width nobody changed, and refusing on that is refusing for a
   * reason no person could see.
   */
  const sameStored = (held: unknown, want: unknown): boolean => {
    const normalised = held === undefined || held === '' ? (typeof want === 'number' ? 0 : PLACEMENT_UNSET) : held;
    if (typeof want === 'number' && typeof normalised === 'number') return Math.abs(want - normalised) < 1;
    return String(normalised) === String(want);
  };

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
  /** One card's presentation before and after a gesture — what an undo of it replays. */
  type StyleChange = { nodeId: string; before: Record<string, unknown>; after: Record<string, unknown> };

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

  function rememberMoves(canvas: string, moves: CardMove[]): void {
    if (!canvas || !moves.length) return;
    history.push({
      scope: canvas,
      label: moves.length > 1 ? `move ${moves.length} cards` : 'move card',
      undo: () => replayMoves(canvas, moves, 'undo'),
      redo: () => replayMoves(canvas, moves, 'redo'),
    });
  }

  /** The holds a drawer takes: record → field → value, with anything expired already gone. */
  const pendingCardStyle: Accessor<PendingWrites> = () => {
    const out: PendingWrites = {};
    for (const key of Object.keys(cardStyle.holds())) {
      const split = key.indexOf('\u0000');
      const nodeId = key.slice(0, split);
      const field = key.slice(split + 1);
      // `toDraw` needs what the data says, and the caller here has no view of it — passing the held
      // value asks only "is this still live", which is the backstop and the in-flight rule.
      const held = cardStyle.holds()[key];
      const live = cardStyle.toDraw(key, held.before ?? held.value);
      if (live === undefined) continue;
      out[nodeId] = { ...out[nodeId], [field]: live };
    }
    return out;
  };

  /*
    What the graph reports is AGREEMENT — the records whose own data already says what was written —
    because that comparison happens in the graph's own field space, where both halves are mapped
    already. So a reported record is one whose observed value equals the held one, which is the rule
    the core drops an entry on.

    What is not reported, and so is not covered, is a peer moving a card's colour to a THIRD value:
    the graph never says "this disagrees", only "this agrees". Such a hold stands until the backstop
    rather than retiring on the push that overtook it. That is exactly what it did before, so nothing
    regresses — but it is the one place the canvas is still short of what the board and involvements
    get, and closing it means the graph reporting observed values rather than a verdict.
  */
  function confirmPending(recordIds: readonly string[]): void {
    if (!cardStyle.inFlight()) return;
    const agreed = new Set(recordIds);
    cardStyle.settle((key, entry) => (agreed.has(key.slice(0, key.indexOf('\u0000'))) ? entry.value : undefined));
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
    // Before the write, not after it: the point is that the card changes on the gesture rather than
    // on the round trip. Dropped again below if the write turns out not to be possible.
    hold(nodeId, patch);
    try {
      const already = await drawnPlacement(dataset.handle, { id: canvas, predicate: PREDICATES.CHILDREN }, nodeId);
      if (!already) {
        drop(nodeId, patch);
        toastService.error('Drag this onto the canvas first — how a card looks is saved with where it sits.');
        return undefined;
      }
      /*
        What every field in the patch held before, read off the row this write is about to land on —
        the baseline an undo puts back, costing nothing because the read has already happened.

        **All of them, not the first.** A resize writes a width, a height and both coordinates as one
        act, and a baseline that carried only the width could put back a card of the right size in
        the wrong place.

        A field that held nothing goes back as the value the canvas seed reads as *absent*, because
        undoing "give these cards a colour" has to be able to say "back to no colour of its own" —
        and an empty string is exactly what `Ad4mModel`'s update skips, so it cannot be stored. For
        text that is `PLACEMENT_UNSET`; for a number it is `0`, which `placementStyle` drops the same
        way.
      */
      const before = Object.fromEntries(
        Object.keys(patch).map((field) => {
          const held = already[field];
          if (held !== undefined && held !== '') return [field, held];
          return [field, typeof patch[field] === 'number' ? 0 : PLACEMENT_UNSET];
        }),
      );

      /*
        The concurrency guard, and the same bargain `writePlacement` strikes for a position.

        A replay says "put this back, if it is still what I left"; a peer who has recoloured the
        card since means the answer is no, and the press leaves their colour alone rather than
        overwriting it. Only a *replay* passes `expect` — a fresh gesture is somebody deciding now,
        and deciding now beats whatever was there.

        All or nothing per card, because a resize writes four fields as one act: putting half of it
        back would leave a card at the old size in the new place.
      */
      if (expect && !Object.entries(expect).every(([field, want]) => sameStored(already[field], want))) {
        drop(nodeId, patch);
        return undefined;
      }

      await Placement.update(dataset.handle, already.id, patch);
      // The write is back, so the hold stops being exempt from what the next draw says — see
      // `BoardDeps.done` for why that is not the same as releasing it.
      done(nodeId, patch);
      return before;
    } catch (error) {
      drop(nodeId, patch);
      console.error('RecordStore: styling a card on a canvas failed', error);
      toastService.error('Could not save that.');
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
    const parent = { id: canvas, predicate: PREDICATES.CHILDREN };

    try {
      const existing = (await EdgeRoute.findAll(dataset.handle, { parent } as Record<string, unknown>)) as {
        id: string;
        connection?: string;
        sourceAnchor?: string;
        targetAnchor?: string;
        points?: string;
      }[];
      const already = existing.find((row) => row.connection === event.recordId);
      // The rule itself lives in `routeWrite`, where it can be tested — every branch of it is a
      // quiet refusal or a rewrite, which is precisely the kind of thing that stops working without
      // anything failing. Discarding somebody's bends is how it stopped working the first time.
      const write = routeWrite(already, event.end, side);

      if (write.action === 'none') return;
      if (write.action === 'update') {
        await EdgeRoute.update(dataset.handle, already!.id, write.fields);
        return;
      }
      if (write.action === 'replace' || write.action === 'delete') {
        await EdgeRoute.delete(dataset.handle, already!.id);
      }
      if (write.action === 'delete') return;
      await EdgeRoute.create(
        dataset.handle as never,
        { ...write.fields, connection: [event.recordId] } as never,
        { parent } as never,
      );
    } catch (error) {
      console.error('RecordStore: anchoring a connection on a canvas failed', error);
      toastService.error('Could not save that.');
    }
  }

  /**
   * Write the whole shape of one connection's route on this canvas.
   *
   * The whole list rather than the point that moved, because a route is one shape: written per point,
   * two people bending the same line would each overwrite half of the other's and what came out would
   * be neither of theirs. Last-write-wins on a shape is a shape somebody chose; last-write-wins on
   * each point is a shape nobody did.
   *
   * An empty list is a straightened route, and a route with nothing left to say — no points and no
   * anchors — is deleted, so the way back leaves nothing behind. See {@link anchorOnCanvas}, which is
   * the other half of the same record.
   */
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
   * The endpoint and its type are two different writes. `sourceType` is an ordinary property; the
   * endpoint is a relation, and `innerUpdate` skips a relation field holding a plain value — so
   * `update(p, id, { source: uri })` typechecks, runs, and moves nothing. The generated accessor is
   * the documented path, and the same trap `saveRecord` documents at the other end of this record's
   * life.
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
      const Model = getEntity(event.recordType || RELATIONSHIP);
      const record = (await Model.findOne(dataset.handle, { where: { id: event.recordId } })) as Record<
        string,
        unknown
      > | null;
      if (!record) return;

      await Model.update(dataset.handle, event.recordId, {
        [event.end === 'source' ? 'sourceType' : 'targetType']: event.nodeType,
      });
      /*
        Called, not optional-chained.

        `setSource`/`setTarget` are generated from the model's declaration, so their absence means
        the record did not come back as a live instance — which is a thing to hear about rather than
        a reason to write nothing. Optional-chained, that case left the type written, the anchor
        cleared and the endpoint exactly where it was: a gesture that reported success and moved
        nothing, which is the hardest kind of failure to find.
      */
      const move = record[event.end === 'source' ? 'setSource' : 'setTarget'];
      if (typeof move !== 'function') {
        throw new Error(`${event.recordType || RELATIONSHIP} has no ${event.end} accessor to move`);
      }
      await (move as (value: string) => Promise<unknown>).call(record, event.nodeId);

      // The anchor for the end that moved, dropped — see the note above. Reusing the same action a
      // person's own clear goes through, so there is one path that knows how to unset one.
      if (canvas) await anchorOnCanvas(canvas, { recordId: event.recordId, end: event.end, side: '' });
    } catch (error) {
      console.error('RecordStore: re-attaching a connection failed', error);
      toastService.error('Could not move that connection.');
    }
  }

  async function rerouteOnCanvas(canvas: string, payload: unknown): Promise<void> {
    const event = (payload ?? {}) as { recordId?: string; points?: unknown };
    const dataset = datasetStore.currentDataset();
    if (!dataset || !canvas || !event.recordId || !Array.isArray(event.points)) return;
    const parent = { id: canvas, predicate: PREDICATES.CHILDREN };
    const points = JSON.stringify(event.points);

    try {
      const existing = (await EdgeRoute.findAll(dataset.handle, { parent } as Record<string, unknown>)) as {
        id: string;
        connection?: string;
        sourceAnchor?: string;
        targetAnchor?: string;
      }[];
      const already = existing.find((row) => row.connection === event.recordId);

      if (!already) {
        if (!event.points.length) return;
        await EdgeRoute.create(
          dataset.handle as never,
          { points, connection: [event.recordId] } as never,
          { parent } as never,
        );
        return;
      }
      if (!event.points.length && !already.sourceAnchor && !already.targetAnchor) {
        await EdgeRoute.delete(dataset.handle, already.id);
        return;
      }
      // `[]` rather than `''`: an update skips an empty string, so a straightened route would keep
      // its old bends. A two-character JSON array is a value, and `waypointsOf` reads it as none.
      await EdgeRoute.update(dataset.handle, already.id, { points });
    } catch (error) {
      console.error('RecordStore: rerouting a connection on a canvas failed', error);
      toastService.error('Could not save that.');
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
   * canvas seed drops is the same trick `SpacePreference` uses for its two sentinels.
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

  function previewCardStyle(node: string | string[], field: string, value: unknown): void {
    const scalar = cardStyleValue(field, value);
    if (scalar === undefined) return;
    for (const nodeId of (Array.isArray(node) ? node : [node]).filter(Boolean)) {
      // A preview, not a write — nothing is coming back for it, so counting one would leave the hold
      // exempt from judgement until the backstop. See `preview` in `@we/optimism`.
      cardStyle.preview(keyOf(nodeId, field), scalar);
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
    const scalar = cardStyleValue(field, value);
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
    const raw =
      color !== null && typeof color === 'object' && 'detail' in color ? (color as { detail: unknown }).detail : color;
    // The same sentinel a card's own colour uses, and for the same reason: `''` cannot be stored, so
    // without it a type could be given a colour and never have it taken away.
    const value = typeof raw === 'string' && raw ? raw : PLACEMENT_UNSET;
    const parent = { id: canvas, predicate: PREDICATES.CHILDREN };

    try {
      // An upsert against the canvas's own children, exactly as a placement is: the parent link is
      // what makes a style belong to a canvas, and colouring a type twice must not leave two records
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
      console.error('RecordStore: colouring a type on a canvas failed', error);
      toastService.error('Could not save that colour.');
    }
  }

  async function dropOnCanvas(
    canvas: string,
    payload: { entity: string; id: string; dataset?: string; x: number; y: number },
  ): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !canvas || !payload?.id || !payload.entity) return;
    // The same spelling a stored reference uses for this dataset, so a row gathered here and dragged
    // back out compares equal to the space it came from.
    const here = datasetKey({ cid: dataset.sharedUri, uuid: dataset.id });
    const from = payload.dataset ?? '';
    if (from && from !== HERE && from !== here) {
      /*
        Something from elsewhere becomes a post here first — a copy or a quote, the rule every drop
        into a space follows — and that post is what goes on the canvas. A canvas can only draw this
        space's records, and placing a coordinate for a record in another dataset drew nothing.

        A single block is brought in *alone* — a copy of the picture, or a lone embed — and belongs to
        the canvas the way a card composed on it does. A post holding one picture was a card around
        nothing. A whole post or note still arrives as a post.
      */
      const brought = await bringOne(
        { ...payload, ref: { entity: payload.entity, id: payload.id, dataset: from } },
        { canvas },
      );
      /*
        `writePlacement` rather than `placeOnCanvas`, so this leaves no undo entry.

        Bringing something in from another space *creates* a record here, and the canvas history is
        arrangement only — an entry for it would undo by removing the placement, which leaves the new
        record behind, loose and usually parked back in the corner by the tray. The act already has
        its own way back: `bringOne` raises a toast with Undo that deletes what it made.
      */
      if (brought) await writePlacement(canvas, brought.id, brought.entity, payload.x, payload.y);
      return;
    }
    if (!schemaFor(payload.entity)) {
      toastService.error('That is not something a canvas can hold.');
      return;
    }
    // A record that is already in this space is only being *placed*, which is an arrangement act
    // like a drag — so it is undoable, and undoing it takes the card off the canvas again.
    await placeOnCanvas(canvas, payload.id, payload.entity, payload.x, payload.y);
  }

  /** The dataset a reference's key names, if this agent holds it. */
  function heldDataset(key: string): AppDataset | undefined {
    const id = datasetIdOf(key);
    if (datasetKindOf(key) === 'personal') return datasetStore.datasets().find((d) => d.id === id);
    return datasetStore.datasets().find((d) => d.sharedId === id || d.sharedUri === `neighbourhood://${id}`);
  }

  /**
   * One dropped thing into the space on screen, with its undo and its announcement.
   *
   * The decision is `shared/bringIn.ts`; this is the store's half — reading and writing through the
   * datasets it holds, and telling modules, since a note shared by dragging is shared as surely as
   * one shared with the button.
   */
  async function bringOne(item: BringInItem, into: { canvas?: string } = {}): Promise<BroughtIn | null> {
    const here = datasetStore.currentDataset();
    if (!here) return null;
    const hereKey = datasetKey({ cid: here.sharedUri, uuid: here.id });
    try {
      const result = await decideBringIn(
        item,
        {
          hereKey,
          me: session.me()?.did,
          held: (key) => {
            const ds = heldDataset(key);
            return ds ? { handle: ds.handle, name: ds.name } : null;
          },
          readPost: async (handle, id) => {
            const post = await CollectionBlock.findOne(handle as never, { where: { id } });
            return post ? { author: post.author, editorState: post.editorState } : null;
          },
          copyable: (handle, editorState, only) => copyableContent(handle, editorState, only),
          write: async (blocks, fields) => {
            const root = await createBlocks(here.handle, blocks as ContentInput, { kind: 'post', fields });
            return root?.id ? { id: root.id } : null;
          },
          // Owned by the canvas, as a card composed on it is — deleting the canvas takes it.
          writeBlock: into.canvas
            ? async (block) =>
                (await createBlock(here.handle, block, {
                  anchor: { id: into.canvas!, predicate: PREDICATES.CHILDREN },
                })) ?? null
            : undefined,
        },
        { alone: !!into.canvas },
      );
      if (!result) return null;

      // Posts only: a block written alone is not a post that arrived, and a note's share is the note.
      if (result.entity === 'CollectionBlock') {
        const to = formatRef({ datasetKey: hereKey, entity: 'CollectionBlock', id: result.id });
        notifyCopiedIn({ from: result.from, to, mode: result.mode, spaceName: here.name });
      }
      const message =
        result.mode === 'quote' ? 'Quoted here' : result.entity === 'CollectionBlock' ? 'Posted here' : 'Added here';
      toastService.success(message, 8000, {
        label: 'Undo',
        run: () => void deleteBlocks(here.handle, result.id).catch(() => toastService.error('Could not undo that.')),
      });
      return result;
    } catch (error) {
      console.error('RecordStore: bringing something into the space failed', error);
      toastService.error('Could not add that here.');
      return null;
    }
  }

  async function bringIn(payload: { items?: BringInItem[] } | undefined): Promise<void> {
    for (const item of payload?.items ?? []) {
      if (item?.ref?.entity && item.ref.id) await bringOne(item);
    }
  }

  async function updateRecordField(entity: string, id: string, field: string, value: unknown): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !entity || !id || !field) return;
    const raw =
      value !== null && typeof value === 'object' && 'detail' in value ? (value as { detail: unknown }).detail : value;
    const kind = displays()[entity]?.fields.find((row) => row.name === field)?.kind;
    let next: unknown = raw;
    if (kind === 'number') next = raw === '' || raw === null || raw === undefined ? undefined : Number(raw);
    else if (kind === 'boolean') next = Boolean(raw);
    else if (raw !== null && raw !== undefined && typeof raw !== 'string') next = String(raw);
    if (next === undefined || (typeof next === 'number' && Number.isNaN(next))) return;
    try {
      await entityClass(entity, dataset.handle).update(dataset.handle, id, { [field]: next });
    } catch (error) {
      console.error('RecordStore: updating a record field failed', error);
      toastService.error('Could not save that change.');
    }
  }

  async function setSpaceTypeColor(spaceId: string, nodeType: string, color: unknown): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !spaceId || !nodeType) return;
    const raw =
      color !== null && typeof color === 'object' && 'detail' in color ? (color as { detail: unknown }).detail : color;
    const value = typeof raw === 'string' ? raw : '';
    // The relation's own predicate, not `children`: a space is not a container and a key is not one
    // of its contents. It is what `Space.typeStyles` reads through.
    const parent = { id: spaceId, predicate: PREDICATES.TYPE_STYLE };

    try {
      const existing = (await TypeStyle.findAll(dataset.handle, { parent } as Record<string, unknown>)) as {
        id: string;
        nodeType?: string;
      }[];
      const rows = existing.filter((row) => row.nodeType === nodeType);
      if (!value) {
        // Clearing deletes. `''` cannot be stored — the ORM's update skips it — and the canvas
        // sentinel would leave a row every reader has to know to ignore.
        for (const row of rows) await TypeStyle.delete(dataset.handle, row.id);
        return;
      }
      const [already, ...duplicates] = rows;
      // Two people colouring the same kind at once can leave two rows; the second write settles it.
      for (const row of duplicates) await TypeStyle.delete(dataset.handle, row.id);
      if (already) {
        await TypeStyle.update(dataset.handle, already.id, { color: value });
        return;
      }
      await TypeStyle.create(dataset.handle as never, { nodeType, color: value } as never, { parent } as never);
    } catch (error) {
      console.error("RecordStore: colouring a type in the space's key failed", error);
      toastService.error('Could not save that colour.');
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
  async function clearPlacement(
    canvas: string,
    nodeId: string,
    expect?: { x: number; y: number },
  ): Promise<PlacementRow | null> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !canvas || !nodeId) return null;
    try {
      const existing = (await Placement.findAll(dataset.handle, {
        parent: { id: canvas, predicate: PREDICATES.CHILDREN },
      } as Record<string, unknown>)) as unknown as PlacementRow[];
      const rows = existing.filter((placement) => placement.node === nodeId);
      if (!rows.length) return null;

      const drawn = resolvePlacement(rows) ?? rows[0];
      if (expect && !sameSpot({ x: Number(drawn.x) || 0, y: Number(drawn.y) || 0 }, expect)) return null;

      // Every placement for this node, not the first: a duplicate should not survive the removal and
      // silently put the thing back on the canvas at the next refresh.
      for (const row of rows) await Placement.delete(dataset.handle, row.id);
      return drawn;
    } catch (error) {
      console.error('RecordStore: removing a record from a canvas failed', error);
      toastService.error('Could not remove that.');
      return null;
    }
  }

  /**
   * Put a card back exactly as it came off — position, size, colour, shape, stacking.
   *
   * Built from the row `clearPlacement` answered with, minus the two fields that identify the row
   * rather than describe it. A fresh record, so it carries a new id: nothing points at a placement,
   * so there is nothing for that to break — which is exactly why *this* is reversible where deleting
   * a record is not.
   */
  async function restorePlacement(canvas: string, nodeId: string, row: PlacementRow): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset) return;
    const parent = { id: canvas, predicate: PREDICATES.CHILDREN };
    const { id: _id, node: _node, ...fields } = row;
    try {
      /*
        Not if somebody has already put it back.

        The guard the other replays make, in the only shape this one can take: there is no stored
        value to compare against, so the question is whether a placement exists at all. A peer who
        dragged the card back on has a position of their own, and a second placement beside it would
        be two rows disagreeing about where the card is.
      */
      if (await drawnPlacement(dataset.handle, parent, nodeId)) return;
      await Placement.create(dataset.handle as never, { ...fields, node: [nodeId] } as never, { parent } as never);
    } catch (error) {
      console.error('RecordStore: putting a card back on a canvas failed', error);
      toastService.error('Could not put that back.');
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
        for (const { nodeId, row } of removed) {
          await clearPlacement(canvas, nodeId, { x: Number(row.x) || 0, y: Number(row.y) || 0 });
        }
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
   * **Not undoable, and deliberately outside the history.** An AD4M delete removes the links; a
   * re-create earns a new id, so every relation pointing at the old record breaks with nothing to
   * say it did. Taking a card *off a canvas* is the reversible neighbour of this and is what the
   * Delete key does; this is the one a person has to ask for.
   *
   * One write group, so a canvas of peers sees the set go at once rather than thinning out over a
   * second — and so a failure part-way leaves nothing half-done.
   */
  async function deleteRecords(records: { recordId?: string; recordType?: string }[] | undefined): Promise<void> {
    const dataset = datasetStore.currentDataset();
    const rows = (records ?? []).filter((row) => row?.recordId && row.recordType);
    if (!dataset || !rows.length) return;

    try {
      await runEntityTransaction(dataset.handle, async (tx) => {
        for (const row of rows) {
          const Model = entityClass(row.recordType!, dataset.handle);
          if (!Model) continue;
          const found = (await Model.findOne(dataset.handle as never, { where: { id: row.recordId } } as never)) as
            { delete?: (batch?: string) => Promise<unknown> } | undefined;
          await found?.delete?.(tx.batchId);
        }
      });
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
      toastService.error('Could not delete those.');
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
      const Model = entityClass(draft.entity, dataset.handle);
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
        Created *inside* the canvas when there is one, not merely positioned on it.

        A canvas holds things by containment and positions them by placement — two facts, and it
        needs both. Writing only the placement made a record that existed, had a coordinate, and was
        invisible: the canvas's seed asks for each type among the canvas's own children, and a record
        created loose in the space is nobody's child. It turned up in the cards route, which asks the
        space rather than the canvas, which is exactly the shape of that bug from the outside.
      */
      const canvas = pendingBoard();
      const created = (await Model.create(
        dataset.handle,
        fields,
        canvas ? { parent: { id: canvas, predicate: PREDICATES.CHILDREN } } : undefined,
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
        The relations, once the record exists — and reported separately if they fail, because by then
        the record *has* been made. Leaving the form open on an error here would invite saving it again
        and making a second one.
      */
      try {
        await linkRelations(draft, created as { id?: string } & Record<string, unknown>, dataset.handle);
      } catch (error) {
        console.error('RecordStore: attaching related records failed', error);
        toastService.error(`${draft.label} created, but what was attached to it could not be saved.`);
      }

      /*
        Placed only where somebody chose a point, and after the record exists.

        After, because a placement points at something and placing first would leave a coordinate for
        nothing. Only-where-chosen, because a record with no placement is *unplaced* — the layout
        parks it in a tray in view, which is a state a person can see and act on. Writing `(0, 0)`
        instead dressed "nobody said" up as an answer, and put the card at the world origin.
      */
      const at = pendingPoint();
      // No undo entry, for `dropOnCanvas`'s reason: this is a record being *made*, and undoing it by
      // unplacing would leave the new record behind rather than putting anything back.
      if (canvas && at && created?.id) await writePlacement(canvas, created.id, draft.entity, at.x, at.y);

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
    provideVocabularies: vocabularies.provide,
    recordErrors,
    savingRecord,
    lastCreatedId,
    pendingLink,
    connectNodesNow,
    openRecordForm,
    connectNodes,
    createOnCanvas,
    createCardOnCanvas,
    placeOnCanvas,
    dragOnCanvas,
    removeFromCanvas,
    deleteRecords,
    canvasHistory: history.state,
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
    pendingCardStyle,
    confirmPending,
    previewCardStyle,
    resizeOnCanvas,
    anchorOnCanvas,
    rerouteOnCanvas,
    retargetOnCanvas,
    setCardStyle,
    setTypeColor,
    setSpaceTypeColor,
    dropOnCanvas,
    bringIn,
    updateRecordField,
    setRecordEntity,
    setRecordField,
    setRecordPlace,
    relationDraft,
    relationErrors,
    openRelationForm,
    setRelationField,
    saveRelationForm,
    cancelRelationForm,
    pickRelation,
    removeRelationEntry,
    setRelationLocation,
    setRelationEntryField,
    addRelationImage,
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
