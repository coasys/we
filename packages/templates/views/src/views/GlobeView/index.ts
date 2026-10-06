/**
 * Default Template — Globe Route (/)
 *
 * Cesium globe view
 */

import type { TemplateSchema } from '@we/schema-shared';

import { agentModal } from './AgentModal.ts';
import { spaceModal } from './SpaceModal.ts';

export const globeView: TemplateSchema = {
  meta: {
    name: 'Globe',
    description: 'Members and spaces placed on the earth',
    icon: 'globe-hemisphere-west',
    role: 'view',
    segment: 'globe',
    // The narrow case `keepAlive` exists for: rebuilding a Cesium viewer on every return to this
    // section costs a visible reload of the whole globe.
    keepAlive: true,
  },
  type: 'Column',
  props: { width: '100%', height: '100%' },
  // The spaces with a location, subscribed once for the layer that draws them.
  $queries: {
    spaceRows: {
      entity: 'Space',
      where: {
        url: { not: { $: 'datasetStore.currentDatasetCid' } },
        name: { contains: { $: 'local.searchText' } },
      },
      include: { location: true },
    },
    // Events with a place, for the layer that plays them through time.
    eventRows: {
      entity: 'EventBlock',
      include: { location: true },
      order: { startDate: 'desc' },
      limit: 500,
    },
  },
  $localState: {
    // Search filter
    searchText: { type: 'string', initial: '' },
    // Layer visibility toggles
    showSkybox: { type: 'boolean', initial: true },
    showStars: { type: 'boolean', initial: true },
    showSolarSystem: { type: 'boolean', initial: false },
    showCountryOutlines: { type: 'boolean', initial: true },
    showH3Hexagons: { type: 'boolean', initial: false },
    showUserLocations: { type: 'boolean', initial: true },
    showSpaceLocations: { type: 'boolean', initial: true },
    showSpaceHeat: { type: 'boolean', initial: false },
    showSpaceGlow: { type: 'boolean', initial: false },
    showEvents: { type: 'boolean', initial: true },
    // NASA's view of the earth on the clock's day
    showDailyPhoto: { type: 'boolean', initial: false },
    showFires: { type: 'boolean', initial: false },
    showSnow: { type: 'boolean', initial: false },
    showRain: { type: 'boolean', initial: false },
    showNightLights: { type: 'boolean', initial: false },
    // Currently selected pin (from clicking a location on the globe)
    selectedPin: { type: 'object', initial: null },
    // Modal open states
  },
  children: [
    // Header
    {
      type: 'Column',
      props: { width: '100%', ax: 'center', position: 'absolute', zIndex: 5 },
      children: [
        {
          type: 'Column',
          props: { width: '100%', maxWidth: 'var(--we-layout-lg)', p: '400', gap: '400' },
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
                        // The space around the earth, which only the full 3D engine draws.
                        hidden: { $: '!modules.globe.drawsSpace' },
                        items: [
                          {
                            type: 'toggle',
                            id: 'skybox',
                            label: 'Skybox',
                            icon: 'image',
                            checked: { $: 'local.showSkybox' },
                            onToggle: { $toggleLocal: 'showSkybox' },
                          },
                          {
                            type: 'toggle',
                            id: 'stars',
                            label: 'Procedural Stars',
                            icon: 'sparkle',
                            checked: { $: 'local.showStars' },
                            onToggle: { $toggleLocal: 'showStars' },
                          },
                          {
                            type: 'toggle',
                            id: 'solar-system',
                            label: 'Solar System',
                            icon: 'atom',
                            checked: { $: 'local.showSolarSystem' },
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
                            checked: { $: 'local.showCountryOutlines' },
                            onToggle: { $toggleLocal: 'showCountryOutlines' },
                          },
                          {
                            type: 'toggle',
                            id: 'h3',
                            label: 'H3 Hexagons',
                            icon: 'hexagon',
                            checked: { $: 'local.showH3Hexagons' },
                            onToggle: { $toggleLocal: 'showH3Hexagons' },
                          },
                        ],
                      },
                      {
                        type: 'group',
                        id: 'earth',
                        label: 'Earth',
                        collapsible: true,
                        items: [
                          {
                            type: 'toggle',
                            id: 'daily-photo',
                            label: 'Daily Photo',
                            icon: 'camera',
                            checked: { $: 'local.showDailyPhoto' },
                            onToggle: { $toggleLocal: 'showDailyPhoto' },
                          },
                          {
                            type: 'toggle',
                            id: 'fires',
                            label: 'Fires',
                            icon: 'fire-simple',
                            checked: { $: 'local.showFires' },
                            onToggle: { $toggleLocal: 'showFires' },
                          },
                          {
                            type: 'toggle',
                            id: 'snow',
                            label: 'Snow',
                            icon: 'snowflake',
                            checked: { $: 'local.showSnow' },
                            onToggle: { $toggleLocal: 'showSnow' },
                          },
                          {
                            type: 'toggle',
                            id: 'rain',
                            label: 'Rain',
                            icon: 'cloud-rain',
                            checked: { $: 'local.showRain' },
                            onToggle: { $toggleLocal: 'showRain' },
                          },
                          {
                            type: 'toggle',
                            id: 'night-lights',
                            label: 'Night Lights',
                            icon: 'moon-stars',
                            checked: { $: 'local.showNightLights' },
                            onToggle: { $toggleLocal: 'showNightLights' },
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
                            checked: { $: 'local.showUserLocations' },
                            onToggle: { $toggleLocal: 'showUserLocations' },
                          },
                          {
                            type: 'toggle',
                            id: 'space-locations',
                            label: 'Space Locations',
                            icon: 'map-pin',
                            checked: { $: 'local.showSpaceLocations' },
                            onToggle: { $toggleLocal: 'showSpaceLocations' },
                          },
                          {
                            type: 'toggle',
                            id: 'space-heat',
                            label: 'Space Heat',
                            icon: 'fire',
                            checked: { $: 'local.showSpaceHeat' },
                            onToggle: { $toggleLocal: 'showSpaceHeat' },
                          },
                          {
                            type: 'toggle',
                            id: 'space-glow',
                            label: 'Space Glow',
                            icon: 'sun',
                            checked: { $: 'local.showSpaceGlow' },
                            onToggle: { $toggleLocal: 'showSpaceGlow' },
                          },
                          {
                            type: 'toggle',
                            id: 'events',
                            label: 'Events',
                            icon: 'calendar',
                            checked: { $: 'local.showEvents' },
                            onToggle: { $toggleLocal: 'showEvents' },
                          },
                        ],
                      },
                    ],
                  },
                },
                // Search filter
                {
                  type: 'Search',
                  props: {
                    placeholder: 'Search spaces and people…',
                    onSearch: { $setLocal: 'searchText', value: { $: 'event' } },
                  },
                },
                // Create Space Button
                {
                  type: 'we-button',
                  props: {
                    text: 'Create New Space',
                    variant: 'primary',
                    height: '40px',
                    onClick: { $action: 'shellStore.setCreateSpaceOpen', args: [true] },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    // Cesium Globe
    {
      type: 'CesiumGlobe',
      props: {
        // The timeline below plays this clock: spaces appear as they were made, events as they happen,
        // and NASA's imagery shows the clock's day.
        clock: 'globe',
        backgroundLayers: [
          {
            factory: 'skyboxLayer',
            enabled: { $: 'local.showSkybox' },
            options: { textureSet: 'tycho2-4k' },
          },
          {
            factory: 'proceduralStarsLayer',
            enabled: { $: 'local.showStars' },
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
            enabled: { $: 'local.showSolarSystem' },
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
          // Spaces and members on one layer, so markers that overlap — a member in a space's city —
          // cluster into one count rather than two drawn on top of each other. Each toggle filters its
          // own rows out, and a rule keeps each kind its colour and size.
          {
            factory: 'pointsLayer',
            id: 'locations',
            options: {
              data: {
                $: "distinct(local.showSpaceLocations ? local.spaceRows.map(s, { id: s.id, kind: 'space', name: s.name, latitude: s.location.latitude, longitude: s.location.longitude, avatar: s.avatar, createdAt: s.createdAt }) : [], local.showUserLocations ? filter(spaceStore.members, { location: { exists: true }, handle: { contains: local.searchText } }).map(item, { id: item.did, kind: 'agent', name: item.name, latitude: item.location.latitude, longitude: item.location.longitude, avatar: item.avatar }) : [])",
              },
              label: 'name',
              cluster: true,
              // A space appears when it was made. People carry no date, so they show throughout.
              time: 'createdAt',
              style: [
                { style: { size: 20, color: '#a855f7', image: { from: 'data.avatar' } } },
                { when: { 'data.kind': 'agent' }, style: { size: 30, color: '#f97316' } },
              ],
              onSelect: { $setLocal: 'selectedPin', value: { $: 'event' } },
            },
          },
          // Where spaces gather: the same rows as the pins, binned into cells and raised by how many.
          {
            factory: 'hexbinLayer',
            id: 'space-heat',
            enabled: { $: 'local.showSpaceHeat' },
            options: {
              data: { $: 'local.spaceRows' },
              latitude: 'location.latitude',
              longitude: 'location.longitude',
              time: 'createdAt',
              resolution: 3,
              style: [
                {
                  style: {
                    color: {
                      metric: 'field',
                      options: { from: 'value' },
                      scale: { from: 'success-500', to: 'danger-500' },
                    },
                    opacity: 0.6,
                    // The least is still raised: a cell with one space in it is not a cell with none.
                    height: { metric: 'field', options: { from: 'value' }, range: [30000, 300000] },
                  },
                },
              ],
            },
          },
          // The same spaces as a glow rather than as cells.
          {
            factory: 'heatmapLayer',
            id: 'space-glow',
            enabled: { $: 'local.showSpaceGlow' },
            options: {
              data: { $: 'local.spaceRows' },
              latitude: 'location.latitude',
              longitude: 'location.longitude',
              time: 'createdAt',
              radius: 40,
            },
          },
          // Events where they happen, for the week either side of the clock's day.
          {
            factory: 'pointsLayer',
            id: 'events',
            enabled: { $: 'local.showEvents' },
            options: {
              data: {
                $: 'local.eventRows.filter(e, e.location).map(e, { id: e.id, name: e.title, latitude: e.location.latitude, longitude: e.location.longitude, startDate: e.startDate })',
              },
              label: 'name',
              labelMaxAltitude: 3000000,
              time: 'startDate',
              window: '7d',
              style: [
                { style: { size: 14, color: 'warning-500', borderColor: 'white' } },
                // The newest stand out: a day old or less.
                { when: { 'data.age': { lt: 1 } }, style: { size: 20 } },
              ],
            },
          },
          // NASA's imagery, each a layer of its own so several can show at once.
          {
            factory: 'satelliteOverlayLayer',
            id: 'daily-photo',
            enabled: { $: 'local.showDailyPhoto' },
            options: { product: 'true-color' },
          },
          {
            factory: 'satelliteOverlayLayer',
            id: 'snow',
            enabled: { $: 'local.showSnow' },
            options: { product: 'snow' },
          },
          {
            factory: 'satelliteOverlayLayer',
            id: 'rain',
            enabled: { $: 'local.showRain' },
            options: { product: 'precipitation' },
          },
          {
            factory: 'satelliteOverlayLayer',
            id: 'night-lights',
            enabled: { $: 'local.showNightLights' },
            options: { product: 'night-lights' },
          },
          {
            factory: 'satelliteOverlayLayer',
            id: 'fires',
            enabled: { $: 'local.showFires' },
            options: { product: 'fires' },
          },
          {
            factory: 'countryOutlinesLayer',
            enabled: { $: 'local.showCountryOutlines' },
            options: { color: '#ffffff', opacity: 0.5, width: 2 },
          },
          {
            factory: 'h3HexagonsLayer',
            enabled: { $: 'local.showH3Hexagons' },
            options: {
              maxResolution: 8,
              color: '#3388ff',
              opacity: 0.6,
              width: 2,
              hoverColor: '#3388ff',
              hoverOpacity: 0.3,
              onHexagonClick: null,
            },
          },
        ],
      },
    },

    // The timeline: plays the globe's clock, once its layers have given it a range to cross.
    {
      type: '$if',
      props: {
        condition: { $: 'clockStore.clocks.globe.canPlay' },
        then: {
          type: 'Column',
          props: {
            width: '100%',
            ax: 'center',
            position: 'absolute',
            bottom: '0',
            zIndex: 5,
            p: '400',
            pointerEvents: 'none',
          },
          children: [
            {
              type: 'Row',
              props: {
                width: '100%',
                maxWidth: 'var(--we-layout-md)',
                ay: 'center',
                gap: '300',
                px: '300',
                py: '200',
                bg: 'surface-raised',
                r: 'pill',
                shadow: 'md',
                pointerEvents: 'auto',
              },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'ghost',
                    size: 'sm',
                    square: true,
                    label: { $: "clockStore.clocks.globe.playing ? 'Pause' : 'Play'" },
                    onClick: { $action: 'clockStore.toggle', args: ['globe'] },
                  },
                  children: [
                    {
                      type: 'we-icon',
                      props: { name: { $: "clockStore.clocks.globe.playing ? 'pause' : 'play'" }, weight: 'fill' },
                    },
                  ],
                },
                {
                  type: 'we-slider',
                  props: {
                    flex: '1',
                    min: 0,
                    max: 1,
                    step: 0.001,
                    value: { $: 'clockStore.clocks.globe.progress' },
                    onInput: { $action: 'clockStore.seekProgress', args: ['globe', { $: 'event.detail' }] },
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: 'clockStore.clocks.globe.atIso' },
                    then: {
                      type: 'we-timestamp',
                      props: {
                        value: { $: 'clockStore.clocks.globe.atIso' },
                        dateStyle: 'medium',
                        color: 'text-muted',
                        whiteSpace: 'nowrap',
                      },
                    },
                    else: {
                      type: 'we-text',
                      props: { color: 'text-muted', whiteSpace: 'nowrap' },
                      children: ['Everything'],
                    },
                  },
                },
                // Back to showing everything, as before anybody pressed play.
                {
                  type: '$if',
                  props: {
                    condition: { $: 'clockStore.clocks.globe.atIso' },
                    then: {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'sm',
                        square: true,
                        label: 'Show everything',
                        onClick: [
                          { $action: 'clockStore.pause', args: ['globe'] },
                          { $action: 'clockStore.seek', args: ['globe', null] },
                        ],
                      },
                      children: [{ type: 'we-icon', props: { name: 'x' } }],
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    },

    // Space Modal (shown when a Space pin is clicked)
    {
      type: '$if',
      props: { condition: { $: "local.selectedPin.kind == 'space'" }, then: spaceModal },
    },

    // Agent Modal (shown when an Agent pin is clicked)
    {
      type: '$if',
      props: { condition: { $: "local.selectedPin.kind == 'agent'" }, then: agentModal },
    },
  ],
};
