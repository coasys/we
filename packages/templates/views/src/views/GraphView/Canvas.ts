import type { SchemaNode } from '@we/schema-shared';
import { composerModal, emptyState, field, formModal } from '@we/template-kit';

import { canvasLegend } from './Legend';
import { clearOnEmptySelection, selectNode } from './NodeDetail';

/**
 * The canvas — the same engine, with position as the data.
 *
 * Every other mode on this route *derives* an arrangement: force settles a knowledge map, tree
 * ranks containment, the schema map is laid out from relations nobody chose. A canvas is the one
 * where somebody put a thing somewhere because that is what they meant, and the layout's whole job
 * is to leave it alone. `manual` reads each card's own `x`/`y`; `drag-node` with `pin: true` is what
 * makes a dropped card stay dropped rather than being reclaimed on the next change; and
 * `onNodeDragEnd` writes the drop back, which is the only reason any of it survives a reload.
 *
 * ## What a card is
 *
 * A `CollectionBlock`, parented to the canvas through `we://children` — which is to say, a post that
 * happens to live on a canvas. That is not a shortcut: it means a card holds composed content
 * (`BlockComposer` writes it, `BlockRenderer` reads it), carries comments and signals like anything
 * else, and is found by everything that already walks a collection. Nothing here is canvas-shaped
 * except the two numbers.
 *
 * ## Reading and editing
 *
 * A card draws its real content — `content: 'block'` mounts the same renderer a post card uses — so
 * a note holding a photo and three paragraphs looks like one rather than like sixty characters of
 * its first line. Clipped, not scrolled: a card is a preview, and what does not fit is reached by
 * opening it.
 *
 * Editing is that modal rather than the canvas. Text entry inside a transformed, zoomable surface is
 * its own piece of work — the engine's notes have said so three times — and once the content is
 * *visible* in place, the remaining value of typing in place is small next to what it costs. Worth
 * revisiting after this has been used, not before.
 */

/** Which canvas is open. A picker writes it; the seed refuses to load until it is set. */
const CANVAS = { $: 'local.canvasId' };

const canvasCards: SchemaNode = {
  type: 'GraphView',
  props: {
    // The `canvas` seed reads the canvas's contents *and* the placements recorded against it, and
    // merges the coordinates into each node. A template names the canvas and nothing else.
    // `connections` draws the relationships whose two ends are both on this canvas — the same
    // records the knowledge map draws as edges, seen from the arrangement somebody made instead of
    // from the query that found them.
    // `typeStyles` is the canvas's key, read back: a colour per kind of thing, which every card of
    // that kind is drawn in unless it carries one of its own.
    // `routes` is the same idea for the lines: which side of a card each connection leaves and
    // arrives on, where somebody has pinned it rather than letting the geometry decide.
    seeds: {
      source: 'canvas',
      options: { canvas: CANVAS, connections: 'Relationship', typeStyles: 'TypeStyle', routes: 'EdgeRoute' },
    },
    // Nothing opens automatically: a canvas shows what is on it, and drilling into a card's own
    // blocks would turn a wall of notes into a tree of fragments.
    expansion: { defaultDepth: 0 },
    // The card's size, so a card nobody has placed is parked in a slot it fits, clear of the rest.
    layout: {
      type: 'manual',
      options: { size: { width: 180, height: 135 }, widthField: 'canvasWidth', heightField: 'canvasHeight' },
    },
    nodeStyle: [
      /*
        A card carries its content inside the box — the node *is* the thing, rather than a mark with
        a caption, which is what `shape: 'card'` means and why `size` stops applying.

        `content: 'block'` draws the post itself: its text, its images, its tasks. A label could only
        ever be the first line, so a card holding a photo and three paragraphs showed sixty
        characters and gave no sign the rest existed.

        Clipped, not scrolled, and that is the design: a card is a *preview*, and what does not fit
        is reached by opening it. Below half zoom it falls back to the label, because a hundred
        documents rendered at once is a hundred component trees and none of them is legible at the
        size where a canvas reads as coloured rectangles.
      */
      {
        style: {
          shape: 'card',
          width: 180,
          color: 'primary-100',
          labelColor: 'primary-900',
          content: 'block',
          contentMinZoom: 0.5,
        },
      },
      { when: { 'data.kind': 'note' }, style: { color: 'warning-100', labelColor: 'warning-900' } },
      { when: { 'data.kind': 'call' }, style: { color: 'success-100', labelColor: 'success-900' } },
      // Anything that is not a composed card — a task somebody put here, a model instance the
      // community defined — reads as its own kind of thing rather than as a note that lost its text.
      { when: { type: { not: 'CollectionBlock' } }, style: { color: 'neutral-100', labelColor: 'neutral-800' } },
      { when: { type: 'TaskBlock' }, style: { color: 'primary-50', labelColor: 'primary-800' } },
      { when: { type: 'EventBlock' }, style: { color: 'warning-50', labelColor: 'warning-800' } },
      /*
        The canvas's key: a colour per kind of thing, decided once and applied to every card of that
        kind. In front of the rules above — which are this template's opinion about what a note and a
        task look like — and behind the card's own colour below, because they answer different
        questions. "Tasks are amber here" is a fact about the canvas; "this one is red" is a fact
        about the card.
      */
      { style: { color: { from: 'data.canvasTypeColor' } } },
      /*
        Last, and read off each card: the presentation somebody chose, in front of every rule above.

        `{ from: … }` reads a field on the node rather than writing a value into the rule, which is
        the only way a rule list fixed when the template was written can describe cards that each
        carry their own size and colour. A card carrying none contributes nothing here and keeps
        whatever the rules above gave it — that deferral is what makes this a *front* layer rather
        than a replacement for the ones behind it.

        The canvas seed namespaces these on their way out of the placement, so `canvasWidth` cannot be
        confused with an image's own pixel width.
      */
      {
        style: {
          width: { from: 'data.canvasWidth' },
          height: { from: 'data.canvasHeight' },
          contentScale: { from: 'data.canvasContentScale' },
          cardShape: { from: 'data.canvasCardShape' },
          color: { from: 'data.canvasColor' },
          z: { from: 'data.canvasZ' },
        },
      },
    ],
    behaviours: [
      // Before drag-node, which is what makes arming mean anything: both claim a press on a node.
      { type: 'connect-nodes', options: { armed: { $: 'local.connecting' } } },
      // The two halves of a double-click: on a node it opens, on empty canvas it creates.
      'node-double-click',
      'canvas-double-click',
      /*
        The sweep, before `pan-zoom` — both want a press on empty canvas, and dispatch stops at the
        first behaviour that claims, so listed after it this would never run at all.

        Armed, a plain background drag sweeps and panning moves to the modifier. Disarmed it still
        answers to Shift and Ctrl/Cmd, which is what makes it findable by anyone who arrives from
        another canvas expecting it.
      */
      { type: 'marquee-select', options: { armed: { $: 'local.selecting' } } },
      'select',
      { type: 'drag-node', options: { pin: true } },
      /*
        Last, because it is the fallback — its own description says so, and listing it earlier is
        what stopped clicking empty canvas from deselecting anything.

        `pan-zoom` claims a press on the background and dispatch stops at the first behaviour that
        claims, so `select` never saw the press begin and had nothing to compare the release
        against. Nothing looked broken: the graph panned, the click did nothing, and the only
        missing thing was an event nobody could see was absent.
      */
      'pan-zoom',
    ],
    edgeStyle: [
      { style: { curve: 'smooth', arrow: 'target', color: 'primary-500', width: 2, showLabel: true } },
      // One rule per kind the community has named, exactly as the knowledge map does — a canvas's
      // connections mean the same things and should look the same way.
      {
        $: "local.relationshipKinds.map(item, { when: { 'data.relationshipTypeId': item.id }, style: { showLabel: true, width: 2, color: item.color, arrow: item.directed ? 'target' : 'none' } })",
      },
    ],
    // `lock` rather than `pin`: every card is placed already, so there is nothing to hold, and the
    // risk worth guarding against is rearranging somebody else's canvas by accident.
    controls: ['zoom-in', 'zoom-out', 'fit', 'lock'],
    height: '100%',
    revision: { $: '`${datasetStore.currentDataset.id}:${local.revision}`' },
    /*
      Cards can be taken elsewhere — a Pocket, a folder, another space's feed.

      No new gesture: the drag that moves a card on the canvas carries it too, and the release
      decides which it was. Drop zones light up as the pointer crosses them, so the option is
      visible while the drag is live, and the card springing back says which of the two happened.
    */
    carry: true,
    /*
      Undo, over this canvas's arrangement.

      The store records a move, a resize, a colour and a removal as it writes them, and replays them
      as new forward writes — so a peer's change in between is not discarded and a card somebody
      else has moved since is left alone. Deleting a record is deliberately not in it.

      Scoped to the canvas the picker has open: replaying a move onto a canvas the reader has
      navigated away from is the most confusing thing the key could do.
    */
    onUndo: { $action: 'recordStore.undoCanvas', args: [CANVAS] },
    onRedo: { $action: 'recordStore.redoCanvas', args: [CANVAS] },
    /*
      What a selection of several offers.

      Two, and deliberately not three. Connect, resize and "open this card" are statements about one
      record and mean nothing said about twelve at once; recolouring and deleting are what is left.

      There was a "take off the canvas" here and it has gone, because it did not do what its icon
      promised. A card the canvas *owns* has no position to lose: the seed reads owned-but-unplaced
      records back as the tray, so erasing one returns it on the next read and the `manual` layout
      parks it in the corner. See `recordStore.removeFromCanvas` — it is still the right action for
      a record merely placed here, which is a distinction a bar over a mixed selection cannot draw.
    */
    selectionActions: [
      { id: 'color', control: 'color', title: 'Colour', value: { from: 'data.canvasColor' } },
      { id: 'delete', icon: 'trash', title: 'Delete', tone: 'danger' },
    ],
    /*
      One handler for the bar, branching on which was pressed — the shape a handler array is for.

      `delete` ends the records for everybody, through the store action that raises the host's
      confirmation **once** for the whole set rather than once per card.
    */
    onSelectionAction: [
      {
        $if: {
          condition: { $: "event.action == 'delete'" },
          then: { $action: 'recordStore.deleteRecords', args: [{ $: 'event.records' }] },
        },
      },
      /*
        The colour, previewed as it is browsed and written once on Apply.

        The picker confirms here (see `ColorControl`), so everything before the tick arrives as a
        preview — which for a selection matters: without the guard, dragging the hue area would
        write a record per selected card per frame.
      */
      {
        $if: {
          condition: { $: "event.action == 'color' && event.preview" },
          then: {
            $action: 'recordStore.previewCardStyle',
            args: [{ $: 'event.records.map(r, r.recordId)' }, 'color', { $: 'event.value' }],
          },
        },
      },
      {
        $if: {
          condition: { $: "event.action == 'color' && !event.preview" },
          then: {
            $action: 'recordStore.setCardStyle',
            args: [CANVAS, { $: 'event.records.map(r, r.recordId)' }, 'color', { $: 'event.value' }],
          },
        },
      },
    ],
    /*
      Delete ends the records, whether one is selected or twenty.

      Through `deleteRecords` rather than `record.delete` because the host's confirmation is modal
      and phrased per record: looping it over a selection stacks a dialog per card, which is what
      made multi-select delete a thing to design rather than to fall into. One question, counting
      what is in the list.

      There is no reversible version of this to offer instead — taking a card off a canvas it is
      owned by does not remove it — so the guard in front of the key is the dialog, not an undo.
    */
    onDeleteSelection: {
      $if: {
        condition: { $: 'count(event.records)' },
        then: { $action: 'recordStore.deleteRecords', args: [{ $: 'event.records' }] },
      },
    },
    onNodeClick: selectNode,
    // Clicking empty canvas deselects — the same handler the other three modes carry. The canvas is
    // where it matters most: it is the mode you click around in, and without it the only way to
    // dismiss the panel is to select something else.
    onSelectionChange: clearOnEmptySelection,
    // Double-click opens the card. Nothing expands on a canvas, so the gesture is free — and it is
    // the one people arrive expecting from every other canvas they have used. A flag rather than an
    // id: the click that precedes the second one has already selected the node, and the modal reads
    // the selection.
    onNodeDoubleClick: { $setLocal: 'cardOpen', value: true },
    onEdgeClick: { $setLocal: 'selectedEdge', value: { $: 'event' } },
    // The same store call the knowledge map makes: connecting two things means the same thing
    // wherever you drew the line, and both end up in the same form.
    onEdgeCreate: { $action: 'recordStore.connectNodes', args: [{ $: 'event' }] },
    /*
      Double-click empty canvas to make something there.

      Position first, then content — forced by the composer being a modal that takes focus and covers
      the canvas, so "click to place" cannot be the last step. It is also the better order: you know
      where a note goes before you know what it says.
    */
    onCanvasDoubleClick: [
      { $setLocal: 'newCardAt', value: { $: 'event' } },
      { $setLocal: 'newCardOpen', value: true },
    ],
    /*
      The drop, written back.

      Without this the canvas is a layout that forgets — and worse, forgets silently, since the cards
      stay where they were dropped until the next reload.

      An upsert against the *canvas*, not an update of the record. A coordinate is a fact about the
      pair, so the same note can sit on two canvases in two places, and the record itself never learns
      it was on a canvas at all. `recordId`/`recordType` rather than the node's address: the graph
      names a node `we-graph://entity/<dataset>/<type>/<id>` and a template has no operator that
      could take that apart.
    */
    onNodeDragEnd: {
      $action: 'recordStore.placeOnCanvas',
      args: [CANVAS, { $: 'event.recordId' }, { $: 'event.recordType' }, { $: 'event.x' }, { $: 'event.y' }],
    },
    /*
      The corner drag, written back — and binding this is what puts the handle on a selected card.

      Onto the placement rather than the record, for the reason the position goes there: a size is a
      fact about the pair. Shrinking a post to fit six of them on a wall is not editing the post, and
      the same post on somebody else's canvas must not change size because of it.
    */
    onNodeResize: { $action: 'recordStore.resizeOnCanvas', args: [CANVAS, { $: 'event' }] },
    /*
      Which side a connection attaches to, written back — and binding this is what puts the grips on
      the ends of a hovered line.

      Onto an `EdgeRoute` parented to this canvas rather than onto the `Relationship`, for the reason
      a position goes on a placement: how a connection is *drawn* is a fact about a view. The same
      claim shown on another canvas is tidied there on its own terms, and the claim itself never
      learns it was ever bent around anything.
    */
    onEdgeAnchor: { $action: 'recordStore.anchorOnCanvas', args: [CANVAS, { $: 'event' }] },
    /*
      The shape of a line, written back — and binding this is what puts the grips on a selected one.

      Points a route is bent through, so a connection can be taken round a card that sits between its
      two ends. Stored in the edge's own frame rather than in world coordinates, which is what makes
      a bend survive somebody tidying the canvas: move either card and the shape follows them, where
      absolute points would leave the line doglegging through empty space.
    */
    onEdgeReroute: { $action: 'recordStore.rerouteOnCanvas', args: [CANVAS, { $: 'event' }] },
    /*
      And the same handle dropped on a *different* card, which re-attaches the connection.

      The one gesture here that edits the claim rather than the view: an anchor and a bend are how
      this canvas draws the line, and this is what the line *says* — so it changes wherever the
      relationship is shown. That end's anchor is cleared with it, a side pinned against the card
      that used to be there deciding nothing about the one that arrived.
    */
    onEdgeRetarget: { $action: 'recordStore.retargetOnCanvas', args: [CANVAS, { $: 'event' }] },
  },
};

/** Canvases in this space, for the picker. Hoisted so the empty state can count them. */
export const canvasQuery = { entity: 'CollectionBlock', where: { kind: 'canvas' }, order: { createdAt: 'asc' } };

/**
 * The canvas's own chrome: which canvas, and adding to it.
 *
 * Separate from the route's mode/layout row because these are about *this* canvas rather than about
 * how the route draws things — and because the layout picker is meaningless here, position being
 * the data rather than something a layout decides.
 */
export const canvasBar: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center' },
  children: [
    {
      type: 'we-select',
      props: {
        size: 'sm',
        placeholder: 'Pick a canvas…',
        options: { $: 'local.canvases.map(item, { label: item.title, value: item.id })' },
        value: CANVAS,
        onChange: { $setLocal: 'canvasId', value: { $: 'event.detail' } },
      },
    },
    {
      type: 'we-button',
      props: {
        size: 'sm',
        variant: 'ghost',
        onClick: { $setLocal: 'newBoardOpen', value: true },
      },
      children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Canvas'],
    },
    {
      type: '$if',
      props: {
        condition: CANVAS,
        then: {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            /*
              Connect mode, the same gesture the knowledge map arms.

              A mode with a visible control rather than a modifier key: the modifiers are taken or do
              not travel, and there are none at all on a touchscreen. It also gives the reader
              somewhere to see which of the two things a drag is about to do.
            */
            {
              type: 'we-button',
              props: {
                size: 'sm',
                variant: { $: "local.connecting ? 'primary' : 'ghost'" },
                onClick: { $toggleLocal: 'connecting' },
              },
              children: [{ type: 'we-icon', props: { name: 'flow-arrow' } }, 'Connect'],
            },
            /*
              Select mode, the counterpart of Connect.

              A drag on empty canvas pans, which is right and is the gesture people use most — so
              sweeping out a selection is armed from a control rather than taking the plain drag
              away. Shift and Ctrl/Cmd reach it without the toggle, which is what makes it findable
              by anybody arriving from another canvas; this is for the reader who wants it to be
              what a plain drag does while they tidy up.
            */
            {
              type: 'we-button',
              props: {
                size: 'sm',
                variant: { $: "local.selecting ? 'primary' : 'ghost'" },
                onClick: { $toggleLocal: 'selecting' },
              },
              children: [{ type: 'we-icon', props: { name: 'selection' } }, 'Select'],
            },
            /*
              Undo and redo, beside the tools rather than only on the keyboard.

              The keys work while the canvas has focus, which is most of the time and not all of it
              — clicking into the inspector to edit a label moves focus away, and the press that
              follows would go nowhere. Buttons work wherever focus is, and they are also the only
              sign the canvas remembers anything at all.

              Disabled rather than hidden, and titled with what the press would put back: a control
              that appears and disappears as you work is harder to aim at than one that greys.
            */
            {
              type: 'we-tooltip',
              props: {
                content: {
                  $: "recordStore.canvasHistory.undoLabel ? `Undo ${recordStore.canvasHistory.undoLabel}` : 'Nothing to undo'",
                },
              },
              children: [
                {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    variant: 'ghost',
                    square: true,
                    label: 'Undo',
                    disabled: { $: '!recordStore.canvasHistory.canUndo' },
                    onClick: { $action: 'recordStore.undoCanvas', args: [CANVAS] },
                  },
                  children: [{ type: 'we-icon', props: { name: 'arrow-counter-clockwise' } }],
                },
              ],
            },
            {
              type: 'we-tooltip',
              props: {
                content: {
                  $: "recordStore.canvasHistory.redoLabel ? `Redo ${recordStore.canvasHistory.redoLabel}` : 'Nothing to redo'",
                },
              },
              children: [
                {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    variant: 'ghost',
                    square: true,
                    label: 'Redo',
                    disabled: { $: '!recordStore.canvasHistory.canRedo' },
                    onClick: { $action: 'recordStore.redoCanvas', args: [CANVAS] },
                  },
                  children: [{ type: 'we-icon', props: { name: 'arrow-clockwise' } }],
                },
              ],
            },
            /*
              The key, which is also where a type's colour is set.

              Toggleable rather than fixed: a canvas with three kinds of thing on it does not need a
              legend, and a panel explaining what you can already see is a panel over the thing you
              are looking at.
            */
            {
              type: 'we-button',
              props: {
                size: 'sm',
                variant: { $: "local.legendOpen ? 'secondary' : 'ghost'" },
                onClick: { $toggleLocal: 'legendOpen' },
              },
              children: [{ type: 'we-icon', props: { name: 'palette' } }, 'Key'],
            },
            {
              type: 'we-button',
              props: { size: 'sm', variant: 'secondary', onClick: { $setLocal: 'newCardOpen', value: true } },
              children: [{ type: 'we-icon', props: { name: 'note' } }, 'Card'],
            },
            /*
              A model instance, made *onto* this canvas.

              The same form the New button opens anywhere else — `createOnCanvas` only adds the
              intent, so what is created is placed here rather than left loose in the space. That is
              the whole difference between a canvas that holds a community's own models and one that
              holds sticky notes, and it is one store call rather than a second authoring path.
            */
            {
              type: '$if',
              props: {
                // Form-made content only: this opens the record form. Notes have their own button.
                condition: { $: "count(recordStore.creatableEntities.filter(k, k.via == 'form'))" },
                then: {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    variant: 'ghost',
                    onClick: { $action: 'recordStore.createOnCanvas', args: [CANVAS] },
                  },
                  children: [{ type: 'we-icon', props: { name: 'cube' } }, 'Record'],
                },
              },
            },
          ],
        },
      },
    },
  ],
};

/** Naming a canvas. `record.create` rather than the composer — a canvas is a container, not a document. */
const newCanvasModal: SchemaNode = formModal({
  open: { $: 'local.newBoardOpen' },
  close: { $setLocal: 'newBoardOpen', value: false },
  title: 'New canvas',
  size: 'sm',
  localState: { canvasName: { type: 'string', initial: '' } },
  children: [field({ name: 'canvasName', label: 'Name', placeholder: 'Ideas, retro, roadmap…' })],
  // Nothing about a name is locally judgeable beyond its presence, so this gates on the value
  // itself rather than dragging in the validation machinery.
  disabled: { $: '!local.canvasName' },
  submitLabel: 'Create',
  submit: {
    $action: 'record.create',
    args: ['CollectionBlock', { kind: 'canvas', title: { $: 'local.canvasName' } }],
    // Straight into the new canvas: making one and then having to find it in a picker is a step
    // nobody wanted.
    onSuccess: [
      { $setLocal: 'canvasId', value: { $: 'result.id' } },
      { $setLocal: 'revision', value: { $: 'local.revision + 1' } },
    ],
  },
});

/**
 * A card, composed.
 *
 * The same handshake every composed artifact in WE uses, anchored to the canvas through
 * `we://children`. It lands unplaced, which the `manual` layout parks in a grid beside what is
 * already there — and then somebody drags it where they meant it to go, which writes its position.
 * Asking for a position up front would be asking where a thing goes before it exists.
 */
const newCardModal: SchemaNode = composerModal({
  openLocal: 'newCardOpen',
  title: 'New card',
  saveLabel: 'Add',
  /*
    One action, because it is one act.

    The card and the coordinate that says where it sits land as a single commit. Written separately
    they are two, and anything watching the data layer catches the state between them — which is
    exactly what the canvas did: it drew the card unpositioned, in the tray, for as long as the
    placement took to arrive, and then moved it.

    `newCardAt` is null when the card came from the toolbar rather than a double-click, and the store
    then writes no placement at all: the card lands in the tray, which is the honest answer to
    "nobody said where" and the place it is recoverable from.
  */
  saveAction: {
    $action: 'recordStore.createCardOnCanvas',
    // `'$arg'` first: the serialized tree, then where it goes.
    args: [{ $: 'arg' }, { canvas: CANVAS, at: { $: 'local.newCardAt' } }],
  },
  onSaved: [
    { $setLocal: 'newCardAt', value: null },
    { $setLocal: 'revision', value: { $: 'local.revision + 1' } },
  ],
});

/** The canvas, or a reason there is nothing on it. */
export const canvasSurface: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', position: 'relative' },
  children: [
    newCanvasModal,
    newCardModal,
    canvasLegend,
    {
      type: '$if',
      props: {
        condition: CANVAS,
        then: canvasCards,
        // Two different absences, said differently: a space with no canvases has one thing to do
        // about it, and a space with canvases nobody has opened has another.
        else: {
          type: '$if',
          props: {
            condition: { $: 'count(local.canvases)' },
            then: emptyState({ icon: 'squares-four', label: 'canvases', message: 'Pick a canvas to open it.' }),
            else: emptyState({
              icon: 'squares-four',
              label: 'canvases',
              message: 'No canvases yet. Make one, and put things on it wherever you like.',
            }),
          },
        },
      },
    },
  ],
};
