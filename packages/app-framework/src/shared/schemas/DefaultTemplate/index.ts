import type { TemplateSchema } from '@we/schema-shared';

import { cardsRoute } from './routes/CardsRoute';
import { fluxRoute } from './routes/FluxRoute';
import { globeRoute } from './routes/GlobeRoute';
// import { graphRoute } from './routes/GraphRoute';
import { signalsRoute } from './routes/SignalsRoute';

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
          // Gate: show the full layout only when the current space is joined.
          // spaceStore.hasJoined is true whenever the agent has a local perspective
          // for the current :spaceId (or when on /space/global).
          type: '$if',
          props: {
            condition: { $store: 'spaceStore.hasJoined' },
            then: {
              type: 'Row',
              props: { flex: '1', height: '100%' },
              children: [
                // Sidebar
                {
                  type: 'Column',
                  props: { flex: '0 0 400px', gap: '200', bg: 'neutral-25' },
                  children: [
                    // Cover image
                    {
                      type: 'EditableImage',
                      props: {
                        src: { $store: 'spaceStore.space.coverImage' },
                        alt: 'Cover image',
                        fit: 'cover',
                        width: '100%',
                        height: '180px',
                        aspect: 4 / 1,
                        placeholderIcon: 'panorama',
                        onImageChange: { $action: 'spaceStore.updateSpaceCoverImage', args: ['$arg'] },
                      },
                    },
                    {
                      type: 'Column',
                      props: { mt: '-65px', width: '100%', ax: 'center' },
                      children: [
                        // Profile picture
                        {
                          type: 'EditableImage',
                          props: {
                            src: { $store: 'spaceStore.space.avatar' },
                            alt: 'Profile picture',
                            fit: 'cover',
                            width: '120px',
                            height: '120px',
                            r: 'pill',
                            ring: '0 0 0 3px var(--we-color-neutral-500)',
                            placeholderIcon: 'users-three',
                            onImageChange: { $action: 'spaceStore.updateSpaceAvatar', args: ['$arg'] },
                          },
                        },
                      ],
                    },
                    // Space Details
                    {
                      type: 'Column',
                      props: { p: '400', gap: '200', ax: 'center' },
                      children: [
                        {
                          type: 'we-text',
                          props: { fontSize: '600', textAlign: 'center' },
                          children: [{ $store: 'spaceStore.space.name' }],
                        },
                        {
                          type: 'we-text',
                          props: { fontSize: '400', textAlign: 'center', mb: '400' },
                          children: [{ $store: 'spaceStore.space.description' }],
                        },
                      ],
                    },
                    // Navigation
                    {
                      type: 'Column',
                      props: { p: '400', gap: '200', ax: 'start' },
                      children: [
                        {
                          type: '$each',
                          props: {
                            items: [
                              { label: 'Globe', icon: 'globe-hemisphere-west', segment: 'globe', path: './globe' },
                              // { label: 'Graph', icon: 'graph', segment: 'graph', path: './graph' },
                              { label: 'Cards', icon: 'cards-three', segment: 'cards', path: './cards' },
                              { label: 'Signals', icon: 'heart', segment: 'signals', path: './signals' },
                              { label: 'Flux', icon: 'chat-circle', segment: 'flux', path: './flux' },
                            ],
                            as: 'view',
                          },
                          children: [
                            {
                              type: 'we-button',
                              props: {
                                variant: {
                                  $if: {
                                    condition: { $eq: [{ $store: 'routeStore.segments.2' }, '$view.segment'] },
                                    then: 'primary',
                                    else: 'ghost',
                                  },
                                },
                                onClick: { $action: 'routeStore.navigate', args: ['$view.path'] },
                              },
                              children: [
                                { type: 'we-icon', props: { name: '$view.icon' } },
                                { type: 'we-text', props: { fontSize: '500' }, children: ['$view.label'] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                // Main content
                { type: '$routes' },
              ],
            },
            else: {
              type: '$if',
              props: {
                condition: { $store: 'adamStore.globalSpaceConfigured' },
                then: {
                  type: 'Column',
                  props: { flex: '1', height: '100%', ax: 'center', ay: 'center', gap: '400', p: '600' },
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
                else: {
                  type: 'Column',
                  props: { flex: '1', height: '100%', ax: 'center', ay: 'center', gap: '400', p: '600' },
                  children: [
                    {
                      type: 'we-icon',
                      props: { name: 'warning', size: 'xl' },
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '700', fontWeight: 'bold' },
                      children: ['Global space not configured'],
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '400', color: 'neutral-500', textAlign: 'center', maxWidth: '400px' },
                      children: [
                        'No global space URL has been set in we-seed.json. Add a globalSpaceUrl to enable joining.',
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      ],
      routes: [{ path: '/', redirect: './globe' }, globeRoute, cardsRoute, signalsRoute, fluxRoute],
    },
  ],
};
