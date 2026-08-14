import type { TemplateSchema } from '@we/schema-shared';

import { initializeSpaceGate } from '../InitializeSpaceGate.ts';
import { aboutRoute } from '../routes/AboutRoute/index.ts';
import { calendarRoute } from '../routes/CalendarRoute/index.ts';
import { cardsRoute } from '../routes/CardsRoute/index.ts';
import { fluxRoute } from '../routes/FluxRoute/index.ts';
import { globeRoute } from '../routes/GlobeRoute/index.ts';
import { graphRoute } from '../routes/GraphRoute/index.ts';
import { homeRoute } from '../routes/HomeRoute/index.ts';
import { settingsRoute } from '../routes/SettingsRoute/index.ts';
import { tasksRoute } from '../routes/TasksRoute/index.ts';
import { spaceGate } from '../SpaceGate.ts';
import { spaceHeader, spaceNavBar } from './SpaceHeader.ts';

export const headerLayout: TemplateSchema = {
  meta: {
    name: 'Default',
    description: 'Welcome screen with perspectives and spaces overview',
    icon: 'layout',
  },
  type: 'Column',
  // `minHeight` rather than `height`: fills the viewport when a route is short, and grows with a
  // long one. A fixed 100% clips the box at the fold, so this node's own background stops there.
  props: { bg: 'neutral-50', minHeight: '100%' },
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
          // Outer gate: show the full layout only when the agent holds a local perspective
          // for this route. Inner gate: within a joined perspective, only render WE's space
          // template once that perspective actually has WE's Space SDNA installed — a
          // perspective synced in from another app (e.g. a Flux community) is joined but
          // isn't a WE space yet, so it gets the "Initialize as WE space" gate instead.
          type: '$if',
          props: {
            condition: { $store: 'datasetStore.currentDataset' },
            then: {
              type: '$if',
              props: {
                condition: { $store: 'datasetStore.isWeSpace' },
                then: {
                  type: 'Column',
                  children: [
                    spaceHeader,
                    spaceNavBar,
                    {
                      type: 'Column',
                      props: { width: '100%', height: 'calc(100vh - 70px)' },
                      children: [{ type: '$routes' }],
                    },
                  ],
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
      routes: [
        { path: '/', redirect: './about' },
        aboutRoute,
        globeRoute,
        cardsRoute,
        fluxRoute,
        graphRoute,
        tasksRoute,
        calendarRoute,
        settingsRoute,
      ],
    },
  ],
};
