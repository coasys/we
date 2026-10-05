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
      // Backend-agnostic: no owned entities, so no manifest→SDNA gap to fall into. Cesium's own files
      // are served by the app, so what reaches the network is the imagery: NASA's, and ion's only
      // when somebody has supplied a token. That is what a person is told.
      requires: {
        frameworks: ['solid'],
        permissions: ['network:gibs.earthdata.nasa.gov', 'network:cesium-ion'],
      },
    },
    contributes: {
      components: { CesiumGlobe: cesiumGlobeComponent },
      /**
       * The one thing that turns ion on. The host hands it to `CesiumGlobe` itself, so no template
       * names it.
       *
       * Two levels. A deployment with its own agreement with Cesium sets it in the seed; a person
       * with their own ion account sets it for themselves. No `space` level: a token is an account
       * and a quota, and a community setting would spend one member's for everybody.
       *
       * `string` rather than `secret`, for `call.iceServers`' reason: a `secret` is agent-level only,
       * which would take the deployment level away. An ion token is a client-side token by design —
       * it is sent from the browser to ion on every request — so it is scoped by the restrictions set
       * on it in the ion dashboard (allowed URLs, assets), not by being hidden.
       */
      settings: [
        {
          key: 'ionAccessToken',
          label: 'Cesium ion access token',
          description:
            "Shows Cesium ion's world imagery instead of NASA's. Empty uses NASA Blue Marble, which " +
            'needs no account. The token is sent to Cesium ion from your browser, and using it ' +
            "means accepting ion's terms.",
          type: 'string',
          default: '',
          levels: ['deployment', 'agent'],
        },
      ],
    },
  });
}

/** The one factory shape every module package exports — the generated registry imports it. */
export const createModule = (host: ModuleHost): ModuleDefinition => createGlobeModule(host.components.CesiumGlobe);

export { GLOBE_LAYER_CATALOG } from './catalog';
