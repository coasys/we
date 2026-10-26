/**
 * What entering a step requires, as a form shows it — the same fields wherever a step is edited.
 *
 * Two places edit what a step requires: a workflow's step in the Workflows editor, and a task state in the
 * space's Vocabulary settings, whose states are the board's workflow. They are one question — how many
 * must agree, whose agreement counts, what must be there first — and they were answered by two copies
 * of the same fields that could only drift apart. So both call these, and a step reads the same in
 * either place.
 *
 * The caller owns the values and what a change does: a workflow's draft is edited through `workflowStore`, a
 * task state's record through `spaceStore`. This arranges the fields and nothing else.
 */
import { formModal } from '@we/schema-kit';
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

export interface StepRequirementOptions {
  /** How many must agree — the number, and what a change does with `event.detail`. */
  approvals: { value: SchemaProp; onChange: SchemaProp };
  /** Whose agreement counts — an involvement kind's slug, or '' for anybody's. */
  kind: { value: SchemaProp; onChange: SchemaProp };
  /**
   * What must be there first: `items` is an expression for the list, each with a `label`; `onRemove`
   * takes away the one at `index`; `onAdd` opens the form for another (see {@link evidenceModal}).
   */
  evidence: { items: string; onRemove: SchemaProp; onAdd: SchemaProp };
}

/** The fields, in order: approvals, whose count, then what must be there. */
export function stepRequirementFields(opts: StepRequirementOptions): SchemaNode[] {
  return [
    {
      type: 'we-form-field',
      props: {
        label: 'Approvals needed to enter it',
        description: 'How many people must agree. At 1, one person asking moves it.',
      },
      children: [
        {
          type: 'we-number-input',
          props: { value: opts.approvals.value, min: 1, max: 20, step: 1, onChange: opts.approvals.onChange },
        },
      ],
    },
    {
      type: 'we-form-field',
      props: {
        label: 'Whose approval counts',
        description: 'Only people holding this part in the record being moved — its reviewers, say.',
      },
      children: [
        {
          type: 'we-select',
          props: {
            options: {
              $: "distinct([{ label: 'Any member', value: '' }], spaceStore.offeredInvolvementTypes.filter(k, !k.reflexive).map(k, { label: k.name, value: k.slug }))",
            },
            value: opts.kind.value,
            onChange: opts.kind.onChange,
          },
        },
      ],
    },
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: ['What must be there first'] },
        {
          type: '$each',
          props: { items: { $: opts.evidence.items }, as: 'requirement' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-text', props: { variant: 'footnote', flex: '1' }, children: [{ $: 'requirement.label' }] },
                {
                  type: 'we-button',
                  props: {
                    variant: 'ghost',
                    size: 'sm',
                    square: true,
                    label: 'Remove',
                    onClick: opts.evidence.onRemove,
                  },
                  children: [{ type: 'we-icon', props: { name: 'x', size: 'sm' } }],
                },
              ],
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $: `!count(${opts.evidence.items})` },
            then: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: ['Nothing — asking is enough.'],
            },
          },
        },
        {
          type: 'we-button',
          props: { size: 'sm', variant: 'ghost', onClick: opts.evidence.onAdd },
          children: ['Add something that must be there'],
        },
      ],
    },
  ];
}

export interface EvidenceModalOptions {
  open: SchemaProp;
  close: SchemaProp;
  /** The action that adds the evidence requirement, given the form's three values as expressions. */
  submit: (fields: { entity: SchemaProp; via: SchemaProp; min: SchemaProp }) => Record<string, unknown>;
}

/**
 * The form for one thing that must be there: what kind of record, where, and how many.
 *
 * "Where" is a relation the record holds — `responses`, what was made in response to it — or anywhere
 * in the space. A task holds no parts of its own (only a collection does), so a document "attached"
 * to a task is one made in response to it.
 */
export function evidenceModal(opts: EvidenceModalOptions): SchemaNode {
  return formModal({
    open: opts.open,
    close: opts.close,
    title: 'Something that must be there',
    size: 'sm',
    localState: {
      evidenceEntity: { type: 'string', initial: 'comment' },
      evidenceVia: { type: 'string', initial: 'responses' },
      evidenceMin: { type: 'number', initial: 1 },
    },
    children: [
      {
        type: 'we-form-field',
        props: { label: 'What' },
        children: [
          {
            type: 'we-select',
            props: {
              value: { $: 'local.evidenceEntity' },
              options: {
                $: "[{ label: 'A comment', value: 'comment' }, { label: 'A call about it', value: 'call' }, { label: 'A task', value: 'task' }, { label: 'A file', value: 'file' }, { label: 'A link', value: 'link' }, { label: 'An image', value: 'image' }]",
              },
              onChange: { $setLocal: 'evidenceEntity', value: { $: 'event.detail' } },
            },
          },
        ],
      },
      {
        type: 'we-form-field',
        props: { label: 'Where' },
        children: [
          {
            type: 'we-select',
            props: {
              value: { $: 'local.evidenceVia' },
              options: {
                $: "[{ label: 'In response to the record', value: 'responses' }, { label: 'Anywhere in the space', value: '' }]",
              },
              onChange: { $setLocal: 'evidenceVia', value: { $: 'event.detail' } },
            },
          },
        ],
      },
      {
        type: 'we-form-field',
        props: { label: 'At least' },
        children: [
          {
            type: 'we-number-input',
            props: {
              value: { $: 'local.evidenceMin' },
              min: 1,
              max: 20,
              step: 1,
              onChange: { $setLocal: 'evidenceMin', value: { $: 'event.detail' } },
            },
          },
        ],
      },
    ],
    submitLabel: 'Add',
    submit: opts.submit({
      entity: { $: 'local.evidenceEntity' },
      via: { $: 'local.evidenceVia' },
      min: { $: 'local.evidenceMin' },
    }),
  });
}
