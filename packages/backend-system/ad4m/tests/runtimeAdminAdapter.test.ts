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

  it('withholds node-wide changes from a guest', () => {
    // A hosted or multi-user node: trust, peer networking and languages change something every user
    // of that node shares, and "restart networking" on a shared machine is a control that should not
    // exist rather than one that returns a capability error.
    //
    // Note AD4M would *permit* several of these — its default guest grant includes LANGUAGE DELETE.
    // That is why `administersNode` is not redundant with the capability check: permitted is not the
    // same as appropriate.
    const port = createAd4mRuntimeAdmin(stubClient(), { administersNode: false });

    expect(port.trustedAgents).toBeUndefined();
    expect(port.networkMetrics).toBeUndefined();
    expect(port.restartNetwork).toBeUndefined();
    expect(port.languages).toBeUndefined();

    // Consent is raised at *this* session, so it survives being a guest.
    expect(port.onConsentRequest).toBeDefined();
    expect(port.approve).toBeDefined();
  });

  it('withholds the app list from a guest, because it is not theirs to see', () => {
    // This used to be offered to guests on the reasoning that `agent.getApps()` answers for whoever
    // is authenticated. It does not: the executor keeps apps in one process-global map behind a
    // single `apps_data.json`, so on a multi-user node the list is either empty or somebody else's.
    const port = createAd4mRuntimeAdmin(stubClient(), { administersNode: false });

    expect(port.authorizedApps).toBeUndefined();
    expect(port.revokeApp).toBeUndefined();
    expect(port.removeApp).toBeUndefined();
  });

  it('lets a guest read the AI models they are granted, without offering to change them', () => {
    // The case that proved a single boolean too coarse. AD4M grants a hosted user AI READ and
    // refuses UPDATE/DELETE; WE hid the whole section, so a transcription model the node was happily
    // running looked to the user like no model at all.
    const port = createAd4mRuntimeAdmin(stubClient(), {
      administersNode: false,
      capabilities: [{ with: { domain: 'artificial intelligence', pointers: ['*'] }, can: ['READ'] }],
    });

    expect(port.aiModels).toBeDefined();
    expect(port.aiModelStatus).toBeDefined();

    expect(port.addAiModel).toBeUndefined();
    expect(port.updateAiModel).toBeUndefined();
    expect(port.removeAiModel).toBeUndefined();
    expect(port.setDefaultAiModel).toBeUndefined();
  });

  it('hides AI entirely when the grant does not include it', () => {
    const port = createAd4mRuntimeAdmin(stubClient(), {
      administersNode: false,
      capabilities: [{ with: { domain: 'perspective', pointers: ['*'] }, can: ['READ'] }],
    });

    expect(port.aiModels).toBeUndefined();
  });

  it('treats an unreadable grant as permitted, so a local host keeps its settings page', () => {
    // A desktop host authenticating with an empty token against an executor with no admin credential
    // holds ALL_CAPABILITY. Reading "no capabilities I can parse" as "no capabilities" would empty
    // the settings page on exactly the hosts that own the node.
    const port = createAd4mRuntimeAdmin(stubClient(), { capabilities: null });

    expect(port.aiModels).toBeDefined();
    expect(port.addAiModel).toBeDefined();
    expect(port.languages).toBeDefined();
  });

  it('honours a wildcard grant', () => {
    const port = createAd4mRuntimeAdmin(stubClient(), {
      capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
    });

    expect(port.aiModels).toBeDefined();
    expect(port.addAiModel).toBeDefined();
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
