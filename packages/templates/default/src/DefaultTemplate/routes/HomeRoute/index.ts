/**
 * Default Template — Home Route (/)
 *
 * Shown when the user is on the Default template but no space is selected.
 * Displays the user's spaces as clickable cards, with a CTA to create/join one
 * if they have none yet.
 */

import type { RouteSchema } from '@we/schema-shared';
import { gatePrompt } from '@we/template-kit';

export const homeRoute: RouteSchema = {
  path: '/',
  type: 'Column',
  props: { height: '100vh', ax: 'center', ay: 'center', gap: '500', p: '600', bg: 'page' },
  children: [
    {
      type: 'Column',
      props: { gap: '500', ax: 'center', maxWidth: '600px', width: '100%' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'heading-md', textAlign: 'center' },
          children: ['Your Spaces'],
        },
        {
          type: 'we-text',
          props: { variant: 'body', textAlign: 'center' },
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
                items: { $store: 'spaceStore.orderedSidebarItems' },
                as: 'space',
              },
              children: [
                {
                  type: 'Card',
                  props: {
                    ax: 'center',
                    bg: 'surface',
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
                        variant: 'body',
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
        // Empty state — shown inline when there are no spaces yet.
        //
        // `$count` rather than reading `.length` off the store path: the latter worked, but it was
        // the only list in the template asking that way, and it silently returns nothing on a store
        // that hands back anything other than a plain array.
        {
          type: '$if',
          props: {
            condition: { $not: { $count: { items: { $store: 'spaceStore.orderedSidebarItems' } } } },
            then: {
              type: 'Card',
              props: { ax: 'center', bg: 'surface', width: '100%' },
              children: [
                // Inside a card that has its own flow, so it does not claim the height a page-level
                // gate does.
                gatePrompt({
                  icon: 'plus-circle',
                  iconColor: 'neutral-300',
                  title: 'No spaces yet',
                  body: 'Create or join a space to get started.',
                  fill: false,
                  gap: '300',
                }),
              ],
            },
          },
        },
      ],
    },
  ],
};
