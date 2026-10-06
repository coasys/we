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
 * (`layerKinds` is injected, and it touches no WE store), so it
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
      description:
        'A globe with a modular layer system — data on the earth, borders, the sky — drawn by Cesium or MapLibre.',
      icon: 'globe-hemisphere-west',
      // Backend-agnostic: no owned entities, so no manifest→SDNA gap to fall into. Cesium's own files
      // are served by the app, so what reaches the network is the imagery: NASA's, and a commercial
      // provider's only when somebody has chosen one and given its key. That is what a person is told.
      requires: {
        frameworks: ['solid'],
        permissions: [
          'network:gibs.earthdata.nasa.gov',
          'network:cesium-ion',
          'network:arcgis.com',
          'network:mapbox.com',
        ],
      },
    },
    contributes: {
      components: { CesiumGlobe: cesiumGlobeComponent },
      /**
       * Which imagery the globe draws, and a key for each provider that needs one. The host hands the
       * choice and its key to `CesiumGlobe` itself, so no template names them.
       *
       * One key per provider rather than one key for whichever is chosen, because settings resolve
       * level by level: a deployment choosing ion with its key, and a person switching themselves to
       * Esri without one, would otherwise send the deployment's ion token to Esri.
       *
       * Two levels. A deployment with its own agreement with a provider sets it in the seed; a person
       * with their own account sets it for themselves. No `space` level: a key is an account and a
       * quota, and a community setting would spend one member's for everybody.
       *
       * `string` rather than `secret`, for `call.iceServers`' reason: a `secret` is agent-level only,
       * which would take the deployment level away. These keys are client-side by design — each is
       * sent from the browser to its provider on every request — so they are scoped by the
       * restrictions set on them in the provider's dashboard (allowed URLs), not by being hidden.
       */
      settings: [
        {
          key: 'engine',
          label: 'Globe engine',
          description:
            'What draws the globe. Cesium is the full 3D globe, with the stars and planets around it and lines that ' +
            'arc. MapLibre is lighter and quicker on a phone: the same earth and the same data, with lines drawn ' +
            'flat and nothing around the earth. Automatic uses MapLibre on phones, tablets and small machines, and ' +
            'Cesium everywhere else.',
          type: 'enum',
          options: [
            { label: 'Automatic', value: 'auto' },
            { label: 'Cesium (full 3D)', value: 'cesium' },
            { label: 'MapLibre (lighter)', value: 'maplibre' },
          ],
          default: 'auto',
          levels: ['deployment', 'agent'],
        },
        {
          key: 'imagery',
          label: 'Globe imagery',
          description:
            "What the globe's surface is drawn with. NASA's needs no account and is sharp to about 30 m. " +
            'The others are sharp to street level and need a key from your own account, set below; ' +
            "using one means accepting that provider's terms. A provider with no key, or a key it " +
            "refuses, draws NASA's.",
          type: 'enum',
          options: [
            { label: 'NASA (no account)', value: 'nasa' },
            { label: 'Cesium ion (Bing aerial)', value: 'ion' },
            { label: 'Esri World Imagery', value: 'esri' },
            { label: 'Mapbox Satellite', value: 'mapbox' },
          ],
          default: 'nasa',
          levels: ['deployment', 'agent'],
        },
        {
          key: 'ionAccessToken',
          label: 'Cesium ion access token',
          description: 'From ion.cesium.com → Access Tokens. Used when the imagery is Cesium ion.',
          type: 'string',
          default: '',
          levels: ['deployment', 'agent'],
        },
        {
          key: 'esriApiKey',
          label: 'Esri API key',
          description:
            'From developers.arcgis.com → API keys, with the basemap styles privilege. Used when the imagery is Esri ' +
            'World Imagery. Esri serves the imagery even for a key it does not recognise, so check this one carefully: ' +
            'a mistyped key draws the imagery without your account being used.',
          type: 'string',
          default: '',
          levels: ['deployment', 'agent'],
        },
        {
          key: 'mapboxAccessToken',
          label: 'Mapbox access token',
          description: 'From account.mapbox.com → Tokens; a public token. Used when the imagery is Mapbox Satellite.',
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
export { type DeviceHints, deviceHints, engineChoiceFrom, type GlobeEngineChoice, resolveEngine } from './engine';
export { type ImageryChoice, imageryChoiceFrom, ionTokenFrom } from './imagery';
