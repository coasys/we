import { lintModule, markAction, markState, storeSurface } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

import { createModule, identityModule } from './index';

const createStore = () =>
  identityModule.createStore!({
    signal: <T>(initial: T): [() => T, (next: T) => void] => {
      let value = initial;
      return [() => value, (next: T) => void (value = next)];
    },
    state: markState,
    action: markAction,
    kernels: {},
  });

describe('the identity module', () => {
  it('passes the module lint as an agent-scoped module', () => {
    expect(lintModule(identityModule).problems).toEqual([]);
    expect(identityModule.manifest.id).toBe('identity');
    expect(identityModule.manifest.scope).toBe('agent');
    expect(createModule({ components: {} })).toBe(identityModule);
  });

  // The Settings template reads these through `modules.identity.*`, and a store keeps every member
  // private unless it marks it, so an unmarked one fails schema validation and renders nothing.
  it('publishes what the Settings template reads, with a description each', () => {
    const surface = storeSurface(createStore());
    for (const name of ['identity', 'roster', 'devices', 'kelEvents', 'selectedDevice', 'enrolmentOffer']) {
      expect(surface[name]?.kind, name).toBe('state');
    }
    for (const name of ['revokeKey', 'exportKel', 'startEnrolment', 'selectDevice', 'copyDid']) {
      expect(surface[name]?.kind, name).toBe('action');
    }
    for (const [name, member] of Object.entries(surface)) expect(member.doc.length, name).toBeGreaterThan(10);
  });

  it('keeps the setters private to the host that wires them', () => {
    const surface = storeSurface(createStore());
    for (const name of ['setIdentity', 'setRoster', 'setKelEvents', 'setEnrolmentOffer']) {
      expect(surface[name], name).toBeUndefined();
    }
  });

  it('derives the device list and counts from the roster', () => {
    const store = createStore() as Record<string, (...args: unknown[]) => unknown>;
    store.setRoster([
      { id: 'a', type: 'device' },
      { id: 'b', type: 'executor' },
      { id: 'c', type: 'assistant' },
    ]);
    expect((store.devices() as unknown[]).length).toBe(2);
    expect(store.assistantCount()).toBe('1');
    store.selectDevice('b');
    expect(store.selectedDevice()).toEqual({ id: 'b', type: 'executor' });
  });
});
