# Globe templates — the patterns

A globe in a template is a `CesiumGlobe` node with two lists of layers. These are the shapes a globe
template is built from. Every layer's options are in `GLOBE_LAYER_CATALOG`
(`packages/module-system/globe/module/src/catalog.ts`); `GlobeView`
(`packages/templates/views/src/views/GlobeView/index.ts`) uses all of them at once.

## The smallest globe

```json
{
  "type": "CesiumGlobe",
  "props": {
    "backgroundLayers": [{ "factory": "skyboxLayer" }],
    "planetLayers": [{ "factory": "countryOutlinesLayer" }]
  }
}
```

A layer in the wrong list is refused by the validator: a skybox draws nothing among the planet layers.

## Layers a reader can switch on and off

`enabled` takes an expression, so a layer follows a `$localState` toggle. The globe mounts and unmounts
it as the value changes.

```json
{
  "type": "Column",
  "$localState": { "showBorders": { "type": "boolean", "initial": true } },
  "children": [
    {
      "type": "we-switch",
      "props": {
        "label": "Borders",
        "checked": { "$": "local.showBorders" },
        "onChange": { "$toggleLocal": "showBorders" }
      }
    },
    {
      "type": "CesiumGlobe",
      "props": {
        "planetLayers": [{ "factory": "countryOutlinesLayer", "enabled": { "$": "local.showBorders" } }]
      }
    }
  ]
}
```

## Drawing records from the space

Fetch with `$queries` on an ancestor and hand the rows to a data kind. The rows go in as they are:
field paths say where the position is, dotted for a nested field, and pressing a marker hands its
whole row to `onSelect`.

```json
{
  "type": "Column",
  "$queries": { "spaces": { "entity": "Space", "include": { "location": true }, "limit": 200 } },
  "$localState": { "selected": { "type": "object", "initial": null } },
  "children": [
    {
      "type": "CesiumGlobe",
      "props": {
        "planetLayers": [
          {
            "factory": "pointsLayer",
            "id": "spaces",
            "options": {
              "data": { "$": "local.spaces" },
              "latitude": "location.latitude",
              "longitude": "location.longitude",
              "style": [{ "style": { "size": 18, "color": "accent", "image": { "from": "data.avatar" } } }],
              "onSelect": { "$setLocal": "selected", "value": { "$": "event" } }
            }
          }
        ]
      }
    }
  ]
}
```

## Styling by rules

`style` is the GraphView's rule list: each rule's `style` applies where its `when` matches, in order,
later rules winning per property. A value is a literal, a field of the row (`{ "from": "data.avatar" }`),
or a metric scaled across all the rows — which is what makes "bigger the more they post" one line.

```json
"style": [
  { "style": { "color": "accent", "size": 10 } },
  { "when": { "data.role": "admin" }, "style": { "color": "warning-500" } },
  { "style": { "size": { "metric": "field", "options": { "from": "postCount" }, "range": [8, 28] } } }
]
```

A row without the field a `from` or a metric reads keeps what the rules before decided, so a member
who has never posted is drawn at the base size rather than the smallest.

## Thousands of markers

`cluster` draws markers close together on screen as one with a count, and pressing one zooms in.
`labelMaxAltitude` keeps names off the globe until the camera is near enough to read them.

```json
{
  "factory": "pointsLayer",
  "options": {
    "data": { "$": "local.sightings" },
    "label": "species",
    "labelMaxAltitude": 1500000,
    "cluster": { "radius": 50 }
  }
}
```

## Countries shaded by data

`areasLayer` with `area: "countries"` groups rows by the country they name and draws each country
once, with how many rows as `data.value` — so the rows need no counting first. With no `style` the
countries are shaded green to red; a rule can raise them too.

```json
{
  "factory": "areasLayer",
  "options": {
    "data": { "$": "spaceStore.members.filter(m, m.location)" },
    "area": "countries",
    "key": "location.countryCode",
    "style": [
      {
        "style": {
          "color": {
            "metric": "field",
            "options": { "from": "value" },
            "scale": { "from": "success-500", "to": "danger-500" }
          },
          "height": { "metric": "field", "options": { "from": "value" }, "range": [30000, 400000] }
        }
      }
    ]
  }
}
```

`aggregate: "sum"` with `value: "postCount"` shades by the members' posts rather than their number.

## A heat of where things happen

`hexbinLayer` gathers rows into hexagonal cells, so a few thousand posts are a few hundred cells.

```json
{
  "factory": "hexbinLayer",
  "id": "heat",
  "enabled": { "$": "local.showHeat" },
  "options": {
    "data": { "$": "local.posts" },
    "latitude": "location.latitude",
    "longitude": "location.longitude",
    "resolution": 3
  }
}
```

`heatmapLayer` takes the same rows as a glow instead: no cells to count or press, and no edges to read
as boundaries the data does not have.

```json
{
  "factory": "heatmapLayer",
  "id": "glow",
  "options": { "data": { "$": "local.posts" }, "latitude": "location.latitude", "longitude": "location.longitude" }
}
```

## Playing data through time

Give the globe a clock and a data layer a field holding each row's moment. Rows from after the clock's
moment are not drawn, so playing it shows them arriving; `window` keeps only the recent ones. The
controls are ordinary nodes reading and driving the same clock by name, and appear once the layers
have given it a range to play through.

```json
{
  "type": "Column",
  "children": [
    {
      "type": "CesiumGlobe",
      "props": {
        "clock": "events",
        "planetLayers": [
          {
            "factory": "pointsLayer",
            "options": {
              "data": { "$": "local.events" },
              "latitude": "location.latitude",
              "longitude": "location.longitude",
              "time": "startDate",
              "window": "7d"
            }
          },
          { "factory": "satelliteOverlayLayer", "options": { "product": "true-color" } }
        ]
      }
    },
    {
      "type": "$if",
      "props": {
        "condition": { "$": "clockStore.clocks.events.canPlay" },
        "then": {
          "type": "Row",
          "props": { "gap": "300", "ay": "center" },
          "children": [
            {
              "type": "we-button",
              "props": { "onClick": { "$action": "clockStore.toggle", "args": ["events"] } },
              "children": [{ "$": "clockStore.clocks.events.playing ? 'Pause' : 'Play'" }]
            },
            {
              "type": "we-slider",
              "props": {
                "flex": "1",
                "max": 1,
                "step": 0.001,
                "value": { "$": "clockStore.clocks.events.progress" },
                "onInput": { "$action": "clockStore.seekProgress", "args": ["events", { "$": "event.detail" }] }
              }
            },
            {
              "type": "we-timestamp",
              "props": { "value": { "$": "clockStore.clocks.events.atIso" }, "dateStyle": "medium" }
            }
          ]
        }
      }
    }
  ]
}
```

The satellite overlay shows the clock's day, so the weather moves with the events. A heat or a height
scaled across the rows is relative to the rows drawn at that moment; give the metric `min` and `max`
to hold the scale still while it plays.

## Routes

`pathsLayer` draws a line per row. `arcHeight` is a share of the line's own length, so a set of routes
arcs in proportion; a rule can read the length, in kilometres, as `data.length`.

```json
{
  "factory": "pathsLayer",
  "options": {
    "data": { "$": "local.trips" },
    "from": { "latitude": "origin.latitude", "longitude": "origin.longitude" },
    "to": { "latitude": "destination.latitude", "longitude": "destination.longitude" },
    "style": [{ "style": { "color": "accent", "arcHeight": 0.25 } }]
  }
}
```

## A layer to share is a configuration

What somebody publishes as "a layer" — members by country, a heat of activity — is one or more entries
like the ones above, as data: it installs with a template or a fragment, from anyone, and needs no code.
`GlobeView`'s "Space Heat" toggle is one, a `hexbinLayer` over the same rows its pins draw:

```json
{
  "factory": "hexbinLayer",
  "id": "space-heat",
  "enabled": { "$": "local.showSpaceHeat" },
  "options": {
    "data": { "$": "local.spaceRows" },
    "latitude": "location.latitude",
    "longitude": "location.longitude",
    "resolution": 3,
    "style": [
      {
        "style": {
          "color": {
            "metric": "field",
            "options": { "from": "value" },
            "scale": { "from": "success-500", "to": "danger-500" }
          },
          "opacity": 0.6,
          "height": { "metric": "field", "options": { "from": "value" }, "range": [30000, 300000] }
        }
      }
    ]
  }
}
```

A drawing none of the kinds can make is a new kind, merged here, rather than a template.

## The same kind twice

Two entries of one kind each need an `id`. Without one they share a key, collide, and only one is drawn.

```json
"planetLayers": [
  { "factory": "pointsLayer", "id": "spaces", "options": { "data": { "$": "local.spaces" }, "style": [{ "style": { "color": "#a855f7" } }] } },
  { "factory": "pointsLayer", "id": "people", "options": { "data": { "$": "local.people" }, "style": [{ "style": { "color": "#f97316" } }] } }
]
```

## What a template cannot write

- **The imagery.** It is the globe's own: NASA's by default, or Cesium ion's, Esri's or Mapbox's
  where the deployment or the person has chosen one in the globe module's `imagery` setting and
  given its key. A template never carries a key.
- **A layer by code.** A layer kind is code merged into this package and listed in the catalogue; a
  template names one. What none of the kinds can draw is a contribution here, not a template.
