import type { SchemaNode } from '@we/schema-shared';

/**
 * Every dataset this agent holds, as datasets rather than as spaces — ids, share URIs, and the two
 * destructive tools.
 *
 * Collapsed by default and separated from the spaces list because the subject differs. The list
 * above is about communities; this is about storage. It also keeps hard delete from sitting one
 * mis-click away from a settings gear.
 *
 * **Includes the system datasets** (`we-root`, `we-test`), which the spaces list drops. Hiding them
 * from the one surface whose whole purpose is to show everything held would reproduce the problem
 * this section exists to solve: a dataset you cannot see is a dataset you cannot reason about when
 * something is wrong.
 */

/** True when this dataset is one the app made for itself rather than one the agent joined. */
const isSystem = { $in: ['$dataset.id', { $store: 'datasetStore.systemDatasetUuids' }] };

/** `we-root` specifically — deleting it takes settings, preferences and installed templates/themes. */
const isRoot = { $eq: ['$dataset.id', { $store: 'datasetStore.rootDataset.id' }] };

const datasetCard: SchemaNode = {
  type: 'Column',
  props: { gap: '200', p: '300', bg: 'neutral-0', r: '300', border: '1px solid neutral-200' },
  $localState: { sdnaCleanupResult: { type: 'string', initial: '' } },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', wrap: true },
      children: [
        {
          type: 'we-icon',
          props: {
            name: {
              $if: {
                condition: isSystem,
                then: 'hard-drives',
                else: { $if: { condition: '$dataset.sharedUri', then: 'globe', else: 'folder' } },
              },
            },
            size: '16px',
          },
        },
        { type: 'we-text', props: { variant: 'label' }, children: ['$dataset.name'] },
        {
          type: '$if',
          props: {
            condition: isSystem,
            then: { type: 'we-badge', props: { size: 'sm' }, children: ['System'] },
          },
        },
      ],
    },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'neutral-400' },
      children: [{ $concat: ['ID: ', '$dataset.id'] }],
    },
    {
      type: '$if',
      props: {
        condition: '$dataset.sharedUri',
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'neutral-400' },
          children: [{ $concat: ['URL: ', '$dataset.sharedUri'] }],
        },
      },
    },
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', wrap: true },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'secondary',
            size: 'sm',
            onClick: {
              $action: 'datasetStore.cleanupSpaceSdna',
              args: ['$dataset.id'],
              onSuccess: [{ $setLocal: 'sdnaCleanupResult', from: '$result' }],
            },
          },
          children: [
            { type: 'we-icon', props: { name: 'broom' } },
            { type: 'we-text', props: { variant: 'label' }, children: ['Clean up duplicate schema'] },
          ],
        },
        {
          type: 'we-button',
          props: {
            variant: 'danger',
            size: 'sm',
            onClick: { $action: 'spaceStore.removeSpace', args: ['$dataset.id'] },
          },
          children: [
            { type: 'we-icon', props: { name: 'trash' } },
            { type: 'we-text', props: { variant: 'label' }, children: ['Delete'] },
          ],
        },
      ],
    },
    // Deleting we-root is deliberately allowed — resetting to a clean agent is a thing worth being
    // able to do while testing. It is named rather than blocked, because what it costs is not
    // guessable from "Delete" on a dataset that holds no space.
    {
      type: '$if',
      props: {
        condition: isRoot,
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'danger-600' },
          children: [
            'Deleting this removes your agent settings, per-space preferences, and every installed template and theme. No space is removed with it.',
          ],
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $local: 'sdnaCleanupResult' },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'neutral-400' },
          children: [{ $local: 'sdnaCleanupResult' }],
        },
      },
    },
  ],
};

export const advancedDatasetsSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  $localState: { advancedOpen: { type: 'boolean', initial: false } },
  children: [
    {
      type: 'we-button',
      props: { variant: 'ghost', ax: 'start', width: '100%', onClick: { $toggleLocal: 'advancedOpen' } },
      children: [
        {
          type: 'we-icon',
          props: { name: { $if: { condition: { $local: 'advancedOpen' }, then: 'caret-down', else: 'caret-right' } } },
        },
        { type: 'we-text', props: { variant: 'label' }, children: ['Advanced — all datasets'] },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $local: 'advancedOpen' },
        then: {
          type: 'Column',
          props: { gap: '200' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'neutral-400' },
              children: ['Raw storage, including the datasets the app keeps for itself.'],
            },
            {
              type: '$each',
              props: { items: { $store: 'datasetStore.datasets' }, as: 'dataset' },
              children: [datasetCard],
            },
          ],
        },
      },
    },
  ],
};
