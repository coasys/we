import type { TemplateSchema } from '@we/schema-shared';

import { initializeSpaceGate } from '../InitializeSpaceGate.ts';
import { cardsRoute } from '../routes/CardsRoute/index.ts';
import { fluxRoute } from '../routes/FluxRoute/index.ts';
import { globeRoute } from '../routes/GlobeRoute/index.ts';
import { graphRoute } from '../routes/GraphRoute/index.ts';
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
  // `minHeight` rather than `height`: a fixed viewport height clips the box at the fold, so a long
  // route scrolls past whatever this node paints. The scroll container behind it carries the space
  // theme's background, so nothing shows through either way — but the template's own is right too.
  props: { minHeight: '100vh' },
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
            // Not `else: spaceGate` directly. `currentDataset` is also null for the first frames
            // of a refresh — the dataset list is still arriving, and the switch to the matching one
            // is itself async — so asking outright flashed "Join this Space" at someone already
            // inside. `routeSpaceUnjoined` is false until that is a settled fact, and nothing
            // renders in the meantime rather than a guess.
            else: {
              type: '$if',
              props: { condition: { $store: 'spaceStore.routeSpaceUnjoined' }, then: spaceGate },
            },
          },
        },
      ],
      // The graph sits beside the cards rather than replacing them: the same space, read as a map
      // instead of a list. It matters more now that a call's extraction hangs records off the call
      // it came from — that structure is a shape, and a list is the one view that cannot show it.
      routes: [{ path: '/', redirect: './globe' }, globeRoute, cardsRoute, fluxRoute, graphRoute],
    },
  ],
};
