/**
 * The notes panel — every note you have written, and the composer to write another.
 *
 * Every piece is a fragment. Nothing here imports a framework: `BlockComposer`, `BlockRenderer` and
 * the `we-*` primitives are registry keys resolved by whichever renderer is running.
 *
 * ## Where the data is
 *
 * The personal space, named once as {@link PERSONAL}. Reads are `$query` with that dataset; writes go
 * through the module's store, because a note is a composition and only the host can write one (see
 * `store.ts`). The panel therefore has no `record.*` in it at all.
 *
 * ## The composer is inline, and saving is a button
 *
 * A note is written in the panel rather than in a modal: a scratchpad that takes over the screen is
 * not one. The composer's save is a handshake — `onReady` hands over `save()`, a button calls it, and
 * `onSave` receives the document — so a Save button is what drives it. Saving on blur or after a pause
 * would need a timer and the draft's identity across two writes (create, then update), and neither is
 * something a fragment can hold; it is a follow-up for the store, not something to fake here.
 */
import { confirmModal, panelScroll, panelShell } from '@we/schema-kit';
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import { NOTE_KIND } from './entities';

/** The dataset every read here names. Chrome tier only — a space's template has no such path. */
const PERSONAL = 'datasetStore.personalDataset';

/** The same dataset as the renderer and composer want it: the handle, for resolving stored files. */
const personalHandle = { $: `${PERSONAL}.handle` };

/** A note's dataset key, as a reference names it — so a note dragged into the Pocket is kept by reference. */
const personalKey = { $: `'p:' + ${PERSONAL}.id` };

/**
 * A composer and its two buttons — shared by a new note and an edit, which differ only in what they
 * start from and which action saves.
 *
 * The `$localState` sits on this node rather than on the panel so an edit open on one card and a new
 * note open at the top each hold their own `save()`: one function slot shared by both would call
 * whichever composer mounted last.
 */
function editor(opts: { editorState?: SchemaProp; save: Record<string, SchemaProp>; cancel: SchemaProp }): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '200', width: '100%' },
    $localState: {
      /** The composer's own `save()`, handed over by `onReady`. Read by `$callLocal`. */
      saveNote: { type: 'function', initial: null },
    },
    children: [
      {
        type: 'Column',
        // `pl` clears the composer's left gutter, where the slash-command affordance sits.
        props: { width: '100%', bg: 'surface-raised', r: '300', p: '300', pl: '900' },
        children: [
          {
            type: 'BlockComposer',
            props: {
              ...(opts.editorState !== undefined && { editorState: opts.editorState }),
              // Stored files in a note are addresses in the personal space; without this the composer
              // would try to fetch them from whichever space is on screen, and draw broken pictures.
              perspective: personalHandle,
              onReady: { $setLocal: 'saveNote', value: { $: 'event.save' } },
              onSave: [opts.save],
            },
          },
        ],
      },
      {
        type: 'Row',
        props: { gap: '200', ax: 'end', width: '100%' },
        children: [
          {
            type: 'we-button',
            props: { variant: 'ghost', size: 'sm', onClick: opts.cancel },
            children: ['Cancel'],
          },
          {
            type: 'we-button',
            props: {
              variant: 'primary',
              size: 'sm',
              loading: { $: "modules.notes.saving != ''" },
              disabled: { $: "modules.notes.saving != ''" },
              onClick: { $callLocal: 'saveNote' },
            },
            children: ['Save'],
          },
        ],
      },
    ],
  };
}

/** One icon button with a tooltip — the card's actions all have this shape. */
function iconAction(opts: {
  label: string;
  icon: string;
  onClick: SchemaProp;
  disabled?: SchemaProp;
  loading?: SchemaProp;
}): SchemaNode {
  return {
    type: 'we-tooltip',
    props: { content: opts.label },
    children: [
      {
        type: 'we-button',
        props: {
          label: opts.label,
          variant: 'ghost',
          size: 'sm',
          square: true,
          onClick: opts.onClick,
          ...(opts.disabled !== undefined && { disabled: opts.disabled }),
          ...(opts.loading !== undefined && { loading: opts.loading }),
        },
        children: [{ type: 'we-icon', props: { name: opts.icon } }],
      },
    ],
  };
}

/**
 * Where a note has been shared — a line per post it became, each going to that post.
 *
 * Read from `NoteShare` beside the note rather than from anything in the space: the post carries no
 * link back, on purpose. See `entities.ts`.
 */
const sharedIn: SchemaNode = {
  type: '$each',
  props: { items: { $: 'local.shares' }, as: 'share' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'share-network', size: 'sm', color: 'text-faint' } },
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'xs',
            onClick: { $action: 'spaceStore.openRecordRef', args: [{ $: 'share.ref' }] },
          },
          children: [{ $: "share.spaceName ? 'Shared in ' + share.spaceName : 'Shared'" }],
        },
        {
          type: 'we-timestamp',
          props: { value: { $: 'share.sharedAt' }, relative: true, fontSize: '100', color: 'text-faint' },
        },
      ],
    },
  ],
};

/**
 * One note — drawn, or open for editing.
 *
 * Draggable as the record it is, so it can be dropped into the Pocket and filed in a folder beside
 * whatever it is about. The two modules never name each other: the drag carries a reference, and the
 * Pocket keeps references.
 */
const noteCard: SchemaNode = {
  type: 'we-draggable',
  props: {
    entity: 'CollectionBlock',
    recordId: { $: 'note.id' },
    datasetKey: personalKey,
    label: { $: "note.textContent ? note.textContent : 'Note'" },
    icon: 'note',
    preview: { content: { $: 'note.editorState' }, date: { $: 'note.createdAt' } },
    // Not while it is open for editing: a press in the composer is selecting text, not picking up.
    disabled: { $: 'local.editing == note.id' },
  },
  children: [
    {
      type: 'Column',
      props: { bg: 'surface-sunken', r: '300', p: '300', gap: '200', width: '100%' },
      $queries: {
        shares: { entity: 'NoteShare', where: { noteId: { $: 'note.id' } }, dataset: PERSONAL },
      },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: 'local.editing == note.id' },
            then: editor({
              editorState: { $: 'note.editorState' },
              save: {
                $action: 'modules.notes.update',
                args: [{ $: 'note.id' }, { $: 'arg' }],
                onSuccess: [{ $setLocal: 'editing', value: '' }],
              },
              cancel: { $setLocal: 'editing', value: '' },
            }),
            else: {
              type: 'BlockRenderer',
              props: { editorState: { $: 'note.editorState' }, perspective: personalHandle },
            },
          },
        },
        {
          type: 'Row',
          props: { gap: '100', ay: 'center', width: '100%' },
          children: [
            {
              type: 'we-timestamp',
              props: { value: { $: 'note.createdAt' }, relative: true, fontSize: '100', color: 'text-faint' },
            },
            { type: 'Column', props: { flex: '1' } },
            iconAction({
              label: 'Edit',
              icon: 'pencil-simple',
              onClick: { $setLocal: 'editing', value: { $: 'note.id' } },
              disabled: { $: 'local.editing == note.id' },
            }),
            iconAction({
              label: 'Share into this space as a post',
              icon: 'share-network',
              onClick: { $setLocal: 'confirmShareId', value: { $: 'note.id' } },
              // Nowhere to share into outside a space. Disabled rather than hidden, so the action is
              // discoverable before it is available.
              disabled: { $: '!datasetStore.currentDataset' },
              loading: { $: 'modules.notes.sharing == note.id' },
            }),
            iconAction({
              label: 'Delete',
              icon: 'trash',
              onClick: { $setLocal: 'confirmDeleteId', value: { $: 'note.id' } },
            }),
          ],
        },
        sharedIn,
        {
          type: '$if',
          props: {
            condition: {
              $: 'modules.notes.lastError && (modules.notes.saving == note.id || local.editing == note.id)',
            },
            then: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'danger-text' },
              children: [{ $: 'modules.notes.lastError' }],
            },
          },
        },
      ],
    },
  ],
};

/**
 * Sharing is publishing, so it asks.
 *
 * A note is private and a post is not, and the step between them should be a decision rather than a
 * misclick on the icon beside Edit.
 */
const confirmShare = confirmModal({
  open: { $: 'local.confirmShareId' },
  close: { $setLocal: 'confirmShareId', value: '' },
  tone: 'primary',
  icon: 'share-network',
  title: 'Share this note?',
  body: {
    $: "spaceStore.currentSpace.name ? 'It will be posted in ' + spaceStore.currentSpace.name + ', where its members can read it.' : 'It will be posted in this space, where its members can read it.'",
  },
  detail: 'A copy is posted. Editing the note afterwards does not change the post.',
  confirmLabel: 'Share',
  confirm: {
    $action: 'modules.notes.share',
    args: [{ $: 'local.confirmShareId' }, { $: 'spaceStore.currentSpace.name' }],
  },
  busy: { $: "modules.notes.sharing != ''" },
});

const confirmDelete = confirmModal({
  open: { $: 'local.confirmDeleteId' },
  close: { $setLocal: 'confirmDeleteId', value: '' },
  title: 'Delete this note?',
  body: 'It cannot be recovered.',
  detail: 'Posts it was shared as stay where they are.',
  confirmLabel: 'Delete',
  confirm: { $action: 'modules.notes.remove', args: [{ $: 'local.confirmDeleteId' }] },
  busy: { $: "modules.notes.saving != ''" },
});

/** The docked panel. */
export const panel: SchemaNode = {
  type: '$if',
  props: {
    // The personal space, not a current space: notes are yours wherever you are, including outside
    // every space. Absent only for the frames before its schema is installed.
    condition: { $: PERSONAL },
    then: {
      ...panelShell({
        title: 'Notes',
        aside: {
          type: 'we-button',
          props: {
            size: 'sm',
            variant: 'secondary',
            disabled: { $: 'local.composing' },
            onClick: { $setLocal: 'composing', value: true },
          },
          children: [
            {
              type: 'Row',
              props: { gap: '100', ay: 'center' },
              children: [{ type: 'we-icon', props: { name: 'plus', size: 'sm' } }, 'New note'],
            },
          ],
        },
        children: [
          {
            // Mounted only while open, so each new note starts from an empty composer: remounting is
            // what resets it, the same reason `composerModal` is an `$if`.
            type: '$if',
            props: {
              condition: { $: 'local.composing' },
              then: editor({
                save: {
                  $action: 'modules.notes.create',
                  args: [{ $: 'arg' }],
                  onSuccess: [{ $setLocal: 'composing', value: false }],
                },
                cancel: { $setLocal: 'composing', value: false },
              }),
            },
          },
          panelScroll({
            children: [
              {
                type: 'Column',
                props: { gap: '300', width: '100%' },
                children: [
                  {
                    type: '$if',
                    props: {
                      condition: { $: 'count(local.notes)' },
                      then: {
                        type: '$each',
                        props: { items: { $: 'local.notes' }, as: 'note' },
                        children: [noteCard],
                      },
                      else: {
                        type: 'we-text',
                        props: { variant: 'footnote', color: 'text-muted' },
                        children: [
                          'Notes are private to you and follow you between spaces. Share one into a space when it is ready to be a post.',
                        ],
                      },
                    },
                  },
                ],
              },
            ],
          }),
          confirmShare,
          confirmDelete,
        ],
      }),
      $localState: {
        composing: { type: 'boolean', initial: false },
        /** The note open for editing, or empty. One at a time: two open editors is two unsaved drafts. */
        editing: { type: 'string', initial: '' },
        confirmShareId: { type: 'string', initial: '' },
        confirmDeleteId: { type: 'string', initial: '' },
      },
      $queries: {
        // Every note, newest first. A note is a post in the personal space — see `entities.ts`.
        notes: {
          entity: 'CollectionBlock',
          where: { kind: NOTE_KIND },
          order: { createdAt: 'desc' },
          dataset: PERSONAL,
        },
      },
    },
  },
};

/**
 * A drop-in trigger a template can place wherever it likes.
 *
 * Through the host, because the host holds the flag: `launchModule` takes a panel's dock id and does
 * what the rail's button does, including bringing a panel that is open but out of sight into view.
 */
export const toggleButton: SchemaNode = {
  type: 'we-button',
  props: { variant: 'ghost', size: 'sm', onClick: { $action: 'spaceStore.launchModule', args: ['notes:main'] } },
  children: [{ type: 'we-icon', props: { name: 'note' } }],
};
