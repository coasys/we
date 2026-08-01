/**
 * The Globe feature module — the first module, and the proof that the contribution points are
 * *sufficient*.
 *
 * Deliberately a **conversion, not a new feature**. The globe already worked, so its behaviour is a
 * fixed reference: if the module system can carry something built before the module system existed,
 * the seams are real. Writing a new feature to test new seams means a failure can't be attributed to
 * either.
 *
 * ## What moved, and what did not
 *
 * Only the *wiring* moved. `CesiumGlobe` stays in `@we/widgets` — it passes the props-only test
 * (`layerFactoryRegistry` is injected, and its `LayerStore` is a private `Map`, not a WE store), so it
 * is correctly a design-system widget. The layers stay in `@we/cesium-layers`. What was scattered
 * across `componentRegistry.tsx` — the layer set, the component wrapper — is now owned here.
 *
 * ## Why this module has no store
 *
 * Layer visibility is `$local` state inside the route schema (`enabled: { $local: 'showSkybox' }`).
 * Inventing a store would be new behaviour and would break the "identical afterwards" property this
 * conversion exists to demonstrate. A module with no store is a legitimate shape, and worth having as
 * the first example so nobody assumes stores are mandatory.
 *
 * ## What it exercises, and what it deliberately doesn't
 *
 * Exercises: `defineModule`, the module registry, a **module-private sub-registry** (layer factories —
 * something the call module will never test), a framework component contributed for an imperative
 * core, and schema fragments.
 *
 * Doesn't: shell slots (the globe is a route, not chrome — the host-slot migration covers those), and
 * the ephemeral port.
 */
import {
  countryOutlinesLayer,
  h3HexagonsLayer,
  type LayerFactory,
  pointLocationsLayer,
  proceduralStarsLayer,
  skyboxLayer,
  solarSystemLayer,
} from '@we/cesium-layers';
import { defineModule } from '@we/schema-shared';

/**
 * The layer set this module ships — a **module-private registry**, nested inside the module system.
 *
 * Worth noting as a shape: a module may own a plugin system of its own without the host needing a
 * generic "sub-registry" concept. Third-party layers do not need to live in this package either, since
 * `CesiumGlobe` resolves layers through an injected `Record<string, LayerFactory>` — an external layer
 * is just a package exporting a factory.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const layerFactoryRegistry: Record<string, LayerFactory<any>> = {
  // Planet layers
  pointLocationsLayer,
  countryOutlinesLayer,
  h3HexagonsLayer,
  // Background layers
  skyboxLayer,
  proceduralStarsLayer,
  solarSystemLayer,
};

/**
 * Build the module definition.
 *
 * A factory taking the widget rather than importing it, so this package never pulls Solid or
 * `@we/widgets` into its own bundle — the host passes in the component it already has. That keeps the
 * single-instance guarantee that matters once modules load dynamically, and it is why `frameworks`
 * below names solid: the *component* is Solid, even though this file is not.
 */
export function createGlobeModule(cesiumGlobeComponent: unknown) {
  return defineModule({
    id: 'globe',
    name: 'Globe',
    description: '3D globe with a modular layer system — locations, country outlines, H3 hexagons.',
    icon: 'globe-hemisphere-west',

    // The globe renders a WebGL canvas and can reach Cesium Ion for terrain/imagery assets.
    capabilities: ['network:cesium-ion'],

    // Backend-agnostic: no owned entities, so no manifest→SDNA gap to fall into. `backends` omitted
    // means portable, which is the default the contract makes you opt out of rather than into.
    frameworks: ['solid'],

    components: { CesiumGlobe: cesiumGlobeComponent },
  });
}
