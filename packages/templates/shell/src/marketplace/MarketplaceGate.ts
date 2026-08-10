import type { SchemaNode } from '@we/schema-shared';
import { gatePrompt } from '@we/template-kit';

/*
  A dead end rather than an invitation, and it says so before it is read: a flat warning icon
  instead of the gradient the join prompt carries. Nothing the reader does here changes it — the
  seed file is not theirs to edit from inside the app.
*/
const notConfiguredPrompt: SchemaNode = gatePrompt({
  icon: 'warning',
  title: 'Marketplace not configured',
  body: 'No marketplace URL has been set in we-seed.json.',
});

const joinPrompt: SchemaNode = gatePrompt({
  icon: 'storefront',
  iconGradient: 'primary',
  title: 'Module Marketplace',
  body: 'Browse and install templates, themes, blocks, and components shared by the WE community.',
  bodyWidth: '420px',
  children: [
    {
      type: 'we-button',
      $localState: { joining: { type: 'boolean', initial: false } },
      props: {
        variant: 'primary',
        loading: { $local: 'joining' },
        disabled: { $local: 'joining' },
        onClick: [
          { $setLocal: 'joining', value: true },
          {
            // `joinSpace` would focus the marketplace's dataset as part of joining, so exploring it
            // silently moved you out of the space you were in — while still looking like an overlay
            // over that space. The marketplace's own routes name `datasetStore.marketplaceDataset`
            // explicitly, so it never needed to be the current one.
            $action: 'spaceStore.joinSpace',
            args: [{ $store: 'datasetStore.marketplaceId' }, false],
            onFinally: [{ $setLocal: 'joining', value: false }],
          },
        ],
      },
      children: ['Explore Marketplace'],
    },
  ],
});

export const marketplaceGate: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'datasetStore.marketplaceConfigured' },
    then: joinPrompt,
    else: notConfiguredPrompt,
  },
};
