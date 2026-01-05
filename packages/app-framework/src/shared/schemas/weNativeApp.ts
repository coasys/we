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
    // { type: 'we-button', props: { p: '600', hoverProps: { bg: 'success-500' } }, children: ['Test Button'] },
    // Left sidebar - CollapsibleSidebar
    {
      type: 'CollapsibleSidebar',
      props: {
        side: 'left',
        position: 'fixed',
        zIndex: 2,
        transitionDuration: 500,
        // collapsedWidth: '150px',
        // expandedWidth: '450px',
        // border: '5px solid #ddd',
        border: 'none',
        itemPadding: '12px',
        // itemGap: '300',
        centerItems: true,
        // iconSize: '26px',
        // padding: '20px',
        // bg: 'ui-500',
        // itemColorActive: 'success-600',
        // itemColorHover: 'danger-500',
        // badgeBg: 'primary-500',
        // badgeColor: 'ui-0',
        // badgeBg: 'ui-200',
        // badgeColor: 'ui-800',
        // Navigation items
        items: [
          {
            id: 'dashboard',
            icon: 'house',
            label: 'Home',
            onClick: { $action: 'routeStore.navigate', args: ['/home'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/home'] },
          },
          {
            id: 'feed',
            icon: 'rss',
            label: 'Feed',
            onClick: { $action: 'routeStore.navigate', args: ['/feed'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/feed'] },
          },
          {
            id: 'globe',
            icon: 'globe',
            label: 'Globe',
            onClick: { $action: 'routeStore.navigate', args: ['/'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/'] },
            badge: 10,
          },
          {
            id: 'graph',
            icon: 'graph',
            label: 'Graph',
            onClick: { $action: 'routeStore.navigate', args: ['/graph'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/graph'] },
          },
        ],

        // Footer items
        footerItems: [
          {
            id: 'logout',
            icon: 'list',
            label: 'Logout',
            onClick: { $action: 'authStore.logout' },
          },
        ],
      },
      slots: {
        header: {
          type: 'Column',
          props: {
            width: '66px',
            height: '66px',
            ax: 'center',
            ay: 'center',
          },
          children: [
            {
              type: 'we-image',
              props: {
                src: '/we-text.svg',
                alt: 'WE Logo',
                width: '38px',
                height: '38px',
                gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              },
            },
          ],
        },
      },
    },
    // Main panel
    {
      type: 'Column',
      props: {
        zIndex: 1,
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
        pl: '80px',
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
                            icon: 'sparkle',
                            checked: { $store: 'spaceStore.showStars' },
                            onToggle: { $action: 'spaceStore.toggleBackground', args: ['stars'] },
                          },
                          {
                            id: 'solar-system',
                            label: 'Solar System',
                            icon: 'atom',
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
            // {
            //   type: 'we-text',
            //   props: {
            //     text: 'User locations around the world',
            //     size: 'lg',
            //     color: 'ui-600',
            //   },
            // },
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
