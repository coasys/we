import type { BackendConnector, BackendInitResult } from '@we/app-shell/shared';
import { createInMemoryBackendPorts, type SeededPeer } from '@we/backend-inmemory';
import { getModel } from '@we/models';
import { applyFixture, datasetIdFor, type Fixture, type FixtureId, FIXTURES } from '@we/template-fixtures';

/**
 * The whole difference between this host and we-web.
 *
 * we-web's connector runs AD4M's connect choreography — an auth UI, a token, a hosted node — and
 * returns a client. This returns the in-memory bundle and nothing else, which is what makes the app
 * boot in a headless browser with no executor, no agent setup and no network.
 *
 * The agent starts **unlocked**. A locked one is the honest default for the port (and what the boot
 * suite exercises), but here it would put a password prompt in front of every screenshot. The lock
 * flow is a shell surface like any other; a fixture that wants to photograph it can ask for one.
 *
 * `runtime`, `transcription` and `interop` are absent, exactly as `createInMemoryBackendPorts`
 * leaves them. They are feature-detected member by member, so the settings surfaces that would use
 * them render their capability-gated empty states — see the README for what that means for anyone
 * pointing this at shell design work rather than at templates.
 */

/** Which fixture to load, from `?fixture=`. Defaults to the first — the host must show *something*. */
export function requestedFixture(): Fixture {
  const id = new URLSearchParams(window.location.search).get('fixture') as FixtureId | null;
  if (id && id in FIXTURES) return FIXTURES[id];
  if (id) console.warn(`[we-preview] no fixture '${id}' — have ${Object.keys(FIXTURES).join(', ')}`);
  return Object.values(FIXTURES)[0];
}

export const inMemoryConnector: BackendConnector = {
  async initialize(ctx): Promise<BackendInitResult> {
    const fixture = requestedFixture();
    const datasetId = datasetIdFor(fixture);

    // Filled after the fixture is applied, and read later — when the presence store opens a scope
    // on this dataset, which happens well after boot. The array identity is what matters, so the
    // beat picks up peers that did not exist when the ports were built.
    const presence: SeededPeer[] = [];

    const ports = createInMemoryBackendPorts(ctx, {
      agent: { id: 'did:preview:me', unlocked: true },
      // Seeded with a `sharedUri` rather than created and published, so the id is knowable before
      // boot — the shoot script navigates straight to `/space/<id>/...` on first load, and an
      // in-memory backend re-mints everything on every load.
      datasets: [{ id: datasetId, name: fixture.space.name, sharedUri: `inmemory://${datasetId}` }],
      profiles: fixture.agents.map((agent) => ({
        did: agent.did,
        firstName: agent.firstName,
        lastName: agent.lastName ?? '',
        handle: agent.handle,
        bio: agent.bio ?? '',
        ...(agent.avatar ? { avatar: agent.avatar } : {}),
      })),
      presence,
    });

    const dataset = await ports.lifecycle.get(datasetId);
    if (!dataset) throw new Error(`[we-preview] seeded dataset '${datasetId}' is missing`);

    const applied = await applyFixture(
      { getModel, dataset: dataset.handle, datasetId, sharedId: dataset.sharedId },
      fixture,
    );

    presence.push(
      ...(fixture.presence ?? []).map((peer) => ({
        did: peer.did,
        availability: 'available' as const,
        // `online` filters on the dataset uri and `onlineHere` further on the path — a peer with
        // neither is present in the abstract and visible nowhere.
        focus: { datasetUri: `inmemory://${datasetId}`, ...(peer.path ? { path: peer.path } : {}) },
      })),
    );

    // How the shoot script knows where to go without loading the page twice. Everything here is
    // derived from the fixture, so it is also knowable ahead of time — this is a convenience and a
    // cross-check, not the source of truth.
    // The full catalogue, so `shoot` with no `--fixture` can enumerate rather than be told twice.
    (window as unknown as Record<string, unknown>).__weFixtures = FIXTURES;
    (window as unknown as Record<string, unknown>).__wePreview = {
      fixture: fixture.id,
      templateId: fixture.templateId,
      datasetId,
      path: applied.path,
      nodes: applied.nodes,
    };

    return { client: {}, ports };
  },
};
