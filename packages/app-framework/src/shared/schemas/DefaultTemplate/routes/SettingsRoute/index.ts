import type { RouteSchema, SchemaNode } from '@we/schema-shared';

import { marketplaceBrowser } from './MarketplaceBrowser.ts';

const templateRow: SchemaNode = {
  type: 'Row',
  props: {
    ay: 'center',
    ax: 'between',
    p: '300',
    r: '300',
    border: '1px solid neutral-200',
    bg: {
      $if: {
        condition: { $eq: ['$template.id', { $store: 'spaceStore.spaceDefaultTemplateId' }] },
        then: 'primary-50',
        else: 'neutral-0',
      },
    },
  },
  children: [
    {
      type: 'Row',
      props: { ay: 'center', gap: '300' },
      children: [
        { type: 'we-icon', props: { name: '$template.meta.icon' } },
        { type: 'we-text', props: { fontWeight: '600' }, children: ['$template.meta.name'] },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $eq: ['$template.id', { $store: 'spaceStore.spaceDefaultTemplateId' }] },
        then: {
          type: 'we-badge',
          props: { variant: 'primary' },
          children: ['Default'],
        },
        else: {
          type: 'we-button',
          props: {
            variant: 'secondary',
            size: 'sm',
            onClick: { $action: 'spaceStore.setSpaceDefaultTemplate', args: ['$template.id'] },
          },
          children: ['Set as default'],
        },
      },
    },
  ],
};

export const settingsRoute: RouteSchema = {
  path: '/settings',
  type: 'Column',
  props: { width: '100%', ax: 'center', height: 'calc(100vh - 72px)' },
  $localState: {
    showMarketplace: { type: 'boolean', initial: false },
  },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: '1200px', gap: '500', px: '400', pt: '500' },
      children: [
        // ─── Default Template ───────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '400', p: '500', bg: 'neutral-100', r: '400', border: '1px solid neutral-200' },
          children: [
            {
              type: 'Column',
              props: { gap: '100' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '700', fontWeight: 'bold', color: 'primary-700' },
                  children: ['Default Template'],
                },
                {
                  type: 'we-text',
                  props: { color: 'neutral-600' },
                  children: ['Choose the template members see when they enter this space.'],
                },
              ],
            },

            // Core templates
            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '400', fontWeight: '600', color: 'neutral-500' },
                  children: ['CORE TEMPLATES'],
                },
                {
                  type: '$each',
                  props: { items: { $store: 'templateStore.coreTemplates' }, as: 'template' },
                  children: [templateRow],
                },
              ],
            },

            // Space templates (saved directly to this space)
            {
              type: '$if',
              props: {
                condition: {
                  $gt: [{ $count: { items: { $store: 'templateStore.spaceTemplates' } } }, 0],
                },
                then: {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '400', fontWeight: '600', color: 'neutral-500' },
                      children: ['SPACE TEMPLATES'],
                    },
                    {
                      type: '$each',
                      props: { items: { $store: 'templateStore.spaceTemplates' }, as: 'template' },
                      children: [templateRow],
                    },
                  ],
                },
              },
            },
          ],
        },

        // ─── Browse Marketplace ─────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '400', p: '500', bg: 'neutral-100', r: '400', border: '1px solid neutral-200' },
          children: [
            {
              type: 'Row',
              props: { ax: 'between', ay: 'center' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '700', fontWeight: 'bold', color: 'primary-700' },
                      children: ['Browse Marketplace'],
                    },
                    {
                      type: 'we-text',
                      props: { color: 'neutral-600' },
                      children: ['Install templates from the marketplace directly into this space.'],
                    },
                  ],
                },
                {
                  type: 'we-button',
                  props: {
                    variant: 'secondary',
                    size: 'sm',
                    onClick: { $toggleLocal: 'showMarketplace' },
                  },
                  children: [
                    {
                      type: '$if',
                      props: {
                        condition: { $local: 'showMarketplace' },
                        then: { type: 'we-text', children: ['Hide'] },
                        else: { type: 'we-text', children: ['Browse'] },
                      },
                    },
                  ],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $local: 'showMarketplace' },
                then: marketplaceBrowser,
              },
            },
          ],
        },
      ],
    },
  ],
};
