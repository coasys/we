/**
 * WE Native App Template
 *
 * A native WE application with sidebar navigation and multiple views.
 * Built entirely from WE design system components - no embedded apps.
 */

import type { TemplateSchema } from '@we/schema-renderer/shared';

export const weNativeAppTemplateSchema: TemplateSchema = {
  meta: {
    name: 'WE Native App',
    description: 'Native WE application with sidebar navigation',
    icon: 'cube',
  },
  type: 'Row',
  props: {
    width: '100%',
    height: '100%',
  },
  children: [
    // Left sidebar
    {
      type: 'Column',
      props: {
        width: '200px',
        height: '100%',
        bg: 'ui-0',
        p: '1rem',
        gap: '0.5rem',
        borderRight: '1px solid',
        borderColor: 'ui-200',
      },
      children: [
        // App title
        {
          type: 'we-text',
          props: {
            text: 'WE Native',
            size: 'xl',
            weight: 'bold',
            mb: '1rem',
          },
        },
        // Navigation buttons
        {
          type: 'we-button',
          props: {
            width: '100%',
            onClick: { $action: 'routeStore.navigate', args: ['/'] },
            variant: 'ghost',
            justify: 'flex-start',
          },
          children: [{ type: 'we-icon', props: { name: 'globe', size: 'sm', mr: '0.5rem' } }, 'Globe'],
        },
        {
          type: 'we-button',
          props: {
            width: '100%',
            onClick: { $action: 'routeStore.navigate', args: ['/chat'] },
            variant: 'ghost',
            justify: 'flex-start',
          },
          children: [{ type: 'we-icon', props: { name: 'chat', size: 'sm', mr: '0.5rem' } }, 'Chat'],
        },
        {
          type: 'we-button',
          props: {
            width: '100%',
            onClick: { $action: 'routeStore.navigate', args: ['/profile'] },
            variant: 'ghost',
            justify: 'flex-start',
          },
          children: [{ type: 'we-icon', props: { name: 'user', size: 'sm', mr: '0.5rem' } }, 'Profile'],
        },
      ],
    },
    // Right main panel
    {
      type: 'Column',
      props: {
        width: '100%',
        height: '100%',
        bg: 'ui-50',
      },
      children: [{ type: '$routes' }],
    },
  ],
  routes: [
    {
      path: '/',
      type: 'Column',
      props: {
        width: '100%',
        height: '100%',
      },
      children: [
        // Header section
        {
          type: 'Column',
          props: {
            width: '100%',
            p: '2rem',
            gap: '0.5rem',
            bg: 'ui-0',
            borderBottom: '1px solid',
            borderColor: 'ui-200',
          },
          children: [
            {
              type: 'Row',
              props: {
                width: '100%',
                justify: 'space-between',
                align: 'center',
              },
              children: [
                {
                  type: 'we-text',
                  props: {
                    text: 'Globe View',
                    size: '2xl',
                    weight: 'bold',
                  },
                },
                // Controls row
                {
                  type: 'Row',
                  props: {
                    gap: '0.5rem',
                  },
                  children: [
                    // Background controls
                    {
                      type: 'PopoverToggleMenu',
                      props: {
                        triggerLabel: 'Background',
                        triggerIcon: 'selection-background',
                        items: [
                          {
                            id: 'skybox',
                            label: 'Skybox',
                            icon: 'image',
                            checked: { $store: 'spaceStore.showSkybox' },
                            onToggle: { $action: 'spaceStore.toggleBackground', args: ['skybox'] },
                          },
                          {
                            id: 'stars',
                            label: 'Procedural Stars',
                            icon: 'star',
                            checked: { $store: 'spaceStore.showStars' },
                            onToggle: { $action: 'spaceStore.toggleBackground', args: ['stars'] },
                          },
                          {
                            id: 'solar-system',
                            label: 'Solar System',
                            icon: 'sun',
                            checked: { $store: 'spaceStore.showSolarSystem' },
                            onToggle: { $action: 'spaceStore.toggleBackground', args: ['solarSystem'] },
                          },
                        ],
                      },
                    },
                    // Layer controls
                    {
                      type: 'PopoverToggleMenu',
                      props: {
                        triggerLabel: 'Layers',
                        triggerIcon: 'stack',
                        items: [
                          {
                            id: 'user-locations',
                            label: 'User Locations',
                            icon: 'map-pin',
                            checked: { $store: 'spaceStore.showUserLocations' },
                            onToggle: { $action: 'spaceStore.toggleLayer', args: ['userLocations'] },
                          },
                          {
                            id: 'countries',
                            label: 'Country Outlines',
                            icon: 'flag',
                            checked: { $store: 'spaceStore.showCountryOutlines' },
                            onToggle: { $action: 'spaceStore.toggleLayer', args: ['countryOutlines'] },
                          },
                          {
                            id: 'h3',
                            label: 'H3 Hexagons',
                            icon: 'hexagon',
                            checked: { $store: 'spaceStore.showH3Hexagons' },
                            onToggle: { $action: 'spaceStore.toggleLayer', args: ['h3Hexagons'] },
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
            {
              type: 'we-text',
              props: {
                text: 'User locations around the world',
                size: 'lg',
                color: 'ui-600',
              },
            },
          ],
        },
        // Globe takes remaining space
        {
          type: 'CesiumGlobe',
          props: {
            width: '100%',
            height: 'calc(100vh - 200px)', // Full height minus header and padding
            backgroundLayers: [
              {
                factory: 'skyboxLayer',
                enabled: { $store: 'spaceStore.showSkybox' },
                options: {
                  textureSet: 'tycho2-4k',
                },
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
                factory: 'userLocationsLayer',
                enabled: { $store: 'spaceStore.showUserLocations' },
                options: {
                  locations: { $store: 'spaceStore.space.userLocations' },
                  markerSize: 15,
                  defaultColor: '#00ffff',
                  onLocationClick: {
                    $action: 'consoleStore.log',
                    args: ['Location clicked:', '$arg'],
                  },
                },
              },
              {
                factory: 'countryOutlinesLayer',
                enabled: { $store: 'spaceStore.showCountryOutlines' },
                options: {
                  color: '#ffffff',
                  opacity: 0.5,
                  width: 2,
                },
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
                  onHexagonClick: {
                    $action: 'consoleStore.log',
                    args: ['Hexagon clicked:', '$arg'],
                  },
                },
              },
            ],
          },
        },
      ],
    },
    {
      path: '/chat',
      type: 'Column',
      props: {
        width: '100%',
        height: '100%',
        p: '2rem',
      },
      children: [
        {
          type: 'we-text',
          props: {
            text: 'Chat View',
            size: '2xl',
            weight: 'bold',
          },
        },
      ],
    },
    {
      path: '/profile',
      type: 'Column',
      props: {
        width: '100%',
        height: '100%',
        p: '2rem',
      },
      children: [
        {
          type: 'we-text',
          props: {
            text: 'Profile View',
            size: '2xl',
            weight: 'bold',
          },
        },
      ],
    },
  ],
};
