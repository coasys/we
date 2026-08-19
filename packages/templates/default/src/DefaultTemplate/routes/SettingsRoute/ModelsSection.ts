import type { SchemaNode } from '@we/schema-shared';
import { sectionCard } from '@we/template-kit';

/**
 * The Models section of space settings: the content models this space defines, the wizard that
 * creates and edits them, and per-space tuning of interpretation hints — for the space's own
 * models and for the core vocabulary (tasks, events) alike.
 *
 * All form state lives in `shapeStore` rather than `$localState`: the wizard's rows are
 * structured, interdependent and validated as a whole (the `runtimeStore.aiForm` precedent), and
 * the LLM flow fills the same draft — both frontends share one review path. The only `$localState`
 * here is the delete confirmation, which is genuinely view-local.
 */

const PROPERTY_TYPE_OPTIONS = [
  { label: 'Text', value: 'text' },
  { label: 'Number', value: 'number' },
  { label: 'Yes / no', value: 'boolean' },
  { label: 'Date', value: 'date' },
  { label: 'Select', value: 'select' },
];

/**
 * The grab area of a member row.
 *
 * A native element, twice over: the renderer assigns a web component's props as DOM *properties*,
 * so the `data-we-handle` attribute `we-sortable` looks for would never exist on a `we-button`;
 * and a native element is the one node type the validator has no prop list for, so the data
 * attribute is not reported as unknown. `tabindex` keeps the keyboard path open — Space on a
 * focused handle picks the row up, which is the whole reason the handle is focusable at all.
 */
const dragHandle: SchemaNode = {
  type: 'div',
  props: {
    'data-we-handle': '',
    tabindex: '0',
    title: 'Drag to reorder',
    style: { display: 'flex', alignItems: 'center', cursor: 'grab' },
  },
  children: [{ type: 'we-icon', props: { name: 'dots-six-vertical', color: 'neutral-400' } }],
};

/** Remove this member. Pinned top-right of the row rather than trailing its last input, which moves. */
const removeMemberButton: SchemaNode = {
  type: 'we-button',
  props: {
    variant: 'ghost',
    size: 'sm',
    onClick: { $action: 'shapeStore.removeMember', args: ['$member.rowId'] },
  },
  children: [{ type: 'we-icon', props: { name: 'trash' } }],
};

/** The shared name input — the one control both kinds of member row open with. */
const memberNameInput: SchemaNode = {
  type: 'we-input',
  props: {
    placeholder: 'fieldName',
    width: '160px',
    size: 'sm',
    value: '$member.name',
    onInput: { $action: 'shapeStore.setMemberField', args: ['$member.rowId', 'name', '$arg.detail'] },
  },
};

/**
 * One property row — a scalar field of the model being defined.
 *
 * The header line is `ax: 'between'` rather than a wrapping run of controls: the delete button
 * belongs to the row as a whole, so it is pinned to the corner rather than trailing whichever
 * input happens to come last (which moves as the type changes, and reads as "clear this field").
 */
const propertyRow: SchemaNode = {
  type: 'Column',
  props: { gap: '200', p: '300', bg: 'neutral-50', r: '300', border: '1px solid neutral-200' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', ax: 'between', wrap: true },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true },
          children: [
            dragHandle,
            memberNameInput,
            {
              type: 'we-select',
              props: {
                size: 'sm',
                width: '130px',
                options: PROPERTY_TYPE_OPTIONS,
                value: '$member.type',
                onChange: { $action: 'shapeStore.setMemberField', args: ['$member.rowId', 'type', '$arg.detail'] },
              },
            },
            {
              type: 'we-switch',
              props: {
                size: 'sm',
                labelOff: 'Optional',
                labelOn: 'Required',
                checked: '$member.required',
                onChange: { $action: 'shapeStore.setMemberField', args: ['$member.rowId', 'required', '$arg.detail'] },
              },
            },
          ],
        },
        removeMemberButton,
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $eq: ['$member.type', 'select'] },
        then: {
          type: 'we-input',
          props: {
            size: 'sm',
            placeholder: 'Options, comma-separated — e.g. certain, probable, unsure',
            value: '$member.options',
            onInput: { $action: 'shapeStore.setMemberField', args: ['$member.rowId', 'options', '$arg.detail'] },
          },
        },
      },
    },
    {
      type: 'Row',
      props: { gap: '200', wrap: true },
      children: [
        {
          type: 'we-input',
          props: {
            size: 'sm',
            flex: '2',
            minWidth: '220px',
            placeholder: 'AI hint — what goes in this field, allowed values, format…',
            value: '$member.hint',
            onInput: { $action: 'shapeStore.setMemberField', args: ['$member.rowId', 'hint', '$arg.detail'] },
          },
        },
        {
          type: 'we-input',
          props: {
            size: 'sm',
            flex: '1',
            minWidth: '120px',
            placeholder: 'Default value',
            value: '$member.defaultValue',
            onInput: {
              $action: 'shapeStore.setMemberField',
              args: ['$member.rowId', 'defaultValue', '$arg.detail'],
            },
          },
        },
      ],
    },
  ],
};

/**
 * One relationship row — an edge to another model.
 *
 * Deliberately shorter than a property row rather than a property row with half its inputs hidden:
 * a relation carries a target and a cardinality and nothing else, so there is no type, no default,
 * and no hint to show. That asymmetry is why the two are separate rows at all.
 */
const relationshipRow: SchemaNode = {
  type: 'Column',
  props: { gap: '200', p: '300', bg: 'primary-50', r: '300', border: '1px solid primary-100' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', ax: 'between', wrap: true },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true },
          children: [
            dragHandle,
            memberNameInput,
            { type: 'we-icon', props: { name: 'arrow-right', color: 'neutral-400' } },
            {
              type: 'we-select',
              props: {
                size: 'sm',
                width: '260px',
                searchable: true,
                placeholder: 'Points at…',
                options: { $store: 'shapeStore.relationshipTargets' },
                value: '$member.target',
                onChange: { $action: 'shapeStore.setMemberField', args: ['$member.rowId', 'target', '$arg.detail'] },
              },
            },
            {
              type: 'we-switch',
              props: {
                size: 'sm',
                labelOff: 'One',
                labelOn: 'Many',
                checked: '$member.many',
                onChange: { $action: 'shapeStore.setMemberField', args: ['$member.rowId', 'many', '$arg.detail'] },
              },
            },
          ],
        },
        removeMemberButton,
      ],
    },
  ],
};

/**
 * One row of the members list, wrapped for drag-to-reorder.
 *
 * `data-we-id` goes on a native div for the same two reasons the handle does — a web component
 * would never carry the attribute, and the validator has no prop list for a native element.
 */
const memberRow: SchemaNode = {
  type: 'div',
  props: { 'data-we-id': '$member.rowId', style: { width: '100%' } },
  children: [
    {
      type: '$if',
      props: {
        condition: { $eq: ['$member.kind', 'relationship'] },
        then: relationshipRow,
        else: propertyRow,
      },
    },
  ],
};

/**
 * The "describe it instead" box — the LLM frontend. Offered for new models only: on an edit a
 * generated draft would replace the stored predicates wholesale, which is exactly what the
 * additive guard exists to prevent. Fills the same draft the rows below edit; nothing is stored
 * until the user saves.
 */
const describeItBox: SchemaNode = {
  type: '$if',
  props: {
    condition: {
      $and: [{ $not: { $store: 'shapeStore.editingShapeId' } }, { $store: 'shapeStore.aiAvailable' }],
    },
    then: {
      type: 'Column',
      props: { gap: '200', p: '300', bg: 'primary-50', r: '300', border: '1px solid primary-100' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'sparkle', color: 'primary-600' } },
            { type: 'we-text', props: { variant: 'label' }, children: ['Describe it instead'] },
          ],
        },
        {
          type: 'we-textarea',
          props: {
            rows: 2,
            placeholder:
              'e.g. "We log bird sightings — species, when and where we saw it, how certain we are, and notes"',
            value: { $local: 'aiDescription' },
            onInput: { $setLocal: 'aiDescription', from: '$event.detail' },
          },
        },
        {
          type: 'Row',
          props: { ax: 'end' },
          children: [
            {
              type: 'we-button',
              props: {
                variant: 'secondary',
                size: 'sm',
                loading: { $store: 'shapeStore.generating' },
                disabled: {
                  $or: [{ $store: 'shapeStore.generating' }, { $not: { $local: 'aiDescription' } }],
                },
                onClick: { $action: 'shapeStore.generateShapeDraft', args: [{ $local: 'aiDescription' }] },
              },
              children: [
                { type: 'we-icon', props: { name: 'sparkle' } },
                { type: 'we-text', children: ['Generate'] },
              ],
            },
          ],
        },
      ],
    },
  },
};

/** The wizard: create or edit one model. Mounted while `shapeStore.shapeDraft` is non-null. */
const shapeWizardModal: SchemaNode = {
  type: 'we-modal',
  props: { close: { $action: 'shapeStore.cancelShapeWizard' } },
  $localState: {
    aiDescription: { type: 'string', initial: '' },
  },
  children: [
    {
      type: 'Column',
      props: { gap: '400', width: 'min(720px, 85vw)' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'heading-sm' },
          children: [
            {
              $if: {
                condition: { $store: 'shapeStore.editingShapeId' },
                then: 'Edit model',
                else: 'New model',
              },
            },
          ],
        },
        describeItBox,
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true },
          children: [
            {
              type: 'we-icon-picker',
              props: {
                size: 'sm',
                value: { $store: 'shapeStore.shapeDraft.icon' },
                onChange: { $action: 'shapeStore.setShapeField', args: ['icon', '$arg.detail'] },
              },
            },
            {
              type: 'we-form-field',
              props: { label: 'Name' },
              children: [
                {
                  type: 'we-input',
                  props: {
                    placeholder: 'Sighting',
                    value: { $store: 'shapeStore.shapeDraft.name' },
                    // Renaming changes what queries resolve, so an existing model's name is fixed.
                    disabled: { $store: 'shapeStore.editingShapeId' },
                    onInput: { $action: 'shapeStore.setShapeField', args: ['name', '$arg.detail'] },
                  },
                },
              ],
            },
            {
              type: 'we-form-field',
              props: { label: 'Description', flex: '1', minWidth: '200px' },
              children: [
                {
                  type: 'we-input',
                  props: {
                    placeholder: 'What one of these is',
                    value: { $store: 'shapeStore.shapeDraft.description' },
                    onInput: { $action: 'shapeStore.setShapeField', args: ['description', '$arg.detail'] },
                  },
                },
              ],
            },
          ],
        },
        {
          type: 'we-form-field',
          props: {
            label: 'AI hint',
            description: 'What this model means, for AI extraction — when should something count as one of these?',
          },
          children: [
            {
              type: 'we-textarea',
              props: {
                rows: 2,
                value: { $store: 'shapeStore.shapeDraft.classHint' },
                onInput: { $action: 'shapeStore.setShapeField', args: ['classHint', '$arg.detail'] },
              },
            },
          ],
        },
        {
          type: 'Column',
          props: { gap: '200' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: ['Fields'] },
            {
              type: 'we-sortable',
              props: {
                direction: 'vertical',
                gap: 'var(--we-space-200)',
                width: '100%',
                // Order is the declaration order the manifest stores, and will be the field order
                // of the derived creation form — so reordering is data, not decoration.
                onReorder: { $action: 'shapeStore.reorderMembers', args: ['$arg.detail'] },
              },
              children: [
                {
                  type: '$each',
                  props: { items: { $store: 'shapeStore.shapeDraft.members' }, as: 'member' },
                  children: [memberRow],
                },
              ],
            },
            {
              type: 'Row',
              props: { gap: '200', wrap: true },
              children: [
                {
                  type: 'we-button',
                  props: { variant: 'ghost', size: 'sm', onClick: { $action: 'shapeStore.addProperty' } },
                  children: [
                    { type: 'we-icon', props: { name: 'plus' } },
                    { type: 'we-text', children: ['Add property'] },
                  ],
                },
                {
                  type: 'we-button',
                  props: { variant: 'ghost', size: 'sm', onClick: { $action: 'shapeStore.addRelationship' } },
                  children: [
                    { type: 'we-icon', props: { name: 'arrow-right' } },
                    { type: 'we-text', children: ['Add relationship'] },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'we-form-field',
          props: {
            label: 'Identifies duplicates',
            description:
              'The field AI extraction compares to recognise “the same one again”. Leave as None if this model has no natural identifier.',
          },
          children: [
            {
              type: 'we-select',
              props: {
                size: 'sm',
                width: '240px',
                options: { $store: 'shapeStore.identityOptions' },
                value: {
                  $if: {
                    condition: { $store: 'shapeStore.shapeDraft.identityMember' },
                    then: { $store: 'shapeStore.shapeDraft.identityMember' },
                    else: 'none',
                  },
                },
                onChange: { $action: 'shapeStore.setIdentityMember', args: ['$arg.detail'] },
              },
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $count: { items: { $store: 'shapeStore.draftErrors' } } },
            then: {
              type: 'Column',
              props: { gap: '100' },
              children: [
                {
                  type: '$each',
                  props: { items: { $store: 'shapeStore.draftErrors' }, as: 'error' },
                  children: [{ type: 'we-alert', props: { variant: 'danger' }, children: ['$error'] }],
                },
              ],
            },
          },
        },
        {
          type: 'Row',
          props: { ax: 'end', gap: '200' },
          children: [
            {
              type: 'we-button',
              props: { variant: 'ghost', onClick: { $action: 'shapeStore.cancelShapeWizard' } },
              children: ['Cancel'],
            },
            {
              type: 'we-button',
              props: {
                variant: 'primary',
                loading: { $store: 'shapeStore.savingShape' },
                disabled: { $store: 'shapeStore.savingShape' },
                onClick: { $action: 'shapeStore.saveShapeDraft' },
              },
              children: [
                {
                  $if: {
                    condition: { $store: 'shapeStore.editingShapeId' },
                    then: 'Save changes',
                    else: 'Create model',
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** Per-space hint tuning for one entity. Mounted while `shapeStore.hintEditor` is non-null. */
const hintEditorModal: SchemaNode = {
  type: 'we-modal',
  props: { close: { $action: 'shapeStore.closeHintEditor' } },
  children: [
    {
      type: 'Column',
      props: { gap: '400', width: 'min(640px, 85vw)' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', ax: 'between' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'heading-sm' },
              children: [{ $concat: ['AI hints — ', { $store: 'shapeStore.hintEditor.entity' }] }],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'shapeStore.hintEditor.customized' },
                then: { type: 'we-badge', props: { variant: 'primary' }, children: ['Customized for this space'] },
                else: { type: 'we-badge', props: { variant: 'neutral' }, children: ['Using defaults'] },
              },
            },
          ],
        },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'neutral-400' },
          children: [
            'These hints steer AI extraction in this space. Once customized, they stay as this community set them — updates to the defaults no longer apply until you reset.',
          ],
        },
        {
          type: 'we-form-field',
          props: { label: 'What counts as one of these' },
          children: [
            {
              type: 'we-textarea',
              props: {
                rows: 3,
                value: { $store: 'shapeStore.hintEditor.classHint' },
                onInput: { $action: 'shapeStore.setHintDraft', args: ['class', '$arg.detail'] },
              },
            },
          ],
        },
        {
          type: '$each',
          props: { items: { $store: 'shapeStore.hintEditor.rows' }, as: 'row' },
          children: [
            {
              type: 'we-form-field',
              props: { label: '$row.name' },
              children: [
                {
                  type: 'we-textarea',
                  props: {
                    rows: 2,
                    placeholder: 'No hint — the AI sees only the field name and type',
                    value: '$row.hint',
                    onInput: { $action: 'shapeStore.setHintDraft', args: ['$row.predicate', '$arg.detail'] },
                  },
                },
              ],
            },
          ],
        },
        {
          type: 'Row',
          props: { ax: 'between', gap: '200', ay: 'center' },
          children: [
            {
              type: '$if',
              props: {
                condition: { $store: 'shapeStore.hintEditor.customized' },
                then: {
                  type: 'we-button',
                  props: {
                    variant: 'ghost',
                    loading: { $store: 'shapeStore.hintBusy' },
                    onClick: { $action: 'shapeStore.resetHintEditor' },
                  },
                  children: [
                    { type: 'we-icon', props: { name: 'arrows-clockwise' } },
                    { type: 'we-text', children: ['Reset to defaults'] },
                  ],
                },
                else: { type: 'div' },
              },
            },
            {
              type: 'Row',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-button',
                  props: { variant: 'ghost', onClick: { $action: 'shapeStore.closeHintEditor' } },
                  children: ['Cancel'],
                },
                {
                  type: 'we-button',
                  props: {
                    variant: 'primary',
                    loading: { $store: 'shapeStore.hintBusy' },
                    disabled: { $store: 'shapeStore.hintBusy' },
                    onClick: { $action: 'shapeStore.saveHintEditor' },
                  },
                  children: ['Save for this space'],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** One space-defined model in the list. */
const shapeRow: SchemaNode = {
  type: 'Column',
  props: { gap: '100', py: '200' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', ax: 'between', wrap: true },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [
            {
              type: 'we-icon',
              props: {
                name: { $if: { condition: '$shape.icon', then: '$shape.icon', else: 'cube' } },
                color: 'primary-600',
              },
            },
            {
              type: 'Column',
              props: { gap: '0' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '200', ay: 'center' },
                  children: [
                    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['$shape.name'] },
                    {
                      type: 'we-badge',
                      props: { variant: 'neutral', size: 'xs' },
                      children: [
                        {
                          $concat: [
                            '$shape.propertyCount',
                            ' ',
                            { $plural: { count: '$shape.propertyCount', one: 'field', other: 'fields' } },
                            ' · v',
                            '$shape.version',
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'neutral-400' },
                  children: ['$shape.description'],
                },
              ],
            },
          ],
        },
        {
          type: 'Row',
          props: { gap: '100' },
          children: [
            {
              type: 'we-button',
              props: {
                variant: 'ghost',
                size: 'sm',
                onClick: { $action: 'shapeStore.openHintEditor', args: ['$shape.name'] },
              },
              children: [
                { type: 'we-icon', props: { name: 'sparkle' } },
                { type: 'we-text', children: ['AI hints'] },
              ],
            },
            {
              type: 'we-button',
              props: {
                variant: 'ghost',
                size: 'sm',
                onClick: { $action: 'shapeStore.openShapeWizard', args: ['$shape.id'] },
              },
              children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
            },
            {
              type: 'we-button',
              props: {
                variant: 'ghost',
                size: 'sm',
                onClick: { $setLocal: 'confirmDeleteShapeId', value: '$shape.id' },
              },
              children: [{ type: 'we-icon', props: { name: 'trash' } }],
            },
          ],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $count: { items: '$shape.problems' } },
        then: {
          type: '$each',
          props: { items: '$shape.problems', as: 'problem' },
          children: [{ type: 'we-alert', props: { variant: 'warning' }, children: ['$problem'] }],
        },
      },
    },
  ],
};

/** One core entity offering hint tuning. */
const hintEntityRow: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', ax: 'between', py: '100' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'package', color: 'neutral-500' } },
        { type: 'we-text', children: ['$entity.entity'] },
        { type: 'we-badge', props: { variant: 'neutral', size: 'xs' }, children: ['Built-in'] },
      ],
    },
    {
      type: 'we-button',
      props: {
        variant: 'ghost',
        size: 'sm',
        onClick: { $action: 'shapeStore.openHintEditor', args: ['$entity.entity'] },
      },
      children: [
        { type: 'we-icon', props: { name: 'sparkle' } },
        { type: 'we-text', children: ['AI hints'] },
      ],
    },
  ],
};

const deleteConfirmModal: SchemaNode = {
  type: '$if',
  props: {
    condition: { $local: 'confirmDeleteShapeId' },
    then: {
      type: 'we-modal',
      props: { close: { $setLocal: 'confirmDeleteShapeId', value: '' } },
      children: [
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Remove this model?'] },
            {
              type: 'we-text',
              children: [
                'Entries already created with it keep their data, and other members keep seeing them — only the definition is removed from this space.',
              ],
            },
            {
              type: 'Row',
              props: { ax: 'end', gap: '200' },
              children: [
                {
                  type: 'we-button',
                  props: { variant: 'ghost', onClick: { $setLocal: 'confirmDeleteShapeId', value: '' } },
                  children: ['Cancel'],
                },
                {
                  type: 'we-button',
                  props: {
                    variant: 'danger',
                    onClick: {
                      $action: 'shapeStore.deleteShape',
                      args: [{ $local: 'confirmDeleteShapeId' }],
                      onSuccess: [{ $setLocal: 'confirmDeleteShapeId', value: '' }],
                    },
                  },
                  children: ['Remove'],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

export const modelsSection: SchemaNode = {
  ...sectionCard({
    title: 'Models',
    description: 'The kinds of content this space defines — its own record types, and how AI interprets them.',
    aside: {
      type: 'we-button',
      props: { variant: 'secondary', size: 'sm', onClick: { $action: 'shapeStore.openShapeWizard' } },
      children: [
        { type: 'we-icon', props: { name: 'plus' } },
        { type: 'we-text', children: ['New model'] },
      ],
    },
    children: [
      {
        type: '$if',
        props: {
          condition: { $store: 'shapeStore.shapesLoaded' },
          then: {
            type: '$if',
            props: {
              condition: { $count: { items: { $store: 'shapeStore.spaceShapes' } } },
              then: {
                type: 'Column',
                props: { gap: '100' },
                children: [
                  {
                    type: '$each',
                    props: { items: { $store: 'shapeStore.spaceShapes' }, as: 'shape' },
                    children: [shapeRow],
                  },
                ],
              },
              else: {
                type: 'Column',
                props: { ax: 'center', gap: '200', p: '400' },
                children: [
                  { type: 'we-icon', props: { name: 'cube', size: 'lg', color: 'neutral-400' } },
                  {
                    type: 'we-text',
                    props: { color: 'neutral-400', textAlign: 'center' },
                    children: ['This space has no models of its own yet.'],
                  },
                ],
              },
            },
          },
          else: { type: 'we-skeleton', props: { height: '48px' } },
        },
      },
      { type: 'we-divider' },
      {
        type: 'Column',
        props: { gap: '100' },
        children: [
          { type: 'we-text', props: { variant: 'label' }, children: ['Built-in models'] },
          {
            type: 'we-text',
            props: { variant: 'footnote', color: 'neutral-400' },
            children: ['Ship with WE. Their structure is fixed, but how AI interprets them here is yours to tune.'],
          },
          {
            type: '$each',
            props: {
              items: {
                $filter: { items: { $store: 'shapeStore.hintEntities' }, where: { source: 'core' } },
              },
              as: 'entity',
            },
            children: [hintEntityRow],
          },
        ],
      },
      { type: '$if', props: { condition: { $store: 'shapeStore.shapeDraft' }, then: shapeWizardModal } },
      { type: '$if', props: { condition: { $store: 'shapeStore.hintEditor' }, then: hintEditorModal } },
      deleteConfirmModal,
    ],
  }),
  $localState: {
    confirmDeleteShapeId: { type: 'string', initial: '' },
  },
};
