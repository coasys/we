import type { SchemaNode, SchemaProp } from '@we/schema-shared';

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
  /** Prop the current value is bound to. `we-switch` calls it `checked`. */
  valueProp?: string;
  props?: Record<string, SchemaProp>;
}

/** Passed only to controls that have one — a switch and a colour swatch have nothing to hint at. */
const PLACEHOLDER = { placeholder: '$field.placeholder' };

const CONTROLS: Record<string, ControlSpec> = {
  text: { tag: 'we-input', event: 'onInput', props: PLACEHOLDER },
  textarea: { tag: 'we-textarea', event: 'onInput', props: { rows: 3, ...PLACEHOLDER } },
  number: { tag: 'we-number-input', event: 'onChange', props: PLACEHOLDER },
  switch: { tag: 'we-switch', event: 'onChange', valueProp: 'checked' },
  select: { tag: 'we-select', event: 'onChange', props: { options: '$field.options' } },
  date: { tag: 'we-date-picker', event: 'onChange', props: PLACEHOLDER },
  datetime: { tag: 'we-date-picker', event: 'onChange', props: { showTime: true, ...PLACEHOLDER } },
  color: { tag: 'we-color-picker', event: 'onChange' },
};

/** One row of the form: the label, and whichever control the field's `control` names. */
function controlRow(control: string, spec: ControlSpec): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $eq: ['$field.control', control] },
      then: {
        type: 'we-form-field',
        props: { label: '$field.label', required: '$field.required', width: '100%' },
        children: [
          {
            type: spec.tag,
            props: {
              [spec.valueProp ?? 'value']: '$field.value',
              width: '100%',
              // One action for every control, taking the field's name — the only shape that works
              // when the fields are data and no handler can be written per field.
              [spec.event]: {
                $action: 'recordStore.setRecordField',
                args: ['$field.name', '$event.detail'],
              },
              ...spec.props,
            },
          },
        ],
      },
    },
  };
}

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
}

export function recordFormModal(opts: RecordFormModalOptions = {}): SchemaNode {
  const save: SchemaProp = {
    $action: 'recordStore.saveRecord',
    ...(opts.onCreated?.length ? { onSuccess: opts.onCreated } : {}),
  };

  return {
    // Mounted only while a draft exists, which is also what makes the draft's non-nullness the one
    // source of "is the form open" — a separate boolean would be a second answer able to disagree.
    type: '$if',
    props: {
      condition: { $store: 'recordStore.recordDraft' },
      then: {
        type: 'we-modal',
        props: { size: 'md', close: { $action: 'recordStore.cancelRecordForm' } },
        /*
          The kinds of connection this community has named.

          Hoisted rather than queried inside the picker for the house reason: one subscription, so
          the picker and anything else reading it cannot disagree about what exists. Subscribed, so
          a kind named in another window appears here without a reload.
        */
        $queries: { relationshipKinds: { entity: 'RelationshipType', order: { name: 'asc' } } },
        children: [
          {
            type: 'Row',
            props: { gap: '300', ay: 'center', width: '100%' },
            slot: 'header',
            children: [
              { type: 'we-icon', props: { name: { $store: 'recordStore.recordDraft.icon' } } },
              {
                type: 'we-text',
                props: { variant: 'heading-md' },
                children: [opts.title ?? { $concat: ['New ', { $store: 'recordStore.recordDraft.label' }] }],
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
              condition: { $store: 'recordStore.pendingLink' },
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
                    children: [{ $store: 'recordStore.pendingLink.sourceLabel' }],
                  },
                  { type: 'we-icon', props: { name: 'arrow-right', size: 'xs', color: 'text-faint' } },
                  {
                    type: 'we-text',
                    props: { variant: 'label', truncate: true },
                    children: [{ $store: 'recordStore.pendingLink.targetLabel' }],
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

            "None" is prepended by hand because a schema can `$map` a store array into options but
            cannot add one — the same reason `shapeStore.identityOptions` is built in a store. Here
            the list comes from `$queries` rather than a store, so the prepend happens in the
            fragment instead.
          */
          {
            type: '$if',
            props: {
              condition: {
                $and: [{ $store: 'recordStore.pendingLink' }, { $count: { items: { $local: 'relationshipKinds' } } }],
              },
              then: {
                type: 'we-form-field',
                props: { label: 'Kind', width: '100%' },
                children: [
                  {
                    type: 'we-select',
                    props: {
                      width: '100%',
                      placeholder: 'Unnamed kind',
                      options: {
                        $concat: [
                          [{ label: 'Unnamed kind', value: '' }],
                          {
                            $map: {
                              items: { $local: 'relationshipKinds' },
                              select: { label: '$item.name', value: '$item.id', icon: '$item.icon' },
                            },
                          },
                        ],
                      },
                      // Not `setRecordField`: `relationshipTypeId` is deliberately absent from the
                      // draft's fields, so writing it through the field setter found nothing and
                      // silently did nothing. The chosen kind is held beside the draft instead.
                      value: { $store: 'recordStore.relationshipKind' },
                      onChange: {
                        $action: 'recordStore.setRelationshipKind',
                        args: ['$event.detail'],
                      },
                    },
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
              condition: {
                $and: [
                  { $not: { $store: 'recordStore.pendingLink' } },
                  { $gt: [{ $count: { items: { $store: 'recordStore.creatableEntities' } } }, 1] },
                ],
              },
              then: {
                type: 'we-form-field',
                props: { label: 'Model', width: '100%' },
                children: [
                  {
                    type: 'we-select',
                    props: {
                      width: '100%',
                      options: { $store: 'recordStore.creatableEntities' },
                      value: { $store: 'recordStore.recordDraft.entity' },
                      onChange: { $action: 'recordStore.setRecordEntity', args: ['$event.detail'] },
                    },
                  },
                ],
              },
            },
          },

          {
            type: '$each',
            props: { items: { $store: 'recordStore.recordDraft.fields' }, as: 'field' },
            children: [
              {
                type: 'Column',
                props: { width: '100%' },
                children: Object.entries(CONTROLS).map(([control, spec]) => controlRow(control, spec)),
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
              condition: { $count: { items: { $store: 'recordStore.recordErrors' } } },
              then: {
                type: 'Column',
                props: { gap: '100', width: '100%' },
                children: [
                  {
                    type: '$each',
                    props: { items: { $store: 'recordStore.recordErrors' }, as: 'problem' },
                    children: [
                      { type: 'we-text', props: { variant: 'footnote', color: 'danger-text' }, children: ['$problem'] },
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
                props: { variant: 'ghost', onClick: { $action: 'recordStore.cancelRecordForm' } },
                children: ['Cancel'],
              },
              {
                type: 'we-button',
                props: {
                  variant: 'primary',
                  // Disabled only while the write is in flight. Never on "the form is not valid
                  // yet" — that would make the button unclickable in exactly the state where
                  // clicking it is what reveals which field is missing.
                  loading: { $store: 'recordStore.savingRecord' },
                  disabled: { $store: 'recordStore.savingRecord' },
                  onClick: save,
                },
                children: ['Create'],
              },
            ],
          },
        ],
      },
    },
  };
}
