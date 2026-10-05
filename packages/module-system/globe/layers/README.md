# @we/globe-layers

WE's first-party globe layers: what can be drawn on the earth (`planet`) and in the space around it
(`background`). Part of the globe family in `packages/module-system/globe/`: **module** (registry and
catalogue) · **protocol** (the contract) · **layers** (this) · **widget** (`CesiumGlobe`).

| Kind                   | Slot       | What it draws                                                    |
| ---------------------- | ---------- | ---------------------------------------------------------------- |
| `pointLocationsLayer`  | planet     | Markers with labels, avatars when given; pressing one reports it |
| `countryOutlinesLayer` | planet     | Country borders, Natural Earth 1:50m, served by the app          |
| `h3HexagonsLayer`      | planet     | The H3 grid, finer as the camera comes closer                    |
| `skyboxLayer`          | background | NASA's Tycho-2 star map                                          |
| `proceduralStarsLayer` | background | Stars at random depths, with parallax                            |
| `solarSystemLayer`     | background | The sun, the planets for today, and their orbits                 |

## Using them in a template

A template places layers by name, as data. The names, their options and a worked example of each are
in `GLOBE_LAYER_CATALOG` (`packages/module-system/globe/module/src/catalog.ts`), which reaches the
generated reference and the validator; [EXAMPLES.md](./EXAMPLES.md) shows the patterns a globe
template is built from. The imagery under every layer is the widget's own, not a layer.

## Writing a layer

A layer is a factory: options in, an object with lifecycle hooks out. The contract is in
`@we/globe-protocol`; import it from here.

```typescript
import { Cartesian3, Color } from 'cesium';
import type { LayerContext, LayerFactory } from '@we/globe-layers';

export interface PulseLayerOptions {
  /** CSS colour of the dot. */
  color?: string;
}

export const pulseLayer: LayerFactory<PulseLayerOptions> = (options) => ({
  name: 'pulse',
  metadata: { slot: 'planet', description: 'One dot at null island.' },
  onMount: ({ viewer, onCleanup }: LayerContext) => {
    const entity = viewer.entities.add({
      position: Cartesian3.fromDegrees(0, 0),
      point: { pixelSize: 10, color: Color.fromCssColorString(options?.color ?? '#ff0000') },
    });
    onCleanup(() => viewer.entities.remove(entity));
  },
});
```

- **`metadata.slot`** says which list the kind belongs in. The catalogue files it there and the
  validator refuses it in the other list.
- **Clean up everything you add**, through `onCleanup`. A layer toggled off and on mounts again.
- **`onUpdate`** runs when a mounted layer's options change. Without one, a change of options is not
  seen until the layer remounts.
- **`zIndex`** arrives in the context for planet layers. Turn it into whatever ordering your drawing
  needs; `pointLocationsLayer` turns it into altitude.

### Three registrations, all of which fail silently if missed

1. Export the factory from `src/index.ts`.
2. Add it to `layerFactoryRegistry` in `packages/module-system/globe/module/src/layers.ts`, under the
   name templates will write.
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

### Events

`context.events` is a bus the layers on one globe share: `emit`, `on`, `off`, `once`. Use it for
layer-to-layer coordination. What a template reacts to goes through a handler option instead
(`onLocationClick`, `onHexagonClick`), which the template wires to an action like any prop.
