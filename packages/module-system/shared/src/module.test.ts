import { describe, expect, it } from 'vitest';

import {
  checkModuleCompatibility,
  defineModule,
  moduleCapabilities,
  type ModuleDefinition,
  modulePredicateViolations,
} from './module';
import { markAction, markState, memberDoc, memberKind, storeSurface } from './store';

const host = { backend: 'ad4m', framework: 'solid' };

function mod(overrides: Partial<ModuleDefinition> = {}): ModuleDefinition {
  return defineModule({ manifest: { id: 'test', name: 'Test' }, ...overrides });
}

describe('checkModuleCompatibility', () => {
  it('treats an omitted axis as agnostic, so the portable case is the default', () => {
    // A module that declares neither backends nor frameworks nor kernels runs anywhere. Making the
    // portable case the default is what forces coupling to be opted into and declared.
    expect(checkModuleCompatibility(mod(), host).compatible).toBe(true);
    expect(checkModuleCompatibility(mod(), { backend: 'nextgraph', framework: 'react' }).compatible).toBe(true);
  });

  it('refuses a module that needs a backend this host is not', () => {
    const plan = checkModuleCompatibility(mod({ manifest: { id: 't', name: 'T', requires: { backends: ['ad4m'] } } }), {
      ...host,
      backend: 'nextgraph',
    });
    expect(plan.compatible).toBe(false);
    expect(plan.problems[0]).toContain('ad4m');
    expect(plan.problems[0]).toContain('nextgraph');
  });

  it('refuses a module with no build for this framework', () => {
    const plan = checkModuleCompatibility(
      mod({ manifest: { id: 't', name: 'T', requires: { frameworks: ['react'] } } }),
      host,
    );
    expect(plan.compatible).toBe(false);
    expect(plan.problems[0]).toContain('react');
  });

  it('refuses a module that names a kernel this host does not implement', () => {
    // The point of naming kernels: a module that reaches presence on a host with no presence is
    // refused with a sentence at registration, instead of degrading silently inside its store.
    const plan = checkModuleCompatibility(
      mod({ manifest: { id: 't', name: 'T', requires: { kernels: ['presence', 'languageModel'] } } }),
      { ...host, kernels: ['records', 'presence'] },
    );
    expect(plan.compatible).toBe(false);
    expect(plan.problems[0]).toContain('languageModel');
    expect(plan.problems[0]).not.toContain('presence');
  });

  it('assumes every kernel when a host declares none — the permissive default a test wants', () => {
    const plan = checkModuleCompatibility(
      mod({ manifest: { id: 't', name: 'T', requires: { kernels: ['records', 'media'] } } }),
      host,
    );
    expect(plan.compatible).toBe(true);
  });

  it('reports every problem at once, so the install prompt can show them together', () => {
    const plan = checkModuleCompatibility(
      mod({ manifest: { id: 't', name: 'T', requires: { backends: ['nextgraph'], frameworks: ['vue'] } } }),
      host,
    );
    expect(plan.problems).toHaveLength(2);
  });
});

describe('defineModule', () => {
  it('round-trips the definition unchanged', () => {
    const definition = defineModule({
      manifest: { id: 'notes', name: 'Notes', requires: { backends: ['ad4m'] } },
      contributes: { slots: [{ anchor: 'dock-right', node: { type: 'Column' }, order: 100 }] },
    });
    expect(definition.manifest.id).toBe('notes');
    expect(definition.contributes?.slots?.[0].anchor).toBe('dock-right');
  });

  it('allows a declaration-only module: no store, no framework, no kernels', () => {
    // The case that matters for distribution: nothing here is code, so nothing here has to be trusted.
    const definition = defineModule({
      manifest: { id: 'banner', name: 'Banner' },
      contributes: {
        parts: { bar: { type: 'Column', children: ['hi'] } },
        panels: [{ name: 'main', title: 'Banner', node: { type: 'Column' } }],
      },
    });
    expect(definition.createStore).toBeUndefined();
    expect(definition.contributes?.components).toBeUndefined();
    expect(
      checkModuleCompatibility(definition, { backend: 'anything', framework: 'anything', kernels: [] }).compatible,
    ).toBe(true);
  });
});

describe('moduleCapabilities', () => {
  it('derives what a person is agreeing to from the manifest and the contributions', () => {
    // Nothing here is authored: a free list six modules wrote and nothing read is what this replaces.
    const caps = moduleCapabilities(
      defineModule({
        manifest: {
          id: 'call',
          name: 'Calls',
          requires: { kernels: ['presence', 'ephemeral', 'media'], permissions: ['microphone', 'camera'] },
        },
        contributes: {
          panels: [{ name: 'stage', title: 'Call', node: { type: 'Column' } }],
          slots: [{ anchor: 'dock-bottom', node: { type: 'Row' } }],
        },
      }),
    );
    expect(caps).toEqual(
      expect.arrayContaining(['microphone', 'camera', 'kernel:presence', 'kernel:media', 'dock', 'slot:dock-bottom']),
    );
    expect(caps).not.toContain('storage:space');
  });

  it('says which dataset a module writes into', () => {
    const manifest = { version: '1.0.0', entities: {} } as never;
    expect(moduleCapabilities(mod({ contributes: { entities: { manifest } } }))).toContain('storage:space');
    expect(moduleCapabilities(mod({ contributes: { entities: { manifest, scope: 'agent' } } }))).toContain(
      'storage:agent',
    );
  });

  it('is empty for a module that asks for nothing', () => {
    expect(moduleCapabilities(mod())).toEqual([]);
  });
});

describe('store markers', () => {
  it('marks state and actions apart, and keeps the description', () => {
    const read = () => 1;
    const act = () => undefined;
    expect(memberKind(markState(read, 'a number'))).toBe('state');
    expect(memberKind(markAction(act, 'does a thing'))).toBe('action');
    expect(memberDoc(markState(read, 'a number'))).toBe('a number');
  });

  it('returns the member it was given, so a marked accessor is still the signal', () => {
    // A copy would break reactivity: the host's memo has to call the very function the signal made.
    const read = () => 1;
    expect(markState(read, 'x')).toBe(read);
  });

  it('wraps a plain value in an accessor, so the bag has one shape to tag', () => {
    const marked = markState(3, 'three');
    expect(typeof marked).toBe('function');
    expect(marked()).toBe(3);
  });

  it('leaves an unmarked member out of the surface — private by default', () => {
    const surface = storeSurface({
      open: markState(() => true, 'whether the panel is open'),
      toggle: markAction(() => undefined, 'opens or closes it'),
      plumbing: () => 'right',
      constant: 4,
    });
    expect(surface).toEqual({
      open: { kind: 'state', doc: 'whether the panel is open' },
      toggle: { kind: 'action', doc: 'opens or closes it' },
    });
  });
});

describe('modulePredicateViolations', () => {
  it('allows a module to mint inside its own subtree', () => {
    expect(modulePredicateViolations('notes', ['we://module/notes/text'])).toEqual([]);
  });

  it('allows reuse of the core vocabulary', () => {
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
