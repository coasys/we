/**
 * The Cesium conversion, as a regression test rather than a demo.
 *
 * The globe was built before the module system existed, so its behaviour is a fixed reference: if the
 * contribution points can carry it *unchanged*, they are sufficient. A throwaway "hello" module could
 * only show that wiring exists.
 *
 * Rendering the globe needs WebGL and a Cesium Ion token, so visual verification is manual. What can
 * be asserted here is the part that actually moved — that the layer set resolves identically from its
 * new owner, and that the module declares itself honestly.
 */
import { createGlobeModule, layerFactoryRegistry } from '@we/module-globe';
import { checkModuleCompatibility } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

import { moduleRegistry } from '../src/shared/registries/moduleRegistry';

/** Exactly the set `componentRegistry.tsx` held before the conversion. */
const EXPECTED_LAYERS = [
  'pointLocationsLayer',
  'countryOutlinesLayer',
  'h3HexagonsLayer',
  'skyboxLayer',
  'proceduralStarsLayer',
  'solarSystemLayer',
];

describe('globe module — the layer set survived the move', () => {
  it('ships every layer the app-framework registry used to hold', () => {
    expect(Object.keys(layerFactoryRegistry).sort()).toEqual([...EXPECTED_LAYERS].sort());
  });

  it('exposes each layer as a callable factory, not just a key', () => {
    // The registry resolving by name is what CesiumGlobe depends on; a missing factory would only
    // surface as a blank globe at runtime.
    for (const name of EXPECTED_LAYERS) {
      expect(typeof layerFactoryRegistry[name]).toBe('function');
    }
  });

  // The `componentRegistry` re-export is deliberately not asserted here: importing it pulls the whole
  // Solid component tree into a node environment, and the re-export existing is a compile-time fact
  // `tsc` already checks. A jsdom environment for one identity assertion isn't worth it.
});

describe('globe module — what it declares', () => {
  const definition = createGlobeModule(() => null);

  it('is backend-agnostic, because it owns no entities', () => {
    // `backends` omitted means portable. The globe has no durable data of its own, so it never meets
    // the manifest→SDNA gap that forces `backends: ['ad4m']` on entity-owning modules.
    expect(definition.backends).toBeUndefined();
    expect(checkModuleCompatibility(definition, { backend: 'nextgraph', framework: 'solid' }).compatible).toBe(true);
  });

  it('declares solid, because its imperative core genuinely is a framework component', () => {
    expect(definition.frameworks).toEqual(['solid']);
    const plan = checkModuleCompatibility(definition, { backend: 'ad4m', framework: 'react' });
    expect(plan.compatible).toBe(false);
    expect(plan.problems[0]).toContain('react');
  });

  it('contributes exactly one component — the imperative core, nothing else', () => {
    // Tier 2 discipline: a Cesium Viewer must be framework code, but that is the *only* part which
    // has to be. Chrome and panels would be fragments.
    expect(Object.keys(definition.components ?? {})).toEqual(['CesiumGlobe']);
  });

  it('registers cleanly against a solid/ad4m host', () => {
    const result = moduleRegistry.register(definition, { backend: 'ad4m', framework: 'solid' });
    expect(result.registered).toBe(true);
    expect(moduleRegistry.components().CesiumGlobe).toBeDefined();
    moduleRegistry.unregister('globe');
  });

  it('owns no store, which is a legitimate module shape', () => {
    // Layer visibility is $local state in the route schema. Inventing a store would be new behaviour
    // and would break the "identical afterwards" property this conversion exists to prove.
    expect(definition.createStore).toBeUndefined();
  });
});
