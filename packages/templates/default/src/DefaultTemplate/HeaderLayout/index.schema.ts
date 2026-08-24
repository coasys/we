import type { TemplateSchema } from '@we/schema-shared';
import { VIEWS_MARKER } from '@we/schema-shared';

import { initializeSpaceGate } from '../InitializeSpaceGate.ts';
import { homeRoute } from '../routes/HomeRoute/index.ts';
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
  props: { bg: 'page', minHeight: '100%' },
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
      /*
        The space's sections go here, whatever they turn out to be.

        This was a written-out list of routes with a nav strip beside it repeating the same names,
        and the two had drifted. Now the marker expands to one route per section from the space's own
        list, and the nav reads that list too — so "what sections does this space have" has one
        answer instead of three. The index redirect comes with the expansion rather than being
        written here: it has to follow the list, or a community that turns off whichever section this
        template happened to name would land on a 404 in their own space.
      */
      routes: [{ path: VIEWS_MARKER }],
    },
  ],
};
