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
  defaultTheme: false,
  setupDone: false,
};
/** Every invariant holds — the answer a finished project gives on reopen. */
const FULL_SETUP: AcornSpaceSetup = {
  spaceRecord: true,
  root: true,
  enabledViews: true,
  defaultTemplate: true,
  defaultTheme: true,
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
    setSpaceDefaultTheme: vi.fn(async (id: string, uuid?: string) => {
      record.push(`theme:${id}:${uuid}`);
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

/*
  The fresh-cell failure fixtures — shared by every describe that needs a mount
  to stall, fail, or report busy. The signatures are the executor's wire text:
  Holochain's init mutex, the B10 snapshot deadline, an in-flight mount slot,
  and our own transport giving up.
*/
const INIT_TIMEOUT = () => new Error('ConductorApiError: CellError(InitTimeout)');
const SNAPSHOT_DEADLINE = () => new Error('acorn snapshot: reads missed the 15000 ms deadline');
const ALREADY_MOUNTING = () => new Error(`${LANG} is already being mounted`);
const TRANSPORT_GAVE_UP = () => new Error(`acornLifecycle: perspective.mount heard nothing for 30s`);

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

/** Drive a lifecycle call through its sleeps until it settles, returning the outcome. */
const settle = async <T>(p: Promise<T>): Promise<{ value?: T; error?: unknown }> => {
  const seen = p.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  // Attempts, backoffs and the budget are timers; the port calls flush as microtasks.
  for (let i = 0; i < 40; i += 1) await vi.advanceTimersByTimeAsync(20_000);
  return seen;
};

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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('names the space from the joined project’s meta — not the placeholder the ask carried', async () => {
    const record: string[] = [];
    const d = deps(record, {
      projectMeta: vi.fn(async () => ({ name: 'Their Real Project' })),
      updateSpaceMeta: vi.fn(async (updates: { name?: string }, uuid?: string) => {
        record.push(`meta:${updates.name}:${uuid}`);
      }),
    });
    const acorn = createAcornLifecycle(d);
    const id = await acorn.joinAcornProject(undefined, 'alpha beta gamma', BASE);
    expect(id).toBe('dataset-1');

    // The structure is born under the real name, and the record itself is corrected.
    expect(record).toContain('ensure:Their Real Project:dataset-1');
    expect(record).toContain('meta:Their Real Project:dataset-1');
  });

  /*
    Words that name no project template a language nobody shares: the mount is
    an empty cell that syncs nothing, so no project meta ever arrives. The join
    waits for it about 20 s, then parks a retryable warning — a wrong-words
    joiner sees the warning instead of an empty space built over nothing, and
    a right-words joiner whose project is still syncing retries into it.
  */
  it('a join whose words name no project waits for the meta, then parks retryable — no empty space', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record, { projectMeta: vi.fn(async () => null) });
    const acorn = createAcornLifecycle(d);
    const outcome = acorn.joinAcornProject(undefined, 'wrong seed words', BASE).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );

    await vi.advanceTimersByTimeAsync(25_000);

    const settled = await Promise.race([outcome, Promise.resolve('still-out' as const)]);
    expect(settled).not.toBe('still-out');
    const pending = await acorn.pendingAcornOperation();
    expect(pending?.phase).toBe('failed');
    expect(pending?.failure?.retryable).toBe(true);
    // No space was built over the empty cell: nothing of the setup tail ran.
    expect(record.find((c) => c.startsWith('ensure:'))).toBeUndefined();
    expect(record.find((c) => c.includes('announceJoin'))).toBeUndefined();
    expect(record.find((c) => c.startsWith('navigate:'))).toBeUndefined();
  });

  /*
    The 20 s is the wait's, not each read's: a meta read still out when the
    wait lapses has not answered, and its late answer is not accepted.
  */
  it('a meta read slower than the 20 s wait parks the join — a 35 s answer is not accepted', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record, {
      projectMeta: vi.fn(
        () => new Promise<{ name: string }>((resolve) => setTimeout(() => resolve({ name: 'Slow Project' }), 35_000)),
      ),
    });
    const acorn = createAcornLifecycle(d);
    const outcome = acorn.joinAcornProject(undefined, 'slow meta words', BASE).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );

    await vi.advanceTimersByTimeAsync(25_000);

    const settled = await Promise.race([outcome, Promise.resolve('still-out' as const)]);
    expect(settled).not.toBe('still-out');
    const pending = await acorn.pendingAcornOperation();
    expect(pending?.phase).toBe('failed');
    expect(pending?.failure?.retryable).toBe(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(record.find((c) => c.startsWith('ensure:'))).toBeUndefined();
    expect(record.find((c) => c.includes('announceJoin'))).toBeUndefined();
  });

  it('the retry on an unanswered join lands once the meta has synced', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    let meta: { name: string } | null = null;
    const d = deps(record, {
      projectMeta: vi.fn(async () => meta),
      updateSpaceMeta: vi.fn(async (updates: { name?: string }, uuid?: string) => {
        record.push(`meta:${updates.name}:${uuid}`);
      }),
    });
    const acorn = createAcornLifecycle(d);
    const outcome = acorn.joinAcornProject(undefined, 'late seed words', BASE).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await Promise.race([outcome, Promise.resolve('still-out' as const)])).not.toBe('still-out');

    meta = { name: 'Late Project' };
    const retried = acorn.resumeAcornOperation('dataset-1', LANG);
    const { value, error } = await settle(retried);
    expect(error).toBeUndefined();
    expect(value).toBe('dataset-1');
    expect(record).toContain('meta:Late Project:dataset-1');
  });
});

describe('the dialog deadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /*
    A join that never lands must not spin forever: at the call's 60 s deadline
    the run is parked resumable — the card the dialog shows, Retry included —
    and the Retry runs the same words on the same retained target.
  */
  it('a join still out at 60 s parks resumable — and Retry runs it again with the same words', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    (port.mount as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string, lang: string) => {
      record.push(`mount:${uuid}:${lang}`);
      return new Promise<boolean>(() => {});
    });
    const acorn = createAcornLifecycle(d);
    const outcome = acorn.joinAcornProject(undefined, 'slow seed words', BASE).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );

    await vi.advanceTimersByTimeAsync(61_000);

    // The spinner's minute is up: a parked, resumable failure is what the dialog shows.
    const pending = await acorn.pendingAcornOperation();
    expect(pending?.phase).toBe('failed');
    expect(pending?.failure?.retryable).toBe(true);
    expect(pending?.datasetId).toBe('dataset-1');
    expect(pending?.languageAddress).toBe(LANG);
    // And the call answered — the dialog does not keep waiting on the mount that never did.
    const settled = await Promise.race([outcome, Promise.resolve('still-out' as const)]);
    expect(settled).not.toBe('still-out');

    /*
      Retry on the parked target: the mount call answers now, the same language
      and dataset are re-checked, and the join lands.
    */
    (port.mount as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string, lang: string) => {
      record.push(`mount:${uuid}:${lang}`);
      port.mountsOf[uuid] = [lang];
      return true;
    });
    const retried = acorn.resumeAcornOperation('dataset-1', LANG).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    const retryOutcome = await Promise.race([
      retried,
      vi.advanceTimersByTimeAsync(240_000).then(() => 'still-out' as const),
    ]);
    expect(retryOutcome).not.toBe('still-out');
    expect((retryOutcome as { value?: string | null }).value).toBe('dataset-1');
    expect(record.filter((c) => c.startsWith('mount:')).every((c) => c === `mount:dataset-1:${LANG}`)).toBe(true);
  });

  /*
    The preflight is part of the call: an address whose `info` never answers
    must not hold Join (or the list row's Open) past the same minute — and an
    answer arriving after it must not carry on into a dataset or a mount.
  */
  it('a join whose address never answers info stops at 60 s — a late answer makes nothing', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    const answer = port.interact as ReturnType<typeof vi.fn>;
    const normal = answer.getMockImplementation() as (url: string, call: { name: string }) => Promise<unknown>;
    let late: (value: unknown) => void = () => {};
    answer.mockImplementation(async (url: string, call: { name: string; parameters?: object }) => {
      if (call.name === 'info') return new Promise((resolve) => (late = resolve));
      return normal(url, call);
    });
    const acorn = createAcornLifecycle(d);
    const outcome = acorn.joinAcornProject(LANG, 'held seed words', BASE).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );

    await vi.advanceTimersByTimeAsync(61_000);

    const settled = await Promise.race([outcome, Promise.resolve('still-out' as const)]);
    expect(settled).not.toBe('still-out');
    const { error } = settled as { error?: unknown };
    expect(error).toBeInstanceOf(AcornLifecycleError);
    expect(error).toMatchObject({ stage: 'prepare' });
    expect(String((error as AcornLifecycleError).cause)).toMatch(/60 s deadline/);

    late({ dnaHash: 'QmdnaUnderTest' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(record.find((c) => c.startsWith('create:'))).toBeUndefined();
    expect(record.find((c) => c.startsWith('mount:'))).toBeUndefined();
  });

  it('an Open whose info scan never answers parks resumable at 60 s — and its Retry finishes', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record, { spaceSetup: vi.fn(async () => ({ ...FULL_SETUP })) });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    const answer = port.interact as ReturnType<typeof vi.fn>;
    const normal = answer.getMockImplementation() as (url: string, call: { name: string }) => Promise<unknown>;
    answer.mockImplementation(async (url: string, call: { name: string; parameters?: object }) => {
      if (call.name === 'info') return new Promise(() => {});
      return normal(url, call);
    });
    const acorn = createAcornLifecycle(d);
    const outcome = acorn.openAcornProject('dataset-1').then(
      (value) => ({ value }),
      (error) => ({ error }),
    );

    await vi.advanceTimersByTimeAsync(61_000);

    const settled = await Promise.race([outcome, Promise.resolve('still-out' as const)]);
    expect(settled).not.toBe('still-out');
    expect((settled as { error?: unknown }).error).toBeInstanceOf(AcornLifecycleError);
    await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({
      phase: 'failed',
      datasetId: 'dataset-1',
      failure: { stage: 'prepare', retryable: true },
    });

    answer.mockImplementation(normal);
    const { value, error } = await settle(acorn.resumeAcornOperation('dataset-1'));
    expect(error).toBeUndefined();
    expect(value).toBe('dataset-1');
  });

  it('a join that lands inside its deadline is not parked — the timer goes with the run', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const acorn = createAcornLifecycle(deps(record));
    const join = acorn.joinAcornProject(undefined, 'quick words', BASE);
    const { value, error } = await settle(join);
    expect(error).toBeUndefined();
    expect(value).toBe('dataset-1');
    expect(await acorn.pendingAcornOperation()).toBeNull();
  });
});

describe('openAcornProject', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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
            defaultTheme: true,
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
            defaultTheme: true,
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
            defaultTheme: false,
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
    // The debt keeps its own name and the intent's newer fields — the mount it
    // survived carries the language and the phase the retry reads.
    expect(d.setupIntent!.get('dataset-1')).toEqual({
      name: 'Rig Project',
      writeMeta: true,
      announce: false,
      languageAddress: LANG,
      phase: 'open',
    });
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

  /*
    The same ownership a close holds: the newest ask is the only run entitled to
    keep issuing. A superseded open's in-flight reads settle, but the writes it
    had not made yet are nobody's to replay — the retained target keeps them for
    whoever opens the project next.
  */
  it('lets only the newest open keep going — a superseded open stands down mid-setup', async () => {
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
    checks[0]({ ...EMPTY_SETUP }); // A's check answers after — but its ask is stale now
    await expect(openA).resolves.toBeNull();

    // Only the newest open ran its setup to the landing; the superseded one
    // stopped where it was — a stale open finishing issues nothing further.
    expect(record).not.toContain('ensure:dataset-a:dataset-a');
    expect(record).toContain('ensure:dataset-b:dataset-b');
    expect(record.filter((c) => c.startsWith('navigate:'))).toEqual(['navigate:dataset-b']);
    expect(current).toBe('dataset-b');
  });

  /*
    Open is the same operation without its mount half: a tail that fails parks
    the operation with the target named, and the Retry under it resumes the same
    dataset — the spinner-then-nothing path is gone.
  */
  it('routes an Open failure through the retained state — its Retry finishes the tail', async () => {
    const record: string[] = [];
    let failedOnce = false;
    const d = deps(record, {
      setSpaceTemplateOverride: vi.fn(async (id: string, uuid?: string) => {
        record.push(`override:${id}:${uuid}`);
        if (!failedOnce) {
          failedOnce = true;
          throw new Error('zome unreachable');
        }
      }),
    });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    const acorn = createAcornLifecycle(d);

    await expect(acorn.openAcornProject('dataset-1')).rejects.toThrow('zome unreachable');
    // Parked, not spinning: the retained op names its target and is resumable,
    // and the failure carries its classified display beside the raw cause.
    await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({
      phase: 'failed',
      datasetId: 'dataset-1',
      languageAddress: LANG,
      failure: {
        stage: 'setup',
        cause: 'zome unreachable',
        display: 'The executor stopped answering partway through.',
        retryable: true,
      },
    });

    await expect(acorn.resumeAcornOperation('dataset-1', LANG)).resolves.toBe('dataset-1');
    expect(record).toContain('navigate:dataset-1');
    await expect(acorn.pendingAcornOperation()).resolves.toBeNull();
  });

  /*
    Open's preflight — the dataset, its mounts, the language's `info` — fails the
    way its tail does: parked as a resumable failure naming the dataset, with a
    Retry that runs the open again. An `info` that rejects is not "not Acorn".
  */
  for (const [what, breakIt] of [
    ['lifecycle.get', (d: AcornLifecycleDeps) => d.lifecycle()!.get as ReturnType<typeof vi.fn>],
    ['mounts', (d: AcornLifecycleDeps) => d.port()!.mounts as ReturnType<typeof vi.fn>],
  ] as const) {
    it(`parks an Open whose ${what} read fails — resumable, and its Retry finishes the open`, async () => {
      const record: string[] = [];
      const d = deps(record);
      const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
      port.mountsOf['dataset-1'] = [LANG];
      breakIt(d).mockRejectedValueOnce(new Error('executor unreachable'));
      const acorn = createAcornLifecycle(d);

      await expect(acorn.openAcornProject('dataset-1')).rejects.toBeInstanceOf(AcornLifecycleError);
      await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({
        phase: 'failed',
        datasetId: 'dataset-1',
        failure: {
          stage: 'prepare',
          display: 'The executor stopped answering partway through.',
          retryable: true,
        },
      });
      // Close and reopen still offer it; Retry runs the open again.
      acorn.dismissAcornOperation();
      await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({ datasetId: 'dataset-1' });
      await expect(acorn.resumeAcornOperation('dataset-1')).resolves.toBe('dataset-1');
      expect(record).toContain('navigate:dataset-1');
      await expect(acorn.pendingAcornOperation()).resolves.toBeNull();
    });
  }

  /*
    A preflight failure on a dataset that already has a parked operation: the
    Retry under the preflight card runs the Open again — not the older op on
    its own — and its success clears the preflight entry, so a reopen offers
    nothing stale for the project just repaired.
  */
  it('a preflight Retry on a dataset with an older parked op runs the Open, and success clears both', async () => {
    const record: string[] = [];
    let overrideFails = true;
    const d = deps(record, {
      setSpaceTemplateOverride: vi.fn(async (id: string, uuid?: string) => {
        record.push(`override:${id}:${uuid}`);
        if (overrideFails) throw new Error('zome unreachable');
      }),
    });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    const acorn = createAcornLifecycle(d);

    // An older operation parks on its tail…
    await expect(acorn.openAcornProject('dataset-1')).rejects.toThrow('zome unreachable');
    await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({ failure: { stage: 'setup' } });
    // …then the same dataset's Open fails its preflight read.
    (port.mounts as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('executor unreachable'));
    await expect(acorn.openAcornProject('dataset-1')).rejects.toBeInstanceOf(AcornLifecycleError);
    await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({
      datasetId: 'dataset-1',
      failure: { stage: 'prepare' },
    });

    overrideFails = false;
    const getsBefore = (d.lifecycle()!.get as ReturnType<typeof vi.fn>).mock.calls.length;
    await expect(acorn.resumeAcornOperation('dataset-1')).resolves.toBe('dataset-1');
    // The Open ran again — its preflight read was asked — and nothing is left parked.
    expect((d.lifecycle()!.get as ReturnType<typeof vi.fn>).mock.calls.length).toBe(getsBefore + 1);
    acorn.dismissAcornOperation();
    await expect(acorn.pendingAcornOperation()).resolves.toBeNull();
  });

  /*
    A preflight entry left from before the operation it names succeeded some
    other way — the op's own Retry — goes with that success.
  */
  it('an operation that finishes on a dataset clears an older preflight failure for it', async () => {
    const record: string[] = [];
    let overrideFails = true;
    const d = deps(record, {
      setSpaceTemplateOverride: vi.fn(async (id: string, uuid?: string) => {
        record.push(`override:${id}:${uuid}`);
        if (overrideFails) throw new Error('zome unreachable');
      }),
    });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    const acorn = createAcornLifecycle(d);

    await expect(acorn.openAcornProject('dataset-1')).rejects.toThrow('zome unreachable');
    (port.mounts as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('executor unreachable'));
    await expect(acorn.openAcornProject('dataset-1')).rejects.toBeInstanceOf(AcornLifecycleError);

    overrideFails = false;
    // The op's own card names its language: the op resumes, and its success clears the preflight too.
    await expect(acorn.resumeAcornOperation('dataset-1', LANG)).resolves.toBe('dataset-1');
    await expect(acorn.pendingAcornOperation()).resolves.toBeNull();
  });

  it('parks an Open whose info read rejects — a rejection is not "not Acorn"', async () => {
    const record: string[] = [];
    const d = deps(record);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    const answer = port.interact as ReturnType<typeof vi.fn>;
    const normal = answer.getMockImplementation() as (url: string, call: { name: string }) => Promise<unknown>;
    answer.mockImplementation(async (url: string, call: { name: string; parameters?: object }) => {
      if (call.name === 'info') throw new Error('socket closed');
      return normal(url, call);
    });
    const acorn = createAcornLifecycle(d);

    await expect(acorn.openAcornProject('dataset-1')).rejects.toBeInstanceOf(AcornLifecycleError);
    await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({
      phase: 'failed',
      datasetId: 'dataset-1',
      failure: { stage: 'prepare', retryable: true },
    });

    answer.mockImplementation(normal);
    await expect(acorn.resumeAcornOperation('dataset-1')).resolves.toBe('dataset-1');
    await expect(acorn.pendingAcornOperation()).resolves.toBeNull();
  });

  /*
    A restart keeps only the durable intent. Setup debt recorded at phase=open —
    the mount answered, the tail did not finish — is offered and resumed by a
    new lifecycle instance the same way a pending mount is.
  */
  it('offers and resumes phase=open debt after a restart', async () => {
    const record: string[] = [];
    const d = deps(record);
    (d.lifecycle()!.list as ReturnType<typeof vi.fn>).mockResolvedValue([ref('dataset-1', 'P')]);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    d.setupIntent!.set('dataset-1', {
      name: 'P',
      writeMeta: false,
      announce: true,
      languageAddress: LANG,
      phase: 'open',
    });
    const afterRestart = createAcornLifecycle(d);

    await expect(afterRestart.pendingAcornOperation()).resolves.toMatchObject({
      phase: 'failed',
      datasetId: 'dataset-1',
      languageAddress: LANG,
      failure: { stage: 'setup', retryable: true },
    });
    await expect(afterRestart.resumeAcornOperation('dataset-1', LANG)).resolves.toBe('dataset-1');
    expect(record.filter((c) => c.startsWith('interact:announceJoin'))).toHaveLength(1);
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(0); // the mount was there already
    expect(d.setupIntent!.get('dataset-1')).toBeNull();
    await expect(afterRestart.pendingAcornOperation()).resolves.toBeNull();
  });

  it('keeps the durable record when local setup fails after the remote debt is paid — a restart still offers it', async () => {
    const record: string[] = [];
    let overrideFails = true;
    const d = deps(record, {
      setSpaceTemplateOverride: vi.fn(async (id: string, uuid?: string) => {
        record.push(`override:${id}:${uuid}`);
        if (overrideFails) throw new Error('zome unreachable');
      }),
    });
    (d.lifecycle()!.list as ReturnType<typeof vi.fn>).mockResolvedValue([ref('dataset-1', 'P')]);
    const acorn = createAcornLifecycle(d);

    // The join's announce lands; the local override after it does not.
    await expect(acorn.joinAcornProject(undefined, 'a b c', BASE)).rejects.toThrow('zome unreachable');
    expect(record.filter((c) => c.startsWith('interact:announceJoin'))).toHaveLength(1);
    expect(d.setupIntent!.get('dataset-1')).toMatchObject({
      announce: false,
      writeMeta: false,
      languageAddress: LANG,
      phase: 'open',
    });

    // Restart: the new instance offers the unfinished setup, and Retry finishes it without re-announcing.
    overrideFails = false;
    const afterRestart = createAcornLifecycle(d);
    await expect(afterRestart.pendingAcornOperation()).resolves.toMatchObject({
      datasetId: 'dataset-1',
      failure: { stage: 'setup', retryable: true },
    });
    await expect(afterRestart.resumeAcornOperation()).resolves.toBe('dataset-1');
    expect(record.filter((c) => c.startsWith('interact:announceJoin'))).toHaveLength(1);
    expect(d.setupIntent!.get('dataset-1')).toBeNull();
  });

  /*
    The same entry, repaired: a create that failed its mount leaves the op and
    the intent's owed meta; the list row's Open is the ask that finishes it —
    and a finished operation is removed, so a close/reopen does not offer a
    stale parked failure or re-owe the debt it paid.
  */
  it('a successful Open clears the parked operation it repaired — close/reopen offers nothing stale', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record);
    mountFailing(record, d, 99, INIT_TIMEOUT);
    const acorn = createAcornLifecycle(d);

    // The create fails and parks — the dataset retained, its meta still owed.
    expect((await settle(acorn.createAcornProject('P', 'a b c', BASE))).error).toBeInstanceOf(AcornLifecycleError);
    await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({ phase: 'failed' });

    // The mount landed server-side meanwhile; the list row's Open is the repair.
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    port.mountsOf['dataset-1'] = [LANG];
    (port.mount as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string, lang: string) => {
      record.push(`mount:${uuid}:${lang}`);
      port.mountsOf[uuid] = [lang];
      return true;
    });
    await expect(acorn.openAcornProject('dataset-1')).resolves.toBe('dataset-1');

    // The owed meta was paid exactly once, the intent is clear, and the op is
    // gone — close/reopen reports nothing pending.
    expect(record.filter((c) => c.includes('class/AcornProjectMeta'))).toHaveLength(1);
    expect(d.setupIntent!.get('dataset-1')).toBeNull();
    acorn.dismissAcornOperation();
    await expect(acorn.pendingAcornOperation()).resolves.toBeNull();
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
    A create asked with words a project already mounts must not land in that
    project — the ask meant a new one, and answering it with the old one drops
    the new name silently. The words being taken is a refusal in plain terms,
    not a join: nothing is touched, and no Retry is offered on a second mount
    that could only answer the same way. An intent that names the same language
    is still "ours" — the interrupted create it marks resumes through this
    scan instead of refusing.
  */
  it('create over words already mounting a project fails in words — it does not land in it', async () => {
    const record: string[] = [];
    const d = deps(record);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    (d.lifecycle()!.list as ReturnType<typeof vi.fn>).mockResolvedValue([ref('dataset-1', 'Old Project')]);
    port.mountsOf['dataset-1'] = [LANG];
    const acorn = createAcornLifecycle(d);

    await expect(acorn.createAcornProject('New Name', 'alpha beta gamma', BASE)).rejects.toThrow(
      /already exists for these words/,
    );
    // Nothing of the old project was touched — no structure, no meta, no landing.
    expect(record.find((c) => c.startsWith('ensure:'))).toBeUndefined();
    expect(record.find((c) => c.includes('AcornProjectMeta'))).toBeUndefined();
    expect(record.find((c) => c.startsWith('navigate:'))).toBeUndefined();
    expect(d.lifecycle()!.create).not.toHaveBeenCalled();
    // Parked but not retryable: the words are taken, not timed out.
    const pending = await acorn.pendingAcornOperation();
    expect(pending?.phase).toBe('failed');
    expect(pending?.failure?.retryable).toBe(false);
  });

  it('a create resumes its own interrupted project when the durable intent names the same language', async () => {
    const record: string[] = [];
    const d = deps(record);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    (d.lifecycle()!.list as ReturnType<typeof vi.fn>).mockResolvedValue([ref('dataset-1', 'Rig Project')]);
    port.mountsOf['dataset-1'] = [LANG];
    d.setupIntent!.set('dataset-1', {
      name: 'Rig Project',
      writeMeta: false,
      announce: false,
      languageAddress: LANG,
      phase: 'open',
    });
    const acorn = createAcornLifecycle(d);

    const id = await acorn.createAcornProject('Rig Project', 'alpha beta gamma', BASE);
    expect(id).toBe('dataset-1');
    expect(d.lifecycle()!.create).not.toHaveBeenCalled();
    expect(record).toContain('ensure:Rig Project:dataset-1');
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  /*
    The seed is the join secret: a templating error that echoes `templateData`
    back carries the passphrase inside it. The boundary redacts it — the state,
    the details line and the log never see the seed the ask was built from.
  */
  it('never lets a templating error carry the seed out — the passphrase stays out of every message', async () => {
    const record: string[] = [];
    const d = deps(record);
    const seed = acornSeed('a b c');
    (d.port()!.applyTemplateLocal as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new Error(`template install failed for templateData { seed: '${seed}' } on ${BASE}`);
    });
    const acorn = createAcornLifecycle(d);

    const error = await acorn.createAcornProject('P', 'a b c', BASE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('template install failed');
    expect((error as Error).message).not.toContain(seed);
    expect((error as Error).message).not.toContain('a-b-c');

    const joinError = await acorn.joinAcornProject(undefined, 'a b c', BASE).catch((e: unknown) => e);
    expect((joinError as Error).message).not.toContain(seed);
  });

  /*
    Every rejection a dialog call can see carries its classified sentence — the
    one a card leads with — so a failure that never parked a state still has a
    headline that is not the wire text.
  */
  it('rejects with a classified display — before an operation exists, and after it parks', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record);
    (d.port()!.applyTemplateLocal as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('socket closed'));
    const acorn = createAcornLifecycle(d);

    const early = await acorn.createAcornProject('P', 'a b c', BASE).catch((e: unknown) => e);
    expect(early).toBeInstanceOf(AcornLifecycleError);
    expect(early).toMatchObject({ stage: 'prepare', display: 'The executor stopped answering partway through.' });

    mountFailing(record, d, 99, INIT_TIMEOUT);
    const parked = (await settle(acorn.createAcornProject('P', 'a b c', BASE))).error;
    const state = await acorn.pendingAcornOperation();
    expect(parked).toMatchObject({ display: state!.failure!.display });
    expect((parked as AcornLifecycleError).display).not.toContain('InitTimeout');
  });

  /*
    Ownership is the newest ask's from the moment it is made — not from when its
    language answer happens to arrive. A Close during templating bumps the
    generation; the call that was still waiting for `applyTemplateLocal` must
    not then claim a fresh one and run the whole tail against a closed dialog.
  */
  it('a close while the language is still templating stands the ask down — nothing after it runs', async () => {
    const record: string[] = [];
    const d = deps(record);
    let releaseTemplate!: (v: { address: string }) => void;
    (d.port()!.applyTemplateLocal as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => (releaseTemplate = resolve)),
    );
    const acorn = createAcornLifecycle(d);

    const create = acorn.createAcornProject('P', 'a b c', BASE);
    acorn.dismissAcornOperation(); // the modal's Close, mid-template
    releaseTemplate({ address: LANG });

    await expect(create).resolves.toBeNull();
    expect(record.filter((c) => c.startsWith('create:'))).toHaveLength(0);
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(0);
    await expect(acorn.pendingAcornOperation()).resolves.toBeNull();
  });

  it('a slow prepare loses to a newer ask — its late language answer does not supersede', async () => {
    const record: string[] = [];
    const d = deps(record);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    let releaseA!: (v: { address: string }) => void;
    (port.applyTemplateLocal as ReturnType<typeof vi.fn>).mockImplementation(
      async (hash: string, data: Record<string, unknown>) => {
        record.push(`applyTemplateLocal:${data.seed}`);
        if (data.seed === 'uid-a-a-a') return new Promise((resolve) => (releaseA = resolve));
        return { address: 'QmzLangB' };
      },
    );
    const acorn = createAcornLifecycle(d);

    const runA = acorn.createAcornProject('A', 'a a a', BASE); // templating stalls
    await vi.waitFor(() => expect(record).toContain('applyTemplateLocal:uid-a-a-a'));
    const runB = acorn.createAcornProject('B', 'b b b', BASE); // resolves first — owns
    await vi.waitFor(() => expect(record).toContain('mount:dataset-1:QmzLangB'));
    releaseA({ address: LANG }); // A's language finally answers

    await expect(runA).resolves.toBeNull(); // stood down — it no longer owns anything
    await expect(runB).resolves.toBe('dataset-1');
    expect(record.filter((c) => c.startsWith('mount:'))).toEqual(['mount:dataset-1:QmzLangB']);
    expect(record.filter((c) => c.startsWith('navigate:'))).toEqual(['navigate:dataset-1']);
  });

  /*
    The same ownership is checked between setup's writes, not only at the
    landing: a Close while a setup call is out lets that call settle — its
    answer may pay a debt — but issues nothing after it.
  */
  it('a close during setup stops the tail — issued calls settle, nothing further is issued', async () => {
    const record: string[] = [];
    const d = deps(record);
    let releaseViews!: () => void;
    (d.setSpaceViews as ReturnType<typeof vi.fn>).mockImplementation(async (ids: string[], uuid?: string) => {
      record.push(`views:${ids.join(',')}:${uuid}`);
      await new Promise<void>((resolve) => (releaseViews = resolve));
    });
    const acorn = createAcornLifecycle(d);

    const create = acorn.createAcornProject('P', 'a b c', BASE);
    await vi.waitFor(() => expect(record.filter((c) => c.startsWith('views:'))).toHaveLength(1));
    acorn.dismissAcornOperation(); // Close, mid-setup
    releaseViews();

    await expect(create).resolves.toBeNull();
    // Issued before the close: ensure and the views write itself. Never issued
    // after: the template write, marker, meta, announce, override, navigation.
    expect(record).toContain('ensure:P:dataset-1');
    expect(record.filter((c) => c.startsWith('template:'))).toHaveLength(0);
    expect(record.filter((c) => c.includes('class/AcornProjectMeta'))).toHaveLength(0);
    expect(record.filter((c) => c.startsWith('interact:announceJoin'))).toHaveLength(0);
    expect(record.filter((c) => c.startsWith('override:'))).toHaveLength(0);
    expect(record.filter((c) => c.startsWith('navigate:'))).toHaveLength(0);
    // The retained target keeps its debt — the next open resumes the tail.
    expect(d.setupIntent!.get('dataset-1')).toMatchObject({ writeMeta: true });
    await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({
      phase: 'failed',
      failure: { retryable: true },
    });
  });

  it('a write in flight at the close still counts as paid — the tail after it does not run', async () => {
    const record: string[] = [];
    const d = deps(record);
    let releaseMeta!: () => void;
    (d.port()!.interact as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string, call: { name: string; parameters?: object }) => {
        record.push(`interact:${call.name}:${url}`);
        if (call.name === 'create') await new Promise<void>((resolve) => (releaseMeta = resolve));
        return call.name === 'whoami' ? { address: 'profile/abc' } : null;
      },
    );
    const acorn = createAcornLifecycle(d);

    const create = acorn.createAcornProject('P', 'a b c', BASE);
    await vi.waitFor(() => expect(record.filter((c) => c.includes('class/AcornProjectMeta'))).toHaveLength(1));
    acorn.dismissAcornOperation(); // Close while the meta write is out
    releaseMeta();

    await expect(create).resolves.toBeNull();
    // The landed meta is paid even though the run stood down — nothing after it ran.
    expect(record.filter((c) => c.startsWith('interact:announceJoin'))).toHaveLength(0);
    expect(record.filter((c) => c.startsWith('navigate:'))).toHaveLength(0);
    // Resume re-checks the mount and finishes the tail without re-writing meta.
    await expect(acorn.resumeAcornOperation()).resolves.toBe('dataset-1');
    expect(record.filter((c) => c.includes('class/AcornProjectMeta'))).toHaveLength(1);
  });

  /*
    Ownership holds inside the preparation and profile helpers too, not only
    between the outer steps: a Close while target discovery, `whoami` or a
    poll is out lets that call settle, and nothing after it is issued.
  */
  it('a close during target discovery stops the run — the absence answer allocates nothing', async () => {
    const record: string[] = [];
    const d = deps(record);
    (d.lifecycle()!.list as ReturnType<typeof vi.fn>).mockResolvedValue([ref('other-1'), ref('other-2')]);
    let releaseMounts!: (mounted: string[]) => void;
    (d.port()!.mounts as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string) => {
      record.push(`mounts:${uuid}`);
      return new Promise<string[]>((resolve) => (releaseMounts = resolve));
    });
    const acorn = createAcornLifecycle(d);

    const create = acorn.createAcornProject('P', 'a b c', BASE);
    await vi.waitFor(() => expect(record).toContain('mounts:other-1'));
    acorn.dismissAcornOperation(); // Close while discovery is out
    releaseMounts([]); // "not mounted here"

    await expect(create).resolves.toBeNull();
    expect(record).not.toContain('mounts:other-2'); // discovery stopped where it was
    expect(d.lifecycle()!.create).not.toHaveBeenCalled();
    expect(record.find((c) => c.startsWith('mount:'))).toBeUndefined();
    await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({
      phase: 'failed',
      failure: { retryable: true },
    });
  });

  it('a close while whoami is out stops the profile write — a null answer creates nothing', async () => {
    const record: string[] = [];
    const d = deps(record);
    let releaseWhoami!: (who: null) => void;
    (d.port()!.interact as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string, call: { name: string; parameters?: object }) => {
        record.push(`interact:${call.name}:${url}`);
        if (call.name === 'whoami') return new Promise((resolve) => (releaseWhoami = resolve));
        return null;
      },
    );
    const acorn = createAcornLifecycle(d);

    const create = acorn.createAcornProject('P', 'a b c', BASE);
    await vi.waitFor(() => expect(record).toContain(`interact:whoami:${LANG}://project`));
    acorn.dismissAcornOperation(); // Close while whoami is out
    releaseWhoami(null); // "no profile yet"

    await expect(create).resolves.toBeNull();
    expect(record).not.toContain(`interact:create:${LANG}://class/AcornProfile`);
    expect(record.filter((c) => c.startsWith('override:'))).toHaveLength(0);
  });

  it('a close stops the poll loops — shapes, info and whoami are not asked again', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record, { pollMs: 1_000 });
    // The shapes never land: the wait polls until its bound.
    (d.schemas()!.hasAnySchema as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      record.push('hasAnySchema');
      return false;
    });
    const acorn = createAcornLifecycle(d);

    const create = acorn.createAcornProject('P', 'a b c', BASE);
    await vi.advanceTimersByTimeAsync(2_500);
    const polled = record.filter((c) => c === 'hasAnySchema').length;
    expect(polled).toBeGreaterThan(0);
    acorn.dismissAcornOperation();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(create).resolves.toBeNull();
    // At most the read already out when the close landed — none scheduled after it.
    expect(record.filter((c) => c === 'hasAnySchema').length).toBeLessThanOrEqual(polled + 1);

    // The same for a cold cell's `info` (join by address) and `whoami`, which retry while they throw.
    for (const name of ['info', 'whoami']) {
      const calls: string[] = [];
      const dd = deps(calls, { pollMs: 1_000 });
      (dd.port()!.interact as ReturnType<typeof vi.fn>).mockImplementation(
        async (url: string, call: { name: string }) => {
          calls.push(`interact:${call.name}:${url}`);
          if (call.name === name) throw new Error('cell still coming up');
          if (call.name === 'info') return { dnaHash: 'QmdnaUnderTest' };
          return null;
        },
      );
      const a = createAcornLifecycle(dd);
      const join = a.joinAcornProject(LANG, 'a b c', BASE);
      await vi.advanceTimersByTimeAsync(2_500);
      const asked = calls.filter((c) => c.startsWith(`interact:${name}:`)).length;
      expect(asked, name).toBeGreaterThan(0);
      a.dismissAcornOperation();
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(join).resolves.toBeNull();
      expect(calls.filter((c) => c.startsWith(`interact:${name}:`)).length, name).toBe(asked);
    }
  });

  /*
    The budget bounds the wait itself, not just the loop: a mount call still in
    flight when the phase's clock runs out is abandoned — its late answer is the
    server's to keep and the next explicit Retry's mounts read to find — never a
    success the run proceeds on.
  */
  it('stops waiting at the budget — a mount answering late is abandoned, not proceeded on', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record, { mountBudgetMs: 5_000 });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    let releaseMount!: () => void;
    (port.mount as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string, lang: string) => {
      record.push(`mount:${uuid}:${lang}`);
      await new Promise<void>((resolve) => (releaseMount = resolve));
      port.mountsOf[uuid] = [lang];
      return true;
    });
    const acorn = createAcornLifecycle(d);

    const out = settle(acorn.createAcornProject('P', 'a b c', BASE));
    // The 5 s budget lapses while the mount is still in flight: parked, not proceeded.
    await vi.advanceTimersByTimeAsync(6_000);
    const done = await out;
    expect(done.error).toBeInstanceOf(AcornLifecycleError);
    expect((done.error as AcornLifecycleError).retryTarget).toEqual({ datasetId: 'dataset-1', languageAddress: LANG });
    // No setup ran on a mount that never answered — the run is invalidated at expiry.
    expect(record.find((c) => c.startsWith('ensure:'))).toBeUndefined();
    expect(record.find((c) => c.startsWith('navigate:'))).toBeUndefined();
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(1);

    // The server's mount lands late — the parked failure already moved on; the
    // explicit Retry's mounts read is what finds it, not the abandoned call.
    releaseMount();
    await vi.advanceTimersByTimeAsync(0);
    await expect(acorn.resumeAcornOperation()).resolves.toBe('dataset-1');
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(1);
    expect(record).toContain('navigate:dataset-1');
  });

  it('bounds the in-flight mounts read too — a held slot with an unanswering read parks at the budget', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record, { mountBudgetMs: 5_000, pollMs: 1_000 });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    (port.mount as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string, lang: string) => {
      record.push(`mount:${uuid}:${lang}`);
      throw new Error(`${lang} is already being mounted`);
    });
    // The mounts read never answers inside the budget — the busy-wait cannot outwait the clock either.
    let releaseMounts!: () => void;
    (port.mounts as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string) => {
      record.push(`mounts:${uuid}`);
      await new Promise<void>((resolve) => (releaseMounts = resolve));
      return [];
    });
    const acorn = createAcornLifecycle(d);

    const out = settle(acorn.createAcornProject('P', 'a b c', BASE));
    await vi.advanceTimersByTimeAsync(6_000);
    const done = await out;
    expect(done.error).toBeInstanceOf(AcornLifecycleError);
    expect((done.error as AcornLifecycleError).stage).toBe('mount');
    expect((done.error as AcornLifecycleError).retryTarget).toEqual({ datasetId: 'dataset-1', languageAddress: LANG });
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(1);
    releaseMounts();
    await vi.advanceTimersByTimeAsync(0);
  });

  /*
    The phase's one clock starts before discovery, not at the first mount call:
    a series of mounts reads that together outlive it is budget spent, and a
    mounted target those reads find after expiry is not proceeded on.
  */
  it('bounds target discovery by the phase budget — a mount found after expiry does not enter setup', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record, { mountBudgetMs: 5_000 });
    (d.lifecycle()!.list as ReturnType<typeof vi.fn>).mockResolvedValue([ref('acorn-1', 'Project one')]);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    let releaseMounts!: (mounted: string[]) => void;
    (port.mounts as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string) => {
      record.push(`mounts:${uuid}`);
      return new Promise<string[]>((resolve) => (releaseMounts = resolve));
    });
    const acorn = createAcornLifecycle(d);

    const out = acorn.createAcornProject('P', 'a b c', BASE).then(
      (value) => ({ value, error: undefined as unknown }),
      (error: unknown) => ({ value: undefined, error }),
    );
    await vi.waitFor(() => expect(record).toContain('mounts:acorn-1'));
    await vi.advanceTimersByTimeAsync(6_000); // the budget lapses inside discovery
    releaseMounts([LANG]); // …and the discovery read then finds the project mounted
    await vi.advanceTimersByTimeAsync(0);

    const done = await out;
    expect(done.error).toBeInstanceOf(AcornLifecycleError);
    expect((done.error as AcornLifecycleError).stage).toBe('mount');
    expect(record.find((c) => c.startsWith('ensure:'))).toBeUndefined();
    expect(record.find((c) => c.startsWith('navigate:'))).toBeUndefined();
    expect(d.lifecycle()!.create).not.toHaveBeenCalled();
    // A budget spent is not a refusal: the parked operation still offers Retry.
    await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({
      phase: 'failed',
      languageAddress: LANG,
      failure: { stage: 'mount', retryable: true },
    });
  });

  it('bounds allocation by the phase budget — a late perspective is kept as the target, not mounted on', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record, { mountBudgetMs: 5_000 });
    let releaseCreate!: () => void;
    (d.lifecycle()!.create as ReturnType<typeof vi.fn>).mockImplementation(async (name: string) => {
      record.push(`create:${name}`);
      await new Promise<void>((resolve) => (releaseCreate = resolve));
      return ref('dataset-1', name);
    });
    const acorn = createAcornLifecycle(d);

    const out = acorn.createAcornProject('P', 'a b c', BASE).then(
      (value) => ({ value, error: undefined as unknown }),
      (error: unknown) => ({ value: undefined, error }),
    );
    await vi.waitFor(() => expect(record).toContain('create:P'));
    await vi.advanceTimersByTimeAsync(6_000);
    const done = await out;
    expect(done.error).toBeInstanceOf(AcornLifecycleError);
    expect(record.find((c) => c.startsWith('mount:'))).toBeUndefined();

    // The perspective arrives late: it is the operation's target now, and the
    // Retry mounts that one rather than allocating a second beside it.
    releaseCreate();
    await vi.advanceTimersByTimeAsync(0);
    await expect(acorn.resumeAcornOperation()).resolves.toBe('dataset-1');
    expect(d.lifecycle()!.create).toHaveBeenCalledTimes(1);
    expect(record).toContain(`mount:dataset-1:${LANG}`);
  });

  /*
    The Retry pressed while the timed-out allocation is still out: the op holds
    that one allocation, and the Retry waits on it rather than allocating a
    second — whichever way the late create and the Retry's own discovery land.
  */
  for (const order of ['before', 'after'] as const) {
    it(`a Retry while the timed-out allocation is out makes no second perspective — it lands ${order} the Retry's turn`, async () => {
      vi.useFakeTimers();
      const record: string[] = [];
      const d = deps(record, { mountBudgetMs: 5_000 });
      const releases: Array<() => void> = [];
      (d.lifecycle()!.create as ReturnType<typeof vi.fn>).mockImplementation(async (name: string) => {
        const n = releases.length + 1;
        record.push(`create:${name}`);
        await new Promise<void>((resolve) => releases.push(resolve));
        return ref(`dataset-${n}`, name);
      });
      const acorn = createAcornLifecycle(d);

      const out = acorn.createAcornProject('P', 'a b c', BASE).then(
        (value) => ({ value, error: undefined as unknown }),
        (error: unknown) => ({ value: undefined, error }),
      );
      await vi.waitFor(() => expect(releases).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(6_000);
      expect((await out).error).toBeInstanceOf(AcornLifecycleError);

      // The Retry's discovery read is held, so the late create can land inside it…
      const list = d.lifecycle()!.list as ReturnType<typeof vi.fn>;
      let releaseList: () => void = () => {};
      list.mockImplementationOnce(() => new Promise<DatasetRef[]>((resolve) => (releaseList = () => resolve([]))));
      const retry = acorn.resumeAcornOperation();
      await vi.advanceTimersByTimeAsync(0);
      if (order === 'before') {
        releases[0]();
        await vi.advanceTimersByTimeAsync(0);
        releaseList();
      } else {
        // …or only after the Retry got past the point where it would allocate.
        releaseList();
        await vi.advanceTimersByTimeAsync(1_000);
        releases[0]();
      }
      for (const release of releases.slice(1)) release();
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(retry).resolves.toBe('dataset-1');
      expect(d.lifecycle()!.create).toHaveBeenCalledTimes(1);
      expect(record).toContain(`mount:dataset-1:${LANG}`);
      expect(record.find((c) => c.includes('dataset-2'))).toBeUndefined();
    });
  }

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

  /*
    Two projects can both be parked: the failure on display is one of them, and
    its Retry must resume that one — not whichever op happens to sit first in
    the map. The displayed state carries its own datasetId/languageAddress;
    Resume keys off it.
  */
  it('resumes the operation the displayed failure names, not the first parked one', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const LANG_B = 'QmzAcornLanguageB';
    const d = deps(record, {
      lifecycle: () =>
        ({
          list: vi.fn(async () => [] as DatasetRef[]),
          get: vi.fn(async (id: string) => ref(id)),
          create: vi.fn(async (name: string) => {
            record.push(`create:${name}`);
            return ref(`dataset-${name}`, name);
          }),
          remove: vi.fn(),
          subscribe: vi.fn(() => () => {}),
        }) as unknown as DatasetLifecyclePort,
    });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    (port.applyTemplateLocal as ReturnType<typeof vi.fn>).mockImplementation(
      async (_hash: string, data: Record<string, unknown>) => ({
        address: data.seed === 'uid-b-b-b' ? LANG_B : LANG,
      }),
    );
    (port.mount as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string, lang: string) => {
      record.push(`mount:${uuid}:${lang}`);
      throw INIT_TIMEOUT();
    });
    const acorn = createAcornLifecycle(d);

    // A and B both park — B's failure is the one on display.
    expect((await settle(acorn.createAcornProject('A', 'a a a', BASE))).error).toBeInstanceOf(AcornLifecycleError);
    expect((await settle(acorn.createAcornProject('B', 'b b b', BASE))).error).toBeInstanceOf(AcornLifecycleError);
    expect(record.filter((c) => c.startsWith('mount:dataset-A:'))).toHaveLength(5);
    expect(record.filter((c) => c.startsWith('mount:dataset-B:'))).toHaveLength(5);

    // The peer comes back; the displayed Retry resumes B's target, never A's.
    (port.mount as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string, lang: string) => {
      record.push(`mount:${uuid}:${lang}`);
      port.mountsOf[uuid] = [lang];
      return true;
    });
    await expect(acorn.resumeAcornOperation('dataset-B', LANG_B)).resolves.toBe('dataset-B');
    expect(record.filter((c) => c.startsWith('mount:dataset-A:'))).toHaveLength(5); // untouched
    expect(record).toContain('navigate:dataset-B');

    // A stays parked — the dialog can still offer it, keyed by its own identity.
    await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({ phase: 'failed', languageAddress: LANG });
  });

  /*
    Reopen with no identity — the dialog's reload and an argument-less Retry —
    offers the failure that happened last, not the entry inserted first.
  */
  it('reopens on the most recently failed operation, not the first inserted', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const LANG_B = 'QmzAcornLanguageB';
    const d = deps(record, {
      lifecycle: () =>
        ({
          list: vi.fn(async () => [] as DatasetRef[]),
          get: vi.fn(async (id: string) => ref(id)),
          create: vi.fn(async (name: string) => ref(`dataset-${name}`, name)),
          remove: vi.fn(),
          subscribe: vi.fn(() => () => {}),
        }) as unknown as DatasetLifecyclePort,
    });
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    (port.applyTemplateLocal as ReturnType<typeof vi.fn>).mockImplementation(
      async (_hash: string, data: Record<string, unknown>) => ({
        address: data.seed === 'uid-b-b-b' ? LANG_B : LANG,
      }),
    );
    (port.mount as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string, lang: string) => {
      record.push(`mount:${uuid}:${lang}`);
      throw INIT_TIMEOUT();
    });
    const acorn = createAcornLifecycle(d);

    // A fails first, then B: B is the newer failure.
    expect((await settle(acorn.createAcornProject('A', 'a a a', BASE))).error).toBeInstanceOf(AcornLifecycleError);
    expect((await settle(acorn.createAcornProject('B', 'b b b', BASE))).error).toBeInstanceOf(AcornLifecycleError);
    acorn.dismissAcornOperation();
    await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({ languageAddress: LANG_B });

    // A fails again: now A is the newer one, for the reload and the no-argument Retry alike.
    expect((await settle(acorn.resumeAcornOperation('dataset-A', LANG))).error).toBeInstanceOf(AcornLifecycleError);
    acorn.dismissAcornOperation();
    await expect(acorn.pendingAcornOperation()).resolves.toMatchObject({ languageAddress: LANG });
    const before = record.filter((c) => c.startsWith('mount:dataset-B:')).length;
    (port.mount as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string, lang: string) => {
      record.push(`mount:${uuid}:${lang}`);
      port.mountsOf[uuid] = [lang];
      return true;
    });
    await expect(acorn.resumeAcornOperation()).resolves.toBe('dataset-A');
    expect(record.filter((c) => c.startsWith('mount:dataset-B:'))).toHaveLength(before);
  });

  it('does not resume an operation whose displayed failure is not retryable', async () => {
    vi.useFakeTimers();
    const record: string[] = [];
    const d = deps(record);
    mountFailing(record, d, 1, () => new Error('the language is owned by another schema mirror'));
    const acorn = createAcornLifecycle(d);

    expect((await settle(acorn.createAcornProject('P', 'a b c', BASE))).error).toBeInstanceOf(AcornLifecycleError);
    // The card offers no Retry for a refusal the executor answered — and the
    // resume refuses it too, even asked by name.
    await expect(acorn.resumeAcornOperation('dataset-1', LANG)).resolves.toBeNull();
    expect(record.filter((c) => c.startsWith('mount:'))).toHaveLength(1);
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

  /*
    Paid debt stays paid: a write that landed is marked done in the ledger, so a
    Retry parked by a *later* step does not get the ask's original flags OR'd
    back over the record. The review's trace was join → announce done → override
    rejects → Retry → a second announce; meta is the same shape.
  */
  it('does not re-announce on Retry — the paid join debt stays paid', async () => {
    const record: string[] = [];
    let failedOnce = false;
    const d = deps(record, {
      setSpaceTemplateOverride: vi.fn(async (id: string, uuid?: string) => {
        record.push(`override:${id}:${uuid}`);
        if (!failedOnce) {
          failedOnce = true;
          throw new Error('zome unreachable');
        }
      }),
    });
    const acorn = createAcornLifecycle(d);

    // announce lands; the step after it is what fails.
    await expect(acorn.joinAcornProject(undefined, 'a b c', BASE)).rejects.toThrow('zome unreachable');
    expect(record.filter((c) => c.startsWith('interact:announceJoin'))).toHaveLength(1);

    await expect(acorn.resumeAcornOperation()).resolves.toBe('dataset-1');
    expect(record.filter((c) => c.startsWith('interact:announceJoin'))).toHaveLength(1);
    expect(d.setupIntent!.get('dataset-1')).toBeNull();
  });

  it('does not re-write meta on Retry — the paid create debt stays paid', async () => {
    const record: string[] = [];
    let failedOnce = false;
    const d = deps(record, {
      setSpaceTemplateOverride: vi.fn(async (id: string, uuid?: string) => {
        record.push(`override:${id}:${uuid}`);
        if (!failedOnce) {
          failedOnce = true;
          throw new Error('zome unreachable');
        }
      }),
    });
    const acorn = createAcornLifecycle(d);

    await expect(acorn.createAcornProject('P', 'a b c', BASE)).rejects.toThrow('zome unreachable');
    expect(record.filter((c) => c.includes('class/AcornProjectMeta'))).toHaveLength(1);

    await expect(acorn.resumeAcornOperation()).resolves.toBe('dataset-1');
    expect(record.filter((c) => c.includes('class/AcornProjectMeta'))).toHaveLength(1);
  });

  /*
    The same ledger without the persistence dep: with no `setupIntent` the live
    record is the only one there is, and it still must not resurrect paid debt.
  */
  it('keeps paid debt paid without a persistence dep — the ledger alone is the record', async () => {
    const record: string[] = [];
    let failedOnce = false;
    const d = deps(record, {
      setupIntent: undefined,
      setSpaceTemplateOverride: vi.fn(async (id: string, uuid?: string) => {
        record.push(`override:${id}:${uuid}`);
        if (!failedOnce) {
          failedOnce = true;
          throw new Error('zome unreachable');
        }
      }),
    });
    const acorn = createAcornLifecycle(d);

    await expect(acorn.joinAcornProject(undefined, 'a b c', BASE)).rejects.toThrow('zome unreachable');
    expect(record.filter((c) => c.startsWith('interact:announceJoin'))).toHaveLength(1);

    await expect(acorn.resumeAcornOperation()).resolves.toBe('dataset-1');
    expect(record.filter((c) => c.startsWith('interact:announceJoin'))).toHaveLength(1);
  });

  /*
    The paid-debt rule under a race, not a sequence: the previous run's
    announce is still out when the modal closes and the Retry reaches the
    mount reconciliation read. The announce landing inside that read's window
    pays the debt through the ledger — and the phase change after the read
    must move on the debt as it stands, not restore the snapshot the Retry
    banked before the acknowledgement arrived.
  */
  it('does not re-owe an announce acknowledged inside the mounts-read window', async () => {
    const record: string[] = [];
    const d = deps(record);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    let releaseAnnounce!: () => void;
    let announceHeld = true;
    (port.interact as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string, call: { name: string; parameters?: object }) => {
        record.push(`interact:${call.name}:${url}`);
        if (call.name === 'announceJoin' && announceHeld) {
          announceHeld = false;
          await new Promise<void>((resolve) => (releaseAnnounce = resolve));
        }
        return call.name === 'whoami' ? { address: 'profile/abc' } : null;
      },
    );
    // The exact-target read the reconciliation makes — held until the announce has landed.
    let releaseMounts!: (mounted: string[]) => void;
    (port.mounts as ReturnType<typeof vi.fn>).mockImplementation(async (uuid: string) => {
      record.push(`mounts:${uuid}`);
      return new Promise<string[]>((resolve) => (releaseMounts = resolve));
    });
    const acorn = createAcornLifecycle(d);

    // The join's announce is out when the modal closes.
    const join = acorn.joinAcornProject(undefined, 'a b c', BASE);
    await vi.waitFor(() => expect(record.filter((c) => c.startsWith('interact:announceJoin'))).toHaveLength(1));
    acorn.dismissAcornOperation(); // Close — the announce still out
    const retry = acorn.resumeAcornOperation(); // reopen → Retry, announce still out
    await vi.waitFor(() => expect(record.filter((c) => c.startsWith('mounts:dataset-1'))).toHaveLength(1));

    // The earlier announce lands inside the read's window — acknowledged, debt paid.
    releaseAnnounce();
    await expect(join).resolves.toBeNull(); // the close ended its ownership; nothing further runs

    // …then the read answers mounted, and the phase moves on what is still owed now.
    let releaseSetup!: (setup: AcornSpaceSetup) => void;
    (d.spaceSetup as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<AcornSpaceSetup>((resolve) => (releaseSetup = resolve)),
    );
    releaseMounts([LANG]);
    await vi.waitFor(() => expect(d.spaceSetup).toHaveBeenCalledTimes(3));
    const intentAfterPhaseMove = d.setupIntent!.get('dataset-1');
    releaseSetup({ ...EMPTY_SETUP });

    await expect(retry).resolves.toBe('dataset-1');
    // Exactly one announce — in memory, and in the persisted intent alike.
    expect(record.filter((c) => c.startsWith('interact:announceJoin'))).toHaveLength(1);
    // The persisted record does not re-owe it either. It stays, debt-free, at
    // phase=open until the tail finishes — the restart record K5 needs.
    expect(intentAfterPhaseMove).toMatchObject({ announce: false, writeMeta: false, phase: 'open' });
    expect(d.setupIntent!.get('dataset-1')).toBeNull();
  });

  /*
    A setup queued behind one that already paid must read the debt as it stands
    when it runs, not as its own ask was filed: two creates landing on one
    target both see the intent's announce owed, the first pays it, and the
    second's queued setup skips it rather than replaying a stale snapshot.
  */
  it('reads the debt as it stands inside the setup queue — a paid debt is not replayed', async () => {
    const record: string[] = [];
    const d = deps(record);
    const port = d.port() as AcornLifecyclePort & { mountsOf: Record<string, string[]> };
    const LANG_B = 'QmzAcornLanguageB';
    (port.applyTemplateLocal as ReturnType<typeof vi.fn>).mockImplementation(
      async (hash: string, data: Record<string, unknown>) => {
        record.push(`applyTemplateLocal:${hash}`);
        return { address: data.seed === 'uid-b-b-b' ? LANG_B : LANG };
      },
    );
    // The join's announce is owed on the target before either run starts.
    d.setupIntent!.set('dataset-1', { name: 'P', writeMeta: false, announce: true });
    let releaseSetup!: (setup: AcornSpaceSetup) => void;
    (d.spaceSetup as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<AcornSpaceSetup>((resolve) => (releaseSetup = resolve)),
    );
    const acorn = createAcornLifecycle(d);

    const runA = acorn.createAcornProject('A', 'a a a', BASE);
    await vi.waitFor(() => expect(d.spaceSetup).toHaveBeenCalledTimes(1)); // A sits inside setup
    const runB = acorn.createAcornProject('B', 'b b b', BASE); // second target-read still sees the debt
    await vi.waitFor(() => expect(record).toContain(`mount:dataset-1:${LANG_B}`));

    releaseSetup({ ...EMPTY_SETUP });
    // B's later ask owns the landing — A stands down where it was, its queued
    // setup issuing nothing once it no longer owns the run. The debt is the
    // assertion either way:
    await expect(runA).resolves.toBeNull();
    await expect(runB).resolves.toBe('dataset-1');

    // One meta, one announce — paid once whichever setup paid it, never replayed by the other.
    expect(record.filter((c) => c.includes('class/AcornProjectMeta'))).toHaveLength(1);
    expect(record.filter((c) => c.startsWith('interact:announceJoin'))).toHaveLength(1);
    // And one structure write — B's run is the only one still entitled to issue it.
    expect(record.filter((c) => c.startsWith('ensure:'))).toHaveLength(1);
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
