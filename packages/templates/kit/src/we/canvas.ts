/**
 * A space's canvas, as behaviour any template can give its `GraphView`: what is on it, where people
 * put it, the lines between them, and the decisions a card asks for.
 *
 * Shared by the workshop and the Coasys space, which drew one canvas twice and drifted: the second
 * had no suggestions, no card toolbar and no connections. Two pieces, both plain props a caller
 * spreads onto its graph:
 *
 * - `canvasSeedOptions` — the `canvas` seed's options: the canvas's own placements over the space's
 *   records, the kinds extraction makes, where each came from, the connections and how this canvas
 *   routes them, which cards are suggestions, and the counts on each card's footer.
 * - `canvasEditing` — every gesture that changes the canvas or what is on it: moving, resizing and
 *   carrying cards, dropping things in, drawing and re-routing lines, undo, deleting, the colour of a
 *   selection, and each card's own toolbar (accept or reject a suggestion, review a suggested change,
 *   colour, shape, content size, delete).
 *
 * What a template does *around* a canvas stays its own: an inspector, lenses over the cards, a tree
 * arrangement. The few points where those meet these gestures are options — what selecting a line
 * just drawn does, what "review" opens, what follows choosing a colour.
 *
 * ## Placements belong to the canvas, members to the space
 *
 * A canvas is a record of its own (a space's `canvas` landmark): the placements are its children, and
 * its cards are read from the space collection's children. So a record anybody files into the space —
 * a call's finds, a note, a task — can be placed without being moved, the same record can sit on two
 * canvases in two places, and the placements never mix into what a feed reads from the space.
 */
import type { SchemaProp } from '@we/schema-shared';

import { CHANGED, UNCONFIRMED } from './suggestions.ts';

/** The kinds of record extraction can make — what an unplaced card on a canvas can be. */
export const EXTRACTABLE = 'shapeStore.extractionCandidates';

export interface CanvasSeedOptions {
  /** The canvas record — its placements are its own. */
  canvas: SchemaProp;
  /** Where its cards come from: the space collection's children, as a rule. */
  members: { id: SchemaProp; via: string };
}

/** The `canvas` seed's options for a space's canvas — see the module comment. */
export function canvasSeedOptions({ canvas, members }: CanvasSeedOptions): Record<string, SchemaProp> {
  return {
    canvas,
    members,
    contains: { $: EXTRACTABLE },
    // Where each card came from, for a badge or a lens by conversation.
    origin: 'extractedFrom',
    connections: 'Relationship',
    // How this canvas draws its lines: which side of a card each end attaches to, and the points one
    // is bent through. Per canvas, like a placement — the same claim elsewhere keeps its own shape.
    routes: 'EdgeRoute',
    /*
      Which cards are suggestions — a whole record a pass staged and nobody has kept — and which are
      agreed records carrying a suggested edit. A staged record answers the canvas's query exactly as a
      kept one does, so this is what lets a card look provisional. See `suggestions.ts`.

      Whether anybody has agreed to a record is a fact about the record, not about the call being
      looked at, so these are unions across calls. Keyed per call, the outgoing call's cards flashed as
      settled for the moment the incoming call's list was being fetched.
    */
    pending: { $: UNCONFIRMED },
    changed: { $: CHANGED },
    // Reactions and replies each card has collected, carried in the reads the seed already makes.
    counts: ['signals', 'responses'],
  };
}

export interface CanvasEditingOptions {
  /** The canvas record every gesture writes against. */
  canvas: SchemaProp;
  /**
   * What "Review pending change" on a card does. A suggested change is answered where there is room
   * to read old against new — an inspector, the record's own page — not on a clipped card.
   */
  onReview: SchemaProp;
  /** What follows a line being drawn: `result` is the new connection's id, empty if it failed. */
  afterConnect?: SchemaProp[];
  /** What follows a colour being chosen for a card — the workshop turns its lenses off. */
  afterColour?: SchemaProp[];
}

/** The style fields a card's toolbar sets on its placement — the action's id is the field. */
const STYLE_FIELDS = "['color', 'cardShape', 'contentScale']";

/** Every gesture that changes the canvas or what is on it — see the module comment. */
export function canvasEditing({ canvas, onReview, afterConnect = [], afterColour = [] }: CanvasEditingOptions) {
  return {
    /*
      A line drawn between two cards is a `Relationship` written at once, with no form in front of it:
      the gesture is the intent, and the words are added where the line is read. What follows (opening
      the line somewhere it can be named) is the caller's.
    */
    onEdgeCreate: { $invoke: 'recordStore.connectNodesNow', args: [{ $: 'event' }], onSuccess: afterConnect },
    /*
      A drop, written back as an upsert against the *canvas* rather than the record: a coordinate is a
      fact about the pair. `dragOnCanvas` with the whole payload, because a folded card carries a
      placement for each card hidden under it.
    */
    onNodeDragEnd: { $invoke: 'recordStore.dragOnCanvas', args: [canvas, { $: 'event' }] },
    onNodeResize: { $invoke: 'recordStore.resizeOnCanvas', args: [canvas, { $: 'event' }] },
    /*
      Routing a line by hand: which side of a card an end attaches to, and the points it is bent
      through. Both land on an `EdgeRoute` parented to this canvas — how a claim is drawn is a fact
      about a view. Dropping an end on another card re-attaches the line, which changes the claim.
    */
    onEdgeAnchor: { $invoke: 'recordStore.anchorOnCanvas', args: [canvas, { $: 'event' }] },
    onEdgeReroute: { $invoke: 'recordStore.rerouteOnCanvas', args: [canvas, { $: 'event' }] },
    onEdgeRetarget: { $invoke: 'recordStore.retargetOnCanvas', args: [canvas, { $: 'event' }] },
    // Something dragged in from the Pocket, or from anywhere else, lands where it was dropped.
    onDrop: { $invoke: 'recordStore.dropOnCanvas', args: [canvas, { $: 'event' }] },
    /*
      Delete on whatever is selected. Cards through `deleteRecords`, which asks once for the whole
      selection rather than a dialog per card; a line the same way, so it vanishes on the press.
    */
    onDeleteSelection: [
      {
        $if: {
          condition: { $: 'count(event.records)' },
          then: { $invoke: 'recordStore.deleteRecords', args: [{ $: 'event.records' }] },
        },
      },
      {
        $if: {
          condition: { $: "event.kind == 'edge' && event.recordId" },
          then: {
            $invoke: 'recordStore.deleteRecords',
            args: [{ $: '[{ recordId: event.recordId, recordType: event.recordType }]' }],
          },
        },
      },
    ],
    /*
      Undo over this canvas's arrangement — a move, a resize, a colour — replayed as new forward writes,
      so a peer rearranging the same canvas does not lose what they did.
    */
    onUndo: { $invoke: 'recordStore.undoCanvas', args: [canvas] },
    onRedo: { $invoke: 'recordStore.redoCanvas', args: [canvas] },
    // Cards can be carried off the canvas — into the Pocket, and from there into any other space.
    carry: true,
    // What a selection of several offers: recolour them, or delete them.
    selectionActions: [
      { id: 'color', control: 'color', title: 'Colour', value: { from: 'data.canvasColor' } },
      { id: 'delete', icon: 'trash', title: 'Delete', tone: 'danger' },
    ],
    onSelectionAction: [
      {
        $if: {
          condition: { $: "event.action == 'delete'" },
          then: { $invoke: 'recordStore.deleteRecords', args: [{ $: 'event.records' }] },
        },
      },
      // Previewed as the colour is browsed and written once on Apply — never a write per card per frame.
      {
        $if: {
          condition: { $: "event.action == 'color' && event.preview" },
          then: {
            $invoke: 'recordStore.previewCardStyle',
            args: [{ $: 'event.records.map(r, r.recordId)' }, 'color', { $: 'event.value' }],
          },
        },
      },
      {
        $if: {
          condition: { $: "event.action == 'color' && !event.preview" },
          then: {
            $invoke: 'recordStore.setCardStyle',
            args: [canvas, { $: 'event.records.map(r, r.recordId)' }, 'color', { $: 'event.value' }],
          },
        },
      },
    ],
    /*
      A card's own toolbar. A suggestion offers the decision and nothing else: Accept or Reject, on the
      card that raised the question. A suggested change offers Review. A settled card offers how it
      looks — colour, shape, content size, as host controls reading the placement — and Delete, which a
      suggestion does not: discarding resolves a suggestion, deleting would leave its staged overlay
      behind. `{ exists: false }` because the seed writes `pending` only on the cards it applies to.
    */
    nodeActions: [
      { id: 'accept', icon: 'check', title: 'Accept', when: { 'data.pending': true }, tone: 'positive' },
      { id: 'reject', icon: 'x', title: 'Reject', when: { 'data.pending': true }, tone: 'danger' },
      { id: 'review', icon: 'pencil-simple-line', title: 'Review pending change', when: { 'data.changed': true } },
      {
        id: 'color',
        control: 'color',
        title: 'Colour',
        value: { from: 'data.canvasColor' },
        when: { 'data.pending': { exists: false } },
      },
      {
        id: 'cardShape',
        control: 'shape',
        title: 'Shape',
        value: { from: 'data.canvasCardShape' },
        when: { 'data.pending': { exists: false } },
      },
      {
        id: 'contentScale',
        control: 'scale',
        title: 'Content size',
        value: { from: 'data.canvasContentScale' },
        when: { 'data.pending': { exists: false } },
      },
      { id: 'delete', icon: 'trash', title: 'Delete', when: { 'data.pending': { exists: false } }, tone: 'danger' },
    ],
    onNodeAction: [
      { $if: { condition: { $: "event.action == 'review'" }, then: onReview } },
      {
        $if: {
          condition: { $: "event.action == 'accept'" },
          /*
            Kept, and pinned where it is drawn. A suggestion is parked rather than placed — nobody had
            agreed to the record — so keeping it is the moment it joins the arrangement.
          */
          then: [
            { $invoke: 'modules.transcribe.acceptProposal', args: [{ $: 'event.recordId' }] },
            {
              $invoke: 'recordStore.placeOnCanvas',
              args: [canvas, { $: 'event.recordId' }, { $: 'event.recordType' }, { $: 'event.x' }, { $: 'event.y' }],
            },
          ],
        },
      },
      {
        $if: {
          condition: { $: "event.action == 'reject'" },
          then: { $invoke: 'modules.transcribe.rejectProposal', args: [{ $: 'event.recordId' }] },
        },
      },
      // Through `record.delete`, guarded by the host's own confirmation like every destructive call.
      {
        $if: {
          condition: { $: "event.action == 'delete'" },
          then: { $invoke: 'record.delete', args: [{ $: 'event.recordType' }, { $: 'event.recordId' }] },
        },
      },
      // The three presentation controls: a moving control previews without writing; a settled one writes.
      {
        $if: {
          condition: { $: `event.action in ${STYLE_FIELDS} && event.preview` },
          then: {
            $invoke: 'recordStore.previewCardStyle',
            args: [{ $: 'event.recordId' }, { $: 'event.action' }, { $: 'event.value' }],
          },
        },
      },
      {
        $if: {
          condition: { $: `event.action in ${STYLE_FIELDS} && !event.preview` },
          then: {
            $invoke: 'recordStore.setCardStyle',
            args: [canvas, { $: 'event.recordId' }, { $: 'event.action' }, { $: 'event.value' }],
          },
        },
      },
      ...(afterColour.length
        ? [{ $if: { condition: { $: "event.action == 'color' && !event.preview" }, then: afterColour } }]
        : []),
    ],
  } satisfies Record<string, SchemaProp>;
}
