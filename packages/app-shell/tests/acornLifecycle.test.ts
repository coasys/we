/**
 * The Acorn project lifecycle — the sequence that turns a mounted Acorn language
 * into a WE space — tested where the whole of it lives: `shared/acornLifecycle`.
 *
 * Two things matter and nothing else does. **Absent**: every call is a no-op on a
 * backend without the mount/template/interact port (the in-memory host the offline
 * suite runs on), because a module-schema `$invoke` hitting a backend that cannot
 * mount must degrade rather than throw — the optional-port pattern (`BackendPorts`
 * docs) applied to lifecycle. **Order**: the open sequence is design §L.4 —
 * applyTemplateLocal → perspective create → mount → `initializeAsWeSpace` →
 * `defaultTemplateId: 'acorn'` → `interact whoami` — and order is the contract:
 * mounting before the language exists, or initializing before the mount's foreign
 * SDNA landed, are the ways this silently produces a space without a project.
 */
import type { AcornOperationState, AcornSetupIntent, AcornSpaceSetup } from '@shared/acornLifecycle';
import {
  ACORN_TEMPLATE_ID,
  type AcornLifecycleDeps,
  AcornLifecycleError,
  acornSeed,
  createAcornLifecycle,
} from '@shared/acornLifecycle';
import type { AcornLifecyclePort, DatasetLifecyclePort, DatasetRef, SchemaPort } from '@we/backend-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const LANG = 'QmzAcornLanguageUnderTest';
const BASE = 'QmzAcornBaseBundleUnderTest';

/** The setup-invariant read: nothing of the space's structure exists yet. */
const EMPTY_SETUP: AcornSpaceSetup = {
  spaceRecord: false,
  root: false,
  enabledViews: false,
  defaultTemplate: false,
  setupDone: false,
};
/** Every invariant holds — the answer a finished project gives on reopen. */
const FULL_SETUP: AcornSpaceSetup = {
  spaceRecord: true,
  root: true,
  enabledViews: true,
  defaultTemplate: true,
  setupDone: true,
};

const ref = (id: string, name = id): DatasetRef => ({ id, name, handle: { id } });

/** A port that records what it was asked for, in the order it was asked. */
function recordedPort(record: string[]): AcornLifecyclePort & { mountsOf: Record<string, string[]> } {
  const mountsOf: Record<string, string[]> = {};
  return {
    mountsOf,
    applyTemplateLocal: vi.fn(async (hash: string, data: Record<string, unknown>) => {
      record.push(`applyTemplateLocal:${hash}`);
      void data;
      return { address: LANG };
    }),
    mount: vi.fn(async (uuid: string, languageAddress: string) => {
      record.push(`mount:${uuid}:${languageAddress}`);
      mountsOf[uuid] = [languageAddress];
      return true;
    }),
    unmount: vi.fn(async (uuid: string, languageAddress: string) => {
      record.push(`unmount:${uuid}:${languageAddress}`);
      return true;
    }),
    mounts: vi.fn(async (uuid: string) => {
      record.push(`mounts:${uuid}`);
      return mountsOf[uuid] ?? [];
    }),
    interact: vi.fn(async (url: string, call: { name: string; parameters?: object }) => {
      record.push(`interact:${call.name}:${url}`);
      if (call.name === 'info') return url === `${LANG}://project` ? { dnaHash: 'QmdnaUnderTest' } : null;
      return call.name === 'whoami' ? { address: 'profile/abc', data: {} } : null;
    }),
  };
}

function deps(
  record: string[],
  overrides: Partial<AcornLifecycleDeps> & Record<string, unknown> = {},
): AcornLifecycleDeps {
  const port = recordedPort(record);
  const lifecycle = {
    list: vi.fn(async () => [] as DatasetRef[]),
    get: vi.fn(async (id: string) => ref(id)),
    create: vi.fn(async (name: string) => {
      record.push(`create:${name}`);
      return ref('dataset-1', name);
    }),
    remove: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  };
  const schemas = {
    hasAnySchema: vi.fn(async () => true),
    hasCoreSchema: vi.fn(async () => false),
  };
  let currentDatasetId: string | undefined;
  const intents = new Map<string, AcornSetupIntent>();
  return {
    // Not part of the deps contract — the pre-fix sequence switched the ambient
    // dataset before checking; the fixed one never calls it, and the record proves it.
    switchDataset: vi.fn(async (id: string) => {
      record.push(`switch:${id}`);
      currentDatasetId = id;
    }),
    port: () => port,
    lifecycle: () => lifecycle as unknown as DatasetLifecyclePort,
    schemas: () => schemas as unknown as SchemaPort,
    spaceSetup: vi.fn(async () => ({ ...EMPTY_SETUP }) as AcornSpaceSetup),
    currentDatasetId: () => currentDatasetId,
    navigateToSpace: vi.fn(async (id: string) => {
      record.push(`navigate:${id}`);
      currentDatasetId = id;
    }),
    ensureSpaceStructure: vi.fn(async (name: string, _description: string, target?: DatasetRef) => {
      record.push(`ensure:${name}:${target?.id}`);
    }),
    setupIntent: {
      get: (id: string) => intents.get(id) ?? null,
      set: (id: string, intent: AcornSetupIntent) => void intents.set(id, intent),
      clear: (id: string) => void intents.delete(id),
    },
    setSpaceDefaultTemplate: vi.fn(async (id: string, uuid?: string) => {
      record.push(`template:${id}:${uuid}`);
    }),
    markSpaceSetupDone: vi.fn(async (uuid: string) => {
      record.push(`marker:${uuid}`);
    }),
    setSpaceViews: vi.fn(async (ids: string[], uuid?: string) => {
      record.push(`views:${ids.join(',')}:${uuid}`);
    }),
    setSpaceTemplateOverride: vi.fn(async (id: string, uuid?: string) => {
      record.push(`override:${id}:${uuid}`);
    }),
    hasAcornTemplate: () => true,
    agentName: () => 'Test Agent',
    ...overrides,
  } as AcornLifecycleDeps;
}

/** The order within `record` of the named prefixes, for an ordered-sequence assertion. */
const orderOf = (record: string[], prefixes: string[]) => prefixes.map((p) => record.findIndex((c) => c.startsWith(p)));

describe('acorn lifecycle on a backend without the port', () => {
  it('degrades — no call throws and nothing is asked of a lifecycle that cannot answer', async () => {
    const d = deps([], { port: () => undefined });
    const acorn = createAcornLifecycle(d);

    await expect(acorn.listAcornProjects()).resolves.toEqual([]);
    await expect(acorn.createAcornProject('P', 'some words here')).resolves.toBeNull();
    await expect(acorn.joinAcornProject(undefined, 'some words here')).resolves.toBeNull();
    await expect(acorn.openAcornProject('dataset-1')).resolves.toBeNull();

    expect(d.lifecycle()!.create).not.toHaveBeenCalled();
    expect(d.ensureSpaceStructure).not.toHaveBeenCalled();
  });
});

describe('acorn lifecycle on a build without the acorn template', () => {
  /*
    `defaultTemplateId: 'acorn'` is the last write every mutating member makes. A deployment
    whose seed left the template out cannot resolve it — offering the creation there produces
    a space that renders nothing, which is worse than not offering it. The mutating members
    refuse; the read still answers, since what it reports is true either way.
  */
  it('create, join and open refuse — no mount, no dataset, no template write', async () => {
    const record: string[] = [];
    const d = deps(record, { hasAcornTemplate: () => false });
    const acorn = createAcornLifecycle(d);

    await expect(acorn.createAcornProject('P', 'some words here')).resolves.toBeNull();
    await expect(acorn.joinAcornProject(undefined, 'some words here')).resolves.toBeNull();
    await expect(acorn.openAcornProject('dataset-1')).resolves.toBeNull();

    expect(d.lifecycle()!.create).not.toHaveBeenCalled();
    expect(d.port()!.applyTemplateLocal).not.toHaveBeenCalled();
    expect(record).toEqual([]);
  });

  it('still lists mounted projects — the read is true whether or not the build draws them', async () => {
    const d = deps([], { hasAcornTemplate: () => false });
    (d.lifecycle()!.list as ReturnType<typeof vi.fn>).mockResolvedValue([ref('acorn-1', 'Project one')]);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['acorn-1'] = [LANG];

    await expect(createAcornLifecycle(d).listAcornProjects()).resolves.toEqual([
      { datasetId: 'acorn-1', name: 'Project one', languageAddress: LANG },
    ]);
  });
});

describe('createAcornProject', () => {
  it('runs the §L.4 sequence: template → create → mount → initialize → template write → interact', async () => {
    const record: string[] = [];
    const acorn = createAcornLifecycle(deps(record));

    const id = await acorn.createAcornProject('Rig Project', 'alpha beta gamma', BASE);
    expect(id).toBe('dataset-1');

    // The §L.4 backbone, in order — nothing may interleave ahead of its step, and the
    // landing comes last, once the space is a space.
    const idx = orderOf(record, [
      'applyTemplateLocal',
      'create:',
      'mount:',
      'ensure:',
      `template:${ACORN_TEMPLATE_ID}`,
      'interact:whoami',
      'navigate:',
    ]);
    expect(idx, `order in ${JSON.stringify(record)}`).toEqual([...idx].sort((a, b) => a - b));
    expect(
      idx.every((i) => i >= 0),
      `missing a step in ${JSON.stringify(record)}`,
    ).toBe(true);

    // The exact calls: the seed from the passphrase, the mount on the new dataset, the acorn template.
    expect(record).toContain(`applyTemplateLocal:${BASE}`);
    expect(record).toContain(`mount:dataset-1:${LANG}`);
    expect(record).toContain('ensure:Rig Project:dataset-1');
    expect(record).toContain(`template:${ACORN_TEMPLATE_ID}:dataset-1`);
    // The space's section list lands beside the template — the acorn nav, outcomes first.
    expect(record).toContain('views:acorn-outcomes,acorn-table,acorn-priority,acorn-map,acorn-settings:dataset-1');
    // And the agent's own override — the app's "every space ours" policy outranks the record.
    expect(record).toContain(`override:${ACORN_TEMPLATE_ID}:dataset-1`);
    // The project meta is written through the language, and whoami asks the mounted project.
    expect(record).toContain(`interact:create:${LANG}://class/AcornProjectMeta`);
    expect(record).toContain(`interact:whoami:${LANG}://project`);
  });

  it('derives the seed the way stock Acorn does — uid- plus hyphenated words', () => {
    expect(acornSeed('alpha beta gamma')).toBe('uid-alpha-beta-gamma');
    expect(acornSeed('word')).toBe('uid-word');
  });

  it('creates the member profile when whoami comes back empty', async () => {
    const record: string[] = [];
    const d = deps(record);
    // whoami → null until the member profile exists; the sequence must create it.
    (d.port()!.interact as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, call: { name: string }) => {
      record.push(`interact:${call.name}:${url}`);
      return null;
    });
    const acorn = createAcornLifecycle(d);
    await acorn.createAcornProject('P', 'a b c', BASE);

    expect(record).toContain(`interact:create:${LANG}://class/AcornProfile`);
  });
});

describe('joinAcornProject', () => {
  it('mounts the same seed-derived language and announces the join — without writing project meta', async () => {
    const record: string[] = [];
    const acorn = createAcornLifecycle(deps(record));

    const id = await acorn.joinAcornProject(undefined, 'alpha beta gamma', BASE);
    expect(id).toBe('dataset-1');

    // Join still templates — same seed ⇒ same language address — rather than trusting the mount to find it.
    expect(record).toContain(`applyTemplateLocal:${BASE}`);
    expect(record).toContain(`mount:dataset-1:${LANG}`);
    expect(record.find((c) => c.startsWith('interact:announceJoin'))).toBe(`interact:announceJoin:${LANG}://project`);
    // The project already has its meta: the joiner must not write a second one.
    expect(record.find((c) => c.includes('class/AcornProjectMeta'))).toBeUndefined();
  });
});

describe('openAcornProject', () => {
  /*
    Reopen is repair, not a skip-list: each setup invariant is read on its own and
    only the missing pieces are finished. "A Space record exists" was never the
    whole state — a run that died between the record and its root, its section
    recipe, or its template left a project the old all-or-nothing check called done.
  */
  it('writes nothing on a project whose setup already holds — a plain reopen', async () => {
    const record: string[] = [];
    const d = deps(record, { spaceSetup: vi.fn(async () => ({ ...FULL_SETUP }) as AcornSpaceSetup) });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    const acorn = createAcornLifecycle(d);
    await acorn.openAcornProject('dataset-1');

    expect(d.ensureSpaceStructure).not.toHaveBeenCalled();
    expect(record.find((c) => c.startsWith('views:'))).toBeUndefined();
    expect(record.find((c) => c.startsWith('template:'))).toBeUndefined();
    // The agent's own template preference still lands, and the open still lands.
    expect(record).toContain(`override:${ACORN_TEMPLATE_ID}:dataset-1`);
    expect(record).toContain('navigate:dataset-1');
  });

  it('repairs a setup that died before the Space record — structure, sections, template', async () => {
    const record: string[] = [];
    const d = deps(record);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    const acorn = createAcornLifecycle(d);
    await acorn.openAcornProject('dataset-1');

    expect(d.ensureSpaceStructure).toHaveBeenCalled();
    expect(record).toContain('views:acorn-outcomes,acorn-table,acorn-priority,acorn-map,acorn-settings:dataset-1');
    expect(record).toContain(`template:${ACORN_TEMPLATE_ID}:dataset-1`);
  });

  it('repairs a Space committed before its root — without writing the record again', async () => {
    const record: string[] = [];
    const d = deps(record, {
      spaceSetup: vi.fn(
        async () =>
          ({
            spaceRecord: true,
            root: false,
            enabledViews: true,
            defaultTemplate: true,
            setupDone: false,
          }) as AcornSpaceSetup,
      ),
    });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    const acorn = createAcornLifecycle(d);
    await acorn.openAcornProject('dataset-1');

    // Structural repair runs — inside the dep the root is written, not a second
    // record; and nothing downstream of the gap is touched, it already held.
    expect(d.ensureSpaceStructure).toHaveBeenCalledTimes(1);
    expect(record.find((c) => c.startsWith('views:'))).toBeUndefined();
    expect(record.find((c) => c.startsWith('template:'))).toBeUndefined();
  });

  it('writes the Acorn section recipe on a space that never got it — and not the rest', async () => {
    const record: string[] = [];
    const d = deps(record, {
      spaceSetup: vi.fn(
        async () =>
          ({
            spaceRecord: true,
            root: true,
            enabledViews: false,
            defaultTemplate: true,
            setupDone: false,
          }) as AcornSpaceSetup,
      ),
    });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    const acorn = createAcornLifecycle(d);
    await acorn.openAcornProject('dataset-1');

    expect(d.ensureSpaceStructure).not.toHaveBeenCalled();
    expect(record).toContain('views:acorn-outcomes,acorn-table,acorn-priority,acorn-map,acorn-settings:dataset-1');
    expect(record.find((c) => c.startsWith('template:'))).toBeUndefined();
  });

  /*
    A member's own section list is not a missing piece: the recipe flag answers
    whether the Acorn sections were ever written, and a list holding any of them
    was written — what a member removed after is theirs to keep.
  */
  it('does not reset a customized section list — recipe present means written', async () => {
    const record: string[] = [];
    const d = deps(record, {
      spaceSetup: vi.fn(
        async () =>
          ({
            spaceRecord: true,
            root: true,
            enabledViews: true,
            defaultTemplate: false,
            setupDone: false,
          }) as AcornSpaceSetup,
      ),
    });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    const acorn = createAcornLifecycle(d);
    await acorn.openAcornProject('dataset-1');

    expect(record.find((c) => c.startsWith('views:'))).toBeUndefined();
    // Only the missing piece — the shared default template — is finished.
    expect(record).toContain(`template:${ACORN_TEMPLATE_ID}:dataset-1`);
  });

  /*
    The remote owed-work — the create's project meta, the join's announce — is
    nothing a read can answer "done?" for: the mount's interact surface has no
    instance read. The intent retained at mount time is the record, cleared piece
    by piece as the writes land, so an Open after a failed create or join resumes
    what it owes instead of skipping it (Lal's R2).
  */
  it('resumes the project meta a failed create still owes through Open', async () => {
    const record: string[] = [];
    const d = deps(record, { spaceSetup: vi.fn(async () => ({ ...FULL_SETUP }) as AcornSpaceSetup) });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    d.setupIntent!.set('dataset-1', { name: 'Rig Project', writeMeta: true, announce: false });
    const acorn = createAcornLifecycle(d);

    await acorn.openAcornProject('dataset-1');
    expect(record).toContain(`interact:create:${LANG}://class/AcornProjectMeta`);
    // Owed work cleared as it landed — the next open owes nothing.
    expect(d.setupIntent!.get('dataset-1')).toBeNull();
  });

  it('resumes the announce a failed join still owes through Open', async () => {
    const record: string[] = [];
    const d = deps(record, { spaceSetup: vi.fn(async () => ({ ...FULL_SETUP }) as AcornSpaceSetup) });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    d.setupIntent!.set('dataset-1', { name: 'Rig Project', writeMeta: false, announce: true });
    const acorn = createAcornLifecycle(d);

    await acorn.openAcornProject('dataset-1');
    expect(record).toContain(`interact:announceJoin:${LANG}://project`);
    expect(d.setupIntent!.get('dataset-1')).toBeNull();
  });

  it('owes nothing on Open without intent or a create/join in flight — no meta write', async () => {
    const record: string[] = [];
    const d = deps(record, { spaceSetup: vi.fn(async () => ({ ...FULL_SETUP }) as AcornSpaceSetup) });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    const acorn = createAcornLifecycle(d);

    await acorn.openAcornProject('dataset-1');
    expect(record.find((c) => c.includes('class/AcornProjectMeta'))).toBeUndefined();
    expect(record.find((c) => c.startsWith('interact:announceJoin'))).toBeUndefined();
  });

  it('counts the single-meta refusal as the write having landed — intent clears', async () => {
    const record: string[] = [];
    const d = deps(record, { spaceSetup: vi.fn(async () => ({ ...FULL_SETUP }) as AcornSpaceSetup) });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    (d.port()!.interact as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, call: { name: string }) => {
      record.push(`interact:${call.name}:${url}`);
      if (call.name === 'info') return { dnaHash: 'QmdnaUnderTest' };
      if (call.name === 'whoami') return { address: 'profile/abc' };
      if (call.name === 'create' && url.includes('AcornProjectMeta')) {
        // The a9 wire form the rig observed: the wasm guest message nested inside
        // the executor's forwarded CellError dump.
        throw new Error(
          'expression_interact failed: Runtime error in language: create: Conductor API error: ' +
            'CellError(WorkflowError(RibosomeError(WasmRuntimeError(...Guest("Only one of this ' +
            'entry type should exist and an existing one was found")))))',
        );
      }
      return null;
    });
    d.setupIntent!.set('dataset-1', { name: 'Rig Project', writeMeta: true, announce: false });
    const acorn = createAcornLifecycle(d);

    // A meta the first create already committed — the second write's refusal is
    // the idempotence the zome guarantees, not a failure the open should report.
    await expect(acorn.openAcornProject('dataset-1')).resolves.toBe('dataset-1');
    expect(d.setupIntent!.get('dataset-1')).toBeNull();
  });

  it('keeps owed intent when the write fails — the next open tries again', async () => {
    const record: string[] = [];
    const d = deps(record, { spaceSetup: vi.fn(async () => ({ ...FULL_SETUP }) as AcornSpaceSetup) });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    (d.port()!.interact as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, call: { name: string }) => {
      record.push(`interact:${call.name}:${url}`);
      if (call.name === 'info') return { dnaHash: 'QmdnaUnderTest' };
      if (call.name === 'whoami') return { address: 'profile/abc' };
      if (call.name === 'create' && url.includes('AcornProjectMeta')) throw new Error('zome unreachable');
      return null;
    });
    d.setupIntent!.set('dataset-1', { name: 'Rig Project', writeMeta: true, announce: false });
    const acorn = createAcornLifecycle(d);

    await expect(acorn.openAcornProject('dataset-1')).rejects.toThrow('zome unreachable');
    expect(d.setupIntent!.get('dataset-1')).toEqual({ name: 'Rig Project', writeMeta: true, announce: false });
  });

  /*
    Navigation during the awaited setup check is the race the explicit target exists
    for: `hasSpaceRecord` resolving does not decide whose dataset the writes land on —
    the target the open was handed does. Setup still completes on the project that was
    opened (the work is real, and the next open finds it done), nothing touches the
    dataset the person moved to, and the stale open does not navigate: landing would
    yank them back onto it.
  */
  it('finishes setup on the target dataset when navigation lands elsewhere mid-open', async () => {
    const record: string[] = [];
    let current: string | undefined = 'dataset-before';
    let releaseCheck!: (setup: AcornSpaceSetup) => void;
    const d = deps(record, {
      spaceSetup: vi
        .fn()
        .mockImplementationOnce(() => new Promise<AcornSpaceSetup>((resolve) => (releaseCheck = resolve)))
        .mockImplementation(async () => ({ ...EMPTY_SETUP }) as AcornSpaceSetup),
      switchDataset: vi.fn(async (id: string) => {
        record.push(`switch:${id}`);
        current = id;
      }),
      currentDatasetId: () => current,
    });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    const acorn = createAcornLifecycle(d);

    const open = acorn.openAcornProject('dataset-1');
    await vi.waitFor(() => expect(d.spaceSetup).toHaveBeenCalled());
    current = 'dataset-other'; // the person navigated while the check was in flight
    releaseCheck({ ...EMPTY_SETUP });

    await expect(open).resolves.toBeNull();

    // Setup landed — on the dataset that was opened, by explicit target.
    expect(record).toContain('ensure:dataset-1:dataset-1');
    expect(record).toContain(`template:${ACORN_TEMPLATE_ID}:dataset-1`);
    expect(record).toContain(`override:${ACORN_TEMPLATE_ID}:dataset-1`);
    // Nothing at all was written against the dataset the person moved to.
    expect(record.filter((c) => c.endsWith(':dataset-other'))).toEqual([]);
    // And the stale open did not navigate: the person stays where they went.
    expect(record.find((c) => c.startsWith('navigate:'))).toBeUndefined();
    // Setup never needed the ambient current dataset — there is no switch at all.
    expect(record.find((c) => c.startsWith('switch:'))).toBeUndefined();
  });

  it('lets only the newest open navigate — a superseded open finishes setup and stands down', async () => {
    const record: string[] = [];
    let current: string | undefined;
    const checks: ((setup: AcornSpaceSetup) => void)[] = [];
    const d = deps(record, {
      spaceSetup: vi
        .fn()
        .mockImplementationOnce(() => new Promise<AcornSpaceSetup>((resolve) => checks.push(resolve)))
        .mockImplementationOnce(() => new Promise<AcornSpaceSetup>((resolve) => checks.push(resolve)))
        .mockImplementation(async () => ({ ...EMPTY_SETUP }) as AcornSpaceSetup),
      switchDataset: vi.fn(async (id: string) => {
        record.push(`switch:${id}`);
        current = id;
      }),
      navigateToSpace: vi.fn(async (id: string) => {
        record.push(`navigate:${id}`);
        current = id;
      }),
      currentDatasetId: () => current,
    });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-a'] = [LANG];
    port.mountsOf['dataset-b'] = [LANG];
    const acorn = createAcornLifecycle(d);

    const openA = acorn.openAcornProject('dataset-a');
    await vi.waitFor(() => expect(checks).toHaveLength(1));
    const openB = acorn.openAcornProject('dataset-b');
    await vi.waitFor(() => expect(checks).toHaveLength(2));

    checks[1]({ ...EMPTY_SETUP }); // B's check answers first — B is the newer open
    await expect(openB).resolves.toBe('dataset-b');
    checks[0]({ ...EMPTY_SETUP }); // A's check answers after
    await expect(openA).resolves.toBeNull();

    // Both setups completed on their own targets — the writes are real — but only
    // the newest open navigated. A stale open finishing must not steal the landing.
    expect(record).toContain('ensure:dataset-a:dataset-a');
    expect(record).toContain('ensure:dataset-b:dataset-b');
    expect(record.filter((c) => c.startsWith('navigate:'))).toEqual(['navigate:dataset-b']);
    expect(current).toBe('dataset-b');
  });

  /*
    Two opens of the same project race the read-then-write "is there a Space" check:
    without serialization each sees the record missing and writes it twice. The second
    open's check waits for the first's setup, sees the record the first wrote, and
    writes nothing of its own.
  */
  it('serializes setup for one target — a second open does not write the Space again', async () => {
    const record: string[] = [];
    let current: string | undefined;
    // The flags the dep's read reports — the writes below turn them true, so the
    // second open's check sees the first's finished setup rather than the same gap.
    const flags = { ...EMPTY_SETUP };
    let firstCheck = true;
    let releaseFirst!: () => void;
    const d = deps(record, {
      spaceSetup: vi.fn(async () => {
        record.push('check');
        if (firstCheck) {
          firstCheck = false;
          await new Promise<void>((resolve) => (releaseFirst = resolve));
        }
        return { ...flags };
      }),
      ensureSpaceStructure: vi.fn(async (name: string, _desc: string, target?: DatasetRef) => {
        record.push(`ensure:${name}:${target?.id}`);
        flags.spaceRecord = true;
        flags.root = true;
      }),
      setSpaceViews: vi.fn(async (ids: string[], uuid?: string) => {
        record.push(`views:${ids.join(',')}:${uuid}`);
        flags.enabledViews = true;
      }),
      setSpaceDefaultTemplate: vi.fn(async (id: string, uuid?: string) => {
        record.push(`template:${id}:${uuid}`);
        flags.defaultTemplate = true;
      }),
      markSpaceSetupDone: vi.fn(async (uuid: string) => {
        record.push(`marker:${uuid}`);
        flags.setupDone = true;
      }),
      switchDataset: vi.fn(async (id: string) => {
        record.push(`switch:${id}`);
        current = id;
      }),
      navigateToSpace: vi.fn(async (id: string) => {
        record.push(`navigate:${id}`);
        current = id;
      }),
      currentDatasetId: () => current,
    });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    const acorn = createAcornLifecycle(d);

    const first = acorn.openAcornProject('dataset-1');
    await vi.waitFor(() => expect(d.spaceSetup).toHaveBeenCalledTimes(1));
    const second = acorn.openAcornProject('dataset-1');
    // The second open is queued behind the first's setup: it cannot have asked yet.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(d.spaceSetup).toHaveBeenCalledTimes(1);

    releaseFirst();
    await expect(first).resolves.toBeNull(); // superseded by the newer open
    await expect(second).resolves.toBe('dataset-1');

    // Three reads total: the first open checks once and once more after its own
    // repair; the second open's single check ran only after that setup settled —
    // and saw the state the first wrote, so there is one structure write and one landing.
    expect(record.filter((c) => c === 'check')).toHaveLength(3);
    expect(record.filter((c) => c.startsWith('ensure:'))).toEqual(['ensure:dataset-1:dataset-1']);
    expect(record.filter((c) => c.startsWith('navigate:'))).toEqual(['navigate:dataset-1']);
    expect(current).toBe('dataset-1');
  });

  /*
    A retried create or join must not make a second perspective for the project it
    already made one for: the same seed templates to the same language address, so
    the dataset already carrying that mount is the project — the open tail resumes
    it rather than `lifecycle.create` starting over.
  */
  it('a retried create reuses the perspective the first attempt made', async () => {
    const record: string[] = [];
    const d = deps(record);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    (d.lifecycle()!.list as ReturnType<typeof vi.fn>).mockResolvedValue([ref('dataset-1', 'Rig Project')]);
    port.mountsOf['dataset-1'] = [LANG];
    const acorn = createAcornLifecycle(d);

    const id = await acorn.createAcornProject('Rig Project', 'alpha beta gamma', BASE);
    expect(id).toBe('dataset-1');
    expect(d.lifecycle()!.create).not.toHaveBeenCalled();
    expect(record).toContain('ensure:Rig Project:dataset-1');
    expect(record).toContain(`interact:create:${LANG}://class/AcornProjectMeta`);
  });

  it('a retried join reuses the perspective the first attempt made', async () => {
    const record: string[] = [];
    const d = deps(record);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    (d.lifecycle()!.list as ReturnType<typeof vi.fn>).mockResolvedValue([ref('dataset-1', 'Acorn project')]);
    port.mountsOf['dataset-1'] = [LANG];
    const acorn = createAcornLifecycle(d);

    const id = await acorn.joinAcornProject(undefined, 'alpha beta gamma', BASE);
    expect(id).toBe('dataset-1');
    expect(d.lifecycle()!.create).not.toHaveBeenCalled();
    expect(record).toContain(`interact:announceJoin:${LANG}://project`);
  });
});

describe('listAcornProjects', () => {
  it('lists only datasets the executor reports a mount on', async () => {
    const record: string[] = [];
    const d = deps(record);
    (d.lifecycle()!.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      ref('acorn-1', 'Project one'),
      ref('plain-space', 'A WE space'),
    ]);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['acorn-1'] = [LANG];

    const projects = await acornProjects(d);
    expect(projects).toEqual([{ datasetId: 'acorn-1', name: 'Project one', languageAddress: LANG }]);
  });

  /*
    A mount is not an Acorn project — it is a language address on a dataset, and any
    language can be mounted. Before this check every mounted dataset listed as a project
    and "open" would have written a project meta into somebody else's language. `info`
    is the call the lifecycle already leans on; only a mount that answers it as a cell
    (`dnaHash`) is ours.
  */
  it('skips mounts whose language does not answer info as an Acorn cell', async () => {
    const record: string[] = [];
    const d = deps(record);
    (d.lifecycle()!.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      ref('acorn-1', 'Project one'),
      ref('chat-space', 'A chat space'),
      ref('quiet-mount', 'A mount that cannot answer'),
    ]);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['acorn-1'] = [LANG];
    port.mountsOf['chat-space'] = ['QmzSomeOtherLanguage'];
    port.mountsOf['quiet-mount'] = ['QmzLanguageThatThrows'];

    const projects = await acornProjects(d);
    expect(projects).toEqual([{ datasetId: 'acorn-1', name: 'Project one', languageAddress: LANG }]);
    // The foreign mounts were asked, not trusted — and none of their calls was a write.
    expect(record).toContain('interact:info:QmzSomeOtherLanguage://project');
  });

  it('picks the Acorn mount when a dataset carries several languages', async () => {
    const record: string[] = [];
    const d = deps(record);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = ['QmzSomeOtherLanguage', LANG];
    const acorn = createAcornLifecycle(d);

    await expect(acorn.openAcornProject('dataset-1')).resolves.toBe('dataset-1');
    // The member interactions went to the language that answered as a project, not
    // to whichever mount happened to be listed first.
    expect(record).toContain(`interact:whoami:${LANG}://project`);
    expect(record.find((c) => c === 'interact:whoami:QmzSomeOtherLanguage://project')).toBeUndefined();
  });

  it('refuses to open a dataset whose mounts are none of them Acorn', async () => {
    const record: string[] = [];
    const d = deps(record);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = ['QmzSomeOtherLanguage'];
    const acorn = createAcornLifecycle(d);

    await expect(acorn.openAcornProject('dataset-1')).resolves.toBeNull();
    expect(d.ensureSpaceStructure).not.toHaveBeenCalled();
    expect(record.find((c) => c.startsWith('navigate:'))).toBeUndefined();
    // No member interaction touched the foreign language.
    expect(record.filter((c) => c.startsWith('interact:') && !c.includes('info'))).toEqual([]);
  });
});

/*
  The fresh-cell stall (REPORT-s2b-2cell): a mounted cell's first network read can
  outlive Holochain's 30 s init mutex — `CellError(InitTimeout)` — and the B10
  language's own snapshot deadline — `reads missed the 15000 ms deadline` — fires
  first. Both are transient by construction: the mount target the ask allocated is
  still the project, so the lifecycle retries *that same target* inside a bounded
  budget rather than minting another perspective (a failed mount writes no link,
  so scanning mounts cannot find it again — the retained pending target is what a
  retry reuses).
*/
describe('mount retry — the fresh-cell stall', () => {
  const INIT_TIMEOUT = () => new Error('ConductorApiError: CellError(InitTimeout)');
  const SNAPSHOT_DEADLINE = () => new Error('acorn snapshot: reads missed the 15000 ms deadline');
  const ALREADY_MOUNTING = () => new Error(`${LANG} is already being mounted`);
  const TRANSPORT_GAVE_UP = () => new Error(`acornLifecycle: perspective.mount heard nothing for 30s`);

  afterEach(() => {
    vi.useRealTimers();
  });

  /** `mount` rejects `n` times with `make()`, then installs the mount and resolves. */
  const mountFailing = (record: string[], d: AcornLifecycleDeps, n: number, make: () => Error) => {
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    let left = n;
    (port.mount as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string, lang: string) => {
      record.push(`mount:${uuid}:${lang}`);
      if (left-- > 0) throw make();
      port.mountsOf[uuid] = [lang];
      return true;
    });
    return port;
  };

  /** Drive `create` through its sleeps until it settles, returning the outcome. */
  const settle = async <T>(p: Promise<T>): Promise<{ value?: T; error?: unknown }> => {
    const seen = p.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    // Attempts, backoffs and the budget are timers; the port calls flush as microtasks.
    for (let i = 0; i < 40; i += 1) await vi.advanceTimersByTimeAsync(20_000);
    return seen;
  };

  it('retries the same target once an InitTimeout clears — one perspective, one landing', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record);
    mountFailing(record, d, 1, INIT_TIMEOUT);
    const acorn = createAcornLifecycle(d);

    const out = settle(acorn.createAcornProject('Rig Project', 'a b c', BASE));
    expect((await out).value).toBe('dataset-1');

    // Two mount calls, one dataset, and the landing only after the mount answered.
    expect(record.filter((c) => c.startsWith('mount:'))).toEqual([
      `mount:dataset-1:${LANG}`,
      `mount:dataset-1:${LANG}`,
    ]);
    expect(d.lifecycle()!.create).toHaveBeenCalledTimes(1);
    expect(record).toContain('navigate:dataset-1');
  });

  it('retries the B10 snapshot-deadline text — the earlier failure InitTimeout alone would miss', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record);
    mountFailing(record, d, 2, SNAPSHOT_DEADLINE);
    const acorn = createAcornLifecycle(d);

    expect((await settle(acorn.createAcornProject('P', 'a b c', BASE))).value).toBe('dataset-1');
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(3);
  });

  it('keeps a mount that landed late — the deadline stopped waiting, the target did not change', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record);
    // The mount lands server-side but the transport had already stopped listening:
    // unknown completion — the retained target is what the resume asks about first.
    const port = mountFailing(record, d, 1, TRANSPORT_GAVE_UP);
    (port.mount as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string, lang: string) => {
      record.push(`mount:${uuid}:${lang}`);
      port.mountsOf[uuid] = [lang]; // it did land — the caller just never heard
      throw TRANSPORT_GAVE_UP();
    });
    const acorn = createAcornLifecycle(d);

    const out = await settle(acorn.createAcornProject('P', 'a b c', BASE));
    expect(out.error).toBeInstanceOf(AcornLifecycleError);
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(1); // no blind second attempt

    await expect(acorn.resumeAcornOperation()).resolves.toBe('dataset-1');
    // The resume asked mounts before mounting: the late answer was already there.
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(1);
    expect(record).toContain('navigate:dataset-1');
  });

  it('waits out a mount already in flight — Mounting that becomes Active is not retried over', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record, { pollMs: 500 });
    const port = mountFailing(record, d, 1, ALREADY_MOUNTING);
    // The in-flight mount lands while the budget waits: the second mounts read sees it.
    let reads = 0;
    (port.mounts as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string) => {
      record.push(`mounts:${uuid}`);
      reads += 1;
      return reads >= 2 ? [LANG] : [];
    });
    const acorn = createAcornLifecycle(d);

    expect((await settle(acorn.createAcornProject('P', 'a b c', BASE))).value).toBe('dataset-1');
    // One mount call — nobody unmounted to "clear" it and nobody mounted a second.
    expect(record.filter((c) => c.startsWith('mount:'))).toEqual([`mount:dataset-1:${LANG}`]);
  });

  it('stops after five attempts and parks the same target — a bounded failure, not a loop', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record);
    mountFailing(record, d, 99, SNAPSHOT_DEADLINE);
    const acorn = createAcornLifecycle(d);

    const out = await settle(acorn.createAcornProject('P', 'a b c', BASE));
    expect(out.error).toBeInstanceOf(AcornLifecycleError);
    const err = out.error as AcornLifecycleError;
    expect(err.stage).toBe('mount');
    expect(String(err.cause)).toContain('15000');
    expect(err.retryTarget).toEqual({ datasetId: 'dataset-1', languageAddress: LANG });
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(5);

    // The target survived the failed mount — the pending op names the project to resume.
    expect(d.setupIntent!.get('dataset-1')).toMatchObject({ languageAddress: LANG, phase: 'mount' });
    await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({
      phase: 'failed',
      datasetId: 'dataset-1',
      languageAddress: LANG,
      failure: { stage: 'mount', retryable: true },
    });
    expect(record.find((c) => c.startsWith('navigate:'))).toBeUndefined();

    // And the same target still mounts when the peer comes back — no new dataset.
    mountFailing(record, d, 0, INIT_TIMEOUT);
    await expect(acorn.resumeAcornOperation()).resolves.toBe('dataset-1');
    expect(d.lifecycle()!.create).toHaveBeenCalledTimes(1);
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(6);
    expect(d.setupIntent!.get('dataset-1')).toBeNull(); // meta landed — nothing owed
  });

  it('stops scheduling at the 180 s wall-clock budget rather than finishing a fifth wait', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    // Each snapshot-deadline failure costs its RPC window; a tight budget ends the loop early.
    const d = deps(record, { mountBudgetMs: 3_000 });
    mountFailing(record, d, 99, INIT_TIMEOUT);
    const acorn = createAcornLifecycle(d);

    const out = await settle(acorn.createAcornProject('P', 'a b c', BASE));
    expect(out.error).toBeInstanceOf(AcornLifecycleError);
    // t0 fails → wait 2 s → t2 fails → 1 s left, clamped → budget out: two attempts, not five.
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(2);
  });

  it('does not retry what the executor refused — a permanent mount error parks unretryable', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record);
    mountFailing(record, d, 1, () => new Error('the language is owned by another schema mirror'));
    const acorn = createAcornLifecycle(d);

    const out = await settle(acorn.createAcornProject('P', 'a b c', BASE));
    expect(out.error).toBeInstanceOf(AcornLifecycleError);
    expect((out.error as AcornLifecycleError).retryTarget).toBeNull();
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(1);
    await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({
      phase: 'failed',
      failure: { retryable: false },
    });
  });

  it('holds the target through a close — a late mount is reconciled, not abandoned', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record);
    const port = mountFailing(record, d, 0, INIT_TIMEOUT);
    let releaseMount!: () => void;
    (port.mount as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string, lang: string) => {
      record.push(`mount:${uuid}:${lang}`);
      await new Promise<void>((resolve) => (releaseMount = resolve));
      port.mountsOf[uuid] = [lang]; // the server-side mount still completes
      return true;
    });
    const acorn = createAcornLifecycle(d);

    const create = acorn.createAcornProject('P', 'a b c', BASE);
    await vi.advanceTimersByTimeAsync(0); // let the mount call start
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(1);
    acorn.dismissAcornOperation(); // the modal's Close — UI ownership ends, the run does not pretend to
    releaseMount();

    await expect(create).resolves.toBeNull(); // stood down — no navigation off a closed dialog
    expect(record.find((c) => c.startsWith('navigate:'))).toBeUndefined();
    await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({
      phase: 'failed',
      datasetId: 'dataset-1',
      languageAddress: LANG,
      failure: { retryable: true },
    });

    // Reopening offers the same operation: resume finds the mount already landed.
    await expect(acorn.resumeAcornOperation()).resolves.toBe('dataset-1');
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(1);
  });

  it('shares one pending target between a create and a join for the same language', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record);
    let releaseMount!: () => void;
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    (port.mount as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string, lang: string) => {
      record.push(`mount:${uuid}:${lang}`);
      await new Promise<void>((resolve) => (releaseMount = resolve));
      port.mountsOf[uuid] = [lang];
      return true;
    });
    const acorn = createAcornLifecycle(d);

    const create = acorn.createAcornProject('P', 'a b c', BASE);
    await vi.advanceTimersByTimeAsync(0); // create's mount is the one in flight
    const join = acorn.joinAcornProject(undefined, 'a b c', BASE); // same seed — same language
    await vi.advanceTimersByTimeAsync(0);
    releaseMount();

    const [created, joined] = await Promise.all([create, join]);
    expect(d.lifecycle()!.create).toHaveBeenCalledTimes(1); // one perspective between them
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(1); // one mount call too
    expect(created ?? joined).toBe('dataset-1');
    // The newest ask landed; the owed work ran exactly once.
    expect(record.filter((c) => c.startsWith('navigate:'))).toHaveLength(1);
    expect(record.filter((c) => c.includes('AcornProjectMeta'))).toHaveLength(1);
    expect(record.filter((c) => c.startsWith('interact:announceJoin'))).toHaveLength(1);
  });

  it('a changed second ask supersedes the parked one — same language, the newer name wins', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record);
    mountFailing(record, d, 99, INIT_TIMEOUT);
    const acorn = createAcornLifecycle(d);

    const first = await settle(acorn.createAcornProject('First name', 'a b c', BASE));
    expect(first.error).toBeInstanceOf(AcornLifecycleError);

    mountFailing(record, d, 0, INIT_TIMEOUT);
    // A new submit is a new ask: the retained target is reused, the new name is owed.
    expect((await settle(acorn.createAcornProject('Second name', 'a b c', BASE))).value).toBe('dataset-1');
    expect(d.lifecycle()!.create).toHaveBeenCalledTimes(1);
    expect(record).toContain('ensure:Second name:dataset-1');
  });

  it('keeps a mount discovery failure from minting a second dataset — unknown is not absent', async () => {
    const record: string[] = [];
    const d = deps(record);
    (d.lifecycle()!.list as ReturnType<typeof vi.fn>).mockResolvedValue([ref('acorn-1', 'Project one')]);
    (d.port()!.mounts as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new Error('executor unreachable');
    });
    const acorn = createAcornLifecycle(d);

    await expect(acorn.createAcornProject('P', 'a b c', BASE)).rejects.toThrow();
    expect(d.lifecycle()!.create).not.toHaveBeenCalled(); // nothing minted over an unknown mount
  });

  it('reports the phase the operation is in — preparing, mounting attempts, setting-up, failed', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const states: (AcornOperationState | null)[] = [];
    const d = deps(record, { progress: (s: AcornOperationState | null) => states.push(s) });
    mountFailing(record, d, 1, INIT_TIMEOUT);
    const acorn = createAcornLifecycle(d);

    expect((await settle(acorn.createAcornProject('P', 'a b c', BASE))).value).toBe('dataset-1');
    const phases = states.filter(Boolean).map((s) => s!.phase);
    expect(phases).toContain('preparing');
    expect(phases).toContain('mounting');
    expect(phases).toContain('setting-up');
    // The mounting reports name the attempt — the modal shows "attempt n of 5".
    expect(states.find((s) => s?.phase === 'mounting')).toMatchObject({ attempt: 1 });
    expect(states.at(-1)).toBeNull(); // a landed project leaves nothing pending
  });
});

async function acornProjects(d: AcornLifecycleDeps) {
  return createAcornLifecycle(d).listAcornProjects();
}
