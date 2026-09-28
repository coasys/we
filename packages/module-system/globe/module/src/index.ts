/**
 * The Globe feature module — the first module, and the proof that the contribution points are
 * *sufficient*.
 *
 * Deliberately a **conversion, not a new feature**. The globe already worked, so its behaviour is a
 * fixed reference: if the module system can carry something built before the module system existed,
 * the seams are real.
 *
 * ## What moved, and what did not
 *
 * Only the *wiring* moved. `CesiumGlobe` stays in `@we/globe-widget` — it passes the props-only test
 * (`layerFactoryRegistry` is injected, and its `LayerStore` is a private `Map`, not a WE store), so it
 * is correctly a widget. The layers stay in `@we/globe-layers`.
 *
 * ## Why this module has no store
 *
 * Layer visibility is local state inside the route schema (`enabled: { $: 'local.showSkybox' }`).
 * A module with no store is a legitimate shape, and worth having as the first example so nobody
 * assumes stores are mandatory.
 */
import { defineModule, type ModuleDefinition, type ModuleHost } from '@we/module-shared';

/**
 * Build the module definition.
 *
 * A factory taking the widget rather than importing it, so this package never pulls Solid or
 * `@we/widgets` into its own bundle — the host passes in the component it already has. That keeps the
 * single-instance guarantee that matters once modules load dynamically, and it is why `frameworks`
 * names solid: the *component* is Solid, even though this file is not.
 */
export function createGlobeModule(cesiumGlobeComponent: unknown): ModuleDefinition {
  return defineModule({
    manifest: {
      id: 'globe',
      name: 'Globe',
      description: '3D globe with a modular layer system — locations, country outlines, H3 hexagons.',
      icon: 'globe-hemisphere-west',
      // Backend-agnostic: no owned entities, so no manifest→SDNA gap to fall into. The globe renders a
      // WebGL canvas and reaches Cesium Ion for terrain and imagery, which is what a person is told.
      requires: { frameworks: ['solid'], permissions: ['network:cesium-ion'] },
    },
    contributes: {
      components: { CesiumGlobe: cesiumGlobeComponent },
    },
  });
}

/** The one factory shape every module package exports — the generated registry imports it. */
export const createModule = (host: ModuleHost): ModuleDefinition => createGlobeModule(host.components.CesiumGlobe);
