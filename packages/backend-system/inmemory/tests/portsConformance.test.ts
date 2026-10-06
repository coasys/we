/**
 * The in-memory bundle against the shared conformance suite — the same cases every backend runs.
 *
 * Writes notify synchronously here, so the timings are as short as a timer allows, and there are no
 * known gaps: this is the reference, and a case it fails is a case written wrong.
 */
import { describeBackendConformance } from '@we/backend-conformance';
import { describe, expect, it } from 'vitest';

import { createInMemoryBackendPorts } from '../src/lifecycle';

const AGENT = 'did:test:me';

function makePorts() {
  return createInMemoryBackendPorts(
    { selfId: () => AGENT },
    { agent: { id: AGENT, unlocked: true }, datasets: [{ id: 'ds-main', name: 'Main' }] },
  );
}

describeBackendConformance('in-memory', {
  async setup() {
    const ports = makePorts();
    const dataset = (await ports.lifecycle.get('ds-main'))!.handle;
    return { ports, dataset, agent: AGENT };
  },
  timing: { settle: 200, quiet: 10 },
});

describe('in-memory specifics', () => {
  it('ephemeral is a real port, not the capability reporting itself absent', async () => {
    // The shared suite accepts null as "no ephemeral here". This backend has a bus, so it must say so.
    const ports = makePorts();
    const dataset = (await ports.lifecycle.get('ds-main'))!;
    expect(ports.ephemeral(dataset.handle as never)).not.toBeNull();
  });
});
