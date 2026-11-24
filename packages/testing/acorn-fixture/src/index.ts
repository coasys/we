/**
 * `@we/acorn-fixture` — an in-memory dataset shaped like a mounted Acorn project.
 *
 * Two pieces, deliberately separate:
 *
 * - {@link ACORN_MANIFEST} — the nine Acorn classes as a WE `EntityManifest`.
 *   Field names match `acorn-ad4m/language/src/shapes.ts:55-184` exactly —
 *   scalars as properties, `kind: "ref"`s as relations (Acorn targets typed;
 *   agent DID IRIs untyped, since a mounted `did:` link names no record in
 *   this dataset). The Acorn `acorn://` SHACL predicates are the AD4M mount's
 *   business, not this manifest's — the in-memory backend stores rows by
 *   field name and ignores predicates by design (see its `compileEntities`).
 *
 * - {@link acornFixture} — one project's worth of records in WE's `Fixture`
 *   format, applied through `applyFixture`/`declareInDataset`, the same path
 *   the app itself writes fixtures and adopts space shapes through. Contents:
 *   `AcornProjectMeta`, 3 outcomes in a parent/child connection tree
 *   (`acorn-outcome-1` → `acorn-outcome-2`, `acorn-outcome-3`), 1 tag, 2 members
 *   + profiles, 1 assignee, 1 comment, 1 entry point.
 */
import type { BackendPorts, EntityManifest } from '@we/backend-shared';
import { getEntity } from '@we/entities';
import { applyFixture, datasetIdFor, type Fixture, type FixtureShape } from '@we/template-fixtures';

// ─── The Acorn vocabulary as an EntityManifest ───────────────────────────────

/** The trailing read-only wire metadata every Acorn class carries (shapes.ts:49-53). */
const WIRE_PROPS = {
  entryHash: { type: 'string' },
  recordCreatedAt: { type: 'number' },
  recordUpdatedAt: { type: 'number' },
} as const;

/** A `kind: "ref"` to a DID (`did:key:…`) — no record in the dataset to point at. */
const agentRef = { target: '', cardinality: 'one' } as const;

export const ACORN_MANIFEST: EntityManifest = {
  version: '1',
  entities: {
    AcornOutcome: {
      description: 'An Acorn outcome — a card in the project tree',
      properties: {
        content: { type: 'string' },
        description: { type: 'string' },
        githubLink: { type: 'string' },
        scopeType: { type: 'string' },
        achievementStatus: { type: 'string' },
        targetDate: { type: 'number' },
        taskList: { type: 'string' },
        smallsEstimate: { type: 'number' },
        timeFrame: { type: 'string' },
        inBreakdown: { type: 'boolean' },
        timestampCreated: { type: 'number' },
        timestampUpdated: { type: 'number' },
        isImported: { type: 'boolean' },
        ...WIRE_PROPS,
      },
      relations: {
        tags: { target: 'AcornTag', cardinality: 'many' },
        creator: agentRef,
        editor: agentRef,
        parent: { target: 'AcornOutcome', cardinality: 'one' },
        children: { target: 'AcornOutcome', cardinality: 'many' },
      },
    },
    AcornConnection: {
      description: 'A parent→child edge between two outcomes',
      properties: {
        siblingOrder: { type: 'number' },
        randomizer: { type: 'number' },
        isImported: { type: 'boolean' },
        ...WIRE_PROPS,
      },
      relations: {
        parent: { target: 'AcornOutcome', cardinality: 'one' },
        child: { target: 'AcornOutcome', cardinality: 'one' },
      },
    },
    AcornEntryPoint: {
      description: 'A marked place to enter the outcome tree',
      properties: {
        color: { type: 'string' },
        createdAtTime: { type: 'number' },
        isImported: { type: 'boolean' },
        ...WIRE_PROPS,
      },
      relations: {
        outcome: { target: 'AcornOutcome', cardinality: 'one' },
        creator: agentRef,
      },
    },
    AcornOutcomeComment: {
      description: 'A comment on an outcome',
      properties: {
        content: { type: 'string' },
        unixTimestamp: { type: 'number' },
        isImported: { type: 'boolean' },
        ...WIRE_PROPS,
      },
      relations: {
        outcome: { target: 'AcornOutcome', cardinality: 'one' },
        creator: agentRef,
      },
    },
    AcornOutcomeMember: {
      description: 'An assignee edge between an outcome and a project member',
      properties: {
        unixTimestamp: { type: 'number' },
        isImported: { type: 'boolean' },
        ...WIRE_PROPS,
      },
      relations: {
        outcome: { target: 'AcornOutcome', cardinality: 'one' },
        member: { target: 'AcornMember', cardinality: 'one' },
        creator: agentRef,
      },
    },
    AcornTag: {
      description: 'A coloured label outcomes carry',
      properties: {
        text: { type: 'string' },
        backgroundColor: { type: 'string' },
        ...WIRE_PROPS,
      },
      relations: {},
    },
    AcornProjectMeta: {
      description: 'Project-level metadata for a mounted Acorn project',
      properties: {
        name: { type: 'string' },
        image: { type: 'string' },
        layeringAlgorithm: { type: 'string' },
        createdAtTime: { type: 'number' },
        isImported: { type: 'boolean' },
        isMigrated: { type: 'boolean' },
        ...WIRE_PROPS,
      },
      relations: {
        topPriorityOutcomes: { target: 'AcornOutcome', cardinality: 'many' },
        creator: agentRef,
      },
    },
    AcornMember: {
      description: 'A project member — the join record between an agent and a profile',
      properties: { ...WIRE_PROPS },
      relations: {
        agent: agentRef,
        sameAs: agentRef,
      },
    },
    AcornProfile: {
      description: "A member's profile inside the project",
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        handle: { type: 'string' },
        status: { type: 'string' },
        avatarUrl: { type: 'string' },
        agentPubKey: { type: 'string' },
        isImported: { type: 'boolean' },
        ...WIRE_PROPS,
      },
      relations: {
        agent: agentRef,
      },
    },
  },
};

/** One `FixtureShape` per Acorn class — how the space's own shapes arrive in WE. */
export const ACORN_FIXTURE_SHAPES: FixtureShape[] = Object.entries(ACORN_MANIFEST.entities).map(([name, entity]) => ({
  name,
  manifest: { version: ACORN_MANIFEST.version, entities: { [name]: entity } },
}));

// ─── The dataset ──────────────────────────────────────────────────────────────

const ALICE = 'did:key:z6MkwAliceAcornFixture1111111111111111111111';
const BOB = 'did:key:z6MkwBobAcornFixture1111111111111111111111111';
const T0 = 1763000000000;

export const acornFixture: Fixture = {
  id: 'acorn-project',
  // The `acorn` shell template in `@we/template-acorn` — the id `we-seed.json`'s
  // `templates` list registers it under.
  templateId: 'acorn',
  space: {
    name: 'Acorn Fixture Project',
    description: 'An Acorn project as a WE space — mounted classes over an in-memory backend',
    root: 'acorn-root',
    // The module this space turns on, and its section list — first listed is where a
    // member lands, so the outcomes list is the fixture's declared default view.
    enabledModules: ['acorn'],
    enabledViews: ['acorn-outcomes', 'acorn-table', 'acorn-priority', 'acorn-map', 'acorn-settings'],
  },
  agents: [
    { did: ALICE, firstName: 'Alice', lastName: 'Anders', handle: 'alice', bio: 'Project lead' },
    { did: BOB, firstName: 'Bob', lastName: 'Bakker', handle: 'bob', bio: '' },
  ],
  shapes: ACORN_FIXTURE_SHAPES,
  content: [],
  records: [
    // The space collection — `Space.root`, so member-scoped queries see a space at all.
    {
      entity: 'CollectionBlock',
      id: 'acorn-root',
      fields: { kind: 'collection', mode: 'feed', title: 'Acorn Fixture Project' },
      createdAt: new Date(T0).toISOString(),
    },
    {
      entity: 'AcornProjectMeta',
      id: 'acorn-project-meta',
      fields: {
        name: 'Acorn Fixture Project',
        image: '',
        layeringAlgorithm: 'layering',
        createdAtTime: T0,
        isImported: false,
        isMigrated: false,
        entryHash: 'uhCkkMetaAcornFixture000000000000000000000000000',
        recordCreatedAt: T0,
        recordUpdatedAt: T0,
      },
      relations: { topPriorityOutcomes: ['acorn-outcome-1'], creator: ALICE },
    },
    {
      entity: 'AcornOutcome',
      id: 'acorn-outcome-1',
      fields: {
        content: 'Acorn runs as a WE template',
        description: 'The vertical slice: shell, project list, live outcome list.',
        githubLink: '',
        scopeType: 'Big',
        achievementStatus: 'NotAchieved',
        targetDate: T0 + 30 * 24 * 3600 * 1000,
        taskList: JSON.stringify([]),
        smallsEstimate: 0,
        timeFrame: '',
        inBreakdown: true,
        timestampCreated: T0,
        timestampUpdated: T0,
        isImported: false,
        entryHash: 'uhCkkOutcomeOneAcornFixture0000000000000000000000',
        recordCreatedAt: T0,
        recordUpdatedAt: T0,
      },
      relations: {
        tags: ['acorn-tag-1'],
        creator: ALICE,
        editor: ALICE,
        children: ['acorn-outcome-2', 'acorn-outcome-3'],
      },
    },
    {
      entity: 'AcornOutcome',
      id: 'acorn-outcome-2',
      fields: {
        content: 'Shell boots on the in-memory backend',
        description: '',
        githubLink: '',
        scopeType: 'Small',
        achievementStatus: 'Achieved',
        targetDate: T0 + 7 * 24 * 3600 * 1000,
        taskList: JSON.stringify([{ task: 'boots', complete: true }]),
        smallsEstimate: 2,
        timeFrame: '',
        inBreakdown: false,
        timestampCreated: T0 + 1,
        timestampUpdated: T0 + 1,
        isImported: false,
        entryHash: 'uhCkkOutcomeTwoAcornFixture0000000000000000000000',
        recordCreatedAt: T0 + 1,
        recordUpdatedAt: T0 + 1,
      },
      relations: { creator: ALICE, editor: BOB, parent: 'acorn-outcome-1' },
    },
    {
      entity: 'AcornOutcome',
      id: 'acorn-outcome-3',
      fields: {
        content: 'Outcome list reads live mounted records',
        description: '',
        githubLink: '',
        scopeType: 'Uncertain',
        achievementStatus: 'NotAchieved',
        targetDate: 0,
        taskList: JSON.stringify([]),
        smallsEstimate: 3,
        timeFrame: JSON.stringify({ fromDate: T0, toDate: T0 + 14 * 24 * 3600 * 1000 }),
        inBreakdown: false,
        timestampCreated: T0 + 2,
        timestampUpdated: T0 + 2,
        isImported: false,
        entryHash: 'uhCkkOutcomeThreeAcornFixture000000000000000000000',
        recordCreatedAt: T0 + 2,
        recordUpdatedAt: T0 + 2,
      },
      relations: { creator: BOB, editor: BOB, parent: 'acorn-outcome-1' },
    },
    {
      entity: 'AcornConnection',
      id: 'acorn-connection-1',
      fields: {
        siblingOrder: 0,
        randomizer: 42,
        isImported: false,
        entryHash: 'uhCkkConnectionOneAcornFixture000000000000000000000',
        recordCreatedAt: T0,
        recordUpdatedAt: T0,
      },
      relations: { parent: 'acorn-outcome-1', child: 'acorn-outcome-2' },
    },
    {
      entity: 'AcornConnection',
      id: 'acorn-connection-2',
      fields: {
        siblingOrder: 1,
        randomizer: 43,
        isImported: false,
        entryHash: 'uhCkkConnectionTwoAcornFixture000000000000000000000',
        recordCreatedAt: T0,
        recordUpdatedAt: T0,
      },
      relations: { parent: 'acorn-outcome-1', child: 'acorn-outcome-3' },
    },
    {
      entity: 'AcornTag',
      id: 'acorn-tag-1',
      fields: {
        text: 'frontend',
        backgroundColor: '#3b82f6',
        entryHash: 'uhCkkTagOneAcornFixture0000000000000000000000000000',
        recordCreatedAt: T0,
        recordUpdatedAt: T0,
      },
    },
    {
      entity: 'AcornMember',
      id: 'acorn-member-1',
      fields: {
        entryHash: 'uhCkkMemberOneAcornFixture00000000000000000000000000',
        recordCreatedAt: T0,
        recordUpdatedAt: T0,
      },
      relations: { agent: ALICE, sameAs: ALICE },
    },
    {
      entity: 'AcornMember',
      id: 'acorn-member-2',
      fields: {
        entryHash: 'uhCkkMemberTwoAcornFixture00000000000000000000000000',
        recordCreatedAt: T0,
        recordUpdatedAt: T0,
      },
      relations: { agent: BOB, sameAs: BOB },
    },
    {
      entity: 'AcornProfile',
      id: 'acorn-profile-1',
      fields: {
        firstName: 'Alice',
        lastName: 'Anders',
        handle: 'alice',
        status: 'Online',
        avatarUrl: '',
        agentPubKey: 'agentPubKey-alice-acorn-fixture',
        isImported: false,
        entryHash: 'uhCkkProfileOneAcornFixture0000000000000000000000000',
        recordCreatedAt: T0,
        recordUpdatedAt: T0,
      },
      relations: { agent: ALICE },
    },
    {
      entity: 'AcornProfile',
      id: 'acorn-profile-2',
      fields: {
        firstName: 'Bob',
        lastName: 'Bakker',
        handle: 'bob',
        status: 'Away',
        avatarUrl: '',
        agentPubKey: 'agentPubKey-bob-acorn-fixture',
        isImported: false,
        entryHash: 'uhCkkProfileTwoAcornFixture0000000000000000000000000',
        recordCreatedAt: T0,
        recordUpdatedAt: T0,
      },
      relations: { agent: BOB },
    },
    {
      entity: 'AcornOutcomeMember',
      id: 'acorn-outcome-member-1',
      fields: {
        unixTimestamp: T0 + 3,
        isImported: false,
        entryHash: 'uhCkkOutcomeMemberOneAcornFixture0000000000000000000',
        recordCreatedAt: T0 + 3,
        recordUpdatedAt: T0 + 3,
      },
      relations: { outcome: 'acorn-outcome-2', member: 'acorn-member-1', creator: ALICE },
    },
    {
      entity: 'AcornOutcomeComment',
      id: 'acorn-comment-1',
      fields: {
        content: 'Looks good — the map can land next.',
        unixTimestamp: T0 + 4,
        isImported: false,
        entryHash: 'uhCkkCommentOneAcornFixture0000000000000000000000000',
        recordCreatedAt: T0 + 4,
        recordUpdatedAt: T0 + 4,
      },
      relations: { outcome: 'acorn-outcome-1', creator: BOB },
    },
    {
      entity: 'AcornEntryPoint',
      id: 'acorn-entry-point-1',
      fields: {
        color: '#22c55e',
        createdAtTime: T0 + 5,
        isImported: false,
        entryHash: 'uhCkkEntryPointOneAcornFixture0000000000000000000000',
        recordCreatedAt: T0 + 5,
        recordUpdatedAt: T0 + 5,
      },
      relations: { outcome: 'acorn-outcome-1', creator: ALICE },
    },
  ],
};

/** The fixture's dataset id — stable, knowable before the dataset exists. */
export const acornDatasetId = datasetIdFor(acornFixture);

/**
 * Write the fixture into a seeded dataset, through the same `applyFixture`
 * path the preview host uses. The dataset must already exist
 * (`lifecycle.create`/a seeded entry) — this is content, not provisioning.
 */
export async function applyAcornFixture(
  ports: Pick<BackendPorts, 'lifecycle' | 'schemas'>,
  datasetId = acornDatasetId,
): Promise<void> {
  const dataset = await ports.lifecycle.get(datasetId);
  if (!dataset) throw new Error(`[acorn-fixture] seeded dataset '${datasetId}' is missing`);
  await applyFixture(
    {
      getEntity,
      dataset: dataset.handle,
      datasetId,
      sharedId: dataset.sharedId,
      // So the Acorn classes exist before their records are written; the app
      // adopts them again from the `Shape` records on entry, as any space's.
      declareShape: (manifest, moduleId) =>
        ports.schemas.declareInDataset(dataset.handle, manifest as never, { moduleId }),
    },
    acornFixture,
  );
}
