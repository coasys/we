/**
 * Settings — Shell template for account settings
 *
 * Provides: template switching, theme switching, agent info, logout.
 */

import type { TemplateSchema } from '@we/schema-shared';

import { createSpaceModal } from '../DefaultTemplate/CreateSpaceModal';

export const settingsTemplate: TemplateSchema = {
  meta: { name: 'Settings', description: 'Account settings', icon: 'gear' },
  type: 'Column',
  props: { width: '100%', minHeight: '100%', bg: 'neutral-50', ax: 'center' },
  $localState: {
    createSpaceModalOpen: { type: 'boolean', initial: false },
  },
  children: [
    {
      type: 'Column',
      props: { px: '400', py: '800', gap: '600', maxWidth: '800px', width: '100%' },
      children: [
        // Header
        {
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'gear', size: 'md', color: 'neutral-500' } },
            { type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Settings'] },
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
                      props: { fontSize: '400', fontWeight: 'medium', color: 'neutral-500' },
                      children: ['DID'],
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '400', styles: { 'word-break': 'break-all' } },
                      children: [{ $store: 'adamStore.me.did' }],
                    },
                  ],
                },
              ],
            },
          ],
        },

        // Template Management
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            { type: 'we-text', props: { fontSize: '600', fontWeight: 'semibold' }, children: ['Templates'] },
            {
              type: 'Column',
              props: { gap: '100' },
              children: [
                {
                  type: '$each',
                  props: { items: { $store: 'templateStore.templateManagementList' }, as: 'template' },
                  children: [
                    {
                      type: 'Row',
                      props: {
                        gap: '300',
                        ay: 'center',
                        p: '300',
                        r: '200',
                        bg: {
                          $if: {
                            condition: '$template.isDefault',
                            then: 'neutral-100',
                            else: 'transparent',
                          },
                        },
                      },
                      children: [
                        // Template icon + name
                        {
                          type: 'Row',
                          props: { gap: '300', ay: 'center', styles: { flex: '1', 'min-width': '0' } },
                          children: [
                            { type: 'we-icon', props: { name: '$template.icon', size: '20px', color: 'neutral-500' } },
                            {
                              type: 'Column',
                              props: { gap: '50' },
                              children: [
                                {
                                  type: 'we-text',
                                  props: { fontSize: '400', fontWeight: 'medium' },
                                  children: ['$template.name'],
                                },
                                {
                                  type: '$if',
                                  props: {
                                    condition: '$template.description',
                                    then: {
                                      type: 'we-text',
                                      props: { fontSize: '300', color: 'neutral-400' },
                                      children: ['$template.description'],
                                    },
                                  },
                                },
                              ],
                            },
                          ],
                        },

                        // Core badge
                        {
                          type: '$if',
                          props: {
                            condition: '$template.isCore',
                            then: {
                              type: 'we-tag',
                              props: { variant: 'neutral' },
                              children: ['Core'],
                            },
                          },
                        },

                        // Install toggle (custom templates only)
                        {
                          type: '$if',
                          props: {
                            condition: { $not: '$template.isCore' },
                            then: {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                {
                                  type: 'we-text',
                                  props: { fontSize: '300', color: 'neutral-400' },
                                  children: ['Installed'],
                                },
                                {
                                  type: 'we-switch',
                                  props: {
                                    checked: '$template.isInstalled',
                                    size: 'sm',
                                    onChange: {
                                      $action: 'templateStore.toggleInstalled',
                                      args: ['$template.id'],
                                    },
                                  },
                                },
                              ],
                            },
                          },
                        },

                        // Default radio button (only shown if template is installed)
                        {
                          type: '$if',
                          props: {
                            condition: '$template.isInstalled',
                            then: {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                {
                                  type: 'we-text',
                                  props: { fontSize: '300', color: 'neutral-400' },
                                  children: ['Default'],
                                },
                                {
                                  type: 'we-radio',
                                  props: {
                                    checked: '$template.isDefault',
                                    name: 'default-template',
                                    value: '$template.id',
                                    onChange: {
                                      $action: 'templateStore.setDefaultTemplate',
                                      args: ['$template.id'],
                                    },
                                  },
                                },
                              ],
                            },
                          },
                        },

                        // Delete button (custom templates only)
                        {
                          type: '$if',
                          props: {
                            condition: { $not: '$template.isCore' },
                            then: {
                              type: 'we-button',
                              props: {
                                variant: 'ghost',
                                size: 'sm',
                                onClick: {
                                  $action: 'templateStore.deleteTemplate',
                                  args: ['$template.id'],
                                },
                              },
                              children: [
                                {
                                  type: 'we-icon',
                                  props: { name: 'trash', size: '16px', color: 'danger-400' },
                                },
                              ],
                            },
                          },
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

        // All Perspectives
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'intersect-three', color: 'neutral-500', size: '20px' } },
                {
                  type: 'we-text',
                  props: { fontSize: '600', fontWeight: 'semibold' },
                  children: ['All Perspectives'],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'adamStore.allPerspectives.length' },
                then: {
                  type: 'Column',
                  props: { gap: '300' },
                  children: [
                    {
                      type: '$each',
                      props: { items: { $store: 'adamStore.allPerspectives' }, as: 'perspective' },
                      children: [
                        {
                          type: 'Column',
                          props: {
                            p: '400',
                            r: '400',
                            ax: 'start',
                            bg: 'neutral-50',
                            gap: '300',
                            border: '1px solid neutral-200',
                          },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                {
                                  type: 'we-icon',
                                  props: {
                                    name: {
                                      $if: { condition: '$perspective.sharedUrl', then: 'globe', else: 'folder' },
                                    },
                                    color: 'neutral-400',
                                    size: '16px',
                                  },
                                },
                                {
                                  type: 'we-text',
                                  props: { fontSize: '400', fontWeight: 'medium' },
                                  children: ['$perspective.name'],
                                },
                              ],
                            },
                            {
                              type: 'we-text',
                              props: { fontSize: '400', color: 'neutral-500' },
                              children: [{ $concat: ['UUID: ', '$perspective.uuid'] }],
                            },
                            {
                              type: 'we-text',
                              props: { fontSize: '400', color: 'neutral-500' },
                              children: [{ $concat: ['URL: ', '$perspective.sharedUrl'] }],
                            },
                            {
                              type: 'we-button',
                              props: {
                                variant: 'danger',
                                size: 'sm',
                                onClick: { $action: 'adamStore.removePerspective', args: ['$perspective.uuid'] },
                              },
                              children: [
                                { type: 'we-icon', props: { name: 'trash', size: '16px' } },
                                {
                                  type: 'we-text',
                                  props: { fontSize: '300' },
                                  children: ['Delete'],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                else: {
                  type: 'we-text',
                  props: { fontSize: '300', color: 'neutral-400', italic: true },
                  children: ['No perspectives yet'],
                },
              },
            },
          ],
        },

        // Shared Spaces
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'globe', color: 'primary-500', size: '20px' } },
                { type: 'we-text', props: { fontSize: '600', fontWeight: 'semibold' }, children: ['Shared Spaces'] },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'adamStore.sharedSpaces.length' },
                then: {
                  type: 'Row',
                  props: { gap: '300', wrap: true },
                  children: [
                    {
                      type: '$each',
                      props: { items: { $store: 'adamStore.sharedSpaces' }, as: 'space' },
                      children: [
                        {
                          type: 'Column',
                          props: {
                            p: '400',
                            r: '400',
                            bg: 'neutral-50',
                            gap: '200',
                            width: '200px',
                            cursor: 'pointer',
                            onClick: { $action: 'spaceStore.navigateToSpace', args: ['$space.uuid'] },
                          },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                { type: 'we-icon', props: { name: 'globe', color: 'primary-400', size: '16px' } },
                                {
                                  type: 'we-text',
                                  props: { fontSize: '400', fontWeight: 'medium' },
                                  children: ['$space.name'],
                                },
                              ],
                            },
                            {
                              type: 'we-text',
                              props: { fontSize: '300', color: 'neutral-400' },
                              children: ['$space.description'],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                else: {
                  type: 'we-text',
                  props: { fontSize: '300', color: 'neutral-400', italic: true },
                  children: ['No shared spaces yet'],
                },
              },
            },
          ],
        },

        // Personal Spaces
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'folder', color: 'primary-500', size: '20px' } },
                {
                  type: 'we-text',
                  props: { fontSize: '600', fontWeight: 'semibold' },
                  children: ['Personal Spaces'],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'adamStore.personalSpaces.length' },
                then: {
                  type: 'Row',
                  props: { gap: '300', wrap: true },
                  children: [
                    {
                      type: '$each',
                      props: { items: { $store: 'adamStore.personalSpaces' }, as: 'space' },
                      children: [
                        {
                          type: 'Column',
                          props: {
                            p: '400',
                            r: '400',
                            bg: 'neutral-50',
                            gap: '200',
                            width: '200px',
                            cursor: 'pointer',
                            onClick: {
                              $action: 'spaceStore.navigateToSpace',
                              args: [{ $if: { condition: '$space.url', then: '$space.url', else: '$space.uuid' } }],
                            },
                          },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                { type: 'we-icon', props: { name: 'folder', color: 'primary-400', size: '16px' } },
                                {
                                  type: 'we-text',
                                  props: { fontSize: '400', fontWeight: 'medium' },
                                  children: ['$space.name'],
                                },
                              ],
                            },
                            {
                              type: 'we-text',
                              props: { fontSize: '300', color: 'neutral-400' },
                              children: ['$space.description'],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                else: {
                  type: 'we-text',
                  props: { fontSize: '300', color: 'neutral-400', italic: true },
                  children: ['No personal spaces yet'],
                },
              },
            },
          ],
        },

        {
          type: 'we-button',
          props: {
            text: 'Create New Space',
            variant: 'primary',
            height: '40px',
            onClick: { $setLocal: 'createSpaceModalOpen', value: true },
          },
        },

        {
          type: '$if',
          props: { condition: { $local: 'createSpaceModalOpen' }, then: createSpaceModal },
        },
      ],
    },
  ],
};
