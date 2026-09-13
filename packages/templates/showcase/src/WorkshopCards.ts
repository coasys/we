/**
 * Putting things on the workshop's canvas, and opening them once they are there.
 *
 * Two kinds of thing a canvas holds, and they are authored differently. A **note** is a composed
 * document — a `CollectionBlock` of kind `card`, the post-it — and nobody types a document into a
 * field list, so it goes through the block composer. Everything else is a **record** of some model
 * the space has, a task or an event or a shape the community defined, and the form for one is
 * derived from the model's own declaration. The chooser between them is the one new piece; both
 * surfaces already existed.
 *
 * ## Double-click, and a chooser
 *
 * The graph's own control strip is plugin-based and closed to templates, and the two pills over
 * the canvas are navigation, so the way in is the gesture every other canvas has: double-click
 * empty canvas to make something there. Position first, then content, forced by the composer
 * being a modal that takes focus — and the better order besides, since you know where a note goes
 * before you know what it says. The chooser is what lets one gesture answer for every kind.
 *
 * ## Opening a note
 *
 * Double-click a note and the composer opens on it, exactly as the graph section's canvas does. A
 * card on the canvas is a preview, clipped and non-interactive; this is where the whole thing is
 * readable, and the composer already displays a document properly, so a read-only step in front of
 * it would be the same dialog with the ability removed. Saving reconciles through `updatePost`, so
 * the note keeps its placement, its comments and its signals.
 *
 * A record that is not a note opens in the inspector instead, which is where its fields already
 * are — see `fieldEditor`.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { composerModal } from '@we/template-kit';

/** The locals a canvas route declares for these. All ephemeral: nothing here survives a reload. */
export const CARD_LOCALS = {
  /** Where a double-click landed, in world units — where whatever is made next goes. */
  newAt: { type: 'object', initial: null },
  chooserOpen: { type: 'boolean', initial: false },
  newNoteOpen: { type: 'boolean', initial: false },
  /** The composer over the selected note. Reads the selection rather than copying an id. */
  noteOpen: { type: 'boolean', initial: false },
} as const;

/** What a double-click on empty canvas does: remember the point, and ask what goes there. */
export const askWhatGoesHere: SchemaProp[] = [
  { $setLocal: 'newAt', value: { $: 'event' } },
  { $setLocal: 'chooserOpen', value: true },
];

/** One choice in the chooser: an icon and a name, the full width, opening to the left. */
function choice(icon: string | { $: string }, label: string | { $: string }, onClick: SchemaProp): SchemaNode {
  return {
    type: 'we-button',
    props: { variant: 'ghost', width: '100%', ax: 'start', gap: '300', onClick },
    children: [
      { type: 'we-icon', props: { name: icon } },
      { type: 'we-text', props: { truncate: true }, children: [label] },
    ],
  };
}

/**
 * "What goes here?" — a note, or a record of any model this space can make.
 *
 * Note first, because it is the thing most canvases are mostly made of. Then
 * `recordStore.creatableEntities`: the space's own models, then WE's built-in ones, each with the
 * icon its declaration carries. Picking a record opens the generic form through `createOnCanvas`,
 * which remembers the canvas and the point, and then switches the form to the chosen model — two
 * actions, because the first opens on whatever model is offered first and the second is the one
 * that says which. Nothing is written until the form is submitted.
 */
export function newThingChooser(call: SchemaProp): SchemaNode {
  const close: SchemaProp = { $setLocal: 'chooserOpen', value: false };
  return {
    type: '$if',
    props: {
      condition: { $: 'local.chooserOpen' },
      then: {
        type: 'we-modal',
        props: { size: 'sm', close },
        children: [
          { type: 'we-text', slot: 'header', props: { variant: 'heading-md' }, children: ['Add to the canvas'] },
          {
            type: 'Column',
            props: { gap: '100', width: '100%' },
            children: [
              choice('note', 'Note', [close, { $setLocal: 'newNoteOpen', value: true }]),
              {
                type: '$if',
                props: {
                  condition: { $: 'count(recordStore.creatableEntities)' },
                  then: { type: 'we-divider' },
                },
              },
              {
                type: '$each',
                props: { items: { $: 'recordStore.creatableEntities' }, as: 'kind' },
                children: [
                  choice({ $: "kind.icon ? kind.icon : 'cube'" }, { $: 'kind.label' }, [
                    close,
                    {
                      $action: 'recordStore.createOnCanvas',
                      args: [call, { $: 'local.newAt.x' }, { $: 'local.newAt.y' }],
                    },
                    { $action: 'recordStore.setRecordEntity', args: [{ $: 'kind.value' }] },
                  ]),
                ],
              },
            ],
          },
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
export function newNoteModal(call: SchemaProp): SchemaNode {
  return composerModal({
    openLocal: 'newNoteOpen',
    title: 'New note',
    saveLabel: 'Add',
    saveAction: {
      $action: 'recordStore.createCardOnCanvas',
      // `arg` first: the serialized tree, then where it goes.
      args: [{ $: 'arg' }, { canvas: call, at: { $: 'local.newAt' } }],
    },
    onSaved: [{ $setLocal: 'newAt', value: null }],
  });
}

/**
 * The selected note, opened in the composer. Bound to the selection the inspector reads — the two
 * address parameters — so it is always the note that is selected and cannot drift from it. Guarded
 * on the type as well, since only a composed document has an `editorState` to render.
 */
export const editNoteModal: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "local.noteOpen && local.inspecting && local.inspectingType == 'CollectionBlock'" },
    then: {
      type: '$single',
      props: {
        item: { $query: { entity: 'CollectionBlock', where: { id: { $: 'local.inspecting' } } } },
        as: 'note',
      },
      children: [
        composerModal({
          openLocal: 'noteOpen',
          title: 'Note',
          saveLabel: 'Save',
          editorState: { $: 'note.editorState' },
          // `arg` second: `updatePost(postId, json)`.
          saveAction: { $action: 'spaceStore.updatePost', args: [{ $: 'note.id' }, { $: 'arg' }] },
        }),
      ],
    },
  },
};

/**
 * Every field the model declares, as a control — the inspector's edit mode.
 *
 * The same walk the read mode makes over `local.display.fields`, drawing a control by `kind` where
 * that drew a value, and writing each change through `recordStore.updateRecordField` the moment
 * the control commits it. No Save button: a record here is a shared thing, and a form that
 * buffered its edits would be a form whose state nobody else could see. `onChange` rather than
 * `onInput` on the typed controls, so a keystroke is not a write.
 *
 * A closed set of values — a task's status — is a select over the options the model declares.
 * Media, files, JSON and relations are not editable here; a picture is uploaded, not typed.
 *
 * `fields` is the list to draw, as an expression, so the inspector can call this twice over two
 * halves of the same declaration — the fields that hold something, and the ones that do not, which
 * sit behind a disclosure. Defaults to all of them, which is what a caller with nothing to split on
 * wants.
 *
 * **The record must be bound as `row`** — by whatever `$each` or `$single` this is placed inside,
 * since the two expressions have to name the same thing. `record` was the obvious name and is the
 * one name it cannot be: `record.create`/`update`/`delete` is the mutation namespace, so a dotted
 * read off a binding called `record` is reported by the tier inspector as a reference to a store
 * member that does not exist — which is a template refused at install time, over a name.
 */
export function fieldEditor(entity: SchemaProp, id: SchemaProp, fields = 'local.display.fields'): SchemaNode {
  const write = (value: SchemaProp): SchemaProp => ({
    $action: 'recordStore.updateRecordField',
    args: [entity, id, { $: 'field.name' }, value],
  });
  const onChange = write({ $: 'event.detail' });
  const value = { $: 'row[field.name]' };
  const control = (node: SchemaNode): SchemaNode => ({
    type: 'we-form-field',
    props: { label: { $: 'field.label' }, size: 'sm', width: '100%' },
    children: [node],
  });

  return {
    type: '$each',
    props: { items: { $: fields }, as: 'field' },
    children: [
      {
        type: '$if',
        props: {
          condition: { $: "!(field.kind in ['image', 'file', 'json', 'relation'])" },
          then: {
            type: '$if',
            props: {
              condition: { $: 'count(field.options)' },
              then: control({
                type: 'we-select',
                props: {
                  size: 'sm',
                  width: '100%',
                  options: { $: 'field.options.map(o, { label: o, value: o })' },
                  value,
                  onChange,
                },
              }),
              else: {
                type: '$if',
                props: {
                  condition: { $: "field.kind == 'boolean'" },
                  then: control({
                    type: 'we-switch',
                    props: { size: 'sm', checked: value, onChange },
                  }),
                  else: {
                    type: '$if',
                    props: {
                      condition: { $: "field.kind == 'number'" },
                      then: control({
                        type: 'we-number-input',
                        props: { size: 'sm', width: '100%', value, onChange },
                      }),
                      else: {
                        type: '$if',
                        props: {
                          condition: { $: "field.kind == 'datetime' || field.kind == 'date'" },
                          then: control({
                            type: 'we-date-picker',
                            props: {
                              size: 'sm',
                              width: '100%',
                              value,
                              showTime: { $: "field.kind == 'datetime'" },
                              onChange,
                            },
                          }),
                          else: {
                            type: '$if',
                            props: {
                              condition: { $: "field.kind == 'longText'" },
                              then: control({
                                type: 'we-textarea',
                                props: { size: 'sm', width: '100%', autoGrow: true, value, onChange },
                              }),
                              else: {
                                type: '$if',
                                props: {
                                  condition: { $: "field.kind == 'color'" },
                                  then: control({
                                    type: 'we-color-picker',
                                    props: { tokens: true, value, onChange },
                                  }),
                                  else: control({
                                    type: 'we-input',
                                    props: {
                                      size: 'sm',
                                      width: '100%',
                                      type: { $: "field.kind == 'url' ? 'url' : 'text'" },
                                      value,
                                      onChange,
                                    },
                                  }),
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
  };
}
