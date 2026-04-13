/**
 * Settings — Shell template for account settings
 *
 * Provides: template switching, theme switching, agent info, logout.
 */

import type { TemplateSchema } from '@we/schema-shared';

export const settingsTemplate: TemplateSchema = {
  meta: { name: 'Settings', description: 'Account settings', icon: 'gear' },
  type: 'Column',
  props: {
    p: '600',
    gap: '600',
    mx: 'auto',
    width: '100%',
    overflow: 'auto',
    height: '100%',
    bg: 'neutral-50',
  },
  children: [
    // Header
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', ax: 'between' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'gear', size: '24px', color: 'neutral-500' } },
            { type: 'we-text', props: { fontSize: '800', fontWeight: 'bold' }, children: ['Settings'] },
          ],
        },
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            onClick: { $action: 'templateStore.switchTemplate', args: ['default'] },
          },
          children: [{ type: 'we-icon', props: { name: 'x', size: '20px' } }],
        },
      ],
    },

    // Agent Info
    {
      type: 'Column',
      props: { gap: '300' },
      children: [
        { type: 'we-text', props: { fontSize: '600', fontWeight: 'semibold' }, children: ['Agent'] },
        {
          type: 'Column',
          props: { gap: '200', p: '400', r: '300', bg: 'neutral-100' },
          children: [
            {
              type: 'Row',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '300', fontWeight: 'medium', color: 'neutral-500' },
                  children: ['DID'],
                },
                {
                  type: 'we-text',
                  props: { fontSize: '300', fontFamily: 'mono', styles: { 'word-break': 'break-all' } },
                  children: [{ $store: 'adamStore.me.did' }],
                },
              ],
            },
          ],
        },
      ],
    },

    // Template Selection
    {
      type: 'Column',
      props: { gap: '300' },
      children: [
        { type: 'we-text', props: { fontSize: '600', fontWeight: 'semibold' }, children: ['Template'] },
        {
          type: 'Column',
          props: { gap: '200' },
          children: [
            {
              type: '$each',
              props: { items: { $store: 'templateStore.templates' }, as: 'template' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: {
                      $if: {
                        condition: { $eq: ['$template.id', { $store: 'templateStore.currentTemplate.id' }] },
                        then: 'secondary',
                        else: 'ghost',
                      },
                    },
                    width: '100%',
                    gap: '300',
                    ax: 'start',
                    onClick: { $action: 'templateStore.switchTemplate', args: ['$template.id'] },
                  },
                  children: [
                    { type: 'we-icon', props: { name: '$template.meta.icon', size: '20px' } },
                    {
                      type: 'Column',
                      props: { gap: '100' },
                      children: [
                        {
                          type: 'we-text',
                          props: { fontSize: '400', fontWeight: 'medium' },
                          children: ['$template.meta.name'],
                        },
                        {
                          type: 'we-text',
                          props: { fontSize: '300', color: 'neutral-400' },
                          children: ['$template.meta.description'],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },

    // Theme Selection
    {
      type: 'Column',
      props: { gap: '300' },
      children: [
        { type: 'we-text', props: { fontSize: '600', fontWeight: 'semibold' }, children: ['Theme'] },
        {
          type: 'Row',
          props: { gap: '200', wrap: true },
          children: [
            {
              type: '$each',
              props: { items: { $store: 'themeStore.themes' }, as: 'theme' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: {
                      $if: {
                        condition: { $eq: ['$theme.id', { $store: 'themeStore.currentTheme.id' }] },
                        then: 'primary',
                        else: 'secondary',
                      },
                    },
                    gap: '200',
                    onClick: { $action: 'themeStore.setCurrentTheme', args: ['$theme.id'] },
                  },
                  children: [
                    { type: 'we-icon', props: { name: '$theme.icon', size: '18px' } },
                    { type: 'we-text', props: { fontSize: '400' }, children: ['$theme.name'] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },

    // Danger Zone
    {
      type: 'Column',
      props: { gap: '300', mt: '400' },
      children: [
        {
          type: 'we-text',
          props: { fontSize: '600', fontWeight: 'semibold', color: 'danger-500' },
          children: ['Danger Zone'],
        },
        {
          type: 'we-button',
          props: {
            variant: 'danger',
            text: 'Logout',
            onClick: { $action: 'adamStore.logout' },
          },
        },
      ],
    },
  ],
};
