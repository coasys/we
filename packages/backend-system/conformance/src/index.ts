/**
 * The backend contract as behaviour: one suite, run against every implementation.
 *
 * `backendPorts.ts` says the boot suite "doubles as the conformance test", and for a while the only
 * backend it ever ran against was the in-memory one. That proves the reference is consistent with
 * itself and nothing more: the production adapter shipped the same binding surface with nothing
 * comparing the two, so a disagreement between them surfaced as a bug somebody found by clicking.
 *
 * So the cases live here, written against the contract alone, and each backend supplies a
 * {@link ConformanceHarness} — how to stand up a fresh dataset, and how long its writes take to come
 * back. The in-memory backend runs the suite in its ordinary tests. A backend that needs a running
 * process runs it from a separate config, against a real one.
 *
 * A case a backend is known to fail is listed in its harness's `knownGaps` with the reason, and runs
 * inverted: it passes while the gap is open and fails the day the gap closes, which is the reminder
 * to delete the entry. A gap is never a skip — a skipped case says nothing when the behaviour moves.
 */
import { type BackendPorts, type DatasetHandle, RECORD_TYPE_KEY, type RendererDataBindings } from '@we/backend-shared';
import { getEntity } from '@we/entities';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** One fresh backend, ready for a case to write into. */
export interface ConformanceSubject {
  ports: BackendPorts;
  /** A dataset with the host's space schema installed and no records in it. */
  dataset: DatasetHandle;
  /** The id the ports' context answers `selfId()` with. */
  agent: string;
}

export interface ConformanceHarness {
  /** A fresh subject for each case, so no case can see another's records. */
  setup(): Promise<ConformanceSubject>;
  teardown?(subject: ConformanceSubject): Promise<void>;
  /**
   * How long this backend takes, in milliseconds. `settle` is how long a case waits for a write to
   * come back through a live query before calling it lost; `quiet` is how long it watches for a push
   * that should not happen. Both are near zero for a backend that notifies synchronously, and real
   * time for one that notifies over a socket.
   */
  timing?: { settle?: number; quiet?: number };
  /** Cases this backend is known to fail, each with what is wrong. See the module comment. */
  knownGaps?: Partial<Record<ConformanceCase, string>>;
}

export const CONFORMANCE_CASES = [
  'bindings.surface',
  'bindings.identities',
  'records.round-trip',
  'relations.ordered-read',
  'relations.replace-whole',
  'relations.member-type',
  'live.pushes-writes',
  'live.dispose-stops',
  'live.included-child-edit',
  'live.identical-queries-independent',
  'ephemeral.no-echo',
] as const;

export type ConformanceCase = (typeof CONFORMANCE_CASES)[number];

interface Row {
  id: string;
  [field: string]: unknown;
}

interface Instance extends Row {
  addChildren(child: unknown): Promise<void>;
  delete(): Promise<void>;
}

interface LiveQuery {
  subscribe(callback: (rows: Row[]) => void): Promise<Row[]>;
  dispose(): void;
}

/** The write half: a registered entity class, as the shell's record actions resolve one. */
interface Model {
  create(dataset: DatasetHandle, data?: Record<string, unknown>): Promise<Instance>;
  update(dataset: DatasetHandle, id: string, data: Record<string, unknown>): Promise<unknown>;
  setRelation(dataset: DatasetHandle, id: string, relation: string, ids: readonly string[]): Promise<void>;
}

/** The read half: what `$getEntity` hands a template. */
interface Reader {
  findAll(dataset: DatasetHandle, query?: Record<string, unknown>): Promise<Row[]>;
  query(dataset: DatasetHandle, query?: Record<string, unknown>): LiveQuery;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry an assertion until it holds or `timeout` runs out, then throw its last failure. */
async function eventually(assertion: () => void, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await sleep(25);
    }
  }
}

export function describeBackendConformance(name: string, harness: ConformanceHarness): void {
  const settle = harness.timing?.settle ?? 1_000;
  const quiet = harness.timing?.quiet ?? 50;
  // A case waits up to `settle` for each of its pushes, and the slowest makes three in a row.
  const timeout = Math.max(5_000, settle * 4 + quiet);

  describe(`backend conformance: ${name}`, () => {
    let subject: ConformanceSubject;
    let bindings: RendererDataBindings;
    const fetched: string[] = [];
    const live: LiveQuery[] = [];

    beforeEach(async () => {
      subject = await harness.setup();
      fetched.length = 0;
      bindings = subject.ports.dataBindings({
        currentDataset: () => subject.dataset,
        currentDatasetEntities: () => [],
        profiles: () => [{ did: subject.agent, handle: 'me' } as { did?: string }],
        fetchProfile: (id) => void fetched.push(id),
        ephemeral: subject.ports.ephemeral,
      });
    }, timeout);

    afterEach(async () => {
      // A subscription a failed case left open would go on answering into the next one.
      for (const query of live.splice(0)) query.dispose();
      await harness.teardown?.(subject);
    }, timeout);

    // Each half the way the app takes it. A template reads through `$getEntity`, which a backend may
    // narrow to a read-only handle; the shell's record actions write through the registered class.
    const reader = (entityName: string) => bindings.$getEntity!(entityName) as unknown as Reader;
    const model = (entityName: string) => getEntity(entityName) as unknown as Model;

    const watch = async (entityName: string, query: Record<string, unknown>) => {
      const pushes: Row[][] = [];
      const handle = reader(entityName).query(subject.dataset, query);
      live.push(handle);
      await handle.subscribe((rows) => void pushes.push(rows));
      const dispose = () => {
        const at = live.indexOf(handle);
        if (at >= 0) live.splice(at, 1);
        handle.dispose();
      };
      return { pushes, dispose };
    };

    const test = (id: ConformanceCase, title: string, body: () => Promise<void>) => {
      const gap = harness.knownGaps?.[id];
      if (gap) it.fails(`${title} [known gap: ${gap}]`, body, timeout);
      else it(title, body, timeout);
    };

    describe('the binding surface', () => {
      test('bindings.surface', 'exposes every data-plane binding a template can depend on', async () => {
        // The renderer's data contract: a key missing here means "runs on this backend" quietly
        // means "boots on this backend". Not `model`: nothing reads it — record actions resolve the
        // registered class themselves — so a backend is free to leave it out.
        for (const key of [
          '$currentDataset',
          '$getEntity',
          '$getEntityForDataset',
          '$queryAdapter',
          '$identities',
          '$ephemeral',
        ] as const) {
          expect(bindings[key], `missing binding: ${key}`).toBeDefined();
        }
      });

      test('bindings.identities', '$identities reads the host profile cache and forwards fetches', async () => {
        expect(bindings.$identities!.get(subject.agent)).toMatchObject({ handle: 'me' });
        expect(bindings.$identities!.get('did:test:unknown')).toBeUndefined();
        bindings.$identities!.fetch('did:test:other');
        expect(fetched).toEqual(['did:test:other']);
      });
    });

    describe('records', () => {
      test('records.round-trip', 'create → query → update → delete round-trips', async () => {
        const created = await model('Space').create(subject.dataset, { name: 'Test space', description: 'd' });
        expect(created.id).toBeTruthy();

        const Space = reader('Space');
        expect(await Space.findAll(subject.dataset, { where: { name: 'Test space' } })).toHaveLength(1);

        await model('Space').update(subject.dataset, created.id, { name: 'Renamed' });
        expect(await Space.findAll(subject.dataset, { where: { name: 'Renamed' } })).toHaveLength(1);
        expect(await Space.findAll(subject.dataset, { where: { name: 'Test space' } })).toHaveLength(0);

        await created.delete();
        expect(await Space.findAll(subject.dataset, {})).toHaveLength(0);
      });
    });

    describe('relations', () => {
      // `ordered` and `polymorphic` are declared once, in the manifest, and implemented once per
      // backend. Every way two implementations can disagree about them is quiet: a collection that
      // reads back in another order, or members that arrive without saying what they are, look like
      // data problems rather than backend ones.

      test('relations.ordered-read', 'reads an ordered collection in the order it was arranged', async () => {
        const Collection = model('CollectionBlock');
        const post = await Collection.create(subject.dataset, { kind: 'post' });
        const paragraph = await Collection.create(subject.dataset, { kind: 'text' });
        const image = await Collection.create(subject.dataset, { kind: 'image' });
        // Created paragraph-then-image, composed image-then-paragraph. Creation order is an accident
        // of typing; the arrangement is the data.
        await post.addChildren(image);
        await post.addChildren(paragraph);

        const [row] = await reader('CollectionBlock').findAll(subject.dataset, {
          where: { id: post.id },
          include: { children: true },
        });
        expect((row.children as Row[]).map((c) => c.id)).toEqual([image.id, paragraph.id]);
      });

      test(
        'relations.replace-whole',
        'replaces an ordered relation whole, keeping the order it was handed',
        async () => {
          // The write a drag makes. Fixtures only ever append, so a backend with `add` and no `set`
          // looks complete until a board is rearranged.
          const Collection = model('CollectionBlock');
          const column = await Collection.create(subject.dataset, { kind: 'column' });
          const [a, b, c] = [
            await Collection.create(subject.dataset, { kind: 'text' }),
            await Collection.create(subject.dataset, { kind: 'text' }),
            await Collection.create(subject.dataset, { kind: 'text' }),
          ];

          await Collection.setRelation(subject.dataset, column.id, 'children', [a.id, b.id, c.id]);
          // Rearranged, and one card taken out: the list is the membership as well as the order.
          await Collection.setRelation(subject.dataset, column.id, 'children', [c.id, a.id]);

          const [row] = await reader('CollectionBlock').findAll(subject.dataset, {
            where: { id: column.id },
            include: { children: true },
          });
          expect((row.children as Row[]).map((r) => r.id)).toEqual([c.id, a.id]);
        },
      );

      test('relations.member-type', 'says what each member of a heterogeneous relation is', async () => {
        // Without this a consumer holding a mixed bag can do nothing with it — a graph cannot address
        // a node, a card cannot pick a display. The key is a wire format, so every backend writes
        // the same one.
        const board = await model('CollectionBlock').create(subject.dataset, { kind: 'board' });
        await board.addChildren(await model('TaskBlock').create(subject.dataset, { title: 'Ship it' }));

        const [row] = await reader('CollectionBlock').findAll(subject.dataset, {
          where: { id: board.id },
          include: { children: true },
        });
        expect((row.children as Row[])[0][RECORD_TYPE_KEY]).toBe('TaskBlock');
      });
    });

    describe('live queries', () => {
      const names = (rows: Row[] | undefined) => (rows ?? []).map((r) => r.name).sort();

      test('live.pushes-writes', 'pushes the new result when a write changes it', async () => {
        const { pushes } = await watch('Space', {});
        await model('Space').create(subject.dataset, { name: 'First', description: 'd' });
        await eventually(() => expect(names(pushes.at(-1))).toEqual(['First']), settle);
      });

      test('live.dispose-stops', 'pushes nothing once disposed', async () => {
        const { pushes, dispose } = await watch('Space', {});
        await model('Space').create(subject.dataset, { name: 'Before', description: 'd' });
        await eventually(() => expect(names(pushes.at(-1))).toEqual(['Before']), settle);

        dispose();
        const count = pushes.length;
        await model('Space').create(subject.dataset, { name: 'After', description: 'd' });
        await sleep(quiet);
        expect(pushes).toHaveLength(count);
      });

      test('live.included-child-edit', 'pushes when a record it includes is edited', async () => {
        // A collection read with its children, and one child's text corrected — a transcript line,
        // a card on a board. The write changes no property of the subscribed entity, only of a record
        // it includes, so a backend that decides when to re-run from the subscribed entity's own
        // fields alone misses it, and every reader goes on showing the old words.
        const Collection = model('CollectionBlock');
        const post = await Collection.create(subject.dataset, { kind: 'post' });
        const line = await model('TextBlock').create(subject.dataset, { text: 'before' });
        await post.addChildren(line);

        const { pushes } = await watch('CollectionBlock', { where: { id: post.id }, include: { children: true } });
        const text = () => ((pushes.at(-1)?.[0]?.children as Row[] | undefined) ?? [])[0]?.text;
        await eventually(() => expect(text()).toBe('before'), settle);

        await model('TextBlock').update(subject.dataset, line.id, { text: 'after' });
        await eventually(() => expect(text()).toBe('after'), settle);
      });

      test(
        'live.identical-queries-independent',
        'keeps one subscription alive when an identical one is disposed',
        async () => {
          // Two surfaces showing the same data ask the same question. Closing one of them must not
          // silence the other — the symptom is a surface that stays stale until it remounts while
          // its neighbour updates, which reads as a rendering bug.
          const first = await watch('Space', {});
          const second = await watch('Space', {});
          first.dispose();

          await model('Space').create(subject.dataset, { name: 'Seen', description: 'd' });
          await eventually(() => expect(names(second.pushes.at(-1))).toEqual(['Seen']), settle);
        },
      );
    });

    describe('ephemeral', () => {
      test('ephemeral.no-echo', 'never delivers an agent its own ephemeral message', async () => {
        // Null is the contract's way of saying the capability is absent here, which is a legal
        // answer — a dataset nobody else can see has nobody to signal.
        const scope = subject.ports.ephemeral(subject.dataset);
        if (!scope) return;
        try {
          const received: unknown[] = [];
          scope.channel('cursors').onMessage((message) => void received.push(message));
          scope.channel('cursors').publish({ x: 1 });
          await sleep(quiet);
          expect(received).toHaveLength(0);
        } finally {
          scope.dispose();
        }
      });
    });
  });
}
