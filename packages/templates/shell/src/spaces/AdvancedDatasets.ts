import type { SchemaNode } from '@we/schema-shared';
import { expr } from '@we/schema-shared';
import { confirmModal } from '@we/template-kit';

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
const isSystem = { $: 'dataset.id in datasetStore.systemDatasetUuids' };

/** `we-root` specifically — deleting it takes settings, preferences and installed templates/themes. */
const isRoot = { $: 'dataset.id == datasetStore.rootDataset.id' };

const datasetCard: SchemaNode = {
  type: 'Column',
  props: { gap: '200', p: '300', bg: 'surface-sunken', r: '300', border: '1px solid border' },
  $localState: {
    sdnaCleanupResult: { type: 'string', initial: '' },
    confirmDeleteOpen: { type: 'boolean', initial: false },
    deleting: { type: 'boolean', initial: false },
  },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', wrap: true },
      children: [
        {
          type: 'we-icon',
          props: {
            name: expr`${isSystem} ? 'hard-drives' : (dataset.sharedUri ? 'globe' : 'folder')`,
            size: '16px',
          },
        },
        { type: 'we-text', props: { variant: 'label' }, children: [{ $: 'dataset.name' }] },
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
      props: { variant: 'footnote', color: 'text-faint' },
      children: [{ $: '`ID: ${dataset.id}`' }],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'dataset.sharedUri' },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
          children: [{ $: '`URL: ${dataset.sharedUri}`' }],
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
              args: [{ $: 'dataset.id' }],
              onSuccess: [{ $setLocal: 'sdnaCleanupResult', value: { $: 'result' } }],
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
            onClick: { $setLocal: 'confirmDeleteOpen', value: true },
          },
          children: [
            { type: 'we-icon', props: { name: 'trash' } },
            { type: 'we-text', props: { variant: 'label' }, children: ['Delete'] },
          ],
        },
        /*
          The one delete in the app that can take everything, and it had no confirmation at all.

          `spaceStore.removeSpace` is wired straight through `DatasetStore.removeDataset` to
          `client.perspective.remove`, and this section lists the **system** datasets alongside the
          rest — so one tap on the `we-root` row destroys the agent's settings, installed templates
          and themes, Pocket and profile cache together. The sibling delete in the spaces list, which
          can only remove one community, asked first; this one did not.

          Chrome, so the host's own destructive guard does not cover it: that one stands in front of
          *space templates*, which is the tier nobody in this repo authored. Chrome asks for itself.

          The body changes for the root dataset rather than adding a second dialog. A footnote under
          the row already says what `we-root` is, and a footnote is exactly what a person about to
          press Delete is not reading.
        */
        confirmModal({
          open: { $: 'local.confirmDeleteOpen' },
          close: { $setLocal: 'confirmDeleteOpen', value: false },
          title: expr`${isRoot} ? 'Delete your root dataset?' : \`Delete "\${dataset.name}"?\``,
          body: expr`${isRoot}
            ? 'This holds your settings, your installed templates and themes, your Pocket and your cached profiles. Deleting it resets this agent to a clean install. It cannot be undone.'
            : 'The dataset and everything stored in it are removed from this device. If it is shared, other members keep their own copies. This cannot be undone.'`,
          detail: { $: '`ID: ${dataset.id}`' },
          confirmLabel: 'Delete',
          busyLocal: 'deleting',
          confirm: { $action: 'spaceStore.removeSpace', args: [{ $: 'dataset.id' }] },
        }),
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
          props: { variant: 'footnote', color: 'danger-text' },
          children: [
            'Deleting this removes your agent settings, per-space preferences, and every installed template and theme. No space is removed with it.',
          ],
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: 'local.sdnaCleanupResult' },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
          children: [{ $: 'local.sdnaCleanupResult' }],
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
          props: { name: { $: "local.advancedOpen ? 'caret-down' : 'caret-right'" } },
        },
        { type: 'we-text', props: { variant: 'label' }, children: ['Advanced — all datasets'] },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'local.advancedOpen' },
        then: {
          type: 'Column',
          props: { gap: '200' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: ['Raw storage, including the datasets the app keeps for itself.'],
            },
            {
              type: '$each',
              props: { items: { $: 'datasetStore.datasets' }, as: 'dataset' },
              children: [datasetCard],
            },
          ],
        },
      },
    },
  ],
};
