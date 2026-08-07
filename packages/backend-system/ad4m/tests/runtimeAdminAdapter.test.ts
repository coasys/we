/**
 * What the runtime port offers, and to whom.
 *
 * The shell feature-detects every section of the settings page against the members of this port, so
 * which members exist *is* the UI. Two properties are worth pinning: a guest on somebody else's
 * node is offered nothing that administers that node, and the guard on system languages lives here
 * rather than only in the template that hides the button.
 */
import { describe, expect, it, vi } from 'vitest';

import { createAd4mRuntimeAdmin } from '../src/runtimeAdminAdapter';

/** Just enough of an Ad4mClient for the members under test. */
function stubClient(overrides: Record<string, unknown> = {}) {
  return {
    languages: {
      all: vi.fn(async () => [
        { address: 'Qm-sys', name: 'languages' },
        { address: 'Qm-mine', name: 'note-language' },
      ]),
      remove: vi.fn(async () => true),
      byAddress: vi.fn(async () => ({})),
    },
    runtime: { addExceptionCallback: vi.fn() },
    agent: { getApps: vi.fn(async () => []) },
    ...overrides,
  };
}

describe('what a connection is allowed to administer', () => {
  it('offers the whole port to a connection that operates the node', () => {
    const port = createAd4mRuntimeAdmin(stubClient());

    expect(port.trustedAgents).toBeDefined();
    expect(port.networkMetrics).toBeDefined();
    expect(port.languages).toBeDefined();
    expect(port.aiModels).toBeDefined();
    expect(port.authorizedApps).toBeDefined();
  });

  it('offers a guest only what belongs to their own agent', () => {
    // A hosted or multi-user node: trust, peer networking, languages and models are the node's, and
    // "restart networking" on a machine shared with other people is a control that should not exist
    // rather than one that returns a capability error.
    const port = createAd4mRuntimeAdmin(stubClient(), { administersNode: false });

    expect(port.trustedAgents).toBeUndefined();
    expect(port.networkMetrics).toBeUndefined();
    expect(port.restartNetwork).toBeUndefined();
    expect(port.languages).toBeUndefined();
    expect(port.aiModels).toBeUndefined();

    // Their own grants and the prompts raised at their own session survive: `agent.getApps()`
    // answers for whoever is authenticated, wherever the node is.
    expect(port.authorizedApps).toBeDefined();
    expect(port.revokeApp).toBeDefined();
    expect(port.onConsentRequest).toBeDefined();
    expect(port.approve).toBeDefined();
  });
});

describe('system languages', () => {
  it('refuses to remove one, whatever the UI offered', async () => {
    const client = stubClient();
    const port = createAd4mRuntimeAdmin(client);

    await expect(port.removeLanguage?.('Qm-sys')).rejects.toThrow(/cannot be removed/);
    expect(client.languages.remove).not.toHaveBeenCalled();
  });

  it('removes one the user installed', async () => {
    const client = stubClient();
    const port = createAd4mRuntimeAdmin(client);

    await port.removeLanguage?.('Qm-mine');
    expect(client.languages.remove).toHaveBeenCalledWith('Qm-mine');
  });

  it('marks the node’s own languages as system, and nothing else', async () => {
    const port = createAd4mRuntimeAdmin(stubClient());

    expect(await port.languages?.()).toEqual([
      { address: 'Qm-sys', name: 'languages', system: true },
      { address: 'Qm-mine', name: 'note-language', system: false },
    ]);
  });
});
