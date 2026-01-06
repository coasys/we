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
      type: 'CollapsibleSidebar',
      props: {
        side: 'left',
        position: 'fixed',
        zIndex: 2,
        border: 'none',
        itemPadding: '12px',
        centerItems: true,
        // Navigation items
        items: [
          {
            type: 'item',
            id: 'dashboard',
            icon: 'house',
            label: 'Home',
            onClick: { $action: 'routeStore.navigate', args: ['/'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, ''] },
          },
          {
            type: 'item',
            id: 'feed',
            icon: 'rss',
            label: 'Feed',
            onClick: { $action: 'routeStore.navigate', args: ['/feed'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/feed'] },
          },
          {
            type: 'item',
            id: 'globe',
            icon: 'globe',
            label: 'Globe',
            onClick: { $action: 'routeStore.navigate', args: ['/globe'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/globe'] },
            badge: 10,
          },
          {
            type: 'item',
            id: 'graph',
            icon: 'graph',
            label: 'Graph',
            onClick: { $action: 'routeStore.navigate', args: ['/graph'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/graph'] },
          },
          // Spaces group
          {
            type: 'group',
            id: 'spaces',
            label: 'Spaces',
            collapsible: true,
            collapsed: false,
            items: [
              {
                type: 'item',
                id: 'design-team',
                avatar: {
                  src: 'https://i.pravatar.cc/150?img=1',
                  name: 'Design Team',
                  status: 'online',
                },
                label: 'Design Team',
                badge: 3,
                onClick: { $action: 'routeStore.navigate', args: ['/spaces/design'] },
                active: { $eq: [{ $store: 'routeStore.currentPath' }, '/spaces/design'] },
              },
              {
                type: 'item',
                id: 'dev-team',
                avatar: { src: 'https://i.pravatar.cc/150?img=2', name: 'Dev Team' },
                label: 'Dev Team',
                onClick: { $action: 'routeStore.navigate', args: ['/spaces/dev'] },
                active: { $eq: [{ $store: 'routeStore.currentPath' }, '/spaces/dev'] },
              },
            ],
          },
          // Quest group
          {
            type: 'group',
            id: 'tools',
            label: 'Quests',
            collapsible: true,
            items: [
              {
                type: 'item',
                id: 'dev-team',
                avatar: { src: 'https://i.pravatar.cc/150?img=2', name: 'Dev Team' },
                label: 'Quest 1',
                onClick: { $action: 'routeStore.navigate', args: ['/spaces/dev'] },
                active: { $eq: [{ $store: 'routeStore.currentPath' }, '/spaces/dev'] },
              },
            ],
          },
        ],

        // Footer items
        footerItems: [
          {
            type: 'item',
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
    // Right sidebar
    {
      type: 'CollapsibleSidebar',
      props: {
        side: 'right',
        position: 'fixed',
        zIndex: 2,
        border: 'none',
        itemPadding: '12px',
        centerItems: true,
        // Navigation items
        items: [
          {
            type: 'item',
            id: 'notifications',
            icon: 'bell',
            label: 'Notifications',
            onClick: { $action: 'routeStore.navigate', args: ['/notifications'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/notifications'] },
          },
          {
            type: 'item',
            id: 'messages',
            icon: 'envelope-simple',
            label: 'Messages',
            onClick: { $action: 'routeStore.navigate', args: ['/messages'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/messages'] },
            badge: 15,
          },
        ],

        // Footer items
        footerItems: [
          {
            type: 'item',
            id: 'logout',
            icon: 'list',
            label: 'Logout',
            onClick: { $action: 'authStore.logout' },
          },
        ],
      },
    },
  ],
  routes: [
    // {
    //   path: '/',
    //   type: 'Column',
    //   props: {
    //     width: '100%',
    //     height: '100%',
    //     p: '2rem',
    //   },
    //   children: [
    //     {},
    //   ],
    // },
    {
      path: '/feed',
      type: 'Column',
      props: {
        px: '60px',
        width: '100%',
        height: '100%',
        bg: 'ui-50',
      },
      children: [
        // Header section with filters and search
        {
          type: 'Column',
          props: {
            width: '100%',
            p: '2rem',
            gap: '1rem',
            bg: 'ui-0',
            borderBottom: '1px solid',
            borderColor: 'ui-200',
          },
          children: [
            // Title
            {
              type: 'we-text',
              props: {
                text: 'Feed',
                size: '800',
                weight: '600',
                color: 'ui-900',
              },
            },
            // Filters and Search Row
            {
              type: 'Row',
              props: {
                width: '100%',
                gap: '1rem',
                ay: 'center',
              },
              children: [
                // Filter buttons
                {
                  type: 'Row',
                  props: {
                    gap: '0.5rem',
                    ay: 'center',
                  },
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        text: 'All',
                        variant: 'primary',
                        size: 'sm',
                      },
                    },
                    {
                      type: 'we-button',
                      props: {
                        text: 'Following',
                        variant: 'ghost',
                        size: 'sm',
                      },
                    },
                    {
                      type: 'we-button',
                      props: {
                        text: 'Trending',
                        variant: 'ghost',
                        size: 'sm',
                      },
                    },
                    {
                      type: 'we-button',
                      props: {
                        text: 'Recent',
                        variant: 'ghost',
                        size: 'sm',
                      },
                    },
                  ],
                },
                // Search bar
                {
                  type: 'Row',
                  props: {
                    flex: '1',
                    maxWidth: '400px',
                    ml: 'auto',
                  },
                  children: [
                    {
                      type: 'we-input',
                      props: {
                        py: '200',
                        placeholder: 'Search posts...',
                        width: '100%',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        // Posts grid
        {
          type: 'Column',
          props: {
            width: '100%',
            height: '100%',
            p: '2rem',
            gap: '1.5rem',
            overflow: 'auto',
          },
          children: [
            // Posts container - using CSS Grid for responsive layout
            {
              type: 'Column',
              props: {
                styles: {
                  display: 'grid',
                  'grid-template-columns': 'repeat(auto-fill, minmax(350px, 1fr))',
                  gap: '1.5rem',
                  width: '100%',
                },
              },
              children: [
                // Post 1
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'Sarah Chen',
                      avatar: 'https://i.pravatar.cc/150?img=5',
                    },
                    title: 'Building Scalable Design Systems',
                    text: 'Just published a comprehensive guide on creating design systems that scale with your team. Key lessons learned from working with 50+ designers.',
                  },
                },
                // Post 2
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'Marcus Rodriguez',
                      avatar: 'https://i.pravatar.cc/150?img=12',
                    },
                    title: 'The Future of Web3 UX',
                    text: 'Exploring how decentralized applications can provide better user experiences. The gap between Web2 and Web3 UX is closing faster than we think.',
                  },
                },
                // Post 3
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'Elena Popov',
                      avatar: 'https://i.pravatar.cc/150?img=9',
                    },
                    title: 'Animation Best Practices 2026',
                    text: 'Performance-first animations that delight users without sacrificing speed. Learn the techniques that top product teams are using.',
                  },
                },
                // Post 4
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'James Wilson',
                      avatar: 'https://i.pravatar.cc/150?img=3',
                    },
                    title: 'TypeScript 5.5 New Features',
                    text: 'Breaking down the latest TypeScript release and what it means for modern application development. Some game-changing improvements here.',
                  },
                },
                // Post 5
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'Priya Sharma',
                      avatar: 'https://i.pravatar.cc/150?img=16',
                    },
                    title: 'Accessibility in 2026',
                    text: 'Why accessibility is not optional anymore. Real-world examples of inclusive design making products better for everyone.',
                  },
                },
                // Post 6
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'Alex Kim',
                      avatar: 'https://i.pravatar.cc/150?img=7',
                    },
                    title: 'Reactive Programming Patterns',
                    text: 'Deep dive into reactive programming with SolidJS. How fine-grained reactivity changes the way we think about state management.',
                  },
                },
                // Post 7
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'Sophie Martin',
                      avatar: 'https://i.pravatar.cc/150?img=10',
                    },
                    title: 'Design Tokens Revolution',
                    text: 'How design tokens are transforming the way teams collaborate between design and development. A standardized approach that works.',
                  },
                },
                // Post 8
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'David Liu',
                      avatar: 'https://i.pravatar.cc/150?img=13',
                    },
                    title: 'Building with Cesium',
                    text: 'Creating stunning 3D visualizations with Cesium. From basic globe rendering to complex spatial data visualization.',
                  },
                },
                // Post 9
                {
                  type: 'PostCard',
                  props: {
                    creator: {
                      name: 'Maya Patel',
                      avatar: 'https://i.pravatar.cc/150?img=20',
                    },
                    title: 'Component Architecture Tips',
                    text: 'Lessons learned from building 100+ reusable components. How to strike the balance between flexibility and simplicity.',
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      path: '/globe',
      type: 'Column',
      props: {
        px: '60px',
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
    // {
    //   path: '/profile',
    //   type: 'Column',
    //   props: {
    //     width: '100%',
    //     height: '100%',
    //     p: '2rem',
    //   },
    //   children: [
    //     {
    //       type: 'we-text',
    //       props: {
    //         text: 'Profile View',
    //         size: '2xl',
    //         weight: 'bold',
    //       },
    //     },
    //   ],
    // },
  ],
};
