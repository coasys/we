/**
 * Default Template — Home Route (/)
 *
 * Shown when the user is on the Default template but no space is selected.
 * Displays the user's spaces as clickable cards, with a CTA to create/join one
 * if they have none yet.
 */

import type { RouteSchema } from '@we/schema-shared';

export const homeRoute: RouteSchema = {
  path: '/',
  type: 'Column',
  props: { height: '100vh', ax: 'center', ay: 'center', gap: '500', p: '600', bg: 'neutral-50' },
  children: [
    {
      type: 'Column',
      props: { gap: '500', ax: 'center', maxWidth: '600px', width: '100%' },
      children: [
        {
          type: 'we-text',
          props: { fontSize: '700', fontWeight: 'bold', textAlign: 'center' },
          children: ['Your Spaces'],
        },
        {
          type: 'we-text',
          props: { fontSize: '400', color: 'neutral-500', textAlign: 'center' },
          children: ['Select a space to open it, or create and join new ones.'],
        },
        // Space cards grid
        {
          type: 'Row',
          props: { gap: '400', wrap: true, ax: 'center', minHeight: '80px' },
          children: [
            {
              type: '$each',
              props: {
                items: { $store: 'adamStore.orderedSidebarItems' },
                as: 'space',
              },
              children: [
                {
                  type: 'Column',
                  props: {
                    gap: '200',
                    ax: 'center',
                    p: '400',
                    r: '400',
                    bg: 'neutral-0',
                    width: '160px',
                    styles: { cursor: 'pointer' },
                    onClick: { $action: 'spaceStore.navigateToSpace', args: ['$space.spaceId'] },
                    title: { $concat: ['Open ', '$space.name'] },
                  },
                  children: [
                    {
                      type: 'we-avatar',
                      props: {
                        image: '$space.avatar',
                        initials: '$space.name',
                        size: '56px',
                      },
                    },
                    {
                      type: 'we-text',
                      props: {
                        fontSize: '400',
                        fontWeight: 'medium',
                        textAlign: 'center',
                        styles: {
                          overflow: 'hidden',
                          'text-overflow': 'ellipsis',
                          'white-space': 'nowrap',
                          'max-width': '140px',
                        },
                      },
                      children: ['$space.name'],
                    },
                  ],
                },
              ],
            },
          ],
        },
        // Empty state — shown inline when there are no spaces yet
        {
          type: '$if',
          props: {
            condition: { $not: { $store: 'adamStore.orderedSidebarItems.length' } },
            then: {
              type: 'Column',
              props: { gap: '200', ax: 'center', p: '400', r: '400', bg: 'neutral-0', width: '100%' },
              children: [
                { type: 'we-icon', props: { name: 'plus-circle', size: 'xl', color: 'neutral-400' } },
                {
                  type: 'we-text',
                  props: { fontSize: '500', fontWeight: 'medium', textAlign: 'center' },
                  children: ['No spaces yet'],
                },
                {
                  type: 'we-text',
                  props: { fontSize: '400', color: 'neutral-500', textAlign: 'center' },
                  children: ['Create or join a space to get started.'],
                },
              ],
            },
          },
        },
      ],
    },
  ],
};
