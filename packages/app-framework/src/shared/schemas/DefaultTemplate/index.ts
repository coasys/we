import type { TemplateSchema } from '@we/schema-shared';

import { cardsRoute } from './routes/CardsRoute';
import { globeRoute } from './routes/GlobeRoute';
import { graphRoute } from './routes/GraphRoute';
import { homeRoute } from './routes/HomeRoute';

export const defaultTemplate: TemplateSchema = {
  meta: {
    name: 'Default',
    description: 'Welcome screen with perspectives and spaces overview',
    icon: 'layout',
  },
  type: 'Row',
  props: { ml: '72px', height: '100vh' },
  children: [
    {
      type: 'CollapsibleSidebar',
      props: {
        bg: 'neutral-25',
        side: 'left',
        position: 'absolute',
        zIndex: 10,
        border: '0',
        itemPadding: '12px',
        centerItems: true,
        items: [
          {
            type: 'item',
            id: 'home',
            icon: 'house',
            label: 'Home',
            onClick: { $action: 'routeStore.navigate', args: ['./home'] },
            active: { $eq: [{ $store: 'routeStore.segments.0' }, 'home'] },
          },
          {
            type: 'item',
            id: 'globe',
            icon: 'globe-hemisphere-west',
            label: 'Globe',
            onClick: { $action: 'routeStore.navigate', args: ['./globe'] },
            active: { $eq: [{ $store: 'routeStore.segments.0' }, 'globe'] },
          },
          {
            type: 'item',
            id: 'graph',
            icon: 'graph',
            label: 'Graph',
            onClick: { $action: 'routeStore.navigate', args: ['./graph'] },
            active: { $eq: [{ $store: 'routeStore.segments.0' }, 'graph'] },
          },
          {
            type: 'item',
            id: 'cards',
            icon: 'cards-three',
            label: 'Cards',
            onClick: { $action: 'routeStore.navigate', args: ['./cards'] },
            active: { $eq: [{ $store: 'routeStore.segments.0' }, 'cards'] },
          },
        ],
      },
    },
    {
      // Gate screen: show routes when the current space (or global space) is joined.
      // Fires when: on a /space/:id route that isn't joined, OR not on a space route and global isn't joined yet.
      type: '$if',
      props: {
        condition: {
          $or: [
            { $store: 'spaceStore.currentNode.isJoined' },
            { $and: [{ $not: { $store: 'spaceStore.currentNode' } }, { $store: 'adamStore.globalPerspective' }] },
          ],
        },
        then: { type: '$routes' },
        else: {
          type: 'Column',
          props: { flex: '1', height: '100%', ax: 'center', ai: 'center', gap: '400', p: '600' },
          children: [
            {
              type: 'we-icon',
              props: { name: 'lock', size: 'xl' },
            },
            {
              type: 'we-text',
              props: { fontSize: '700', fontWeight: 'bold' },
              children: ['Join this Space'],
            },
            {
              type: 'we-text',
              props: { fontSize: '400', color: 'neutral-500', textAlign: 'center', maxWidth: '400px' },
              children: ["You haven't joined this space yet. Click below to connect and start collaborating."],
            },
            {
              type: 'we-button',
              props: {
                text: 'Join Space',
                variant: 'primary',
                onClick: {
                  $action: 'adamStore.joinSpace',
                  args: [
                    {
                      $if: {
                        condition: { $store: 'routeStore.segments.1' },
                        then: { $store: 'routeStore.segments.1' },
                        else: 'global',
                      },
                    },
                  ],
                },
              },
            },
            // {
            //   type: 'we-button',
            //   props: {
            //     text: '← Back',
            //     variant: 'ghost',
            //     onClick: { $action: 'routeStore.navigate', args: ['/'] },
            //   },
            // },
          ],
        },
      },
    },
  ],
  routes: [{ path: '/', redirect: './home' }, homeRoute, globeRoute, graphRoute, cardsRoute],
};
