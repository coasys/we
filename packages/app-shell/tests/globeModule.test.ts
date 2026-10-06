/**
 * The Cesium conversion, as a regression test rather than a demo.
 *
 * The globe was built before the module system existed, so its behaviour is a fixed reference: if the
 * contribution points can carry it *unchanged*, they are sufficient. A throwaway "hello" module could
 * only show that wiring exists.
 *
 * Rendering the globe needs WebGL, so visual verification is manual. What can
 * be asserted here is the part that actually moved — that the layer set resolves identically from its
 * new owner, and that the module declares itself honestly.
 */
import {
  createGlobeModule,
  engineChoiceFrom,
  GLOBE_LAYER_CATALOG,
  imageryChoiceFrom,
  ionTokenFrom,
  resolveEngine,
} from '@we/module-globe';
import { layerKinds } from '@we/module-globe/layers';
import { maplibreLayerKinds } from '@we/module-globe/layers-maplibre';
import { checkModuleCompatibility } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

import { moduleRegistry } from '../src/shared/registries/moduleRegistry';

/** Exactly the set `componentRegistry.tsx` held before the conversion. */
const EXPECTED_LAYERS = [
  'pointsLayer',
  'pathsLayer',
  'areasLayer',
  'hexbinLayer',
  'pointLocationsLayer',
  'countryOutlinesLayer',
  'h3HexagonsLayer',
  'skyboxLayer',
  'proceduralStarsLayer',
  'solarSystemLayer',
];

describe('globe module — the layer set survived the move', () => {
  it('ships every layer the app-framework registry used to hold', () => {
    expect(Object.keys(layerKinds).sort()).toEqual([...EXPECTED_LAYERS].sort());
  });

  it('holds each kind under its own id, with a Cesium renderer', () => {
    // The registry resolving by name is what CesiumGlobe depends on; a kind filed under the wrong
    // name, or with no renderer for the engine, would only surface as a blank globe at runtime.
    for (const name of EXPECTED_LAYERS) {
      expect(layerKinds[name]?.id).toBe(name);
      expect(typeof layerKinds[name]?.renderers.cesium).toBe('function');
    }
  });

  // The `componentRegistry` re-export is deliberately not asserted here: importing it pulls the whole
  // Solid component tree into a node environment, and the re-export existing is a compile-time fact
  // `tsc` already checks. A jsdom environment for one identity assertion isn't worth it.
});

/** What the light engine draws; the rest are Cesium's only. */
const MAPLIBRE_DRAWS = [
  'pointsLayer',
  'pathsLayer',
  'areasLayer',
  'hexbinLayer',
  'pointLocationsLayer',
  'countryOutlinesLayer',
];

describe('globe module — the MapLibre engine', () => {
  it('knows every kind Cesium does, with the same meaning', () => {
    // Knowing a kind it does not draw is what lets it say "not drawn here" rather than "no such kind".
    expect(Object.keys(maplibreLayerKinds).sort()).toEqual([...EXPECTED_LAYERS].sort());
    for (const name of EXPECTED_LAYERS) {
      const { id, slot, description } = maplibreLayerKinds[name];
      expect({ id, slot, description }).toEqual({
        id: layerKinds[name].id,
        slot: layerKinds[name].slot,
        description: layerKinds[name].description,
      });
    }
  });

  it('draws the data kinds and the borders, and nothing of the space around the earth', () => {
    for (const name of EXPECTED_LAYERS) {
      const drawn = typeof maplibreLayerKinds[name].renderers.maplibre === 'function';
      expect([name, drawn]).toEqual([name, MAPLIBRE_DRAWS.includes(name)]);
      // Never Cesium's renderer: this registry must not reach the other engine.
      expect(maplibreLayerKinds[name].renderers.cesium).toBeUndefined();
    }
  });
});

describe('globe module — which engine', () => {
  const desktop = { coarsePointer: false, deviceMemory: 16, cores: 12 };

  it('takes an explicit choice as it is, on any device', () => {
    expect(resolveEngine('cesium', { coarsePointer: true })).toBe('cesium');
    expect(resolveEngine('maplibre', desktop)).toBe('maplibre');
  });

  it('chooses MapLibre automatically on a touchscreen or a small machine, and Cesium elsewhere', () => {
    expect(resolveEngine('auto', desktop)).toBe('cesium');
    expect(resolveEngine('auto', { ...desktop, coarsePointer: true })).toBe('maplibre');
    expect(resolveEngine('auto', { ...desktop, deviceMemory: 4 })).toBe('maplibre');
    expect(resolveEngine('auto', { ...desktop, cores: 4 })).toBe('maplibre');
    // A browser that does not say is not assumed small.
    expect(resolveEngine('auto', {})).toBe('cesium');
  });

  it('reads anything but a known engine as automatic', () => {
    expect(engineChoiceFrom({})).toBe('auto');
    expect(engineChoiceFrom({ engine: 'webgpu' })).toBe('auto');
    expect(engineChoiceFrom({ engine: 'maplibre' })).toBe('maplibre');
  });

  it('declares the setting, at the deployment and for each person', () => {
    const setting = createGlobeModule(() => null).contributes?.settings?.find((s) => s.key === 'engine');
    expect(setting?.default).toBe('auto');
    expect(setting?.levels).toEqual(['deployment', 'agent']);
  });
});

describe('globe module — what it declares', () => {
  const definition = createGlobeModule(() => null);

  it('is backend-agnostic, because it owns no entities', () => {
    // `backends` omitted means portable. The globe has no durable data of its own, so it never meets
    // the manifest→SDNA gap that forces `backends: ['ad4m']` on entity-owning modules.
    expect(definition.manifest.requires?.backends).toBeUndefined();
    expect(checkModuleCompatibility(definition, { backend: 'nextgraph', framework: 'solid' }).compatible).toBe(true);
  });

  it('declares solid, because its imperative core genuinely is a framework component', () => {
    expect(definition.manifest.requires?.frameworks).toEqual(['solid']);
    const plan = checkModuleCompatibility(definition, { backend: 'ad4m', framework: 'react' });
    expect(plan.compatible).toBe(false);
    expect(plan.problems[0]).toContain('react');
  });

  it('contributes exactly one component — the imperative core, nothing else', () => {
    // Tier 2 discipline: a Cesium Viewer must be framework code, but that is the *only* part which
    // has to be. Chrome and panels would be fragments.
    expect(Object.keys(definition.contributes?.components ?? {})).toEqual(['CesiumGlobe']);
  });

  it('registers cleanly against a solid/ad4m host', () => {
    const result = moduleRegistry.register(definition, { backend: 'ad4m', framework: 'solid' });
    expect(result.registered).toBe(true);
    expect(moduleRegistry.components().CesiumGlobe).toBeDefined();
    moduleRegistry.unregister('globe');
  });

  it('lets a deployment or a person choose imagery and give its key, and never a space', () => {
    // A key is an account and a quota. A space level would spend one member's for everybody.
    for (const key of ['imagery', 'ionAccessToken', 'esriApiKey', 'mapboxAccessToken']) {
      const setting = definition.contributes?.settings?.find((s) => s.key === key);
      expect(setting?.levels, key).toEqual(['deployment', 'agent']);
    }
    const imagery = definition.contributes?.settings?.find((s) => s.key === 'imagery');
    expect(imagery?.default).toBe('nasa');
    expect(imagery?.options?.map((o) => o.value)).toEqual(['nasa', 'ion', 'esri', 'mapbox']);
  });

  it('owns no store, which is a legitimate module shape', () => {
    // Layer visibility is $local state in the route schema. Inventing a store would be new behaviour
    // and would break the "identical afterwards" property this conversion exists to prove.
    expect(definition.createStore).toBeUndefined();
  });
});

/*
  The catalogue is the only thing that tells a template author, or an LLM, which `factory` strings a
  globe accepts, and the validator checks against it. A name catalogued and not registered is a
  template written from the documentation that draws nothing; a layer registered and not catalogued
  is one nobody can find. Both fail silently, so both directions are asserted here, against the
  registry `CesiumGlobe` is actually given.
*/
describe('globe module — the layer catalogue', () => {
  const byId = new Map(GLOBE_LAYER_CATALOG.plugins.map((plugin) => [plugin.id, plugin]));

  it('names exactly the layers the registry holds', () => {
    expect([...byId.keys()].sort()).toEqual(Object.keys(layerKinds).sort());
  });

  it('files each layer under the slot the layer itself declares', () => {
    for (const [id, kind] of Object.entries(layerKinds)) {
      expect(byId.get(id)?.category, id).toBe(kind.slot);
    }
  });

  it('says what each one is for, and shows one being used under its own name', () => {
    for (const plugin of GLOBE_LAYER_CATALOG.plugins) {
      expect(plugin.description?.trim(), `${plugin.id} has no description`).toBeTruthy();
      for (const option of plugin.options ?? []) {
        expect(option.description?.trim(), `${plugin.id}.${option.name} has no description`).toBeTruthy();
      }
      // Valid JSON, and naming itself: an example copied into a template must work as it stands.
      expect(JSON.parse(plugin.example ?? '{}').factory, `${plugin.id}'s example`).toBe(plugin.id);
    }
  });

  it('places planet layers and background layers in their own lists', () => {
    expect(GLOBE_LAYER_CATALOG.placements).toEqual([
      { prop: 'planetLayers', key: 'factory', categories: ['planet'] },
      { prop: 'backgroundLayers', key: 'factory', categories: ['background'] },
    ]);
  });
});

/*
  What the host hands the globe from its settings. One key per provider is the point: settings resolve
  level by level, so a deployment's ion token must never travel with a person's choice of Esri.
*/
describe('globe module — imagery from settings', () => {
  const keys = { ionAccessToken: 'ion-key', esriApiKey: 'esri-key', mapboxAccessToken: 'mapbox-key' };

  it.each([
    ['ion', { provider: 'ion', key: 'ion-key' }],
    ['esri', { provider: 'esri', key: 'esri-key' }],
    ['mapbox', { provider: 'mapbox', key: 'mapbox-key' }],
  ])('gives %s its own key', (imagery, expected) => {
    expect(imageryChoiceFrom({ ...keys, imagery })).toEqual(expected);
  });

  it("is NASA's when NASA is chosen, nothing is, or the choice is unknown", () => {
    for (const imagery of ['nasa', undefined, 'bing']) expect(imageryChoiceFrom({ ...keys, imagery })).toBeUndefined();
  });

  it("is NASA's when the chosen provider has no key, rather than borrowing another's", () => {
    expect(imageryChoiceFrom({ imagery: 'esri', ionAccessToken: 'ion-key', esriApiKey: '  ' })).toBeUndefined();
  });

  it('still offers the ion token to layers that need one, whatever the imagery', () => {
    expect(ionTokenFrom({ imagery: 'nasa', ionAccessToken: ' ion-key ' })).toBe('ion-key');
  });
});
