/**
 * Opening what is on the workshop's canvas: a note in the composer, a record's fields in the inspector.
 *
 * Making things there — the double-click, the chooser, the note composed at the point — is the kit's
 * (`canvasCards.ts` in the template kit), shared with every space canvas. What follows is the half that
 * is the workshop's own, because it goes through the workshop's inspector.
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
          saveAction: { $invoke: 'spaceStore.updatePost', args: [{ $: 'note.id' }, { $: 'arg' }] },
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
    $invoke: 'recordStore.updateRecordField',
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
