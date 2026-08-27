import type { SchemaNode } from '@we/schema-shared';
import { field, formModal, sectionCard } from '@we/template-kit';

/**
 * The kinds of connection this community makes.
 *
 * Beside Signal Types on purpose, because it is the same act: a community naming what it means by
 * something, as data, in its own space. A signal type says what a reaction here *is*; a relationship
 * type says what a connection here *is*. Both are records rather than schema, so any member can
 * propose one and nobody needs a release.
 *
 * ## The tier this belongs to
 *
 * A connection can live in one of three places, and this is the middle one:
 *
 * - A **free-text label** on the relationship, which is where a vocabulary is discovered. Costs
 *   nothing, needs no permission, and cannot be queried or drawn — "contradicts", "Contradicts" and
 *   "contradicts?" are three different relations to a `where` clause.
 * - A **named kind**, here. A record, so adding one is not a schema change; identified, so a query
 *   can filter on it and an edge style can key on it. This is what makes a community's own
 *   vocabulary *visible* on a map rather than merely readable.
 * - A **declared relation** on the model itself, which gets the full query surface — `include`
 *   hydration, ordering by a related property, count projections — and can carry nothing about the
 *   connection: no author, no date, nothing to comment on or rate.
 *
 * Promote out of here when you want to query *by* the relation rather than filter a list of them.
 * See `docs/architecture/relations.md`.
 */

/** A label over a control the kit's `field` has no case for — the two pickers and the switch. */
const labelled = (label: string, control: SchemaNode): SchemaNode => ({
  type: 'we-form-field',
  props: { label, width: '100%' },
  children: [control],
});

const createModal: SchemaNode = formModal({
  open: { $local: 'createRelationshipTypeOpen' },
  close: { $setLocal: 'createRelationshipTypeOpen', value: false },
  title: 'New kind of connection',
  size: 'sm',
  localState: {
    kindName: { type: 'string', initial: '' },
    kindInverse: { type: 'string', initial: '' },
    kindDescription: { type: 'string', initial: '' },
    kindIcon: { type: 'string', initial: 'arrow-right' },
    kindColor: { type: 'string', initial: '' },
    kindDirected: { type: 'boolean', initial: true },
  },
  children: [
    field({
      name: 'kindName',
      label: 'Name',
      // A verb phrase, because the name is read *along* the edge — "A contradicts B" — and a
      // noun there makes every connection read as a category rather than a claim.
      placeholder: 'contradicts, came out of, supersedes…',
    }),
    field({ name: 'kindInverse', label: 'Reads backwards as', placeholder: 'contradicted by, led to…' }),
    field({
      name: 'kindDescription',
      label: 'Description',
      control: 'textarea',
      placeholder: 'When should somebody use this?',
      props: { rows: 2 },
    }),
    {
      type: 'Row',
      props: { gap: '300', width: '100%', wrap: true },
      children: [
        labelled('Icon', {
          type: 'we-icon-picker',
          props: {
            value: { $local: 'kindIcon' },
            onChange: { $setLocal: 'kindIcon', from: '$event.detail' },
          },
        }),
        labelled('Colour', {
          type: 'we-color-picker',
          props: {
            value: { $local: 'kindColor' },
            onChange: { $setLocal: 'kindColor', from: '$event.detail' },
          },
        }),
      ],
    },
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', ax: 'between', width: '100%' },
      children: [
        {
          type: 'Column',
          props: { gap: '100' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: ['Direction matters'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted' },
              children: ['Off for "related to" and "same as", where an arrow would assert an order nobody meant.'],
            },
          ],
        },
        {
          type: 'we-switch',
          props: {
            checked: { $local: 'kindDirected' },
            onChange: { $setLocal: 'kindDirected', from: '$event.detail' },
          },
        },
      ],
    },
  ],
  // Nothing about a name is locally judgeable beyond its presence, so this gates on the value
  // rather than dragging in the validation machinery.
  disabled: { $not: { $local: 'kindName' } },
  submitLabel: 'Create',
  submit: {
    $action: 'spaceStore.createRelationshipType',
    args: [
      {
        name: { $local: 'kindName' },
        inverseName: { $local: 'kindInverse' },
        description: { $local: 'kindDescription' },
        icon: { $local: 'kindIcon' },
        color: { $local: 'kindColor' },
        directed: { $local: 'kindDirected' },
      },
    ],
  },
});

/** One kind, as it will be read on a map: its icon and colour, its name, and how it reads backwards. */
const kindRow: SchemaNode = {
  type: 'Row',
  props: {
    gap: '300',
    ay: 'center',
    width: '100%',
    py: '300',
    borderBottom: '1px solid border',
  },
  children: [
    {
      type: 'we-icon',
      props: {
        name: '$kind.icon',
        color: { $if: { condition: '$kind.color', then: '$kind.color', else: 'text-muted' } },
      },
    },
    {
      type: 'Column',
      props: { gap: '100', flex: '1' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true },
          children: [
            { type: 'we-text', props: { fontWeight: '600' }, children: ['$kind.name'] },
            {
              type: '$if',
              props: {
                condition: '$kind.inverseName',
                then: {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-muted' },
                  children: [{ $concat: ['↔ ', '$kind.inverseName'] }],
                },
              },
            },
            {
              type: '$if',
              props: {
                condition: { $not: '$kind.directed' },
                then: { type: 'we-badge', props: { size: 'xs' }, children: ['undirected'] },
              },
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: '$kind.description',
            then: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted' },
              children: ['$kind.description'],
            },
          },
        },
      ],
    },
    {
      type: 'we-button',
      props: {
        size: 'xs',
        variant: 'ghost',
        color: 'danger-text',
        // Removing a kind leaves the connections that used it: they keep their label and lose their
        // colour, which is the right degradation. Deleting them with it would delete claims people
        // made because somebody tidied a vocabulary.
        onClick: { $action: 'model.delete', args: ['RelationshipType', '$kind.id'] },
      },
      children: [{ type: 'we-icon', props: { name: 'trash' } }],
    },
  ],
};

export const relationshipTypesSection: SchemaNode = sectionCard({
  title: 'Connection Types',
  description:
    'The kinds of connection members can draw between things here — "contradicts", "came out of". Naming a kind lets the graph colour it, and lets you find every connection of that kind.',
  aside: {
    type: 'we-button',
    props: {
      variant: 'secondary',
      size: 'sm',
      onClick: { $setLocal: 'createRelationshipTypeOpen', value: true },
    },
    children: [
      { type: 'we-icon', props: { name: 'plus' } },
      { type: 'we-text', children: ['Add Kind'] },
    ],
  },
  children: [
    {
      type: '$each',
      props: { items: { $query: { entity: 'RelationshipType', order: { name: 'asc' } } }, as: 'kind' },
      children: [kindRow],
    },
    createModal,
  ],
});
