/**
 * The Lal P1 #3 gate, front-loaded: the acorn module registers on **both** host descriptors —
 * the in-memory backend the offline tests run on, and the AD4M backend the app runs on —
 * because it declares no backend requirement. A module that said `backends: ['ad4m']` is the
 * thing this test exists to refuse: it would work in the app and silently never activate
 * where every fixture render runs.
 *
 * `checkModuleCompatibility` is the same check `moduleRegistry.register` runs; `lintModule` is
 * the refusal list it evaluates before that. Together they are the registration gate minus the
 * registry's bookkeeping — the equivalent of `activateSeedModules` for a definition in hand.
 */
import { checkModuleCompatibility, lintModule, moduleCapabilities } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

import { ACORN_MANIFEST, acornModule, createModule } from '../src/index.ts';

describe('@we/module-acorn — the registration gate', () => {
  it('declares no backend requirement — backend-neutral by contract (design §L.1)', () => {
    expect(ACORN_MANIFEST.id).toBe('acorn');
    expect(ACORN_MANIFEST.requires?.backends).toBeUndefined();
    expect(ACORN_MANIFEST.requires?.frameworks).toBeUndefined();
  });

  it('createModule returns the definition the registry lints and registers', () => {
    // The generated registry imports only this factory; what it returns must be the definition.
    expect(createModule({ components: {} })).toBe(acornModule);
  });

  it('lints clean — the registry would not refuse it', () => {
    const lint = lintModule(acornModule, { externalEntities: ['WeNode'] });
    expect(lint.problems).toEqual([]);
    expect(lint.warnings).toEqual([]);
  });

  it('module registers on inmemory host', () => {
    const result = checkModuleCompatibility(acornModule, { backend: 'inmemory', framework: 'solid' });
    expect(result.problems).toEqual([]);
    expect(result.compatible).toBe(true);
  });

  it('module registers on ad4m host descriptor', () => {
    const result = checkModuleCompatibility(acornModule, { backend: 'ad4m', framework: 'solid' });
    expect(result.problems).toEqual([]);
    expect(result.compatible).toBe(true);
  });

  it('contributes only what this stage promises — parts and pure functions, no entities, no store', () => {
    const contributes = acornModule.contributes ?? {};
    expect(Object.keys(contributes.parts ?? {}).length).toBeGreaterThan(0);
    expect((contributes.functions ?? []).length).toBeGreaterThan(0);
    expect(contributes.entities).toBeUndefined();
    expect(acornModule.createStore).toBeUndefined();
    // Capability derivation agrees there is nothing to warn a person about.
    expect(moduleCapabilities(acornModule)).toEqual([]);
  });
});
