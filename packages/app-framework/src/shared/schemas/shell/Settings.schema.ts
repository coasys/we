/**
 * Settings — Shell template for account settings
 *
 * Provides: template switching, theme switching, agent info, logout.
 */

import type { TemplateSchema } from '@we/schema-shared';

import { createSpaceModal } from '../DefaultTemplate/CreateSpaceModal.ts';

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
            { type: 'we-icon', props: { name: 'gear', size: 'md' } },
            { type: 'we-text', props: { variant: 'heading-md' }, children: ['Settings'] },
          ],
        },

        // Agent Info
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Agent'] },
            {
              type: 'Card',
              props: { bg: 'neutral-100' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '200' },
                  children: [
                    {
                      type: 'we-text',
                      props: { variant: 'body', fontWeight: 'medium' },
                      children: ['DID'],
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'body', styles: { 'word-break': 'break-all' } },
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
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Templates'] },
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
                            { type: 'we-icon', props: { name: '$template.icon', size: '20px' } },
                            {
                              type: 'Column',
                              props: { gap: '50' },
                              children: [
                                {
                                  type: 'we-text',
                                  props: { variant: 'body', fontWeight: 'medium' },
                                  children: ['$template.name'],
                                },
                                {
                                  type: '$if',
                                  props: {
                                    condition: '$template.description',
                                    then: {
                                      type: 'we-text',
                                      props: { variant: 'label' },
                                      children: ['$template.description'],
                                    },
                                  },
                                },
                              ],
                            },
                          ],
                        },

                        // Built-in badge
                        {
                          type: '$if',
                          props: {
                            condition: '$template.isBuiltIn',
                            then: {
                              type: 'we-tag',
                              props: { variant: 'neutral' },
                              children: ['Built-in'],
                            },
                          },
                        },

                        // Install toggle (custom templates only)
                        {
                          type: '$if',
                          props: {
                            condition: { $not: '$template.isBuiltIn' },
                            then: {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                {
                                  type: 'we-text',
                                  props: { variant: 'label' },
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
                                  props: { variant: 'label' },
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
                            condition: { $not: '$template.isBuiltIn' },
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

        // Theme Management
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Themes'] },
            {
              type: 'Column',
              props: { gap: '100' },
              children: [
                {
                  type: '$each',
                  props: { items: { $store: 'themeStore.themeManagementList' }, as: 'theme' },
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
                            condition: '$theme.isDefault',
                            then: 'neutral-100',
                            else: 'transparent',
                          },
                        },
                      },
                      children: [
                        // Theme icon + name
                        {
                          type: 'Row',
                          props: { gap: '300', ay: 'center', styles: { flex: '1', 'min-width': '0' } },
                          children: [
                            { type: 'we-icon', props: { name: '$theme.icon', size: '20px' } },
                            {
                              type: 'we-text',
                              props: { variant: 'body', fontWeight: 'medium' },
                              children: ['$theme.name'],
                            },
                          ],
                        },

                        // Built-in badge
                        {
                          type: '$if',
                          props: {
                            condition: '$theme.isBuiltIn',
                            then: {
                              type: 'we-tag',
                              props: { variant: 'neutral' },
                              children: ['Built-in'],
                            },
                          },
                        },

                        // Install toggle (custom themes only)
                        {
                          type: '$if',
                          props: {
                            condition: { $not: '$theme.isBuiltIn' },
                            then: {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                {
                                  type: 'we-text',
                                  props: { variant: 'label' },
                                  children: ['Installed'],
                                },
                                {
                                  type: 'we-switch',
                                  props: {
                                    checked: '$theme.isInstalled',
                                    size: 'sm',
                                    onChange: {
                                      $action: 'themeStore.toggleThemeInstalled',
                                      args: ['$theme.id'],
                                    },
                                  },
                                },
                              ],
                            },
                          },
                        },

                        // Default radio button (only shown if theme is installed)
                        {
                          type: '$if',
                          props: {
                            condition: '$theme.isInstalled',
                            then: {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                {
                                  type: 'we-text',
                                  props: { variant: 'label' },
                                  children: ['Default'],
                                },
                                {
                                  type: 'we-radio',
                                  props: {
                                    checked: '$theme.isDefault',
                                    name: 'default-theme',
                                    value: '$theme.id',
                                    onChange: {
                                      $action: 'themeStore.setDefaultTheme',
                                      args: ['$theme.id'],
                                    },
                                  },
                                },
                              ],
                            },
                          },
                        },

                        // Delete button (custom themes only)
                        {
                          type: '$if',
                          props: {
                            condition: { $not: '$theme.isBuiltIn' },
                            then: {
                              type: 'we-button',
                              props: {
                                variant: 'ghost',
                                size: 'sm',
                                onClick: {
                                  $action: 'themeStore.deleteTheme',
                                  args: ['$theme.id'],
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

        // All Perspectives
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'intersect-three', size: '20px' } },
                {
                  type: 'we-text',
                  props: { fontWeight: 'semibold' },
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
                          type: 'Card',
                          props: {
                            ax: 'start',
                            bg: 'neutral-50',
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
                                    size: '16px',
                                  },
                                },
                                {
                                  type: 'we-text',
                                  props: { variant: 'body', fontWeight: 'medium' },
                                  children: ['$perspective.name'],
                                },
                              ],
                            },
                            {
                              type: 'we-text',
                              props: { variant: 'body' },
                              children: [{ $concat: ['UUID: ', '$perspective.uuid'] }],
                            },
                            {
                              type: 'we-text',
                              props: { variant: 'body' },
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
                                  props: { variant: 'label' },
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
                  props: { variant: 'label', italic: true },
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
                { type: 'we-icon', props: { name: 'globe', size: '20px' } },
                { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Shared Spaces'] },
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
                          type: 'Card',
                          props: {
                            bg: 'neutral-50',
                            width: '200px',
                            cursor: 'pointer',
                            onClick: { $action: 'spaceStore.navigateToSpace', args: ['$space.uuid'] },
                          },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                { type: 'we-icon', props: { name: 'globe', size: '16px' } },
                                {
                                  type: 'we-text',
                                  props: { variant: 'body', fontWeight: 'medium' },
                                  children: ['$space.name'],
                                },
                              ],
                            },
                            {
                              type: 'we-text',
                              props: { variant: 'label' },
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
                  props: { variant: 'label', italic: true },
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
                { type: 'we-icon', props: { name: 'folder', size: '20px' } },
                {
                  type: 'we-text',
                  props: { variant: 'heading-sm' },
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
                          type: 'Card',
                          props: {
                            bg: 'neutral-50',
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
                                { type: 'we-icon', props: { name: 'folder', size: '16px' } },
                                {
                                  type: 'we-text',
                                  props: { variant: 'body', fontWeight: 'medium' },
                                  children: ['$space.name'],
                                },
                              ],
                            },
                            {
                              type: 'we-text',
                              props: { variant: 'label' },
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
                  props: { variant: 'label', italic: true },
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
