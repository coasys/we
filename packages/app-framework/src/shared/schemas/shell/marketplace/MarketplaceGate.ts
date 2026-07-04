import type { SchemaNode } from '@we/schema-shared';

const notConfiguredPrompt: SchemaNode = {
  type: 'Column',
  props: { flex: '1', height: '100%', ax: 'center', ay: 'center', gap: '400', p: '600' },
  children: [
    { type: 'we-icon', props: { name: 'warning', size: 'xl' } },
    {
      type: 'we-text',
      props: { variant: 'heading-md' },
      children: ['Marketplace not configured'],
    },
    {
      type: 'we-text',
      props: { variant: 'body', textAlign: 'center', maxWidth: '400px' },
      children: ['No marketplace URL has been set in we-seed.json.'],
    },
  ],
};

const joinPrompt: SchemaNode = {
  type: 'Column',
  props: { flex: '1', height: '100%', ax: 'center', ay: 'center', gap: '400', p: '600' },
  children: [
    { type: 'we-icon', props: { name: 'storefront', size: 'xl', gradient: 'primary' } },
    {
      type: 'we-text',
      props: { variant: 'heading-md', textAlign: 'center' },
      children: ['Module Marketplace'],
    },
    {
      type: 'we-text',
      props: { variant: 'body', textAlign: 'center', maxWidth: '420px' },
      children: ['Browse and install templates, themes, blocks, and components shared by the WE community.'],
    },
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
            $action: 'adamStore.joinSpace',
            args: [{ $store: 'adamStore.marketplaceId' }],
            onFinally: [{ $setLocal: 'joining', value: false }],
          },
        ],
      },
      children: ['Explore Marketplace'],
    },
  ],
};

export const marketplaceGate: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'adamStore.marketplaceConfigured' },
    then: joinPrompt,
    else: notConfiguredPrompt,
  },
};
