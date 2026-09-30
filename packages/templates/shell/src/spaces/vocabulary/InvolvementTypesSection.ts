import type { SchemaNode } from '@we/schema-shared';
import { field, formModal, sectionCard } from '@we/template-kit';

/**
 * The kinds of part people can have in this community's work — "Assigned", "Reviewing", "Going".
 *
 * The fourth of the same kind, beside Signal Types, Connection Types and Task States, and the same act
 * each time: a community naming what it means by something, as data, in its own space. Drawn as the
 * task states are, field for field where the two do the same job, because a reader who has learned
 * one section should not have to learn the next.
 *
 * ## Two questions the form asks that a state's does not
 *
 * **Who gives it.** Being assigned is something one member says about another; being "Going" is
 * something only you can say about yourself. That is what separates a task's assign menu from an
 * event's RSVP buttons, and it is fixed once a kind is made: turning an assignment into an answer
 * would leave everyone who holds it claiming to have said something they never said. So it is on the
 * create form and absent from the edit form, with a line saying why.
 *
 * **What it is offered on.** A kind named "Shepherd" belongs in a task's menu and not beside an
 * event's Going and Maybe. The three choices are the two records WE draws people on today, and
 * anything — a kind a community means for its own models too.
 *
 * ## Why the defaults are shown but not stored, and retired rather than deleted
 *
 * `TaskStatesSection`'s reasons, one vocabulary along: a space starts with five kinds it has never
 * written down, and an involvement names its kind by slug, so removing the kind would leave somebody
 * holding a word nothing defines.
 */

/** A label over a control the kit's `field` has no case for. */
const labelled = (label: string, control: SchemaNode): SchemaNode => ({
  type: 'we-form-field',
  props: { label, width: '100%' },
  children: [control],
});

interface KindFieldNames {
  name: string;
  semantic: string;
  appliesTo: string;
  icon: string;
}

/** What a kind is, as a form — written once and filled in twice, for `stateFields`' reason. */
function kindFields(names: KindFieldNames): SchemaNode[] {
  return [
    field({ name: names.name, label: 'Name', placeholder: 'Shepherd' }),
    labelled('The rest of the app reads this as', {
      type: 'we-select',
      props: {
        value: { $: `local.${names.semantic}` },
        onChange: { $setLocal: names.semantic, value: { $: 'event.detail' } },
        options: [
          { label: 'Doing it', value: 'responsible' },
          { label: 'Checking it', value: 'reviewing' },
          { label: 'Coming', value: 'committed' },
          { label: 'Might come', value: 'interested' },
          { label: 'Not coming', value: 'declined' },
        ],
      },
    }),
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-muted' },
      children: [
        'What this means to everything outside this space — a board finding who is doing the work, a calendar counting who is coming. The name is yours; this is the part they read.',
      ],
    },
    labelled('Offered on', {
      type: 'we-select',
      props: {
        value: { $: `local.${names.appliesTo}` },
        onChange: { $setLocal: names.appliesTo, value: { $: 'event.detail' } },
        options: [
          { label: 'Tasks', value: 'TaskBlock' },
          { label: 'Events', value: 'EventBlock' },
          { label: 'Anything', value: '' },
        ],
      },
    }),
    labelled('Icon', {
      type: 'we-icon-picker',
      props: {
        value: { $: `local.${names.icon}` },
        onChange: { $setLocal: names.icon, value: { $: 'event.detail' } },
      },
    }),
  ];
}

const createModal: SchemaNode = formModal({
  open: { $: 'local.createInvolvementTypeOpen' },
  close: { $setLocal: 'createInvolvementTypeOpen', value: false },
  title: 'New kind of involvement',
  size: 'sm',
  localState: {
    kindName: { type: 'string', initial: '' },
    kindSemantic: { type: 'string', initial: 'responsible' },
    kindAppliesTo: { type: 'string', initial: 'TaskBlock' },
    kindIcon: { type: 'string', initial: '' },
    kindReflexive: { type: 'string', initial: 'other' },
  },
  children: [
    ...kindFields({ name: 'kindName', semantic: 'kindSemantic', appliesTo: 'kindAppliesTo', icon: 'kindIcon' }),
    labelled('Who says it', {
      type: 'we-select',
      props: {
        value: { $: 'local.kindReflexive' },
        onChange: { $setLocal: 'kindReflexive', value: { $: 'event.detail' } },
        options: [
          { label: 'Anyone, about anyone — like assigning', value: 'other' },
          { label: 'Each person, about themselves — like an RSVP', value: 'self' },
        ],
      },
    }),
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-muted' },
      children: [
        'Fixed once made. A person gives one answer about themselves to anything, so a kind they say about themselves replaces their other answers there.',
      ],
    },
  ],
  disabled: { $: '!local.kindName' },
  // Everything else starts set, so the guard would fire on a form nobody has touched.
  discardWhen: { $: 'local.kindName' },
  submitLabel: 'Add kind',
  submit: {
    $action: 'spaceStore.createInvolvementType',
    args: [
      {
        name: { $: 'local.kindName' },
        semantic: { $: 'local.kindSemantic' },
        appliesTo: { $: 'local.kindAppliesTo' },
        icon: { $: 'local.kindIcon' },
        reflexive: { $: "local.kindReflexive == 'self'" },
      },
    ],
  },
});

/** The kind being edited, found by the slug the row's pencil wrote. */
const EDITING = 'find(spaceStore.involvementTypes, { slug: local.editInvolvementTypeSlug })';

/** The stored `appliesTo` as the form's select holds it — one entity, or `''` for anything. */
const APPLIES = `(count(${EDITING}.appliesTo) == 1) ? first(${EDITING}.appliesTo) : ''`;

/** Changing a kind the community already has — `TaskStatesSection`'s `editModal`, one vocabulary along. */
const editModal: SchemaNode = formModal({
  open: { $: 'local.editInvolvementTypeSlug' },
  close: { $setLocal: 'editInvolvementTypeSlug', value: '' },
  title: 'Edit kind of involvement',
  size: 'sm',
  localState: {
    editKindName: { type: 'string', initial: { $: `${EDITING}.name` } },
    editKindSemantic: { type: 'string', initial: { $: `${EDITING}.semantic` } },
    editKindAppliesTo: { type: 'string', initial: { $: APPLIES } },
    editKindIcon: { type: 'string', initial: { $: `${EDITING}.icon` } },
  },
  children: [
    ...kindFields({
      name: 'editKindName',
      semantic: 'editKindSemantic',
      appliesTo: 'editKindAppliesTo',
      icon: 'editKindIcon',
    }),
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-faint' },
      children: [
        {
          $:
            '`Stored as “${' +
            EDITING +
            '.slug}”, whatever it is called. ${' +
            EDITING +
            ".reflexive ? 'Each person says it about themselves' : 'Anyone can say it about anyone'} — that is fixed.`",
        },
      ],
    },
  ],
  disabled: { $: '!local.editKindName' },
  discardWhen: {
    $:
      `local.editKindName != ${EDITING}.name || local.editKindSemantic != ${EDITING}.semantic || ` +
      `local.editKindIcon != ${EDITING}.icon || local.editKindAppliesTo != (${APPLIES})`,
  },
  submitLabel: 'Save',
  submit: {
    $action: 'spaceStore.updateInvolvementType',
    args: [
      { $: 'local.editInvolvementTypeSlug' },
      {
        name: { $: 'local.editKindName' },
        semantic: { $: 'local.editKindSemantic' },
        appliesTo: { $: 'local.editKindAppliesTo' },
        icon: { $: 'local.editKindIcon' },
      },
    ],
  },
});

/** What a semantic reads as beside the kind's own name. */
const SEMANTIC_LABEL =
  "kind.semantic == 'reviewing' ? 'checking it' : " +
  "kind.semantic == 'committed' ? 'coming' : " +
  "kind.semantic == 'interested' ? 'might come' : " +
  "kind.semantic == 'declined' ? 'not coming' : 'doing it'";

/** Where it is offered, in words. */
const APPLIES_LABEL =
  "!count(kind.appliesTo) ? 'on anything' : " +
  "count(kind.appliesTo) == 1 && first(kind.appliesTo) == 'TaskBlock' ? 'on tasks' : " +
  "count(kind.appliesTo) == 1 && first(kind.appliesTo) == 'EventBlock' ? 'on events' : " +
  "'on ' + join(kind.appliesTo, ', ')";

const kindRow: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', width: '100%', py: '300', borderBottom: '1px solid border' },
  children: [
    {
      type: 'we-icon',
      props: { name: { $: "kind.icon ? kind.icon : 'user'" }, color: 'text-muted' },
    },
    {
      type: 'Column',
      props: { gap: '100', flex: '1' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true },
          children: [
            { type: 'we-text', props: { fontWeight: '600' }, children: [{ $: 'kind.name' }] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted' },
              children: [{ $: SEMANTIC_LABEL }],
            },
            {
              type: 'we-badge',
              props: { size: 'xs', variant: 'neutral' },
              children: [{ $: "kind.reflexive ? 'about themselves' : 'about someone'" }],
            },
            {
              type: '$if',
              props: {
                condition: { $: 'kind.retired' },
                then: { type: 'we-badge', props: { size: 'xs' }, children: ['withdrawn'] },
              },
            },
            {
              type: '$if',
              props: {
                condition: { $: '!kind.defined' },
                then: {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint' },
                  children: ['default'],
                },
              },
            },
          ],
        },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
          children: [{ $: `\`offered ${'${'}${APPLIES_LABEL}${'}'} · stored as “${'${'}kind.slug${'}'}”\`` }],
        },
      ],
    },
    {
      type: 'we-tooltip',
      props: { content: 'Edit this kind' },
      children: [
        {
          type: 'we-button',
          props: {
            label: 'Edit this kind',
            size: 'xs',
            variant: 'ghost',
            onClick: { $setLocal: 'editInvolvementTypeSlug', value: { $: 'kind.slug' } },
          },
          children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
        },
      ],
    },
    {
      type: 'we-tooltip',
      props: { content: { $: "kind.retired ? 'Bring this kind back' : 'Stop offering this kind'" } },
      children: [
        {
          type: 'we-button',
          props: {
            label: { $: "kind.retired ? 'Bring this kind back' : 'Stop offering this kind'" },
            size: 'xs',
            variant: 'ghost',
            onClick: {
              $action: 'spaceStore.setInvolvementTypeRetired',
              args: [{ $: 'kind.slug' }, { $: '!kind.retired' }],
            },
          },
          children: [
            { type: 'we-icon', props: { name: { $: "kind.retired ? 'arrow-counter-clockwise' : 'eye-slash'" } } },
          ],
        },
      ],
    },
  ],
};

export const involvementTypesSection: SchemaNode = sectionCard({
  title: 'Involvement',
  description:
    'The parts people can have in things here — assigned to a task, reviewing it, going to an event. Each says what it counts as, so a board can find who is doing the work whatever this space calls it.',
  aside: {
    type: 'we-button',
    props: { variant: 'secondary', size: 'sm', onClick: { $setLocal: 'createInvolvementTypeOpen', value: true } },
    children: [
      { type: 'we-icon', props: { name: 'plus' } },
      { type: 'we-text', children: ['Add Kind'] },
    ],
  },
  children: [
    {
      // From the store, for `TaskStatesSection`'s reason: with none written down the list a space uses
      // is the defaults, and a query would show nothing on exactly the spaces that most need explaining.
      type: '$each',
      props: { items: { $: 'spaceStore.involvementTypes' }, as: 'kind' },
      children: [kindRow],
    },
    createModal,
    editModal,
  ],
});
