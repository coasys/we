/**
 * What a template may name inside a `CesiumGlobe`.
 *
 * The globe's layer protocol was always good, and a template author could still not use it: props say
 * `planetLayers` is a list, and nothing said which `factory` strings exist or what options each takes,
 * so an LLM could not write a globe from the reference. This catalogue is that list. `@we/ai-context`
 * reads it (`context: { type: 'plugins' }` in this package's `package.json`) into the generated
 * reference, and the validator checks every literal `factory` against it through `placements`.
 *
 * Pure data, so importing it costs nothing: the layers themselves, which pull Cesium, are in
 * `./layers`. Keep each entry in step with its layer's options interface in `@we/globe-layers`; the
 * test in `@we/app-shell` (`globeModule.test.ts`) checks the names and slots against the registry.
 */
import type { PluginCatalog } from '@we/schema-shared';

export const GLOBE_LAYER_CATALOG: PluginCatalog = {
  component: 'CesiumGlobe',
  description:
    'Layers are listed in two props: planetLayers (drawn on the earth) and backgroundLayers (the space around it). ' +
    'Each entry is { factory, id?, enabled?, zIndex?, options? }: factory names the kind below; id is required ' +
    'when one kind appears twice, or the two collide and one is not drawn; enabled takes an expression, so a ' +
    "layer can follow a toggle; zIndex is a planet layer's stacking order, which each kind interprets. Options take expressions and handlers like any prop, so a layer can draw " +
    'what a $queries entry fetched: read it with { "$": "local.rows.map(…)" }. The imagery is the globe\'s own ' +
    'and is not a layer. ' +
    'The data kinds (pointsLayer, pathsLayer, areasLayer, hexbinLayer) each take rows as `data`, field paths saying ' +
    'where in a row its geometry is (dotted for nested fields: "location.latitude"), and `style`: rules in the ' +
    "GraphView's dialect, [{ when?, style }], applied in order with later matches winning per property. A rule's " +
    '`when` reads a row\'s fields as "data.<field>"; a style value is a literal, { "from": "data.<field>" } to read ' +
    'it off the row, or { "metric": "field", "options": { "from": "<field>" }, "range": [min, max] } (a number) or ' +
    '"scale": "heat" | "cool" | "categorical" | { "from": colour, "to": colour } (a colour) to scale it across all ' +
    'the rows. Colours are roles or tokens ("accent", "warning-500") or CSS. Pressing a feature calls onSelect.',
  placements: [
    { prop: 'planetLayers', key: 'factory', categories: ['planet'] },
    { prop: 'backgroundLayers', key: 'factory', categories: ['background'] },
  ],
  plugins: [
    // ─── Planet ────────────────────────────────────────────────────────────────
    {
      id: 'pointsLayer',
      category: 'planet',
      description:
        'A marker per row: a dot, or a picture, with a label. For members, spaces, events, sightings — anything with a place. Thousands are fine; close together they can cluster into one marker with a count.',
      options: [
        { name: 'data', type: 'object[]', description: 'The rows. Rows without a place are left out.' },
        { name: 'latitude', type: 'string', description: 'Field path to the latitude. Default "latitude".' },
        { name: 'longitude', type: 'string', description: 'Field path to the longitude. Default "longitude".' },
        {
          name: 'id',
          type: 'string',
          description: 'Field naming each row, so an update restyles rather than redraws. Default "id".',
        },
        { name: 'label', type: 'string', description: 'Field shown beside each marker. Default "name"; "" for none.' },
        {
          name: 'labelMaxAltitude',
          type: 'number',
          description:
            'Labels show only while the camera is below this many metres — e.g. 2000000 to hide them from orbit.',
        },
        {
          name: 'style',
          type: 'rules',
          description:
            'Properties: size (pixels, default 12), color, opacity, borderColor (default white), borderWidth (default 2), image (a picture instead of a dot, usually { "from": "data.avatar" }), labelColor.',
        },
        {
          name: 'cluster',
          type: 'boolean | { radius?, color? }',
          description:
            'Draw markers within radius pixels (default 60) of each other as one, with a count; pressing one zooms in.',
        },
        { name: 'onSelect', type: 'handler', description: 'Runs when a marker is pressed, with its row as event.' },
      ],
      example: `{ "factory": "pointsLayer", "id": "members", "options": { "data": { "$": "spaceStore.members.filter(m, m.location)" }, "latitude": "location.latitude", "longitude": "location.longitude", "label": "name", "style": [{ "style": { "color": "accent", "image": { "from": "data.avatar" } } }, { "when": { "data.role": "admin" }, "style": { "borderColor": "warning-500" } }], "cluster": true, "onSelect": { "$setLocal": "selected", "value": { "$": "event" } } } }`,
    },
    {
      id: 'pointLocationsLayer',
      category: 'planet',
      description:
        'Markers at places on the earth, each with a label, drawn as the avatar when one is given and as a coloured dot otherwise. Pressing one calls onLocationClick with that location, every field included, so a location can carry what a modal needs (a kind, an id).',
      options: [
        {
          name: 'locations',
          type: '{ id, name, latitude, longitude, avatar?, color? }[]',
          description:
            'What to mark. Usually an expression over a query or a store — any extra fields ride along to onLocationClick.',
        },
        { name: 'markerSize', type: 'number', description: 'Diameter in pixels. Default 15.' },
        {
          name: 'defaultColor',
          type: 'string',
          description: 'CSS colour of a dot with no avatar or color. Default "#00ffff".',
        },
        {
          name: 'onLocationClick',
          type: 'handler',
          description: 'Runs when a marker is pressed, with the location as event.',
        },
      ],
      example: `{ "factory": "pointLocationsLayer", "id": "space-locations", "enabled": { "$": "local.showSpaces" }, "options": { "locations": { "$": "local.spaceRows.map(s, { id: s.id, kind: 'space', name: s.name, latitude: s.location.latitude, longitude: s.location.longitude, avatar: s.avatar })" }, "markerSize": 20, "defaultColor": "#a855f7", "onLocationClick": { "$setLocal": "selectedPin", "value": { "$": "event" } } } }`,
    },
    {
      id: 'countryOutlinesLayer',
      category: 'planet',
      description:
        'Country borders, from Natural Earth 1:50m. The app serves the data itself, so the borders draw offline. Draped on the surface, so markers and hexagons always sit above them.',
      options: [
        { name: 'color', type: 'string', description: 'CSS colour of the lines. Default "#ffffff".' },
        { name: 'opacity', type: 'number', description: '0 to 1. Default 0.5.' },
        { name: 'width', type: 'number', description: 'Line width in pixels. Default 2.' },
        {
          name: 'dataUrl',
          type: 'string',
          description:
            "Another GeoJSON of boundaries to draw instead. Only a URL on the app's own origin is fetched; any other is ignored, with a warning, and the default drawn.",
        },
      ],
      example: `{ "factory": "countryOutlinesLayer", "options": { "color": "#ffffff", "opacity": 0.5, "width": 2 } }`,
    },
    {
      id: 'h3HexagonsLayer',
      category: 'planet',
      description:
        'The H3 hexagon grid, finer as the camera comes closer: each zoom draws the resolution whose cells suit it. A hovered cell is highlighted.',
      options: [
        { name: 'maxResolution', type: 'number', description: 'Finest H3 resolution drawn, 0–15. Default 8.' },
        { name: 'color', type: 'string', description: 'CSS colour of the cell edges. Default "#3388ff".' },
        { name: 'opacity', type: 'number', description: 'Edge opacity, 0 to 1. Default 0.6.' },
        { name: 'width', type: 'number', description: 'Edge width in pixels. Default 2.' },
        { name: 'hoverColor', type: 'string', description: 'CSS colour of a hovered cell. Default "#3388ff".' },
        { name: 'hoverOpacity', type: 'number', description: 'Opacity of a hovered cell. Default 0.3.' },
        {
          name: 'onHexagonClick',
          type: 'handler',
          description: "Runs when a cell is pressed, with the cell's H3 index as event.",
        },
      ],
      example: `{ "factory": "h3HexagonsLayer", "enabled": { "$": "local.showHexagons" }, "options": { "maxResolution": 8, "color": "#3388ff", "opacity": 0.6 } }`,
    },

    // ─── Background ────────────────────────────────────────────────────────────
    {
      id: 'skyboxLayer',
      category: 'background',
      description:
        "A star map around the globe, from NASA's Tycho-2 catalogue. Cesium's own copy shows at once and offline; the set asked for replaces it once it has loaded.",
      options: [
        {
          name: 'textureSet',
          type: '"tycho2-1k" | "tycho2-2k" | "tycho2-4k" | "custom"',
          description: 'Resolution of each face: 1k is 2.4 MB, 2k 5.8 MB, 4k 20 MB. Default "tycho2-1k".',
        },
        {
          name: 'customPaths',
          type: '{ px, nx, py, ny, pz, nz }',
          description: 'One image URL per cube face, with textureSet "custom".',
        },
      ],
      example: `{ "factory": "skyboxLayer", "enabled": { "$": "local.showSkybox" }, "options": { "textureSet": "tycho2-4k" } }`,
    },
    {
      id: 'proceduralStarsLayer',
      category: 'background',
      description:
        'Points of light at random depths around the earth, which move against each other as the camera turns.',
      options: [
        { name: 'count', type: 'number', description: 'How many stars. Default 5000.' },
        { name: 'minDistance', type: 'number', description: 'Nearest star, in metres from the surface.' },
        { name: 'maxDistance', type: 'number', description: 'Farthest star, in metres from the surface.' },
        { name: 'minBrightness', type: 'number', description: 'Dimmest star, 0 to 1. Default 0.3.' },
        { name: 'maxBrightness', type: 'number', description: 'Brightest star, 0 to 1. Default 1.' },
        { name: 'minSize', type: 'number', description: 'Smallest star in pixels. Default 1.' },
        { name: 'maxSize', type: 'number', description: 'Largest star in pixels. Default 3.' },
        { name: 'color', type: 'string', description: 'CSS colour. Default "#ffffff".' },
      ],
      example: `{ "factory": "proceduralStarsLayer", "enabled": { "$": "local.showStars" }, "options": { "count": 2000, "minDistance": 10000, "maxDistance": 100000000 } }`,
    },
    {
      id: 'solarSystemLayer',
      category: 'background',
      description:
        'The sun, the planets at their positions for today, and their orbits, scaled down to be seen from the earth.',
      options: [
        {
          name: 'planets',
          type: 'string[]',
          description: 'Which to draw: mercury, venus, earth, mars, jupiter, saturn, uranus, neptune.',
        },
        { name: 'showSun', type: 'boolean', description: 'Default true.' },
        { name: 'showOrbits', type: 'boolean', description: 'Default true.' },
        { name: 'showPlanets', type: 'boolean', description: 'Default true.' },
        { name: 'showLabels', type: 'boolean', description: 'Default true.' },
        { name: 'planetScale', type: 'number', description: 'Multiplies the size of each planet’s point. Default 1.' },
        {
          name: 'orbitScale',
          type: 'number',
          description: 'Shrinks the orbits to fit the view; the real system is far too large. Default 0.0001.',
        },
        { name: 'orbitWidth', type: 'number', description: 'Orbit line width in pixels. Default 2.' },
        { name: 'orbitResolution', type: 'number', description: 'Points per orbit; more is smoother. Default 360.' },
      ],
      example: `{ "factory": "solarSystemLayer", "enabled": { "$": "local.showSolarSystem" }, "options": { "planets": ["mercury", "venus", "earth", "mars"], "orbitScale": 0.01 } }`,
    },
  ],
};
