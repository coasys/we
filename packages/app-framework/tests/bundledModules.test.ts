/**
 * Seed-declared module activation.
 *
 * The seed's stated purpose already includes "which modules to include", so this is the deployment
 * layer of the three-part enablement story — the other two (`AgentSettings.installedModules`,
 * `Space.enabledModules`) arrive with the marketplace, when modules become installable rather than
 * bundled.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activateSeedModules, bundledModules } from '../src/shared/registries/bundledModules';
import { moduleRegistry } from '../src/shared/registries/moduleRegistry';

const host = { backend: 'ad4m', framework: 'solid' };
const deps = { components: { CesiumGlobe: () => null } };

beforeEach(() => {
  for (const { definition } of moduleRegistry.all()) moduleRegistry.unregister(definition.id);
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
    expect(moduleRegistry.get('globe')?.definition.components?.CesiumGlobe).toBe(deps.components.CesiumGlobe);
  });

  it('exposes the globe as a bundled module', () => {
    expect(Object.keys(bundledModules)).toContain('globe');
  });
});
