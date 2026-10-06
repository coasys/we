# @we/globe-layers

WE's first-party globe layers: what can be drawn on the earth (`planet`) and in the space around it
(`background`). Part of the globe family in `packages/module-system/globe/`: **module** (registry and
catalogue) · **protocol** (the contract) · **layers** (this) · **widget** (`CesiumGlobe`).

| Kind                    | Slot       | What it draws                                                             |
| ----------------------- | ---------- | ------------------------------------------------------------------------- |
| `pointsLayer`           | planet     | A marker per row — a dot or a picture, labelled, clustered if asked       |
| `pathsLayer`            | planet     | A line per row, between two places or along several, arcing               |
| `areasLayer`            | planet     | Filled shapes, a row's own or the countries the rows name                 |
| `hexbinLayer`           | planet     | Rows gathered into H3 cells, shaded and raised by what is in each         |
| `heatmapLayer`          | planet     | Rows as a continuous glow, bright where they gather                       |
| `satelliteOverlayLayer` | planet     | One day of NASA's imagery: the day's photo, fires, snow, rain, night      |
| `pointLocationsLayer`   | planet     | `pointsLayer` with its earlier option names, for the templates using them |
| `countryOutlinesLayer`  | planet     | Country borders, Natural Earth 1:50m, served by the app                   |
| `h3HexagonsLayer`       | planet     | The H3 grid, finer as the camera comes closer                             |
| `skyboxLayer`           | background | NASA's Tycho-2 star map                                                   |
| `proceduralStarsLayer`  | background | Stars at random depths, with parallax                                     |
| `solarSystemLayer`      | background | The sun, the planets for today, and their orbits                          |

The first five are the **data kinds**: each takes rows (`data`), field paths saying where in a row its
geometry is, and `style` rules in the GraphView's dialect, so a globe can draw a template's own data —
members coloured by role, countries shaded by how many posts came from them, a heat of activity. They
are general on purpose: a layer somebody shares is a configuration of these, as data, and a new
drawing need grows this list rather than living in a template.

## Using them in a template

A template places layers by name, as data. The names, their options and a worked example of each are
in `GLOBE_LAYER_CATALOG` (`packages/module-system/globe/module/src/catalog.ts`), which reaches the
generated reference and the validator; [EXAMPLES.md](./EXAMPLES.md) shows the patterns a globe
template is built from. The imagery under every layer is the widget's own, not a layer.

## Two engines

A globe is drawn by **Cesium**, the full 3D globe, or **MapLibre**, a lighter one for phones and
light builds. The globe module's `engine` setting chooses (`auto` picks MapLibre on a touchscreen or
a small machine); a template never names one. Each engine has its own registry so a MapLibre build
never loads Cesium:

| Engine   | Registry                                           | Draws                                           |
| -------- | -------------------------------------------------- | ----------------------------------------------- |
| Cesium   | `layerKinds` (`@we/module-globe/layers`)           | every kind                                      |
| MapLibre | `maplibreLayerKinds` (`@we/globe-layers/maplibre`) | every planet kind, and nothing around the earth |

The MapLibre registry lists the Cesium-only kinds too, with no renderer, so a template using one is
told once that it is not drawn there rather than that it does not exist.

MapLibre's own lines lie on the ground, so a `pathsLayer` arc is drawn there by a custom WebGL layer
(`src/maplibre/arcs.ts`) projected by MapLibre's own shader code, rather than by deck.gl, which would
be several hundred kilobytes on the engine that exists to be light.

## Time

A globe can follow a **clock** (`@we/clock`): `clock: "events"` names one of the app's clocks, the
same one `clockStore.clocks.events` reads and `clockStore.toggle` plays, so the controls beside a
globe are ordinary template nodes. A data kind given `time: "<field>"` then draws only the rows up to
the clock's moment; `window: "7d"` keeps only the recent ones, which fade out over the last quarter
of it. The clock's range is the span of every timed layer's rows, so nobody has to know the dates.
Until somebody plays or scrubs, the clock has no moment and every row is drawn.
`satelliteOverlayLayer` shows the clock's day.

Every renderer gets `context.clock`, which always answers and reads `null` with no clock. A data
kind's renderer follows it with `followTime` from `@we/globe-core`: hand it a redraw, and on every
redraw ask it for the slice to draw with `time.slice(options.data, options)`, passing that to the
kind's feature function. It contributes the rows' span to the clock and calls the redraw only when
what shows changes — a row's moment crossed, or a fade stepping down — so a playing clock costs a
layer nothing between those. Give it a `minInterval` for a redraw that rebuilds a batch.

## Writing a layer

A layer kind says what it is (an id, a slot, a description) and how it is drawn on each engine: a
**renderer** per engine, which is the only place that engine's API appears. The contract is in
`@we/globe-protocol`; import it from here. A kind both engines draw takes its meaning from
`src/meta.ts`, which each engine's registry spreads over its own renderer.

```typescript
import { Cartesian3, Color } from 'cesium';
import type { CesiumRendererContext, LayerKind } from '@we/globe-layers';

export interface PulseLayerOptions {
  /** CSS colour of the dot. */
  color?: string;
}

export const pulseLayer: LayerKind<PulseLayerOptions> = {
  id: 'pulseLayer',
  slot: 'planet',
  description: 'One dot at null island.',
  renderers: {
    cesium: ({ viewer, onCleanup }: CesiumRendererContext, options) => {
      const entity = viewer.entities.add({
        position: Cartesian3.fromDegrees(0, 0),
        point: { pixelSize: 10, color: Color.fromCssColorString(options.color ?? '#ff0000') },
      });
      onCleanup(() => viewer.entities.remove(entity));
      return {
        update: (next) => void (entity.point!.color = Color.fromCssColorString(next.color ?? '#ff0000') as never),
      };
    },
  },
};
```

- **`slot`** says which list the kind belongs in. The catalogue files it there and the validator
  refuses it in the other list.
- **A renderer per engine.** A kind with no renderer for the globe's engine is absent there, not
  broken. Keep everything that is not drawing in `@we/globe-core`, so a second engine's renderer
  stays thin: the data kinds are each a function there (`pointFeatures`, `pathFeatures`,
  `areaFeatures`, `hexFeatures`) turning options into placed, styled features, and a renderer only
  turns those into its engine's primitives, applying a `FeatureDiffer`'s diff on an update. Colours
  come out of the core as CSS (roles, tokens, `color-mix()`); `createColorResolver` turns them into
  RGBA under the theme of the globe's own element.
- **Clean up everything you add**, through `onCleanup`. A layer toggled off and on mounts again.
- **`update`**, returned by the renderer, runs when this layer's own options change and only then.
  Without it the layer is remounted on a change, which is correct and slower. Handlers in the options
  always call the template's newest one.
- **`zIndex`** arrives in the context for planet layers. Turn it into whatever ordering your drawing
  needs; the markers and lines turn it into altitude.

### Three registrations, all of which fail silently if missed

1. Export the factory from `src/index.ts`, and, for a MapLibre renderer, from `src/maplibre/index.ts`.
2. Add it to `layerKinds` in `packages/module-system/globe/module/src/layers.ts`, and to
   `maplibreLayerKinds` in `src/maplibre/index.ts` (with no renderer, if MapLibre does not draw it);
   it is filed under its own `id`, which is the name templates write.
3. Add an entry to `GLOBE_LAYER_CATALOG`, under its slot, with a description, its options and an
   example. `pnpm --filter @we/app-shell test` fails if the catalogue and the registry disagree.

Then `pnpm --filter @we/ai-context generate-context`, so the new kind reaches the reference.

### A layer must draw offline

WE is local-first, and a layer that fetches its data at runtime draws nothing without a network, and
can take the globe down with it (a skybox whose textures failed stopped Cesium's render loop).

- **Data the layer needs ships with the app.** Put it in `assets/` and read it from
  `import.meta.env.WE_GLOBE_LAYER_ASSETS_URL` inside `onMount`, never at module scope; every WE app
  serves that folder through `globeLayerAssets()` from `@we/globe-layers/vite`. See
  `planet/country-outlines` and `assets/README.md`.
- **Something only worth having online** (the 4k sky) loads in the background and replaces a local
  default once it has arrived. See `background/skybox`.
- **Never hand Cesium a URL that may fail** where a failure is rethrown during rendering, as a cube
  map's is. Load it yourself and pass Cesium the image.
- **The exception is imagery that is the network's by nature**: `satelliteOverlayLayer` shows what
  NASA's satellites saw on a day, which no app can ship. Offline it draws nothing, through Cesium's
  and MapLibre's ordinary tile loading, which already tolerate a tile that does not come.

### Events

`context.events` is a bus the layers on one globe share: `emit`, `on`, `off`, `once`. Use it for
layer-to-layer coordination. What a template reacts to goes through a handler option instead
(`onSelect` on the data kinds), which the template wires to an action like any prop.
