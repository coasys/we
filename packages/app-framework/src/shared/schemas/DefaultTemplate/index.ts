import type { TemplateSchema } from '@we/schema-shared';

import { cardsRoute } from './routes/CardsRoute';
import { fluxRoute } from './routes/FluxRoute';
import { globeRoute } from './routes/GlobeRoute';
// import { graphRoute } from './routes/GraphRoute';
import { homeRoute } from './routes/HomeRoute';
import { signalsRoute } from './routes/SignalsRoute';
import { spaceGate } from './SpaceGate';
import { spaceSidebar } from './SpaceSidebar';

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
    homeRoute,
    {
      // Layout route: all space views live under /space/:spaceId/*
      // The sidebar and gate are rendered here so they share the same $nav context
      // as the sub-routes, making ./home, ./globe etc. relative navigation work correctly.
      path: '/space/:spaceId',
      children: [
        {
          // Gate: show the full layout only when the agent holds a local perspective for this route.
          // adamStore.currentPerspective is a PerspectiveProxy object (truthy) or null (falsy).
          type: '$if',
          props: {
            condition: { $store: 'adamStore.currentPerspective' },
            then: {
              type: 'Row',
              props: { flex: '1', height: '100%' },
              children: [spaceSidebar, { type: '$routes' }],
            },
            else: spaceGate,
          },
        },
      ],
      routes: [{ path: '/', redirect: './globe' }, globeRoute, cardsRoute, signalsRoute, fluxRoute],
    },
  ],
};
