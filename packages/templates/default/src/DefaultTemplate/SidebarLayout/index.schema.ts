import type { TemplateSchema } from '@we/schema-shared';

import { initializeSpaceGate } from '../InitializeSpaceGate.ts';
import { cardsRoute } from '../routes/CardsRoute/index.ts';
import { fluxRoute } from '../routes/FluxRoute/index.ts';
import { globeRoute } from '../routes/GlobeRoute/index.ts';
// import { graphRoute } from '../routes/GraphRoute/index.ts';
import { homeRoute } from '../routes/HomeRoute/index.ts';
import { spaceGate } from '../SpaceGate.ts';
import { spaceSidebar } from './SpaceSidebar.ts';

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
            condition: { $store: 'datasetStore.currentDataset' },
            then: {
              type: '$if',
              props: {
                condition: { $store: 'datasetStore.isWeSpace' },
                then: {
                  type: 'Row',
                  props: { flex: '1', height: '100%' },
                  children: [spaceSidebar, { type: '$routes' }],
                },
                else: initializeSpaceGate,
              },
            },
            else: spaceGate,
          },
        },
      ],
      routes: [{ path: '/', redirect: './globe' }, globeRoute, cardsRoute, fluxRoute],
    },
  ],
};
