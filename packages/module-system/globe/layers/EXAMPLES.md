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

Fetch with `$queries` on an ancestor, then shape the rows into locations with an expression. Any extra
field rides along to the click handler, which is how a pin knows what it stands for.

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
            "factory": "pointLocationsLayer",
            "options": {
              "locations": {
                "$": "local.spaces.filter(s, s.location).map(s, { id: s.id, kind: 'space', name: s.name, latitude: s.location.latitude, longitude: s.location.longitude, avatar: s.avatar })"
              },
              "markerSize": 20,
              "onLocationClick": { "$setLocal": "selected", "value": { "$": "event" } }
            }
          }
        ]
      }
    }
  ]
}
```

## The same kind twice

Two entries of one kind each need an `id`. Without one they share a key, collide, and only one is drawn.

```json
"planetLayers": [
  { "factory": "pointLocationsLayer", "id": "spaces", "options": { "locations": { "$": "local.spacePins" }, "defaultColor": "#a855f7" } },
  { "factory": "pointLocationsLayer", "id": "people", "options": { "locations": { "$": "local.peoplePins" }, "defaultColor": "#f97316" } }
]
```

## What a template cannot write

- **The imagery.** It is the globe's own: NASA's imagery by default, Cesium ion's where the deployment
  or the person has set the globe module's `ionAccessToken`. A template never carries a token.
- **A layer by code.** A layer kind is code merged into this package and listed in the catalogue; a
  template names one. What none of the kinds can draw is a contribution here, not a template.
