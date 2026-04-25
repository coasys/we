/**
 * Default Template — Home Route (/)
 *
 * Welcome screen listing Shared Spaces, Personal Spaces, and All Perspectives,
 * plus the Create Space button and modal.
 */

import type { RouteSchema } from '@we/schema-shared';

import { createSpaceModal } from '../modals/CreateSpaceModal';

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
        then: createSpaceModal,
      },
    },
  ],
};
