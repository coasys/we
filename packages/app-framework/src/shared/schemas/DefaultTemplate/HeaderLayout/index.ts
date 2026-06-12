import type { TemplateSchema } from '@we/schema-shared';

import { aboutRoute } from '../routes/AboutRoute';
import { cardsRoute } from '../routes/CardsRoute';
import { fluxRoute } from '../routes/FluxRoute';
import { globeRoute } from '../routes/GlobeRoute';
import { graphRoute } from '../routes/GraphRoute';
import { homeRoute } from '../routes/HomeRoute';
// import { signalsRoute } from '../routes/SignalsRoute';
import { spaceGate } from '../SpaceGate';
import { spaceHeader } from './SpaceHeader';

export const headerLayout: TemplateSchema = {
  meta: {
    name: 'Default',
    description: 'Welcome screen with perspectives and spaces overview',
    icon: 'layout',
  },
  type: 'Column',
  children: [{ type: '$routes' }],
  routes: [
    homeRoute,
    {
      // Layout route: all space views live under /space/:spaceId/*
      // The header and gate are rendered here so they share the same $nav context
      // as the sub-routes, making ./home, ./globe etc. relative navigation work correctly.
      path: '/space/:spaceId',
      children: [
        {
          // Gate: show the full layout only when the agent holds a local perspective for this route
          type: '$if',
          props: {
            condition: { $store: 'adamStore.currentPerspective' },
            then: { type: 'Column', children: [spaceHeader, { type: '$routes' }] },
            else: spaceGate,
          },
        },
      ],
      routes: [
        { path: '/', redirect: './globe' },
        aboutRoute,
        globeRoute,
        cardsRoute,
        // signalsRoute,
        fluxRoute,
        graphRoute,
      ],
    },
  ],
};
