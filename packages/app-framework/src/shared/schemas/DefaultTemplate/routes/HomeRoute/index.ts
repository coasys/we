/**
 * Default Template — Home Route (/)
 *
 * Welcome screen listing Shared Spaces, Personal Spaces, and All Perspectives,
 * plus the Create Space button and modal.
 */

import type { RouteSchema } from '@we/schema-shared';

import { createSpaceModal } from './CreateSpaceModal';

export const homeRoute: RouteSchema = {
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
    listedGlobally: { type: 'boolean', initial: false },
    thumbnail: { type: 'file', initial: null },
    globalPromptDismissed: { type: 'boolean', initial: false },
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

    // ── Global Space join prompt (shown until joined or dismissed) ──
    {
      type: '$if',
      props: {
        condition: {
          $and: [
            { $not: { $store: 'adamStore.agentSettings.globalSpaceJoined' } },
            { $not: { $local: 'globalPromptDismissed' } },
          ],
        },
        then: {
          type: 'Row',
          props: {
            gap: '400',
            ay: 'center',
            p: '400',
            r: '400',
            bg: 'primary-50',
            border: '1px solid primary-200',
          },
          children: [
            { type: 'we-icon', props: { name: 'globe', color: 'primary-500', size: '28px' } },
            {
              type: 'Column',
              props: { gap: '100', flex: '1' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '500', fontWeight: 'semibold' },
                  children: ['Discover the WE Global Space'],
                },
                {
                  type: 'we-text',
                  props: { fontSize: '300', color: 'neutral-500' },
                  children: [
                    'Connect with communities and people around the world. Spaces you make public will appear on the global discovery globe.',
                  ],
                },
              ],
            },
            {
              type: 'Row',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'ghost',
                    text: 'Maybe Later',
                    height: '36px',
                    onClick: { $setLocal: 'globalPromptDismissed', value: true },
                  },
                },
                {
                  type: 'we-button',
                  props: {
                    text: 'Join Global Space',
                    bg: 'primary-500',
                    color: 'neutral-0',
                    height: '36px',
                    onClick: { $action: 'adamStore.joinGlobalSpace', args: [] },
                  },
                },
              ],
            },
          ],
        },
      },
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
                        onClick: [
                          { $action: 'adamStore.setCurrentPerspective', args: ['$space.uuid'] },
                          {
                            $action: 'routeStore.navigate',
                            args: [{ $concat: ['/space/', '$space.uuid'] }],
                          },
                        ],
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
                        onClick: [
                          {
                            $action: 'adamStore.setCurrentPerspective',
                            args: [{ $if: { condition: '$space.url', then: '$space.uuid', else: '$space.uuid' } }],
                          },
                          {
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
                        ],
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
