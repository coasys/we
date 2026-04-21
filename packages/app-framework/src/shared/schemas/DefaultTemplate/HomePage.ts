/**
 * Default Template — Home Route (/)
 *
 * Welcome screen listing Shared Spaces, Personal Spaces, and All Perspectives,
 * plus the Create Space button and modal.
 */

import type { RouteSchema } from '@we/schema-shared';

export const homePage: RouteSchema = {
  path: '/',
  type: 'Column',
  props: { gap: '600', maxWidth: '900px', mx: 'auto', width: '100%' },
  $localState: {
    createSpaceOpen: { type: 'boolean', initial: false },
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
                          $action: 'routeStore.navigate',
                          args: [{ $concat: ['/space/', '$space.uuid'] }],
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
                          $action: 'routeStore.navigate',
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
                                  $if: {
                                    condition: '$perspective.sharedUrl',
                                    then: 'globe',
                                    else: 'folder',
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
                        {
                          type: 'we-button',
                          props: {
                            variant: 'ghost',
                            text: 'Delete',
                            color: 'danger-500',
                            height: '28px',
                            width: 'fit-content',
                            onClick: {
                              $action: 'adamStore.removePerspective',
                              args: ['$perspective.uuid'],
                            },
                          },
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
        onClick: { $setLocal: 'createSpaceOpen', value: true },
      },
    },

    // ── Create Space Modal ──
    {
      type: '$if',
      props: {
        condition: { $local: 'createSpaceOpen' },
        then: {
          type: 'we-modal',
          props: {
            close: { $setLocal: 'createSpaceOpen', value: false },
            maxWidth: '560px',
            width: '100%',
          },
          children: [
            { type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Create a New Space'] },

            // Space image
            {
              type: 'EditableImage',
              props: {
                src: { $local: 'thumbnail' },
                alt: 'Space image',
                fit: 'cover',
                width: '100%',
                height: '160px',
                r: '300',
                placeholderIcon: 'image',
                onImageChange: { $setLocal: 'thumbnail', from: '$event' },
              },
            },

            // Name
            {
              type: 'we-form-field',
              props: {
                label: 'Name',
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
              type: 'we-form-field',
              props: { label: 'Description' },
              children: [
                {
                  type: 'we-input',
                  props: {
                    placeholder: 'Description (optional)',
                    value: { $local: 'description' },
                    onInput: { $setLocal: 'description', from: '$event.detail' },
                  },
                },
              ],
            },

            // Shared toggle
            {
              type: 'Row',
              props: { gap: '300', ay: 'center' },
              children: [
                { type: 'we-text', props: { fontSize: '400' }, children: ['Shared with network'] },
                {
                  type: 'we-switch',
                  props: {
                    checked: { $local: 'shared' },
                    onChange: { $setLocal: 'shared', from: '$event.detail' },
                  },
                },
              ],
            },

            // Action buttons
            {
              type: 'Row',
              props: { gap: '300', ax: 'end', mt: '200' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'ghost',
                    text: 'Cancel',
                    onClick: { $setLocal: 'createSpaceOpen', value: false },
                  },
                },
                {
                  type: 'we-button',
                  props: {
                    text: 'Create Space',
                    bg: 'primary-500',
                    color: 'neutral-0',
                    height: '40px',
                    loading: { $store: 'adamStore.creatingSpace' },
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
        },
      },
    },
  ],
};
