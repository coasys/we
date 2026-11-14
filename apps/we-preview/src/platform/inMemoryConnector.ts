import type { BackendConnector, BackendInitResult } from '@we/app-shell/shared';
import { createInMemoryBackendPorts, type SeededPeer } from '@we/backend-inmemory';
import type { WorkflowDefinition } from '@we/backend-shared';
import { getEntity } from '@we/entities';
import { applyFixture, datasetIdFor, type Fixture, type FixtureId, FIXTURES, pathFor } from '@we/template-fixtures';

/**
 * `?record=1` — the flag the snapshot recorder (`crates/renderer/scripts/record-coasys.mjs`) loads
 * the host under. Off, none of the recording hooks exist: the lifecycle port reports its real
 * member list (empty), and a fixture's `workflows` section is ignored, exactly as before.
 */
export function recordingRequested(): boolean {
  return new URLSearchParams(window.location.search).get('record') === '1';
}

/**
 * A fixture's recorder-only extension — a list of `{ definition, runs }` seeded through the
 * backend's own `WorkflowPort` so `workflowStore.workflows` has something real to list. Not part
 * of the `Fixture` contract: nothing outside a recording needs it, and the `?record` flag is the
 * only place it is read.
 */
interface WorkflowSeed {
  definition: WorkflowDefinition;
  runs?: { record: string; at?: string }[];
}

/**
 * The slice of a record's generated API the seeding below uses — `findAll` on the class and the
 * `add<Relation>` writers on the instance. Neither is on the `Fixture` types' `EntityClass` shape,
 * which only promises `create`.
 */
interface FixtureEntityClass {
  create(handle: unknown, data: Record<string, unknown>): Promise<{ id: string }>;
  findAll(handle: unknown, options: Record<string, unknown>): Promise<FixtureRecordInstance[]>;
}
interface FixtureRecordInstance {
  id: string;
  addTypeStyles?(target: { id: string }): Promise<unknown>;
}

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
/** A fixture loaded from a URL (`?fixtureUrl=`), which wins over a bundled id. Set by the entry. */
let externalFixture: Fixture | undefined;
export function useExternalFixture(fixture: Fixture): void {
  externalFixture = fixture;
}

export function requestedFixture(): Fixture {
  if (externalFixture) return externalFixture;
  const id = new URLSearchParams(window.location.search).get('fixture') as FixtureId | null;
  if (id && id in FIXTURES) return FIXTURES[id];
  if (id) console.warn(`[we-preview] no fixture '${id}' — have ${Object.keys(FIXTURES).join(', ')}`);
  return Object.values(FIXTURES)[0];
}

/**
 * Where the host lands.
 *
 * For a template `we-render` injected: the `?route=` asked for, else `/`, inside the fixture's space
 * — a template's routes hang off `/space/<id>`, and a path without that prefix leaves the space and
 * finds none of them. A fixture's own route is no use here; it names a page of the fixture's
 * template. A path that already names a space is taken as it is.
 *
 * Otherwise the fixture's route, or a `?route=` in its place, exactly as before.
 */
export function startRoute(fixture: Fixture): string {
  const requested = new URLSearchParams(window.location.search).get('route');
  if (!(window as unknown as Record<string, unknown>).__externalTemplateId) return requested ?? pathFor(fixture);
  const path = requested ?? '/';
  if (path.startsWith('/space/')) return path;
  return `/space/${datasetIdFor(fixture)}${path === '/' ? '' : path}`;
}

export const inMemoryConnector: BackendConnector = {
  async initialize(ctx): Promise<BackendInitResult> {
    let fixture = requestedFixture();

    const externalTemplateId = (window as unknown as Record<string, unknown>).__externalTemplateId as
      string | undefined;
    if (externalTemplateId) {
      fixture = { ...fixture, templateId: externalTemplateId };
    }

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
      profiles: [
        // The agent this host signs in as. Nameless, it met the first-run "what should we call you?"
        // prompt, which sat over every render this host exists to take.
        { did: 'did:preview:me', firstName: 'Preview', lastName: 'User', handle: 'preview', bio: '' },
        ...fixture.agents.map((agent) => ({
          did: agent.did,
          firstName: agent.firstName,
          lastName: agent.lastName ?? '',
          handle: agent.handle,
          bio: agent.bio ?? '',
          ...(agent.avatar ? { avatar: agent.avatar } : {}),
        })),
      ],
      presence,
    });

    const dataset = await ports.lifecycle.get(datasetId);
    if (!dataset) throw new Error(`[we-preview] seeded dataset '${datasetId}' is missing`);

    if (recordingRequested()) {
      /*
        The in-memory lifecycle answers `members` with nobody, which is honest — an in-memory
        "neighbourhood" has no other agents. A recording fixture says who its people are, and under
        the record flag the port answers with them, so `spaceStore.members` photographs a community
        rather than the recorder alone.
      */
      const originalMembers = ports.lifecycle.members;
      ports.lifecycle = {
        ...ports.lifecycle,
        members: (id: string) =>
          id === datasetId
            ? Promise.resolve(fixture.agents.map((agent) => agent.did))
            : (originalMembers?.(id) ?? Promise.resolve([])),
      };
    }

    const applied = await applyFixture(
      {
        getEntity,
        dataset: dataset.handle,
        datasetId,
        sharedId: dataset.sharedId,
        // So a fixture's own shapes exist before their records are written; the app adopts them
        // again from the `Shape` records on entry, as it would any space's.
        declareShape: (manifest, moduleId) =>
          ports.schemas.declareInDataset(dataset.handle, manifest as never, { moduleId }),
      },
      fixture,
    );

    if (recordingRequested()) {
      /*
        Workflow definitions and the records going through them — the fixture's `workflows`
        extension, seeded through `ports.workflows` like any other client. `install` is idempotent
        and `start` puts each record at the state it is said to be in.
      */
      if (!ports.workflows) {
        console.warn('[we-preview] record=1: no workflows port — fixture workflows skipped');
      }
      for (const seed of (fixture as Fixture & { workflows?: WorkflowSeed[] }).workflows ?? []) {
        await ports.workflows?.install(dataset.handle, seed.definition);
        for (const run of seed.runs ?? []) {
          await ports.workflows?.start(dataset.handle, seed.definition.name, run.record, {
            ...(run.at ? { at: run.at } : {}),
          });
        }
      }

      /*
        Relations the space record carries that `applyFixture` cannot reach — the record is written
        inside it, not addressed by a fixture record. `space.typeStyles` is the one the Coasys
        surface queries for: a space styling its card types. Same mechanism the host's own writer
        would use — the record's generated relation setter.
      */
      const Space = getEntity('Space') as unknown as FixtureEntityClass;
      const [spaceRecord] = await Space.findAll(dataset.handle, { where: { id: `${fixture.id}-space` } });
      const typeStyles = (
        fixture.space as {
          typeStyles?: { nodeType: string; color?: string; display?: Record<string, unknown>; createdAt?: string }[];
        }
      ).typeStyles;
      for (const style of typeStyles ?? []) {
        const written = await (getEntity('TypeStyle') as unknown as FixtureEntityClass).create(dataset.handle, {
          id: `${fixture.id}-typestyle-${style.nodeType.toLowerCase()}`,
          author: 'did:preview:me',
          createdAt: style.createdAt ?? '2025-10-01T00:00:00.000Z',
          updatedAt: style.createdAt ?? '2025-10-01T00:00:00.000Z',
          timestamp: style.createdAt ?? '2025-10-01T00:00:00.000Z',
          nodeType: style.nodeType,
          ...(style.color ? { color: style.color } : {}),
          ...(style.display ? { display: JSON.stringify(style.display) } : {}),
        });
        await spaceRecord?.addTypeStyles?.({ id: written.id });
      }
    }

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
      path: startRoute(fixture),
      nodes: applied.nodes,
    };

    return { client: {}, ports };
  },
};
