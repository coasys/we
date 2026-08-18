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
  { label: 'Reference', value: 'reference' },
];

/** One property row of the wizard — everything about one field of the model being defined. */
const propertyRow: SchemaNode = {
  type: 'Column',
  props: { gap: '200', p: '300', bg: 'neutral-50', r: '300', border: '1px solid neutral-200' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', wrap: true },
      children: [
        {
          type: 'we-input',
          props: {
            placeholder: 'fieldName',
            width: '180px',
            size: 'sm',
            value: '$prop.name',
            onInput: { $action: 'shapeStore.setDraftProperty', args: ['$index', 'name', '$arg.detail'] },
          },
        },
        {
          type: 'we-select',
          props: {
            size: 'sm',
            width: '140px',
            options: PROPERTY_TYPE_OPTIONS,
            value: '$prop.type',
            onChange: { $action: 'shapeStore.setDraftProperty', args: ['$index', 'type', '$arg.detail'] },
          },
        },
        {
          type: 'Row',
          props: { gap: '300', ay: 'center', flex: '1' },
          children: [
            {
              type: 'we-switch',
              props: {
                size: 'sm',
                labelOn: 'Required',
                labelOff: 'Required',
                checked: '$prop.required',
                onChange: { $action: 'shapeStore.setDraftProperty', args: ['$index', 'required', '$arg.detail'] },
              },
            },
            {
              type: 'we-tooltip',
              props: { title: 'The field used to recognize “the same one again” — deduplication for AI extraction' },
              children: [
                {
                  type: 'we-switch',
                  props: {
                    size: 'sm',
                    labelOn: 'Identity',
                    labelOff: 'Identity',
                    checked: '$prop.identity',
                    onChange: { $action: 'shapeStore.setDraftProperty', args: ['$index', 'identity', '$arg.detail'] },
                  },
                },
              ],
            },
          ],
        },
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            onClick: { $action: 'shapeStore.removeDraftProperty', args: ['$index'] },
          },
          children: [{ type: 'we-icon', props: { name: 'trash' } }],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $eq: ['$prop.type', 'select'] },
        then: {
          type: 'we-input',
          props: {
            size: 'sm',
            placeholder: 'Options, comma-separated — e.g. certain, probable, unsure',
            value: '$prop.options',
            onInput: { $action: 'shapeStore.setDraftProperty', args: ['$index', 'options', '$arg.detail'] },
          },
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $eq: ['$prop.type', 'reference'] },
        then: {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            {
              type: 'we-select',
              props: {
                size: 'sm',
                width: '220px',
                searchable: true,
                placeholder: 'Points at…',
                options: {
                  $map: {
                    items: { $store: 'shapeStore.referenceTargets' },
                    select: { label: { $concat: ['$item'] }, value: { $concat: ['$item'] } },
                  },
                },
                value: '$prop.target',
                onChange: { $action: 'shapeStore.setDraftProperty', args: ['$index', 'target', '$arg.detail'] },
              },
            },
            {
              type: 'we-switch',
              props: {
                size: 'sm',
                labelOn: 'Many',
                labelOff: 'One',
                checked: '$prop.many',
                onChange: { $action: 'shapeStore.setDraftProperty', args: ['$index', 'many', '$arg.detail'] },
              },
            },
          ],
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $ne: ['$prop.type', 'reference'] },
        then: {
          type: 'Row',
          props: { gap: '200', wrap: true },
          children: [
            {
              type: 'we-input',
              props: {
                size: 'sm',
                flex: '2',
                minWidth: '220px',
                placeholder: 'AI hint — what should be put in this field, allowed values, format…',
                value: '$prop.hint',
                onInput: { $action: 'shapeStore.setDraftProperty', args: ['$index', 'hint', '$arg.detail'] },
              },
            },
            {
              type: 'we-input',
              props: {
                size: 'sm',
                flex: '1',
                minWidth: '120px',
                placeholder: 'Default value',
                value: '$prop.defaultValue',
                onInput: { $action: 'shapeStore.setDraftProperty', args: ['$index', 'defaultValue', '$arg.detail'] },
              },
            },
          ],
        },
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
            { type: 'we-text', props: { variant: 'label' }, children: ['Properties'] },
            {
              type: '$each',
              props: { items: { $store: 'shapeStore.shapeDraft.properties' }, as: 'prop' },
              children: [propertyRow],
            },
            {
              type: 'we-button',
              props: { variant: 'ghost', size: 'sm', ax: 'start', onClick: { $action: 'shapeStore.addDraftProperty' } },
              children: [
                { type: 'we-icon', props: { name: 'plus' } },
                { type: 'we-text', children: ['Add property'] },
              ],
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
