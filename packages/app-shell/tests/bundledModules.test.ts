/**
 * Seed-declared module activation.
 *
 * The seed's stated purpose already includes "which modules to include", so this is the deployment
 * layer of the three-part enablement story — `AgentSettings.installedModules` and
 * `Space.enabledModules` are the other two. The map of factories is generated from the seed
 * (`bundledModules.generated.ts`); what is tested here is the activation over it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activateSeedModules, bundledModules } from '../src/shared/registries/bundledModules';
import { moduleRegistry } from '../src/shared/registries/moduleRegistry';

const host = { backend: 'ad4m', framework: 'solid' };
const deps = { components: { CesiumGlobe: () => null, GraphView: () => null } };

beforeEach(() => {
  for (const { definition } of moduleRegistry.all()) moduleRegistry.unregister(definition.manifest.id);
});

describe('activateSeedModules', () => {
  it('activates a module the seed declares', () => {
    const result = activateSeedModules(['globe'], deps, host, moduleRegistry);
    expect(result.activated).toEqual(['globe']);
    expect(moduleRegistry.has('globe')).toBe(true);
  });

  it('activates nothing when the seed declares nothing', () => {
    expect(activateSeedModules(undefined, deps, host, moduleRegistry).activated).toEqual([]);
    expect(moduleRegistry.all()).toHaveLength(0);
  });

  it('reports an unknown id rather than ignoring it', () => {
    // A silently missing module surfaces much later as an unexplained missing component — which is
    // exactly the confusion the renderer's placeholder now has to name.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = activateSeedModules(['globe', 'nonexistent'], deps, host, moduleRegistry);

    expect(result.activated).toEqual(['globe']);
    expect(result.missing).toEqual(['nonexistent']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('records a refusal separately from a missing id — they are different faults', () => {
    // Missing means the build lacks the module; refused means it is present but cannot run here.
    // Collapsing them would send someone hunting for a packaging problem that isn't there.
    const refusing = { register: () => ({ registered: false, problems: ['needs backend nextgraph'] }) };
    const result = activateSeedModules(['globe'], deps, host, refusing);

    expect(result.activated).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.refused).toEqual([{ id: 'globe', problems: ['needs backend nextgraph'] }]);
  });

  it('passes host components through, so a module never imports them itself', () => {
    // The globe's definition is built from the CesiumGlobe the host already holds — which is what
    // keeps Solid and @we/widgets single instances.
    activateSeedModules(['globe'], deps, host, moduleRegistry);
    expect(moduleRegistry.get('globe')?.definition.contributes?.components?.CesiumGlobe).toBe(
      deps.components.CesiumGlobe,
    );
  });

  it('exposes every module the seed names, in the seed’s order', () => {
    // The generated map is the seed's list: an unlisted module leaves the bundle, and the order is
    // the module rail's order.
    expect(Object.keys(bundledModules)).toEqual(['call', 'transcribe', 'pocket', 'notes', 'globe', 'graph']);
  });

  it('takes a factory map of its own, so a test can activate a module the seed left out', () => {
    const custom = { extra: () => ({ manifest: { id: 'extra', name: 'Extra' } }) };
    const result = activateSeedModules(['extra'], deps, host, moduleRegistry, custom);
    expect(result.activated).toEqual(['extra']);
    expect(moduleRegistry.has('extra')).toBe(true);
  });
});
