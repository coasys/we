/**
 * Round-trip reduction in storedShapes and hasSubjectClassLink.
 *
 * The original `storedShapes` ran five sequential SPARQL queries per call.
 * The original `ensureEntitiesRegistered` called `hasSubjectClassLink` once
 * per model.  Both multiplied wall-clock time by the number of round trips.
 *
 * The optimised versions:
 *   - run the five SPARQL queries concurrently (`Promise.all`),
 *   - replace N `hasSubjectClassLink` calls with one `bulkHasSubjectClassLink`,
 *   - cache the `storedShapes` result so consecutive callers within one
 *     `switchDataset` do not repeat the queries — and drop that cache whenever
 *     a shape is written, so a read never predates a write.
 *
 * These tests verify the behavioural contracts that survive the change, not
 * the internal concurrency (which a unit test cannot observe reliably).
 */
import {
  bulkHasSubjectClassLink,
  clearStoredShapesCache,
  ensureEntityRegistered,
  forgetStoredShapes,
  registerEntity,
  resetInterpretationHints,
  unregisterEntity,
  writeInterpretationHints,
} from '@we/backend-ad4m';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskBlock } from '../src/entities';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockLink(source: string) {
  return {
    data: { source, predicate: 'rdf://type', target: 'ad4m://SubjectClass' },
    author: 'did:key:test',
    timestamp: new Date().toISOString(),
    proof: { valid: true },
  };
}

function mockPerspective(registeredClasses: string[]) {
  return {
    get: vi.fn().mockResolvedValue(registeredClasses.map(mockLink)),
    querySparql: vi.fn().mockResolvedValue([]),
    uuid: `test-${Math.random().toString(36).slice(2)}`,
  } as never;
}

type MockProxy = {
  get: ReturnType<typeof vi.fn>;
  querySparql: ReturnType<typeof vi.fn>;
  ensureSubjectClasses: ReturnType<typeof vi.fn>;
  clearEnsuredSubjectClasses: ReturnType<typeof vi.fn>;
  uuid: string;
};

/**
 * A perspective `ensureEntityRegistered` can both read and write through. `Ad4mModel.registerAll`
 * is `perspective.ensureSubjectClasses(models)`, so that is the whole write surface to mock.
 */
function writablePerspective(registeredClasses: string[]): MockProxy {
  return {
    get: vi.fn().mockResolvedValue(registeredClasses.map(mockLink)),
    querySparql: vi.fn().mockResolvedValue([]),
    ensureSubjectClasses: vi.fn().mockResolvedValue(undefined),
    clearEnsuredSubjectClasses: vi.fn(),
    uuid: `test-${Math.random().toString(36).slice(2)}`,
  };
}

const TARGET = 'we://TaskBlock';
/** storedShapes issues exactly this many SPARQL queries per uncached read. */
const QUERIES_PER_READ = 5;

// ─── bulkHasSubjectClassLink ──────────────────────────────────────────────────

describe('bulkHasSubjectClassLink', () => {
  it('returns true for registered classes and false for missing ones', async () => {
    const p = mockPerspective(['we://Space', 'we://Note', 'we://Template']);

    const result = await bulkHasSubjectClassLink(p, [
      'we://Space',
      'we://Note',
      'we://TaskBlock',
      undefined,
      'we://Template',
    ]);

    expect(result).toEqual([true, true, false, false, true]);
  });

  it('uses a single queryLinks call for two or more classes', async () => {
    const p = mockPerspective(['we://Space']);
    const proxy = p as unknown as { get: ReturnType<typeof vi.fn> };

    await bulkHasSubjectClassLink(p, ['we://Space', 'we://Note', 'we://Template']);

    // One call with no source filter, not three calls with individual sources.
    expect(proxy.get).toHaveBeenCalledTimes(1);
    const query = proxy.get.mock.calls[0][0];
    expect(query.source).toBeUndefined();
    expect(query.predicate).toBe('rdf://type');
    expect(query.target).toBe('ad4m://SubjectClass');
  });

  it('falls back to a source-filtered query for one class', async () => {
    const p = mockPerspective(['we://Space']);
    const proxy = p as unknown as { get: ReturnType<typeof vi.fn> };

    await bulkHasSubjectClassLink(p, ['we://Space']);

    // Still one round trip, but filtered — the executor returns one link, not every class.
    expect(proxy.get).toHaveBeenCalledTimes(1);
    expect(proxy.get.mock.calls[0][0].source).toBe('we://Space');
  });

  it('returns an empty array for an empty input', async () => {
    const p = mockPerspective(['we://Space']);
    const proxy = p as unknown as { get: ReturnType<typeof vi.fn> };

    const result = await bulkHasSubjectClassLink(p, []);

    expect(result).toEqual([]);
    expect(proxy.get).not.toHaveBeenCalled();
  });

  it('handles duplicate target classes', async () => {
    const p = mockPerspective(['we://Space']);

    const result = await bulkHasSubjectClassLink(p, ['we://Space', 'we://Space']);

    expect(result).toEqual([true, true]);
  });

  it('handles perspectives with no registered classes', async () => {
    const p = mockPerspective([]);

    const result = await bulkHasSubjectClassLink(p, ['we://Space', 'we://Note']);

    expect(result).toEqual([false, false]);
  });
});

// ─── storedShapes cache ───────────────────────────────────────────────────────

/**
 * Driven through `ensureEntityRegistered`, the narrowest public entry point that reads the stored
 * shapes. With the class present and no stored paths it reads and writes nothing, so a second call
 * measures the cache alone; with the class absent it writes, which is what must drop the cache.
 */
describe('storedShapes cache', () => {
  beforeEach(() => clearStoredShapesCache());
  afterEach(() => clearStoredShapesCache());

  it('reads the shapes once for consecutive callers on the same perspective', async () => {
    const p = writablePerspective([TARGET]);

    await ensureEntityRegistered(p as never, TaskBlock);
    await ensureEntityRegistered(p as never, TaskBlock);

    expect(p.querySparql).toHaveBeenCalledTimes(QUERIES_PER_READ);
    expect(p.ensureSubjectClasses).not.toHaveBeenCalled();
  });

  it('keeps perspectives apart', async () => {
    const a = writablePerspective([TARGET]);
    const b = writablePerspective([TARGET]);

    await ensureEntityRegistered(a as never, TaskBlock);
    await ensureEntityRegistered(b as never, TaskBlock);

    expect(a.querySparql).toHaveBeenCalledTimes(QUERIES_PER_READ);
    expect(b.querySparql).toHaveBeenCalledTimes(QUERIES_PER_READ);
  });

  it('is dropped by a write, so the next read sees what was written', async () => {
    // Absent at first: the call reads (populating the cache), then registers the class.
    const p = writablePerspective([]);
    await ensureEntityRegistered(p as never, TaskBlock);
    expect(p.ensureSubjectClasses).toHaveBeenCalledTimes(1);
    expect(p.querySparql).toHaveBeenCalledTimes(QUERIES_PER_READ);

    // Now present. Had the write not dropped the cache, this would be served the pre-write map —
    // which has no entry for the class, and which `shapeIsStale` reads as fresh — and a re-adoption
    // of a modified shape inside the TTL would silently never be written.
    p.get.mockResolvedValue([mockLink(TARGET)]);
    await ensureEntityRegistered(p as never, TaskBlock);

    expect(p.querySparql).toHaveBeenCalledTimes(QUERIES_PER_READ * 2);
  }, 5_000);

  it('does not cache a failed read', async () => {
    const p = writablePerspective([TARGET]);
    p.querySparql.mockRejectedValueOnce(new Error('executor unreachable'));

    await ensureEntityRegistered(p as never, TaskBlock);
    // The callers fall back to an empty map for that call — which must not be remembered.
    await ensureEntityRegistered(p as never, TaskBlock);

    expect(p.querySparql).toHaveBeenCalledTimes(QUERIES_PER_READ * 2);
    expect(p.ensureSubjectClasses).not.toHaveBeenCalled();
  });

  it('is dropped by forgetStoredShapes for that perspective only', async () => {
    const a = writablePerspective([TARGET]);
    const b = writablePerspective([TARGET]);
    await ensureEntityRegistered(a as never, TaskBlock);
    await ensureEntityRegistered(b as never, TaskBlock);

    forgetStoredShapes(a);
    await ensureEntityRegistered(a as never, TaskBlock);
    await ensureEntityRegistered(b as never, TaskBlock);

    expect(a.querySparql).toHaveBeenCalledTimes(QUERIES_PER_READ * 2);
    expect(b.querySparql).toHaveBeenCalledTimes(QUERIES_PER_READ);
  });

  it('is dropped by the interpretation-hint writers', async () => {
    // The hint writers resolve the entity by name, then locate its shape through `get` — which
    // here answers every link query with the same marker link. A non-empty target is all
    // `locateShape` needs to proceed to the write, which is the part under test.
    registerEntity('TaskBlock', TaskBlock as never);
    const p = {
      ...writablePerspective([TARGET]),
      add: vi.fn().mockResolvedValue(undefined),
      removeLinks: vi.fn().mockResolvedValue(undefined),
    };

    try {
      await ensureEntityRegistered(p as never, TaskBlock);
      expect(p.querySparql).toHaveBeenCalledTimes(QUERIES_PER_READ);

      await writeInterpretationHints(p as never, 'TaskBlock', { classHint: 'tuned' });
      await ensureEntityRegistered(p as never, TaskBlock);
      expect(p.querySparql).toHaveBeenCalledTimes(QUERIES_PER_READ * 2);

      await resetInterpretationHints(p as never, 'TaskBlock');
      await ensureEntityRegistered(p as never, TaskBlock);
      expect(p.querySparql).toHaveBeenCalledTimes(QUERIES_PER_READ * 3);
    } finally {
      unregisterEntity('TaskBlock');
    }
  });
});
