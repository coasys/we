/**
 * Default Template — Globe Route (/)
 *
 * Cesium globe view
 */

import type { RouteSchema } from '@we/schema-shared';

import { agentModal } from './AgentModal';
import { createAgentModal } from './CreateAgentModal';
import { createSpaceModal } from './CreateSpaceModal';
import { spaceModal } from './SpaceModal';

export const globeRoute: RouteSchema = {
  path: '/globe',
  type: 'Column',
  $localState: {
    // Layer visibility toggles
    showSkybox: { type: 'boolean', initial: true },
    showStars: { type: 'boolean', initial: true },
    showSolarSystem: { type: 'boolean', initial: false },
    showCountryOutlines: { type: 'boolean', initial: true },
    showH3Hexagons: { type: 'boolean', initial: false },
    showUserLocations: { type: 'boolean', initial: true },
    showSpaceLocations: { type: 'boolean', initial: true },
    // Currently selected pin (from clicking a location on the globe)
    selectedPin: { type: 'object', initial: null },
    // Modal open states
    createSpaceModalOpen: { type: 'boolean', initial: false },
    createAgentModalOpen: { type: 'boolean', initial: false },
  },
  children: [
    // Header
    {
      type: 'Column',
      props: { width: 'calc(100% - 72px)', p: '400', gap: '400', position: 'absolute', zIndex: 5 },
      children: [
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
                        checked: { $local: 'showSkybox' },
                        onToggle: { $toggleLocal: 'showSkybox' },
                      },
                      {
                        type: 'toggle',
                        id: 'stars',
                        label: 'Procedural Stars',
                        icon: 'sparkle',
                        checked: { $local: 'showStars' },
                        onToggle: { $toggleLocal: 'showStars' },
                      },
                      {
                        type: 'toggle',
                        id: 'solar-system',
                        label: 'Solar System',
                        icon: 'atom',
                        checked: { $local: 'showSolarSystem' },
                        onToggle: { $toggleLocal: 'showSolarSystem' },
                      },
                    ],
                  },
                  {
                    type: 'group',
                    id: 'planet-surface',
                    label: 'Planet',
                    collapsible: true,
                    items: [
                      {
                        type: 'toggle',
                        id: 'countries',
                        label: 'Country Outlines',
                        icon: 'flag',
                        checked: { $local: 'showCountryOutlines' },
                        onToggle: { $toggleLocal: 'showCountryOutlines' },
                      },
                      {
                        type: 'toggle',
                        id: 'h3',
                        label: 'H3 Hexagons',
                        icon: 'hexagon',
                        checked: { $local: 'showH3Hexagons' },
                        onToggle: { $toggleLocal: 'showH3Hexagons' },
                      },
                    ],
                  },
                  {
                    type: 'group',
                    id: 'content',
                    label: 'Content',
                    collapsible: true,
                    items: [
                      {
                        type: 'toggle',
                        id: 'user-locations',
                        label: 'User Locations',
                        icon: 'map-pin',
                        checked: { $local: 'showUserLocations' },
                        onToggle: { $toggleLocal: 'showUserLocations' },
                      },
                      {
                        type: 'toggle',
                        id: 'space-locations',
                        label: 'Space Locations',
                        icon: 'map-pin',
                        checked: { $local: 'showSpaceLocations' },
                        onToggle: { $toggleLocal: 'showSpaceLocations' },
                      },
                    ],
                  },
                ],
              },
            },
            // Create Space Button
            {
              type: 'we-button',
              props: {
                text: 'Create New Space',
                variant: 'primary',
                height: '40px',
                onClick: { $setLocal: 'createSpaceModalOpen', value: true },
              },
            },
            // Create Agent Profile Button
            {
              type: 'we-button',
              props: {
                text: 'Add Agent Profile',
                variant: 'primary',
                height: '40px',
                onClick: { $setLocal: 'createAgentModalOpen', value: true },
              },
            },

            // Space store test button
            {
              type: 'we-button',
              props: {
                text: 'Test',
                variant: 'primary',
                height: '40px',
                onClick: { $action: 'spaceStore.test' },
              },
            },
          ],
        },
      ],
    },
    // Cesium Globe
    {
      type: 'CesiumGlobe',
      props: {
        backgroundLayers: [
          {
            factory: 'skyboxLayer',
            enabled: { $local: 'showSkybox' },
            options: { textureSet: 'tycho2-4k' },
          },
          {
            factory: 'proceduralStarsLayer',
            enabled: { $local: 'showStars' },
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
            enabled: { $local: 'showSolarSystem' },
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
            factory: 'pointLocationsLayer',
            id: 'space-locations',
            enabled: { $local: 'showSpaceLocations' },
            options: {
              locations: {
                $map: {
                  items: {
                    $query: {
                      model: 'Space',
                      where: { id: { not: { $store: 'spaceStore.space.id' } } },
                      include: { location: true },
                    },
                  },
                  select: {
                    id: '$item.id',
                    kind: 'space',
                    name: '$item.name',
                    latitude: '$item.location.latitude',
                    longitude: '$item.location.longitude',
                    avatar: '$item.avatar',
                  },
                },
              },
              markerSize: 20,
              defaultColor: '#a855f7',
              onLocationClick: { $setLocal: 'selectedPin', from: '$event' },
            },
          },
          {
            factory: 'pointLocationsLayer',
            id: 'agent-locations',
            enabled: { $local: 'showUserLocations' },
            options: {
              locations: {
                $map: {
                  items: {
                    $query: {
                      model: 'AgentProfile',
                      include: { location: true },
                    },
                  },
                  select: {
                    id: '$item.id',
                    kind: 'agent',
                    name: { $concat: ['$item.firstName', ' ', '$item.lastName'] },
                    latitude: '$item.location.latitude',
                    longitude: '$item.location.longitude',
                    avatar: '$item.avatar',
                  },
                },
              },
              markerSize: 30,
              defaultColor: '#f97316',
              onLocationClick: { $setLocal: 'selectedPin', from: '$event' },
            },
          },
          {
            factory: 'countryOutlinesLayer',
            enabled: { $local: 'showCountryOutlines' },
            options: { color: '#ffffff', opacity: 0.5, width: 2 },
          },
          {
            factory: 'h3HexagonsLayer',
            enabled: { $local: 'showH3Hexagons' },
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

    // Create Space Modal
    {
      type: '$if',
      props: { condition: { $local: 'createSpaceModalOpen' }, then: createSpaceModal },
    },

    // Create Agent Profile Modal
    {
      type: '$if',
      props: { condition: { $local: 'createAgentModalOpen' }, then: createAgentModal },
    },

    // Space Modal (shown when a Space pin is clicked)
    {
      type: '$if',
      props: { condition: { $eq: [{ $local: 'selectedPin.kind' }, 'space'] }, then: spaceModal },
    },

    // Agent Modal (shown when an Agent pin is clicked)
    {
      type: '$if',
      props: { condition: { $eq: [{ $local: 'selectedPin.kind' }, 'agent'] }, then: agentModal },
    },
  ],
};
