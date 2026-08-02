import { describe, expect, it } from 'vitest';

import { checkModuleCompatibility, defineModule, type ModuleDefinition, modulePredicateViolations } from './module';

const host = { backend: 'ad4m', framework: 'solid' };

function mod(overrides: Partial<ModuleDefinition> = {}): ModuleDefinition {
  return defineModule({ id: 'test', name: 'Test', ...overrides });
}

describe('checkModuleCompatibility', () => {
  it('treats an omitted axis as agnostic, so the portable case is the default', () => {
    // A module that declares neither backends nor frameworks runs anywhere. Making the portable case
    // the default is what forces coupling to be opted into and declared.
    expect(checkModuleCompatibility(mod(), host).compatible).toBe(true);
    expect(checkModuleCompatibility(mod(), { backend: 'nextgraph', framework: 'react' }).compatible).toBe(true);
  });

  it('refuses a module that needs a backend this host is not', () => {
    const plan = checkModuleCompatibility(mod({ backends: ['ad4m'] }), { ...host, backend: 'nextgraph' });
    expect(plan.compatible).toBe(false);
    expect(plan.problems[0]).toContain('ad4m');
    expect(plan.problems[0]).toContain('nextgraph');
  });

  it('admits an entity-owning module on the backend it declares', () => {
    // The escape hatch working as intended: coupling is visible, not blocking.
    expect(checkModuleCompatibility(mod({ backends: ['ad4m'] }), host).compatible).toBe(true);
  });

  it('refuses a module with no build for this framework', () => {
    const plan = checkModuleCompatibility(mod({ frameworks: ['react'] }), host);
    expect(plan.compatible).toBe(false);
    expect(plan.problems[0]).toContain('react');
  });

  it('accepts a module listing several options if the host is any of them', () => {
    expect(checkModuleCompatibility(mod({ frameworks: ['react', 'solid'] }), host).compatible).toBe(true);
  });

  it('reports every problem at once, so the install prompt can show them together', () => {
    const plan = checkModuleCompatibility(mod({ backends: ['nextgraph'], frameworks: ['vue'] }), host);
    expect(plan.problems).toHaveLength(2);
  });
});

describe('defineModule', () => {
  it('round-trips the definition unchanged', () => {
    const definition = defineModule({
      id: 'notes',
      name: 'Notes',
      capabilities: ['storage', 'slot:dock-right'],
      backends: ['ad4m'],
      slots: [{ anchor: 'dock-right', node: { type: 'Column' }, order: 100 }],
    });
    expect(definition.id).toBe('notes');
    expect(definition.slots?.[0].anchor).toBe('dock-right');
  });

  it('allows a fragments-only module to declare no framework at all', () => {
    // The case that matters for dynamic loading: no `components`, no `frameworks`, so nothing
    // framework-shaped is imported and there is no second-runtime hazard.
    const definition = defineModule({
      id: 'banner',
      name: 'Banner',
      schemas: { bar: { type: 'Column', children: ['hi'] } },
      slots: [{ anchor: 'banner', node: { type: 'Column' } }],
    });
    expect(definition.frameworks).toBeUndefined();
    expect(definition.components).toBeUndefined();
    expect(checkModuleCompatibility(definition, { backend: 'anything', framework: 'anything' }).compatible).toBe(true);
  });
});

describe('modulePredicateViolations', () => {
  it('allows a module to mint inside its own subtree', () => {
    expect(modulePredicateViolations('notes', ['we://module/notes/text'])).toEqual([]);
  });

  it('allows reuse of the core vocabulary', () => {
    // Shared vocabulary is the point — generic UI that displays a name works on this entity for
    // free. Only *minting* a new flat name is unadjudicated, and that is not distinguishable from
    // reuse without a registry of core names, so reuse is permitted.
    expect(modulePredicateViolations('notes', ['we://name', 'we://title'])).toEqual([]);
  });

  it("refuses another module's subtree", () => {
    expect(modulePredicateViolations('notes', ['we://module/call/roster'])).toEqual(['we://module/call/roster']);
  });

  it('refuses a scheme of its own', () => {
    expect(modulePredicateViolations('notes', ['notes://text', 'module://notes/text'])).toEqual([
      'notes://text',
      'module://notes/text',
    ]);
  });
});
