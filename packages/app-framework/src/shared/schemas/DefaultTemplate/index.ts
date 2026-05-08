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
  props: { height: '100vh' },
  children: [{ type: '$routes' }],
  routes: [
    { path: '/', redirect: '/space/global' },
    {
      // Layout route: all space views live under /space/:spaceId/*
      // The sidebar and gate are rendered here so they share the same $nav context
      // as the sub-routes, making ./home, ./globe etc. relative navigation work correctly.
      path: '/space/:spaceId',
      children: [
        {
          type: 'Column',
          props: {
            flex: '0 0 300px',
            height: '100%',
            gap: '200',
            p: '400',
            bg: 'neutral-25',
          },
          children: [
            {
              type: 'we-button',
              props: {
                text: 'Home',
                variant: {
                  $if: {
                    condition: { $eq: [{ $store: 'routeStore.segments.2' }, 'home'] },
                    then: 'primary',
                    else: 'secondary',
                  },
                },
                onClick: { $action: 'routeStore.navigate', args: ['./home'] },
              },
            },
            {
              type: 'we-button',
              props: {
                text: 'Globe',
                variant: {
                  $if: {
                    condition: { $eq: [{ $store: 'routeStore.segments.2' }, 'globe'] },
                    then: 'primary',
                    else: 'secondary',
                  },
                },
                onClick: { $action: 'routeStore.navigate', args: ['./globe'] },
              },
            },
            {
              type: 'we-button',
              props: {
                text: 'Graph',
                variant: {
                  $if: {
                    condition: { $eq: [{ $store: 'routeStore.segments.2' }, 'graph'] },
                    then: 'primary',
                    else: 'secondary',
                  },
                },
                onClick: { $action: 'routeStore.navigate', args: ['./graph'] },
              },
            },
            {
              type: 'we-button',
              props: {
                text: 'Cards',
                variant: {
                  $if: {
                    condition: { $eq: [{ $store: 'routeStore.segments.2' }, 'cards'] },
                    then: 'primary',
                    else: 'secondary',
                  },
                },
                onClick: { $action: 'routeStore.navigate', args: ['./cards'] },
              },
            },
          ],
        },
        {
          // Gate: show routes when the current space is joined.
          // spaceStore.currentNode is non-null whenever segments[0] === 'space',
          // so this gate fires correctly for all /space/:spaceId/* paths.
          type: '$if',
          props: {
            condition: { $store: 'spaceStore.currentNode.isJoined' },
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
                      args: [{ $store: 'routeStore.segments.1' }],
                    },
                  },
                },
              ],
            },
          },
        },
      ],
      routes: [{ path: '/', redirect: './globe' }, homeRoute, globeRoute, graphRoute, cardsRoute],
    },
  ],
};
