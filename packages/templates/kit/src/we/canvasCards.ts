/**
 * Making things on a canvas: double-click empty space, choose what goes there, and it is made where
 * you clicked — a note in the composer, anything else through the record form.
 *
 * Shared by every canvas that makes things — the workshop's and the Coasys space's — so the chooser,
 * the composer and where the new card lands are one behaviour. A canvas route declares `CARD_LOCALS`,
 * binds `onCanvasDoubleClick` to `askWhatGoesHere`, and places `newThingChooser` and `newNoteModal`.
 * How the chooser colours each kind is the caller's: the workshop's key paints them, a canvas without
 * one leaves the picker's own colours.
 */
import { composerModal } from '@we/schema-kit';
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import { typePicker } from './typePicker.ts';

/** The locals a canvas route declares for these. All ephemeral: nothing here survives a reload. */
export const CARD_LOCALS = {
  /** Where a double-click landed, in world units — where whatever is made next goes. */
  newAt: { type: 'object', initial: null },
  chooserOpen: { type: 'boolean', initial: false },
  newNoteOpen: { type: 'boolean', initial: false },
  /** The composer over the selected note. Reads the selection rather than copying an id. */
  noteOpen: { type: 'boolean', initial: false },
} as const;

/**
 * What a double-click on empty canvas does: remember the point, and ask what goes there.
 *
 * Only when there is a canvas to put it on. Every choice writes against the canvas — a placement on
 * it, a card in it — so with none the chooser opened onto a list of things that could only fail.
 * Asked when the double-click lands rather than gated on the canvas, which is drawn either way.
 */
export function askWhatGoesHere(canvas: { $: string }): SchemaProp {
  return {
    $if: {
      condition: canvas,
      then: [
        { $setLocal: 'newAt', value: { $: 'event' } },
        { $setLocal: 'chooserOpen', value: true },
      ],
    },
  };
}

/**
 * The order of the chooser's built-in section: tasks and events, which are what a meeting mostly
 * produces, then media, then the rest. Named rather than sorted by a flag because the choice is this
 * canvas's — another picker over the same list has its own reasons. A kind not named here follows.
 */
const LEADING_KINDS = [
  'TaskBlock',
  'EventBlock',
  'ImageBlock',
  'AudioBlock',
  'VideoBlock',
  'TextBlock',
  'FileBlock',
  'LocationBlock',
  'LinkBlock',
  'CodeBlock',
  'TagBlock',
  'CalloutBlock',
];

/** Back to the chooser, from whichever form or composer it opened. */
export const BACK_TO_CHOOSER: SchemaProp[] = [{ $setLocal: 'chooserOpen', value: true }];

/**
 * "What goes here?" — anything this space can make, as `typePicker`'s searchable grid.
 *
 * The note first (a collection, written in the composer — its description says it is a document of
 * blocks, which is what tells it apart from Text), then this space's own types, then WE's blocks led by tasks and events. Each card's
 * icon is drawn in the colour the key gives its kind, so the chooser and the key agree.
 *
 * A composed kind opens the composer. Anything else opens the generic form through `createOnCanvas`,
 * which remembers the canvas and the point, and then switches the form to the chosen model — two
 * actions, because the first opens on whatever model comes first and the second is the one that says
 * which. Nothing is written until the form or the composer is saved.
 */
export interface CanvasCardOptions {
  /** The colour a kind is drawn in, as an expression over its name — a canvas with a key passes it. */
  fill?: (kind: string) => string;
}

export function newThingChooser(canvas: SchemaProp, opts: CanvasCardOptions = {}): SchemaNode {
  const close: SchemaProp = { $setLocal: 'chooserOpen', value: false };
  return {
    type: '$if',
    props: {
      condition: { $: 'local.chooserOpen' },
      then: {
        type: 'we-modal',
        // Wide enough for three columns of cards where the screen has room; it narrows with the screen.
        props: { size: 'lg', close },
        children: [
          { type: 'we-text', slot: 'header', props: { variant: 'heading-md' }, children: ['Add to the canvas'] },
          typePicker({
            lead: LEADING_KINDS,
            composedLabel: 'Note',
            composedIcon: 'note',
            // The key's colour is looked up by the kind's *name*; a picker entry is the whole row.
            ...(opts.fill ? { fill: (kind: string) => opts.fill!(`${kind}.value`) } : {}),
            pick: (kind) => [
              close,
              {
                $if: {
                  condition: { $: `${kind}.via == 'composer'` },
                  then: { $setLocal: 'newNoteOpen', value: true },
                  else: [
                    {
                      $invoke: 'recordStore.createOnCanvas',
                      args: [canvas, { $: 'local.newAt.x' }, { $: 'local.newAt.y' }],
                    },
                    { $invoke: 'recordStore.setRecordEntity', args: [{ $: `${kind}.value` }] },
                  ],
                },
              },
            ],
          }),
        ],
      },
    },
  };
}

/**
 * A note, composed onto the canvas at the point that was double-clicked.
 *
 * One action, because it is one act: the note and the coordinate that says where it sits land as
 * a single commit, so nothing watching the data layer sees a note in the tray for as long as the
 * placement takes to arrive. The same handshake the graph section's canvas uses.
 */
export function newNoteModal(canvas: SchemaProp, opts: CanvasCardOptions = {}): SchemaNode {
  return composerModal({
    openLocal: 'newNoteOpen',
    title: 'New note',
    saveLabel: 'Add',
    saveAction: {
      $invoke: 'recordStore.createCardOnCanvas',
      // `arg` first: the serialized tree, then where it goes.
      args: [{ $: 'arg' }, { canvas, at: { $: 'local.newAt' } }],
    },
    onSaved: [{ $setLocal: 'newAt', value: null }],
    back: BACK_TO_CHOOSER,
    // The disc the chooser drew a note with — its glyph, in the note's colour.
    icon: { name: 'note', ...(opts.fill ? { color: { $: opts.fill("'CollectionBlock'") } } : {}) },
  });
}
