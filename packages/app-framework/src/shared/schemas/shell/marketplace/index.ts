import type { TemplateSchema } from '@we/schema-shared';

import { marketplaceGate } from './MarketplaceGate';
import { blocksRoute } from './routes/BlocksRoute';
import { componentsRoute } from './routes/ComponentsRoute';
import { templatesRoute } from './routes/TemplatesRoute';
import { themesRoute } from './routes/ThemesRoute';

const tabs = [
  { key: '', label: 'Templates', path: '/' },
  { key: 'themes', label: 'Themes', path: '/themes' },
  { key: 'blocks', label: 'Blocks', path: '/blocks' },
  { key: 'components', label: 'Components', path: '/components' },
];

const tabBar = {
  type: 'we-tabs',
  props: {
    selectedKey: { $store: 'routeStore.segments.0' },
  },
  children: tabs.map((tab) => ({
    type: 'we-tab',
    props: {
      key: tab.key,
      label: tab.label,
      onClick: { $action: 'routeStore.navigate', args: [tab.path] },
    },
  })),
};

const marketplaceBrowser = {
  type: 'Column',
  props: { width: '100%', minHeight: '100%' },
  children: [
    // Header
    {
      type: 'Column',
      props: { px: '500', pt: '600', pb: '400', gap: '100', borderBottom: '1px solid neutral-200', bg: 'neutral-50' },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center', mb: '300' },
          children: [
            { type: 'we-icon', props: { name: 'storefront', size: 'md', color: 'primary-500' } },
            {
              type: 'we-text',
              props: { fontSize: '700', fontWeight: 'bold' },
              children: ['Module Marketplace'],
            },
          ],
        },
        {
          type: 'we-text',
          props: { fontSize: '400', color: 'neutral-500', mb: '300' },
          children: ['Browse and install community modules for your WE spaces.'],
        },
        tabBar,
      ],
    },

    // Route content
    { type: '$routes' },
  ],
};

export const marketplaceTemplate: TemplateSchema = {
  meta: { name: 'Module Marketplace', description: 'Browse and install community modules', icon: 'storefront' },
  type: 'Column',
  props: { width: '100%', minHeight: '100%', bg: 'neutral-50' },
  routes: [
    { path: '/', ...templatesRoute },
    { path: '/themes', ...themesRoute },
    { path: '/blocks', ...blocksRoute },
    { path: '/components', ...componentsRoute },
  ],
  children: [
    {
      type: '$if',
      props: {
        condition: { $store: 'adamStore.marketplaceJoined' },
        then: marketplaceBrowser,
        else: marketplaceGate,
      },
    },
  ],
};
