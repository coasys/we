import { backButton, discardGuard } from '@we/schema-kit';
import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { expr } from '@we/schema-shared';

/**
 * The form for creating one record, over whatever model was chosen.
 *
 * The shape wizard lets a community define a model without writing code. This is the other half:
 * without it a community can describe a "Sighting" and then has no way to record one, because every
 * form in WE names its fields at authoring time and a model invented afterwards has no names to
 * name. `recordStore` derives the field list from the manifest; this renders it.
 *
 * ## Why every control is written out here
 *
 * The obvious compression is one control that takes a `type` prop. It does not exist: a date is a
 * `we-date-picker`, a closed vocabulary is a `we-select`, a boolean is a `we-switch`, and they
 * differ in which prop carries the value and which event returns it. That table is per-component
 * knowledge, which belongs in the layer that already knows the components — the same argument
 * `field()` makes about not being a `$field` operator.
 *
 * ## Why it is not a `field()` call per row
 *
 * `field()` binds to `$localState`, which is exactly what a data-driven form cannot use: local
 * state names are fixed when a template is written, so there is no name to declare for a field that
 * arrives from a manifest at runtime. Values live in the store and are written by name through one
 * action.
 */

/** How each control reads its value and reports a new one. */
interface ControlSpec {
  tag: string;
  event: string;
  /**
   * Prop the current value is bound to. `we-switch` calls it `checked`; `null` for a control that
   * holds its own value and takes none back, as a file picker does.
   */
  valueProp?: string | null;
  props?: Record<string, SchemaProp>;
}

/** Passed only to controls that have one — a switch and a colour swatch have nothing to hint at. */
const PLACEHOLDER = { placeholder: { $: 'field.placeholder' } };

const CONTROLS: Record<string, ControlSpec> = {
  text: { tag: 'we-input', event: 'onInput', props: PLACEHOLDER },
  url: { tag: 'we-input', event: 'onInput', props: { type: 'url', ...PLACEHOLDER } },
  textarea: { tag: 'we-textarea', event: 'onInput', props: { rows: 3, ...PLACEHOLDER } },
  number: { tag: 'we-number-input', event: 'onChange', props: PLACEHOLDER },
  switch: { tag: 'we-switch', event: 'onChange', valueProp: 'checked' },
  select: { tag: 'we-select', event: 'onChange', props: { options: { $: 'field.options' } } },
  date: { tag: 'we-date-picker', event: 'onChange', props: PLACEHOLDER },
  datetime: { tag: 'we-date-picker', event: 'onChange', props: { showTime: true, ...PLACEHOLDER } },
  color: { tag: 'we-color-picker', event: 'onChange' },
  // A file is read into the draft when it is chosen, and uploaded only when the form saves.
  file: { tag: 'we-file-upload', event: 'onChange', valueProp: null, props: { accept: { $: 'field.accept' } } },
};

/**
 * One row of the form: the label, and whichever control the field's `control` names.
 *
 * `setter` is the store action the value is written through — the outer form's, or the nested
 * form's for a record being made inline — so both forms are the same rows.
 */
function controlRow(control: string, spec: ControlSpec, setter = 'recordStore.setRecordField'): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: expr`field.control == ${control}`,
      then: {
        type: 'we-form-field',
        props: { label: { $: 'field.label' }, required: { $: 'field.required' }, width: '100%' },
        children: [
          {
            type: spec.tag,
            props: {
              ...(spec.valueProp === null ? {} : { [spec.valueProp ?? 'value']: { $: 'field.value' } }),
              width: '100%',
              // One action for every control, taking the field's name — the only shape that works
              // when the fields are data and no handler can be written per field.
              [spec.event]: {
                $action: setter,
                args: [{ $: 'field.name' }, { $: 'event.detail' }],
              },
              ...spec.props,
            },
          },
        ],
      },
    },
  };
}

/** A picked place's name or address, typed over what the map reverse-geocoded. */
function placeInput(property: string, label: string): SchemaNode {
  return {
    type: 'we-form-field',
    props: { label, flex: '1 1 12rem', minWidth: '0' },
    children: [
      {
        type: 'we-input',
        props: {
          size: 'sm',
          value: { $: `first(field.entries).fields.${property} ?? ''` },
          onInput: {
            $action: 'recordStore.setRelationEntryField',
            args: [{ $: 'field.name' }, { $: 'first(field.entries).key' }, property, { $: 'event.detail' }],
          },
        },
      },
    ],
  };
}

/**
 * A place, picked on the map where the relation is — not a form of latitude and longitude boxes.
 * The same shape as the profile page: the picker, then the words beneath it for the person to
 * correct. A to-many relation adds a place per pick and lists them as chips.
 */
const locationEditor: SchemaNode = {
  type: 'Column',
  props: { gap: '200', width: '100%' },
  children: [
    {
      type: 'we-location-picker',
      props: {
        width: '100%',
        latitude: { $: 'field.many ? null : first(field.entries).fields.latitude' },
        longitude: { $: 'field.many ? null : first(field.entries).fields.longitude' },
        placeholder: { $: '`Pin ${lower(field.label)} on the map…`' },
        onChange: { $action: 'recordStore.setRelationLocation', args: [{ $: 'field.name' }, { $: 'arg.detail' }] },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: '!field.many && count(field.entries)' },
        then: {
          type: 'Row',
          props: { gap: '300', wrap: true, width: '100%' },
          children: [placeInput('name', 'Name'), placeInput('address', 'Address')],
        },
      },
    },
  ],
};

/**
 * A picture, chosen and cropped where the relation is, and shown once chosen. One editor for a
 * to-one — change it or take it away in place — and a tile per picture plus one to add for a to-many.
 */
const imageEditor: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'field.many' },
    then: {
      type: 'Row',
      props: { gap: '200', wrap: true, width: '100%' },
      children: [
        {
          type: '$each',
          props: { items: { $: 'field.entries' }, as: 'entry' },
          children: [
            {
              type: 'Column',
              props: { position: 'relative', width: '96px', height: '96px', r: 'surface', overflow: 'hidden' },
              children: [
                {
                  type: 'we-image',
                  props: {
                    src: { $: 'entry.preview' },
                    alt: { $: 'entry.label' },
                    fit: 'cover',
                    width: '96px',
                    height: '96px',
                  },
                },
                {
                  type: 'Row',
                  props: { position: 'absolute', top: '100', right: '100' },
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        variant: 'secondary',
                        size: 'xs',
                        square: true,
                        label: { $: '`Remove ${entry.label}`' },
                        onClick: {
                          $action: 'recordStore.removeRelationEntry',
                          args: [{ $: 'field.name' }, { $: 'entry.key' }],
                        },
                      },
                      children: [{ type: 'we-icon', props: { name: 'x' } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'EditableImage',
          props: {
            fit: 'cover',
            width: '96px',
            height: '96px',
            r: 'surface',
            placeholderIcon: 'image',
            uploadLabel: { $: '`Add ${lower(field.targetLabel)}`' },
            onImageChange: { $action: 'recordStore.addRelationImage', args: [{ $: 'field.name' }, { $: 'event' }] },
          },
        },
      ],
    },
    else: {
      type: 'EditableImage',
      props: {
        src: { $: 'first(field.entries).preview' },
        alt: { $: 'field.label' },
        fit: 'cover',
        width: '100%',
        height: '200px',
        r: 'surface',
        placeholderIcon: 'image',
        uploadLabel: { $: '`Add ${lower(field.targetLabel)}`' },
        editLabel: { $: '`Change ${lower(field.targetLabel)}`' },
        onImageChange: { $action: 'recordStore.addRelationImage', args: [{ $: 'field.name' }, { $: 'event' }] },
        onImageRemove: {
          $action: 'recordStore.removeRelationEntry',
          args: [{ $: 'field.name' }, { $: 'first(field.entries).key' }],
        },
      },
    },
  },
};

/** Chips, a picker and "Add" — for a target with no control of its own. */
const genericRelationEditor: SchemaNode = {
  type: 'Column',
  props: { gap: '200', width: '100%' },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: 'count(field.entries)' },
        then: {
          type: 'Row',
          props: { gap: '200', wrap: true, width: '100%' },
          children: [
            {
              type: '$each',
              props: { items: { $: 'field.entries' }, as: 'entry' },
              children: [
                {
                  type: 'Row',
                  props: {
                    gap: '100',
                    ay: 'center',
                    bg: 'surface-sunken',
                    r: 'control',
                    pl: '300',
                    pr: '100',
                    py: '100',
                    maxWidth: '100%',
                  },
                  children: [
                    {
                      type: 'we-icon',
                      props: {
                        name: { $: "recordStore.displays[entry.entity].icon ?? 'cube'" },
                        size: 'xs',
                        color: 'text-muted',
                      },
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'label', truncate: true, minWidth: '0' },
                      children: [{ $: 'entry.label' }],
                    },
                    {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'xs',
                        square: true,
                        label: { $: '`Remove ${entry.label}`' },
                        onClick: {
                          $action: 'recordStore.removeRelationEntry',
                          args: [{ $: 'field.name' }, { $: 'entry.key' }],
                        },
                      },
                      children: [{ type: 'we-icon', props: { name: 'x' } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: 'field.many || !count(field.entries)' },
        then: {
          type: 'Row',
          props: { gap: '200', ay: 'center', width: '100%', wrap: true },
          children: [
            {
              type: '$if',
              props: {
                condition: { $: 'field.canPick' },
                then: {
                  type: 'Row',
                  props: { flex: '1 1 12rem', minWidth: '0' },
                  // One subscription per picker, mounted only where there is a picker.
                  $queries: { candidates: { entity: { $: 'field.target' }, limit: 200 } },
                  children: [
                    {
                      type: 'we-select',
                      props: {
                        width: '100%',
                        searchable: true,
                        placeholder: { $: '`Choose ${lower(field.targetLabel)}…`' },
                        options: {
                          $: 'local.candidates.map(row, { label: row[recordStore.displays[field.target].title] ?? row.id, value: row.id })',
                        },
                        value: '',
                        onChange: {
                          $action: 'recordStore.pickRelation',
                          args: [{ $: 'field.name' }, { $: 'event.detail' }],
                        },
                      },
                    },
                  ],
                },
              },
            },
            {
              type: '$if',
              props: {
                condition: { $: 'field.canCreate' },
                then: {
                  type: 'we-button',
                  props: {
                    variant: 'secondary',
                    size: 'sm',
                    onClick: { $action: 'recordStore.openRelationForm', args: [{ $: 'field.name' }] },
                  },
                  children: [{ type: 'we-icon', props: { name: 'plus' } }, { $: '`Add ${lower(field.targetLabel)}`' }],
                },
              },
            },
          ],
        },
      },
    },
  ],
};

/**
 * A relation: what it will point at, as chips, and the ways to give it something.
 *
 * Two ways, offered by what the target is. A record that stands on its own — a species, a person —
 * can be **picked** from those the space already holds. Anything with a form of its own can be
 * **made** here, in a small form over this one; that is the only way for a block, since an image
 * belongs to the sighting it was added to. Nothing is written until the outer form saves.
 *
 * A to-one relation with something in it offers neither: the chip's remove is how it is changed.
 */
const relationRow: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "field.control == 'relation'" },
    then: {
      type: 'we-form-field',
      props: { label: { $: 'field.label' }, width: '100%' },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: "field.inline == 'location'" },
            then: locationEditor,
            else: {
              type: '$if',
              props: { condition: { $: "field.inline == 'image'" }, then: imageEditor, else: genericRelationEditor },
            },
          },
        },
      ],
    },
  },
};

/**
 * The small form a relation's record is made in — the same rows as the outer form, over the nested
 * draft, and nothing written until the outer form saves.
 */
const relationFormModal: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'recordStore.relationDraft' },
    then: {
      type: 'we-modal',
      props: { size: 'sm', close: { $action: 'recordStore.cancelRelationForm' } },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center', width: '100%' },
          slot: 'header',
          children: [
            { type: 'we-icon', props: { name: { $: 'recordStore.relationDraft.icon' } } },
            {
              type: 'we-text',
              props: { variant: 'heading-md' },
              children: [{ $: '`New ${lower(recordStore.relationDraft.label)}`' }],
            },
          ],
        },
        {
          type: '$each',
          props: { items: { $: 'recordStore.relationDraft.fields' }, as: 'field' },
          children: [
            {
              type: 'Column',
              props: { width: '100%' },
              children: Object.entries(CONTROLS).map(([control, spec]) =>
                controlRow(control, spec, 'recordStore.setRelationField'),
              ),
            },
          ],
        },
        {
          type: '$each',
          props: { items: { $: 'recordStore.relationErrors' }, as: 'problem' },
          children: [
            { type: 'we-text', props: { variant: 'footnote', color: 'danger-text' }, children: [{ $: 'problem' }] },
          ],
        },
        {
          type: 'Row',
          props: { gap: '300', ax: 'end', width: '100%' },
          slot: 'footer',
          children: [
            {
              type: 'we-button',
              props: { variant: 'secondary', onClick: { $action: 'recordStore.cancelRelationForm' } },
              children: ['Cancel'],
            },
            {
              type: 'we-button',
              props: { variant: 'primary', onClick: { $action: 'recordStore.saveRelationForm' } },
              children: ['Add'],
            },
          ],
        },
      ],
    },
  },
};

export interface RecordFormModalOptions {
  /**
   * Extra actions to run after a record is created — bumping a graph's `revision`, usually.
   *
   * The store closes the form itself, so this is for the *caller's* reaction to a new record
   * existing. `recordStore.lastCreatedId` holds its id for anything that wants to select it.
   */
  onCreated?: SchemaProp[];
  /** Heading text. Defaults to naming the model being created. */
  title?: SchemaProp;
  /**
   * Where "Back" goes, as actions run after the form closes — reopening the type chooser it was picked
   * from. Omit for no Back button. Not offered for a connection being drawn, which was not picked from
   * anything. With fields filled in it asks first, and a discard closes without going back.
   */
  back?: SchemaProp[];
}

export function recordFormModal(opts: RecordFormModalOptions = {}): SchemaNode {
  const save: SchemaProp = {
    $action: 'recordStore.saveRecord',
    ...(opts.onCreated?.length ? { onSuccess: opts.onCreated } : {}),
  };

  /*
    The guard reads a *store* flag rather than a `$local` expression, uniquely among the forms in
    the kit. The fields here are derived from whichever model is being created — a shape a community
    defined this morning has properties no schema was written against — so there is no set of names
    for an expression to test. `recordStore.recordDraftDirty` is the only thing that can see them.
  */
  const guard = discardGuard({
    dirty: { $: 'recordStore.recordDraftDirty' },
    close: { $action: 'recordStore.cancelRecordForm' },
    title: 'Discard this entry?',
    body: 'What you have filled in will be lost. Nothing has been saved to the space yet.',
  });

  return {
    // Mounted only while a draft exists, which is also what makes the draft's non-nullness the one
    // source of "is the form open" — a separate boolean would be a second answer able to disagree.
    type: '$if',
    props: {
      condition: { $: 'recordStore.recordDraft' },
      then: {
        type: 'we-modal',
        props: { size: 'md', close: guard.close },
        /*
          The kinds of connection this community has named.

          Hoisted rather than queried inside the picker for the house reason: one subscription, so
          the picker and anything else reading it cannot disagree about what exists. Subscribed, so
          a kind named in another window appears here without a reload.
        */
        $queries: { relationshipKinds: { entity: 'RelationshipType', order: { name: 'asc' } } },
        // The guard's flag has to live on the modal so it is destroyed with the draft it guards.
        $localState: guard.localState,
        children: [
          {
            type: 'Row',
            props: { gap: '300', ay: 'center', width: '100%' },
            slot: 'header',
            children: [
              ...(opts.back
                ? [
                    {
                      type: '$if',
                      props: {
                        condition: { $: '!recordStore.pendingLink' },
                        then: backButton({
                          $if: {
                            condition: { $: 'recordStore.recordDraftDirty' },
                            then: guard.close,
                            else: [{ $action: 'recordStore.cancelRecordForm' }, ...opts.back],
                          },
                        }),
                      },
                    } as SchemaNode,
                  ]
                : []),
              { type: 'we-icon', props: { name: { $: 'recordStore.recordDraft.icon' } } },
              {
                type: 'we-text',
                props: { variant: 'heading-md' },
                children: [opts.title ?? { $: '`New ${recordStore.recordDraft.label}`' }],
              },
            ],
          },

          /*
            What is being connected, when this form was opened by drawing a line.

            Not editable, and not a field: the endpoints came from a gesture, not from typing, and
            offering to change them here would be offering to redo the gesture in a worse way. It is
            here to be *read* — "Post → Sighting" above the label box is the difference between
            filling in a form and knowing what you are asserting.
          */
          {
            type: '$if',
            props: {
              condition: { $: 'recordStore.pendingLink' },
              then: {
                type: 'Row',
                props: {
                  gap: '200',
                  ay: 'center',
                  wrap: true,
                  width: '100%',
                  bg: 'surface-sunken',
                  r: '300',
                  px: '300',
                  py: '200',
                },
                children: [
                  {
                    type: 'we-text',
                    props: { variant: 'label', truncate: true },
                    children: [{ $: 'recordStore.pendingLink.sourceLabel' }],
                  },
                  { type: 'we-icon', props: { name: 'arrow-right', size: 'xs', color: 'text-faint' } },
                  {
                    type: 'we-text',
                    props: { variant: 'label', truncate: true },
                    children: [{ $: 'recordStore.pendingLink.targetLabel' }],
                  },
                ],
              },
            },
          },

          /*
            Which kind of connection this is — the middle tier.

            Shown only when connecting, and only once the community has named at least one kind. A
            space that has named none still connects things: the label below carries the meaning,
            which is how a vocabulary gets discovered before anybody knows what it is. Once kinds
            exist this picker carries it and the label qualifies it.

            There is no "None" option, and there cannot be one.

            A "None" used to be prepended here, written as an interpolation over two lists —
            `` `${[{ label: 'None', value: '' }]}${kinds.map(…)}` ``. A template literal evaluates to
            a **string**, whatever is interpolated into it, so what reached `options` was the eleven
            characters `[object Object]` twice over. The picker rendered with no options at all: not
            the list plus None, not the list, nothing. Which is why this is worth spelling out rather
            than quietly correcting — it validated, it typechecked, and the control it broke is the
            one control this modal exists for.

            The comment it carried was right about the cause and wrong about the workaround: a schema
            genuinely cannot prepend to a list, which is why `shapeStore.identityOptions` is built in
            a store. Nothing prepends here now. The unset state is the `placeholder`, which is what a
            select shows for a value matching no option, and getting *back* to unset is the button
            beside it — one control per job, both of which work.
          */
          {
            type: '$if',
            props: {
              condition: { $: 'recordStore.pendingLink && count(local.relationshipKinds)' },
              then: {
                type: 'we-form-field',
                props: { label: 'Kind', width: '100%' },
                children: [
                  {
                    type: 'Row',
                    props: { gap: '200', ay: 'center', width: '100%' },
                    children: [
                      {
                        type: 'we-select',
                        props: {
                          flex: '1',
                          minWidth: '0',
                          placeholder: 'Unnamed kind',
                          options: {
                            $: 'local.relationshipKinds.map(item, { label: item.name, value: item.id, icon: item.icon })',
                          },
                          // Not `setRecordField`: `relationshipTypeId` is deliberately absent from
                          // the draft's fields, so writing it through the field setter found nothing
                          // and silently did nothing. The chosen kind is held beside the draft.
                          value: { $: 'recordStore.relationshipKind' },
                          onChange: {
                            $action: 'recordStore.setRelationshipKind',
                            args: [{ $: 'event.detail' }],
                          },
                        },
                      },
                      // Only once there is something to undo. An always-present clear beside an empty
                      // picker is a control offering to do what has already been done.
                      {
                        type: '$if',
                        props: {
                          condition: { $: 'recordStore.relationshipKind' },
                          then: {
                            type: 'we-tooltip',
                            props: { content: 'Leave the kind unnamed' },
                            children: [
                              {
                                type: 'we-button',
                                props: {
                                  variant: 'ghost',
                                  square: true,
                                  label: 'Leave the kind unnamed',
                                  flexShrink: '0',
                                  onClick: { $action: 'recordStore.setRelationshipKind', args: [''] },
                                },
                                children: [{ type: 'we-icon', props: { name: 'x' } }],
                              },
                            ],
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },

          /*
            The model picker, shown only where there is a choice.

            A space with one vocabulary has one answer, and offering a select with a single option
            asks a question whose answer is already on screen.
          */
          {
            type: '$if',
            props: {
              // The form-made ones: a note or a post is written in the composer, not picked here.
              condition: {
                $: "!recordStore.pendingLink && count(recordStore.creatableEntities.filter(k, k.via == 'form')) > 1",
              },
              then: {
                type: 'we-form-field',
                props: { label: 'Entity', width: '100%' },
                children: [
                  {
                    type: 'we-select',
                    props: {
                      width: '100%',
                      options: { $: "recordStore.creatableEntities.filter(k, k.via == 'form')" },
                      value: { $: 'recordStore.recordDraft.entity' },
                      onChange: { $action: 'recordStore.setRecordEntity', args: [{ $: 'event.detail' }] },
                    },
                  },
                ],
              },
            },
          },

          {
            type: '$each',
            props: { items: { $: 'recordStore.recordDraft.fields' }, as: 'field' },
            children: [
              {
                type: 'Column',
                props: { width: '100%' },
                children: [
                  ...Object.entries(CONTROLS).map(([control, spec]) => controlRow(control, spec)),
                  relationRow,
                ],
              },
            ],
          },

          /*
            Errors listed rather than attached per field.

            `$error` reads a `$localState` validation rule, and these fields have none to read —
            the same reason the values are not in local state. A save failure from the backend
            belongs here too, and it has no field to attach to at all.
          */
          {
            type: '$if',
            props: {
              condition: { $: 'count(recordStore.recordErrors)' },
              then: {
                type: 'Column',
                props: { gap: '100', width: '100%' },
                children: [
                  {
                    type: '$each',
                    props: { items: { $: 'recordStore.recordErrors' }, as: 'problem' },
                    children: [
                      {
                        type: 'we-text',
                        props: { variant: 'footnote', color: 'danger-text' },
                        children: [{ $: 'problem' }],
                      },
                    ],
                  },
                ],
              },
            },
          },

          {
            type: 'Row',
            props: { gap: '300', ax: 'end', width: '100%' },
            slot: 'footer',
            children: [
              {
                type: 'we-button',
                // Guarded like the backdrop — one way out of the modal.
                props: { variant: 'secondary', onClick: guard.close },
                children: ['Cancel'],
              },
              {
                type: 'we-button',
                props: {
                  variant: 'primary',
                  // Disabled only while the write is in flight. Never on "the form is not valid
                  // yet" — that would make the button unclickable in exactly the state where
                  // clicking it is what reveals which field is missing.
                  loading: { $: 'recordStore.savingRecord' },
                  disabled: { $: 'recordStore.savingRecord' },
                  onClick: save,
                },
                children: ['Create'],
              },
            ],
          },
          relationFormModal,
          guard.node,
        ],
      },
    },
  };
}
