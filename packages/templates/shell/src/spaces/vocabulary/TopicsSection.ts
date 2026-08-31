import type { SchemaNode } from '@we/schema-shared';
import { field, formModal, sectionCard } from '@we/template-kit';

/**
 * What this community is about — the subjects it returns to.
 *
 * The third of the three vocabulary sections, and the same act as the two above it: a community
 * naming its own terms, as data, in its own space. A signal type says what a reaction means here, a
 * connection type says what a connection means, and a topic says what the conversation is *about*.
 *
 * ## Curated, not discovered
 *
 * The difference from the other two is where the vocabulary comes from. A connection type is often
 * discovered — somebody writes a free-text label, it recurs, and the community names it. A topic set
 * is decided: a handful of subjects a community agrees it works on, written down so that content can
 * point at them and a map can group by them.
 *
 * That is why there is no free-text tier beneath this one. `TagBlock` exists and is a different
 * thing: a chip composed inline into a document, not a term the community owns.
 *
 * ## Linking is the graph's job, not this section's
 *
 * Nothing here attaches a topic to anything. A topic is a record, so it appears in a graph like any
 * other, and the graph's `connect-nodes` behaviour already turns a dragged edge into a
 * `Relationship` through `recordStore.connectNodes`. Pair it with a connection type — "about" — and
 * the link carries its own author, date and comments, which is what a claim about a pair needs and
 * what a declared edge could not hold.
 */

/** A label over a control the kit's `field` has no case for — the two pickers. */
const labelled = (label: string, control: SchemaNode): SchemaNode => ({
  type: 'we-form-field',
  props: { label, width: '100%' },
  children: [control],
});

const createModal: SchemaNode = formModal({
  open: { $: 'local.createTopicOpen' },
  close: { $setLocal: 'createTopicOpen', value: false },
  title: 'New topic',
  size: 'sm',
  localState: {
    topicName: { type: 'string', initial: '' },
    topicDescription: { type: 'string', initial: '' },
    topicIcon: { type: 'string', initial: 'hash' },
    topicColor: { type: 'string', initial: '' },
  },
  children: [
    field({
      name: 'topicName',
      label: 'Name',
      // A noun phrase, unlike a connection type's verb: a topic is the thing at the end of the edge
      // rather than the reading along it.
      placeholder: 'Roadmap, Hiring, The Berlin trip…',
    }),
    field({
      name: 'topicDescription',
      label: 'Description',
      control: 'textarea',
      // The useful description here draws a line rather than restating the name — it is what stops
      // two members filing the same conversation under different topics.
      placeholder: 'What counts as this topic, and what does not?',
      props: { rows: 2 },
    }),
    {
      type: 'Row',
      props: { gap: '300', width: '100%', wrap: true },
      children: [
        labelled('Icon', {
          type: 'we-icon-picker',
          props: {
            value: { $: 'local.topicIcon' },
            onChange: { $setLocal: 'topicIcon', value: { $: 'event.detail' } },
          },
        }),
        labelled('Colour', {
          type: 'we-color-picker',
          props: {
            value: { $: 'local.topicColor' },
            onChange: { $setLocal: 'topicColor', value: { $: 'event.detail' } },
          },
        }),
      ],
    },
  ],
  // Nothing about a name is locally judgeable beyond its presence — the same gate the connection
  // type modal uses, rather than dragging in the validation machinery for one field.
  disabled: { $: '!local.topicName' },
  // The typed fields only: the icon and colour start set, so including them would make the guard
  // fire on a form nobody has touched.
  discardWhen: { $: 'local.topicName || local.topicDescription' },
  submitLabel: 'Create',
  /*
    `record.create` rather than a store action. `createSignalType` and `createRelationshipType` exist
    because both derive a slug from the name; a topic has none — see the note on the entity — so
    there is nothing for an action to do that the generic write does not.
  */
  submit: {
    $action: 'record.create',
    args: [
      'Topic',
      {
        name: { $: 'local.topicName' },
        description: { $: 'local.topicDescription' },
        icon: { $: 'local.topicIcon' },
        color: { $: 'local.topicColor' },
      },
    ],
  },
});

/** One topic, as it will be read on a map: its icon and colour, its name, and where its line is. */
const topicRow: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', width: '100%', py: '300', borderBottom: '1px solid border' },
  children: [
    {
      type: 'we-icon',
      props: {
        name: { $: "topic.icon ? topic.icon : 'hash'" },
        color: { $: "topic.color ? topic.color : 'text-muted'" },
      },
    },
    {
      type: 'Column',
      props: { gap: '100', flex: '1' },
      children: [
        { type: 'we-text', props: { fontWeight: '600' }, children: [{ $: 'topic.name' }] },
        {
          type: '$if',
          props: {
            condition: { $: 'topic.description' },
            then: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted' },
              children: [{ $: 'topic.description' }],
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
        /*
          Removing a topic leaves the connections that pointed at it, exactly as removing a
          connection type leaves the connections that used it. Those relationships keep their label
          and lose their far end, which is the right degradation: deleting them here would delete
          claims people made because somebody tidied a vocabulary.
        */
        onClick: { $action: 'record.delete', args: ['Topic', { $: 'topic.id' }] },
      },
      children: [{ type: 'we-icon', props: { name: 'trash' } }],
    },
  ],
};

export const topicsSection: SchemaNode = sectionCard({
  title: 'Topics',
  description:
    'The subjects this community works on. Naming one lets content point at it, so a map can group by subject and you can find everything about one.',
  aside: {
    type: '$if',
    props: {
      condition: { $: 'space.canAdminister' },
      then: {
        type: 'we-button',
        props: { variant: 'secondary', size: 'sm', onClick: { $setLocal: 'createTopicOpen', value: true } },
        children: [
          { type: 'we-icon', props: { name: 'plus' } },
          { type: 'we-text', children: ['Add topic'] },
        ],
      },
    },
  },
  children: [
    {
      type: '$each',
      props: { items: { $query: { entity: 'Topic', order: { name: 'asc' }, subscribe: true } }, as: 'topic' },
      children: [topicRow],
    },
    // Carries its own `$if` — see `formModal`.
    createModal,
  ],
});
