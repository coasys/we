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
 * ## Its parts
 *
 * Templates read one `recordStore`; behind it are six jobs, each a factory of its own in
 * `./records/`, composed here:
 *
 * - **kinds** — what can be made and shown here, how each is laid out, and the space's key over that.
 * - **connections** — a line drawn before its write lands, and the dedup key every connection carries.
 * - **canvas** — where each card sits and how it looks, routes, cards taken off, and the undo history.
 * - **tree** — a card dragged within a canvas read as a hierarchy, written as the structure it means.
 * - **forms** — the draft of a record being made, and the records filled in inline for its relations.
 * - **drops** — something dragged in from elsewhere, copied or quoted into the space on screen.
 *
 * What is left here is the one surface over them, where content lives (lent by the space store), and
 * an inspector's edit of one field.
 *
 * ## Why it does not create posts
 *
 * A post is composed, not filled in: it is a `CollectionBlock` holding a tree of blocks, authored
 * through `BlockComposer`, which produces a serialized document rather than a set of field values.
 * A surface that offers both should offer the composer for that case and this for the rest — one
 * entry point, two bodies. Folding a document editor into a generated form would serve neither.
 */
import type { HistoryState } from '@we/history';
import type { Accessor, ReactivityPort } from '@we/reactivity';

import { type BringInItem } from '../bringIn';
import type { PendingConnectionWrites } from '../canvas/connectionHolds';
import { hostSlot } from '../hostSlot';
import { type CreatableEntity } from '../shapes/creatableKinds';
import { type TypePresentation } from '../shapes/presentation';
import { fieldEditValue, type RecordDisplay } from '../shapes/recordDisplay';
import { type RecordDraft } from '../shapes/recordDraft';
import { type Spine } from '../sources/treeSpines';
import type { Toasts } from '../toasts';
import { createRecordCanvas } from './records/canvas';
import { createRecordConnections } from './records/connections';
import { operationRunner, type RecordDatasets, RELATIONSHIP } from './records/context';
import { createRecordDrops } from './records/drops';
import { createRecordForms } from './records/forms';
import { createRecordKinds } from './records/kinds';
import { createRecordTree } from './records/tree';
import type { SessionStore } from './SessionStore';
import type { ShapeStore } from './ShapeStore';

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
   * WE's own structural classes — a Space, a setting, a placement, a community's vocabularies — by
   * name: what a list of a space's classes leaves out wherever their shape came from. The one part of
   * that list a template cannot name for itself (`WE_PLUMBING_CLASSES`).
   */
  plumbingClasses: Accessor<readonly string[]>;
  /**
   * Every kind of record that can be shown here — what can be made, then every core block and the
   * kinds read without being made (a drawn connection, the space's vocabulary) — each with its name,
   * glyph and hue. The list a canvas colours its cards from: `creatableEntities` leaves out a quote
   * dropped in from the Pocket, which is still a card.
   */
  kinds: Accessor<Omit<CreatableEntity, 'via' | 'description'>[]>;
  /**
   * SpaceStore supplies the lists a *community* owns, for a property whose declaration names one —
   * see `vocabulary` on a property, and `offeredTaskStates`.
   *
   * Injected rather than read: the answer lives on records in the space, and SpaceStore is composed
   * after this one. Unset, every display falls back to the declaration's own `options`.
   */
  provideVocabularies: (resolve: (vocabulary: string) => string[] | undefined) => () => void;
  /**
   * Where content lives — injected by the store that knows the space's structure.
   *
   * A canvas holds its cards by containment, but a space canvas cannot work that way: what it shows is everything top-level in the space, read
   * from the space collection, and a card hidden inside the canvas record would be on no feed, no
   * board and no other canvas. So `forCanvas` answers where content made on a canvas goes (the space
   * collection, for the space's canvas; the canvas itself otherwise), and `root` where content with
   * no other home goes. Unset, a canvas holds its own cards and loose content has no parent.
   */
  provideContentHomes: (homes: { forCanvas: (canvas: string) => string; root: () => string }) => () => void;
  /** Validation errors from the last save attempt. */
  recordErrors: Accessor<string[]>;
  savingRecord: Accessor<boolean>;
  /**
   * The id of the last record created, empty before the first.
   *
   * Read by a surface that wants to do something with what was just made — select the new node on a
   * graph, scroll to the new row. Kept rather than passed to a callback because `$invoke`'s
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
   * `{ $invoke: 'recordStore.openRecordForm' }` with no `args` hands it the DOM event — anything
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
   * knows in advance, and `$invoke` calls a method once — so "place this, and each of those" has to
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
      opened?: boolean;
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
   * Bring a connection's dedup key back in line with its label and both ends' titles.
   *
   * `updateRecordField` does this itself. A surface that saves a connection through the generic
   * `record.update` calls this after, or the next extraction pass reads the old claim from the key.
   */
  rekeyConnection: (id: string) => Promise<void>;
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
   * Irreversible, and outside the undo history on purpose: a delete drops the record's links, and a
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
   * Move a card to another place in a tree, from the graph's `onNodeArrange` payload.
   *
   * The counterpart of `dragOnCanvas` for a canvas being read as a hierarchy: there a drag writes a
   * coordinate, and here it writes the structure the layout reads. `relationshipTypeId` says which kind
   * of connection the tree follows — the community's own vocabulary, and the reader's current choice of
   * spine, neither of which the store can know.
   *
   * Dropping a card ON another makes it a child of it; dropping it BESIDE one reorders it there, which
   * writes a rank on the placement; dropping it in the unconnected area takes it out of its tree.
   *
   * Three things it refuses, each with a toast saying why: a drop that would put a card inside itself,
   * a drop beside a tree's own root (which would detach it as a side effect — the unconnected area is
   * where that is explicit), and taking out a connection people have commented on or reacted to, since
   * removing a parental claim means deleting the record and there is no reversible spelling of that.
   */
  arrangeOnTree: (canvas: string, spine: Spine | string, payload: unknown) => Promise<void>;
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
   * Connections written and not yet seen come back — a line just drawn, one just deleted, an end just
   * moved — in records, for the graph to draw ahead of the data. See `holdConnection`.
   */
  pendingConnections: Accessor<PendingConnectionWrites>;
  /**
   * What the graph is drawing from its own data, in records, so each pending connection can be judged
   * against it and dropped once the data has caught up. Called by whoever draws on the store's behalf.
   */
  observeConnections: (connections: readonly { id: string; source: string; target: string }[]) => void;
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
   * Say how every record of one type is laid out in this space — a card's title, summary, picture
   * and listed fields, a field's control, the fields its form asks for — over the model's own.
   * Only what `presentation` sets is overridden; `null` puts the type back to the model's. The
   * colour the type has in the space's key is kept. See `shared/shapes/presentation.ts`.
   */
  setSpaceTypePresentation: (spaceId: string, nodeType: string, presentation: TypePresentation | null) => Promise<void>;
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

export interface RecordStoreDeps {
  reactivity: ReactivityPort;
  toasts: Toasts;
  /** Who writes — every write runs as the signed-in agent. */
  sessionStore: Pick<SessionStore, 'me'>;
  datasetStore: RecordDatasets;
  /** The space's own models, which it offers forms and displays for beside WE's. */
  shapeStore: Pick<ShapeStore, 'spaceShapes'>;
}

export function createRecordStore(deps: RecordStoreDeps): RecordStore {
  const { reactivity, toasts } = deps;
  const datasetStore = deps.datasetStore;
  const session = deps.sessionStore;
  const runOp = operationRunner(session);
  const context = { reactivity, toasts, sessionStore: session, datasetStore, runOp };

  const kinds = createRecordKinds({ ...context, shapeStore: deps.shapeStore });
  const { creatableEntities, displays, titleField } = kinds;
  const connections = createRecordConnections({ ...context, kinds });
  const { pendingConnections, observeConnections, rekeyConnection } = connections;

  const contentHomes = hostSlot<{ forCanvas: (canvas: string) => string; root: () => string }>();
  /** Where content made on `canvas` lives — or, with no canvas, content with no other home. See `provideContentHomes`. */
  const contentHome = (canvas?: string): string | undefined =>
    canvas ? (contentHomes.get()?.forCanvas(canvas) ?? canvas) : contentHomes.get()?.root() || undefined;

  const onCanvas = createRecordCanvas({ ...context, connections, contentHome });
  const tree = createRecordTree({ ...context, shapeStore: deps.shapeStore, kinds, connections, canvas: onCanvas });
  const forms = createRecordForms({ ...context, kinds, connections, canvas: onCanvas, contentHome });
  const drops = createRecordDrops({ ...context, kinds, canvas: onCanvas, contentHome });

  async function updateRecordField(entity: string, id: string, field: string, value: unknown): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !entity || !id || !field) return;
    const kind = displays()[entity]?.fields.find((row) => row.name === field)?.kind;
    const next = fieldEditValue(kind, value);
    if (next === undefined) return;
    try {
      await runOp('core.editRecord', { entity, id, fields: { [field]: next } }, dataset.handle);
    } catch (error) {
      console.error('RecordStore: updating a record field failed', error);
      toasts.error('Could not save that change.');
      return;
    }
    /*
      The keys that quote what just changed. A connection's key carries its label and both ends'
      titles, so relabelling one or renaming a record it joins leaves a key describing a claim nobody
      is making any more — and the next interpretation pass reads the tree from those keys.
    */
    if (entity === RELATIONSHIP && field === 'label') await rekeyConnection(id);
    else if (field === titleField(entity)) await connections.rekeyConnectionsOf(dataset.handle, id);
  }

  /*
    One surface over the parts. The forms, the tree and the drops hand back public members only, so
    they are spread; the kinds, the connections and the canvas also lend the other parts what they
    need, so only their public members are named here.
  */
  const store: RecordStore = {
    ...forms,
    ...tree,
    ...drops,
    creatableEntities,
    displays,
    kinds: kinds.kinds,
    plumbingClasses: kinds.plumbingClasses,
    provideVocabularies: kinds.provideVocabularies,
    setSpaceTypeColor: kinds.setSpaceTypeColor,
    setSpaceTypePresentation: kinds.setSpaceTypePresentation,
    pendingConnections,
    observeConnections,
    rekeyConnection,
    createCardOnCanvas: onCanvas.createCardOnCanvas,
    placeOnCanvas: onCanvas.placeOnCanvas,
    dragOnCanvas: onCanvas.dragOnCanvas,
    removeFromCanvas: onCanvas.removeFromCanvas,
    deleteRecords: onCanvas.deleteRecords,
    canvasHistory: onCanvas.canvasHistory,
    undoCanvas: onCanvas.undoCanvas,
    redoCanvas: onCanvas.redoCanvas,
    pendingCardStyle: onCanvas.pendingCardStyle,
    confirmPending: onCanvas.confirmPending,
    previewCardStyle: onCanvas.previewCardStyle,
    resizeOnCanvas: onCanvas.resizeOnCanvas,
    anchorOnCanvas: onCanvas.anchorOnCanvas,
    rerouteOnCanvas: onCanvas.rerouteOnCanvas,
    retargetOnCanvas: onCanvas.retargetOnCanvas,
    setCardStyle: onCanvas.setCardStyle,
    setTypeColor: onCanvas.setTypeColor,
    provideContentHomes: contentHomes.provide,
    updateRecordField,
  };

  return store;
}

// Re-exported so a consumer needs one import for the store and the shape of what it holds.
export type { RecordDraft, RecordField } from '../shapes/recordDraft';
