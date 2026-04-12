/**
 * Default Template
 *
 * Welcome screen showing all perspectives grouped into three categories:
 * - Shared Spaces: perspectives with a Space model published as neighbourhoods
 * - Personal Spaces: perspectives with a Space model (local only)
 * - All Perspectives: every AD4M perspective (raw graphs)
 *
 * Also provides a form to create new spaces.
 */

import type { TemplateSchema } from '@we/schema-shared';

export const defaultTemplate: TemplateSchema = {
  meta: {
    name: 'Default',
    description: 'Welcome screen with perspectives and spaces overview',
    icon: 'layout',
  },
  type: 'Column',
  props: { width: '100%', height: '100%', overflow: 'auto', bg: 'neutral-50' },
  children: [{ type: '$routes' }],
  routes: [
    // ── Welcome / Home ──
    {
      path: '/',
      type: 'Column',
      props: { p: '600', gap: '600', maxWidth: '900px', mx: 'auto', width: '100%' },
      children: [
        // Header
        {
          type: 'Column',
          props: { gap: '200' },
          children: [
            { type: 'we-text', props: { fontSize: '800', fontWeight: 'bold' }, children: ['Welcome to WE'] },
            {
              type: 'we-text',
              props: { fontSize: '400', color: 'neutral-500' },
              children: ['Your perspectives and spaces'],
            },
          ],
        },

        // ── Shared Spaces ──
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
                      props: {
                        items: { $store: 'adamStore.sharedSpaces' },
                        as: 'space',
                      },
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
                              $action: 'adamStore.navigate',
                              args: [
                                {
                                  $concat: [
                                    '/space/',
                                    { $if: { condition: '$space.url', then: '$space.url', else: '$space.uuid' } },
                                  ],
                                },
                              ],
                            },
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

        // ── Personal Spaces ──
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
                      props: {
                        items: { $store: 'adamStore.personalSpaces' },
                        as: 'space',
                      },
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
                              $action: 'adamStore.navigate',
                              args: [
                                {
                                  $concat: [
                                    '/space/',
                                    { $if: { condition: '$space.url', then: '$space.url', else: '$space.uuid' } },
                                  ],
                                },
                              ],
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

        // ── All Perspectives ──
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'diagram-3', color: 'neutral-500', size: '20px' } },
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
                  type: 'Row',
                  props: { gap: '300', wrap: true },
                  children: [
                    {
                      type: '$each',
                      props: {
                        items: { $store: 'adamStore.allPerspectives' },
                        as: 'perspective',
                      },
                      children: [
                        {
                          type: 'Column',
                          props: {
                            p: '400',
                            r: '400',
                            bg: 'neutral-50',
                            gap: '100',
                            width: '200px',
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
                                      $if: {
                                        condition: '$perspective.sharedUrl',
                                        then: 'globe',
                                        else: 'diagram-3',
                                      },
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
                              props: { fontSize: '200', color: 'neutral-400', fontFamily: 'mono' },
                              children: [{ $concat: ['UUID: ', '$perspective.uuid'] }],
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

        // ── Create Space Button ──
        {
          type: 'we-button',
          props: {
            text: 'Create New Space',
            bg: 'primary-500',
            color: 'neutral-0',
            height: '40px',
            width: 'fit-content',
            onClick: { $action: 'routeStore.navigate', args: ['/new-space'] },
          },
        },
      ],
    },

    // ── Create Space Form ──
    {
      path: '/new-space',
      type: 'Column',
      props: { p: '600', gap: '500', maxWidth: '500px', mx: 'auto', width: '100%' },
      $localState: {
        name: {
          type: 'string',
          initial: '',
          validate: [{ rule: 'required', message: 'Name is required' }],
        },
        description: { type: 'string', initial: '' },
        shared: { type: 'boolean', initial: false },
        thumbnail: { type: 'file', initial: null },
      },
      children: [
        // Back link
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', cursor: 'pointer' },
          children: [
            {
              type: 'we-button',
              props: {
                variant: 'ghost',
                text: '← Back',
                onClick: { $action: 'routeStore.navigate', args: ['/'] },
              },
            },
          ],
        },
        { type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Create a New Space'] },

        // Name
        {
          type: 'we-form-field',
          props: {
            error: { $if: { condition: { $error: 'name' }, then: { $error: 'name' } } },
          },
          children: [
            {
              type: 'we-input',
              props: {
                placeholder: 'Space name...',
                value: { $local: 'name' },
                onInput: { $setLocal: 'name', from: '$event.detail' },
                onBlur: { $touch: 'name' },
              },
            },
          ],
        },

        // Description
        {
          type: 'we-input',
          props: {
            placeholder: 'Description (optional)',
            value: { $local: 'description' },
            onInput: { $setLocal: 'description', from: '$event.detail' },
          },
        },

        // Visibility toggle
        {
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [
            { type: 'we-text', props: { fontSize: '400' }, children: ['Shared'] },
            {
              type: 'we-switch',
              props: {
                checked: { $local: 'shared' },
                onChange: { $setLocal: 'shared', from: '$event.detail' },
              },
            },
          ],
        },

        // Create button
        {
          type: 'we-button',
          props: {
            text: 'Create Space',
            bg: 'primary-500',
            color: 'neutral-0',
            height: '40px',
            disabled: { $not: { $formValid: '$scope' } },
            onClick: [
              { $touch: '$all' },
              {
                $if: {
                  condition: { $formValid: '$scope' },
                  then: {
                    $action: 'adamStore.createSpace',
                    args: [
                      { $local: 'name' },
                      { $local: 'description' },
                      { $local: 'shared' },
                      { $local: 'thumbnail' },
                    ],
                  },
                },
              },
            ],
          },
        },
      ],
    },
  ],
};
