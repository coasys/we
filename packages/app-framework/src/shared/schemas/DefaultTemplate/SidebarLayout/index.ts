import type { TemplateSchema } from '@we/schema-shared';

import { cardsRoute } from '../routes/CardsRoute';
import { fluxRoute } from '../routes/FluxRoute';
import { globeRoute } from '../routes/GlobeRoute';
// import { graphRoute } from '../routes/GraphRoute';
import { homeRoute } from '../routes/HomeRoute';
import { signalsRoute } from '../routes/SignalsRoute';
import { spaceGate } from '../SpaceGate';
import { spaceSidebar } from './SpaceSidebar';

export const sidebarLayout: TemplateSchema = {
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
      path: '/space/:spaceId',
      children: [
        {
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
