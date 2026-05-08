/**
 * Default Template — Globe Route (/)
 *
 * Cesium globe view
 */

import type { RouteSchema } from '@we/schema-shared';

import { createSpaceModal } from './CreateSpaceModal';

export const globeRoute: RouteSchema = {
  path: '/globe',
  type: 'Column',
  $localState: {
    createSpaceOpen: { type: 'boolean', initial: false },
    globalPromptDismissed: { type: 'boolean', initial: false },
  },
  children: [
    // Header section controls
    {
      type: 'Column',
      props: { width: 'calc(100% - 72px)', p: '400', gap: '400', position: 'absolute', zIndex: 5 },
      children: [
        // // ── Global Space join prompt (shown until joined or dismissed) ──
        // {
        //   type: '$if',
        //   props: {
        //     condition: {
        //       $and: [
        //         { $not: { $store: 'adamStore.agentSettings.globalSpaceJoined' } },
        //         { $not: { $local: 'globalPromptDismissed' } },
        //       ],
        //     },
        //     then: {
        //       type: 'Row',
        //       props: {
        //         gap: '400',
        //         ay: 'center',
        //         p: '400',
        //         r: '400',
        //         bg: 'primary-50',
        //         border: '1px solid primary-200',
        //       },
        //       children: [
        //         { type: 'we-icon', props: { name: 'globe', color: 'primary-500', size: '28px' } },
        //         {
        //           type: 'Column',
        //           props: { gap: '100', flex: '1' },
        //           children: [
        //             {
        //               type: 'we-text',
        //               props: { fontSize: '500', fontWeight: 'semibold' },
        //               children: ['Discover the WE Global Space'],
        //             },
        //             {
        //               type: 'we-text',
        //               props: { fontSize: '300', color: 'neutral-500' },
        //               children: [
        //                 'Connect with communities and people around the world. Spaces you make public will appear on the global discovery globe.',
        //               ],
        //             },
        //           ],
        //         },
        //         {
        //           type: 'Row',
        //           props: { gap: '200' },
        //           children: [
        //             {
        //               type: 'we-button',
        //               props: {
        //                 variant: 'ghost',
        //                 text: 'Maybe Later',
        //                 height: '36px',
        //                 onClick: { $setLocal: 'globalPromptDismissed', value: true },
        //               },
        //             },
        //             {
        //               type: 'we-button',
        //               props: {
        //                 text: 'Join Global Space',
        //                 bg: 'primary-500',
        //                 color: 'neutral-0',
        //                 height: '36px',
        //                 onClick: { $action: 'adamStore.joinGlobalSpace', args: [] },
        //               },
        //             },
        //           ],
        //         },
        //       ],
        //     },
        //   },
        // },
        {
          type: 'Row',
          props: { gap: '400' },
          children: [
            // Globe layer controls
            {
              type: 'DropdownMenu',
              props: {
                placement: 'bottom-start',
                triggerLabel: 'Layers',
                triggerIcon: 'stack',
                items: [
                  {
                    type: 'group',
                    id: 'background',
                    label: 'Background',
                    collapsible: true,
                    items: [
                      {
                        type: 'toggle',
                        id: 'skybox',
                        label: 'Skybox',
                        icon: 'image',
                        checked: { $store: 'spaceStore.showSkybox' },
                        onToggle: { $action: 'spaceStore.toggleBackground', args: ['skybox'] },
                      },
                      {
                        type: 'toggle',
                        id: 'stars',
                        label: 'Procedural Stars',
                        icon: 'sparkle',
                        checked: { $store: 'spaceStore.showStars' },
                        onToggle: { $action: 'spaceStore.toggleBackground', args: ['stars'] },
                      },
                      {
                        type: 'toggle',
                        id: 'solar-system',
                        label: 'Solar System',
                        icon: 'atom',
                        checked: { $store: 'spaceStore.showSolarSystem' },
                        onToggle: { $action: 'spaceStore.toggleBackground', args: ['solarSystem'] },
                      },
                    ],
                  },
                  {
                    type: 'group',
                    id: 'planet-surface',
                    label: 'Planet Surface',
                    collapsible: true,
                    items: [
                      {
                        type: 'toggle',
                        id: 'user-locations',
                        label: 'User Locations',
                        icon: 'map-pin',
                        checked: { $store: 'spaceStore.showUserLocations' },
                        onToggle: { $action: 'spaceStore.toggleLayer', args: ['userLocations'] },
                      },
                      {
                        type: 'toggle',
                        id: 'countries',
                        label: 'Country Outlines',
                        icon: 'flag',
                        checked: { $store: 'spaceStore.showCountryOutlines' },
                        onToggle: { $action: 'spaceStore.toggleLayer', args: ['countryOutlines'] },
                      },
                      {
                        type: 'toggle',
                        id: 'h3',
                        label: 'H3 Hexagons',
                        icon: 'hexagon',
                        checked: { $store: 'spaceStore.showH3Hexagons' },
                        onToggle: { $action: 'spaceStore.toggleLayer', args: ['h3Hexagons'] },
                      },
                    ],
                  },
                ],
              },
            },
            // ── Create Space Button ──
            {
              type: 'we-button',
              props: {
                text: 'Create New Space',
                bg: 'primary-500',
                color: 'neutral-0',
                height: '40px',
                width: 'fit-content',
                onClick: { $setLocal: 'createSpaceOpen', value: true },
              },
            },
          ],
        },
      ],
    },
    // Globe takes remaining space
    {
      type: 'CesiumGlobe',
      props: {
        backgroundLayers: [
          {
            factory: 'skyboxLayer',
            enabled: { $store: 'spaceStore.showSkybox' },
            options: { textureSet: 'tycho2-4k' },
          },
          {
            factory: 'proceduralStarsLayer',
            enabled: { $store: 'spaceStore.showStars' },
            options: {
              count: 2000,
              minDistance: 10000,
              maxDistance: 100000000,
              minBrightness: 0.3,
              maxBrightness: 1.0,
              minSize: 1,
              maxSize: 3,
              color: '#ffffff',
              show: true,
            },
          },
          {
            factory: 'solarSystemLayer',
            enabled: { $store: 'spaceStore.showSolarSystem' },
            options: {
              planets: ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'],
              showSun: true,
              showOrbits: true,
              showPlanets: true,
              showLabels: true,
              planetScale: 1.5,
              orbitScale: 0.01,
              orbitWidth: 2,
            },
          },
        ],
        planetLayers: [
          {
            factory: 'spaceLocationsLayer',
            enabled: { $store: 'spaceStore.showUserLocations' },
            options: {
              locations: { $store: 'spaceStore.spaceLocationPins' },
              markerSize: 15,
              defaultColor: '#a855f7',
              onLocationClick: { $action: 'spaceStore.setSelectedPin', args: ['$arg'] },
            },
          },
          {
            factory: 'agentLocationsLayer',
            enabled: { $store: 'spaceStore.showUserLocations' },
            options: {
              locations: { $store: 'spaceStore.memberLocationPins' },
              markerSize: 12,
              defaultColor: '#f97316',
              onLocationClick: { $action: 'spaceStore.setSelectedPin', args: ['$arg'] },
            },
          },
          {
            factory: 'countryOutlinesLayer',
            enabled: { $store: 'spaceStore.showCountryOutlines' },
            options: { color: '#ffffff', opacity: 0.5, width: 2 },
          },
          {
            factory: 'h3HexagonsLayer',
            enabled: { $store: 'spaceStore.showH3Hexagons' },
            options: {
              maxResolution: 8,
              color: '#3388ff',
              opacity: 0.6,
              width: 2,
              hoverColor: '#3388ff',
              hoverOpacity: 0.3,
              onHexagonClick: { $action: 'consoleStore.log', args: ['Hexagon clicked:', '$arg'] },
            },
          },
        ],
      },
    },

    // // Header
    // {
    //   type: 'Column',
    //   props: { gap: '200' },
    //   children: [
    //     { type: 'we-text', props: { fontSize: '800', fontWeight: 'bold' }, children: ['Welcome to WE'] },
    //     {
    //       type: 'we-text',
    //       props: { fontSize: '400', color: 'neutral-500' },
    //       children: ['Your perspectives and spaces'],
    //     },
    //   ],
    // },

    // // ── Shared Spaces ──
    // {
    //   type: 'Column',
    //   props: { gap: '300' },
    //   children: [
    //     {
    //       type: 'Row',
    //       props: { gap: '200', ay: 'center' },
    //       children: [
    //         { type: 'we-icon', props: { name: 'globe', color: 'primary-500', size: '20px' } },
    //         { type: 'we-text', props: { fontSize: '600', fontWeight: 'semibold' }, children: ['Shared Spaces'] },
    //       ],
    //     },
    //     {
    //       type: '$if',
    //       props: {
    //         condition: { $store: 'adamStore.sharedSpaces.length' },
    //         then: {
    //           type: 'Row',
    //           props: { gap: '300', wrap: true },
    //           children: [
    //             {
    //               type: '$each',
    //               props: { items: { $store: 'adamStore.sharedSpaces' }, as: 'space' },
    //               children: [
    //                 {
    //                   type: 'Column',
    //                   props: {
    //                     p: '400',
    //                     r: '400',
    //                     bg: 'neutral-50',
    //                     gap: '200',
    //                     width: '200px',
    //                     cursor: 'pointer',
    //                     onClick: [
    //                       { $action: 'adamStore.setCurrentPerspective', args: ['$space.uuid'] },
    //                       {
    //                         $action: 'routeStore.navigate',
    //                         args: [{ $concat: ['/space/', '$space.uuid'] }],
    //                       },
    //                     ],
    //                   },
    //                   children: [
    //                     {
    //                       type: 'Row',
    //                       props: { gap: '200', ay: 'center' },
    //                       children: [
    //                         { type: 'we-icon', props: { name: 'globe', color: 'primary-400', size: '16px' } },
    //                         {
    //                           type: 'we-text',
    //                           props: { fontSize: '400', fontWeight: 'medium' },
    //                           children: ['$space.name'],
    //                         },
    //                       ],
    //                     },
    //                     {
    //                       type: 'we-text',
    //                       props: { fontSize: '300', color: 'neutral-400' },
    //                       children: ['$space.description'],
    //                     },
    //                   ],
    //                 },
    //               ],
    //             },
    //           ],
    //         },
    //         else: {
    //           type: 'we-text',
    //           props: { fontSize: '300', color: 'neutral-400', italic: true },
    //           children: ['No shared spaces yet'],
    //         },
    //       },
    //     },
    //   ],
    // },

    // // ── Personal Spaces ──
    // {
    //   type: 'Column',
    //   props: { gap: '300' },
    //   children: [
    //     {
    //       type: 'Row',
    //       props: { gap: '200', ay: 'center' },
    //       children: [
    //         { type: 'we-icon', props: { name: 'folder', color: 'primary-500', size: '20px' } },
    //         {
    //           type: 'we-text',
    //           props: { fontSize: '600', fontWeight: 'semibold' },
    //           children: ['Personal Spaces'],
    //         },
    //       ],
    //     },
    //     {
    //       type: '$if',
    //       props: {
    //         condition: { $store: 'adamStore.personalSpaces.length' },
    //         then: {
    //           type: 'Row',
    //           props: { gap: '300', wrap: true },
    //           children: [
    //             {
    //               type: '$each',
    //               props: { items: { $store: 'adamStore.personalSpaces' }, as: 'space' },
    //               children: [
    //                 {
    //                   type: 'Column',
    //                   props: {
    //                     p: '400',
    //                     r: '400',
    //                     bg: 'neutral-50',
    //                     gap: '200',
    //                     width: '200px',
    //                     cursor: 'pointer',
    //                     onClick: [
    //                       {
    //                         $action: 'adamStore.setCurrentPerspective',
    //                         args: [{ $if: { condition: '$space.url', then: '$space.uuid', else: '$space.uuid' } }],
    //                       },
    //                       {
    //                         $action: 'routeStore.navigate',
    //                         args: [
    //                           {
    //                             $concat: [
    //                               '/space/',
    //                               { $if: { condition: '$space.url', then: '$space.url', else: '$space.uuid' } },
    //                             ],
    //                           },
    //                         ],
    //                       },
    //                     ],
    //                   },
    //                   children: [
    //                     {
    //                       type: 'Row',
    //                       props: { gap: '200', ay: 'center' },
    //                       children: [
    //                         { type: 'we-icon', props: { name: 'folder', color: 'primary-400', size: '16px' } },
    //                         {
    //                           type: 'we-text',
    //                           props: { fontSize: '400', fontWeight: 'medium' },
    //                           children: ['$space.name'],
    //                         },
    //                       ],
    //                     },
    //                     {
    //                       type: 'we-text',
    //                       props: { fontSize: '300', color: 'neutral-400' },
    //                       children: ['$space.description'],
    //                     },
    //                   ],
    //                 },
    //               ],
    //             },
    //           ],
    //         },
    //         else: {
    //           type: 'we-text',
    //           props: { fontSize: '300', color: 'neutral-400', italic: true },
    //           children: ['No personal spaces yet'],
    //         },
    //       },
    //     },
    //   ],
    // },

    // ── Create Space Modal ──
    {
      type: '$if',
      props: { condition: { $local: 'createSpaceOpen' }, then: createSpaceModal },
    },
  ],
};
