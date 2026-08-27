import type { SchemaNode } from '@we/schema-shared';
import { sectionCard } from '@we/template-kit';

import { createSignalTypeModal } from './vocabulary/CreateSignalTypeModal.ts';
import { modelsSection } from './vocabulary/ModelsSection.ts';
import { relationshipTypesSection } from './vocabulary/RelationshipTypesSection.ts';
import { signalTypeCard } from './vocabulary/SignalTypeCard.ts';

/**
 * What this community has decided things mean — its reactions, its connections, and its models.
 *
 * The three are one act at different levels: naming what a reaction means, what a connection means,
 * and what a thing *is*. They sat together in the default template's settings route and they stay
 * together here, because a community reasoning about its own vocabulary is reasoning about all three
 * at once.
 *
 * ## Why this section, alone, needs the space open
 *
 * Everything else on this page writes through an action that takes a space uuid, so it configures
 * whichever row you clicked. Vocabulary is read with `$query` and `shapeStore`, and both resolve
 * against the *current dataset* — there is no way to ask "the signal types of that other space"
 * without holding its dataset open, which joining does and clicking a row does not.
 *
 * So rather than pretend, it says so and offers the one thing that would fix it. Hiding the section
 * would be worse: a community that defined signal types in one space and cannot find them from
 * another has no way to tell a missing feature from a missing space.
 */
const openSpaceFirst: SchemaNode = {
  type: 'Column',
  props: { gap: '300', p: '400', bg: 'surface-sunken', r: '300', border: '1px solid border' },
  children: [
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: ['Vocabulary'] },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
          children: [
            'Signals, relationships and models are read from the space itself, so this one has to be open to edit them.',
          ],
        },
      ],
    },
    {
      type: 'we-button',
      props: {
        variant: 'secondary',
        size: 'sm',
        alignSelf: 'start',
        onClick: { $action: 'spaceStore.navigateToSpace', args: ['$space.uuid'] },
      },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: ['Open this space'] },
        { type: 'we-icon', props: { name: 'arrow-right' } },
      ],
    },
  ],
};

const signalTypesSection: SchemaNode = sectionCard({
  title: 'Signal types',
  description: 'What a reaction means here — a like, a vote, a rating, whatever this community counts.',
  aside: {
    type: '$if',
    props: {
      condition: '$space.canAdminister',
      then: {
        type: 'we-button',
        props: { variant: 'secondary', size: 'sm', onClick: { $setLocal: 'createSignalTypeOpen', value: true } },
        children: [
          { type: 'we-icon', props: { name: 'plus' } },
          { type: 'we-text', children: ['Add signal type'] },
        ],
      },
    },
  },
  children: [
    {
      type: '$each',
      props: { items: { $query: { entity: 'SignalType', subscribe: true } }, as: 'signalType' },
      children: [signalTypeCard],
    },
    // Carries its own `$if` — see `formModal`.
    createSignalTypeModal,
  ],
});

export const spaceVocabularySection: SchemaNode = {
  type: '$if',
  props: {
    // The row being configured is the dataset currently open. Anything else cannot be queried from
    // here — see the docblock.
    condition: { $eq: ['$space.uuid', { $store: 'datasetStore.currentDataset.id' }] },
    then: {
      type: 'Column',
      props: { gap: '400' },
      $localState: {
        createSignalTypeOpen: { type: 'boolean', initial: false },
        createRelationshipTypeOpen: { type: 'boolean', initial: false },
      },
      children: [signalTypesSection, relationshipTypesSection, modelsSection],
    },
    else: openSpaceFirst,
  },
};
