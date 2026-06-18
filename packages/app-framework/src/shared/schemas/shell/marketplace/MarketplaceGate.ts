import type { SchemaNode } from '@we/schema-shared';

const notConfiguredPrompt: SchemaNode = {
  type: 'Column',
  props: { flex: '1', height: '100%', ax: 'center', ay: 'center', gap: '400', p: '600' },
  children: [
    { type: 'we-icon', props: { name: 'warning', size: 'xl', color: 'neutral-400' } },
    {
      type: 'we-text',
      props: { fontSize: '700', fontWeight: 'bold' },
      children: ['Marketplace not configured'],
    },
    {
      type: 'we-text',
      props: { fontSize: '400', color: 'neutral-500', textAlign: 'center', maxWidth: '400px' },
      children: ['No marketplace URL has been set in we-seed.json.'],
    },
  ],
};

const joinPrompt: SchemaNode = {
  type: 'Column',
  props: { flex: '1', height: '100%', ax: 'center', ay: 'center', gap: '400', p: '600' },
  children: [
    { type: 'we-icon', props: { name: 'storefront', size: 'xl', color: 'primary-500' } },
    {
      type: 'we-text',
      props: { fontSize: '700', fontWeight: 'bold', textAlign: 'center' },
      children: ['Module Marketplace'],
    },
    {
      type: 'we-text',
      props: { fontSize: '400', color: 'neutral-500', textAlign: 'center', maxWidth: '420px' },
      children: [
        'Browse and install templates, themes, blocks, and components shared by the WE community.',
      ],
    },
    {
      type: 'we-button',
      props: {
        variant: 'primary',
        onClick: {
          $action: 'adamStore.joinSpace',
          args: [{ $store: 'adamStore.marketplaceId' }],
        },
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
