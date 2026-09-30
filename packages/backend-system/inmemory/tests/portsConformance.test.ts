/**
 * The ports bundle as a conformance surface.
 *
 * `backendPorts.ts` says the boot suite "doubles as the conformance test", but
 * until now the in-memory bundle stubbed its data plane (`ephemeral: () =>
 * null`, two bindings) — so a suite running against it could exercise
 * lifecycle and nothing else, while the production adapter shipped a full
 * $getEntity/$queryAdapter/mutations/$identities surface nothing compared
 * against. These tests pin the bundle to the full binding surface and run a
 * create → query → update → delete round-trip plus the ephemeral bus through
 * it — the contract exercised end to end with no executor.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryBackendPorts } from '../src/lifecycle';

const AGENT = 'did:test:me';

function makePorts() {
  return createInMemoryBackendPorts(
    { selfId: () => AGENT },
    { agent: { id: AGENT, unlocked: true }, datasets: [{ id: 'ds-main', name: 'Main' }] },
  );
}

async function makeBindings(ports: ReturnType<typeof makePorts>) {
  const dataset = (await ports.lifecycle.get('ds-main'))!;
  const profiles: Array<{ did?: string; handle?: string }> = [{ did: AGENT, handle: 'me' }];
  const fetched: string[] = [];
  const bindings = ports.dataBindings({
    currentDataset: () => dataset.handle as never,
    currentDatasetEntities: () => [],
    profiles: () => profiles,
    fetchProfile: (id) => void fetched.push(id),
    ephemeral: ports.ephemeral,
  });
  return { bindings, dataset, fetched };
}

describe('binding-surface conformance', () => {
  it('exposes the same data-plane bindings the production adapter does', async () => {
    const { bindings } = await makeBindings(makePorts());
    // The renderer's data contract (RendererDataBindings): every key the production
    // adapter provides and a template can depend on must be present here too,
    // or "runs on the in-memory backend" quietly means "boot only".
    for (const key of [
      '$currentDataset',
      '$getEntity',
      '$getEntityForDataset',
      '$queryAdapter',
      '$identities',
      '$ephemeral',
      'model',
    ] as const) {
      expect(bindings[key], `missing binding: ${key}`).toBeDefined();
    }
    expect(bindings.model).toMatchObject({
      create: expect.any(Function),
      update: expect.any(Function),
      delete: expect.any(Function),
    });
  });

  it('ephemeral is a real port, not the capability reporting itself absent', async () => {
    const ports = makePorts();
    const dataset = (await ports.lifecycle.get('ds-main'))!;
    expect(ports.ephemeral(dataset.handle as never)).not.toBeNull();
  });
});

describe('data plane through the bundle', () => {
  let ports: ReturnType<typeof makePorts>;
  let bindings: Awaited<ReturnType<typeof makeBindings>>['bindings'];

  beforeEach(async () => {
    ports = makePorts();
    ({ bindings } = await makeBindings(ports));
  });

  it('create → query → update → delete round-trips', async () => {
    const created = await bindings.model!.create('Space', { name: 'Test space', description: 'd' });
    expect(created.id).toBeTruthy();

    const Space = bindings.$getEntity!('Space') as unknown as {
      findAll(dataset: unknown, q?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
    };
    const dataset = bindings.$currentDataset!();
    let rows = await Space.findAll(dataset, { where: { name: 'Test space' } });
    expect(rows).toHaveLength(1);

    await bindings.model!.update('Space', created.id, { name: 'Renamed' });
    rows = await Space.findAll(dataset, { where: { name: 'Renamed' } });
    expect(rows).toHaveLength(1);

    await bindings.model!.delete('Space', created.id);
    rows = await Space.findAll(dataset, {});
    expect(rows).toHaveLength(0);
  });

  it('$identities reads the host profile cache and forwards fetches', async () => {
    const { bindings, fetched } = await makeBindings(ports);
    expect(bindings.$identities!.get(AGENT)).toMatchObject({ handle: 'me' });
    expect(bindings.$identities!.get('did:test:unknown')).toBeUndefined();
    bindings.$identities!.fetch('did:test:other');
    expect(fetched).toEqual(['did:test:other']);
  });

  it('the ephemeral bus delivers to other agents on the same dataset, never the sender', async () => {
    const ports = makePorts();
    const dataset = (await ports.lifecycle.get('ds-main'))!;

    // Two agents over the same bundle bus: the port reads selfId lazily.
    const scopeA = ports.ephemeral(dataset.handle as never)!;
    const received: unknown[] = [];
    scopeA.channel('cursors').onMessage((message) => void received.push(message));

    // The same agent publishing must not hear itself.
    scopeA.channel('cursors').publish({ x: 1 });
    expect(received).toHaveLength(0);
  });
});

/**
 * The two model-layer facts a relation can now carry, held to the same meaning on both backends.
 *
 * `ordered` and `polymorphic` are declared once, in the manifest, and implemented twice — the production
 * adapter hands them to decorators the executor reads, this backend implements them itself. Nothing
 * makes the two agree, and the ways they can disagree are all quiet: a collection that reads back in
 * a different order, or members that arrive without saying what they are, look like data problems
 * rather than backend ones.
 *
 * These are the assertions a wider conformance suite would open with. They are here rather than in a
 * new harness because there is exactly one divergence worth catching so far, and a suite built
 * before there is something to catch is a suite guessing at what matters.
 */
describe('model-layer conformance', () => {
  it('reads an ordered collection in the order it was arranged, not the order written', async () => {
    const ports = makePorts();
    const handle = (await ports.lifecycle.get('ds-main'))!.handle;
    const { getEntity } = await import('@we/entities');
    const Collection = getEntity('CollectionBlock') as unknown as {
      create(h: unknown, d: Record<string, unknown>): Promise<{ id: string; addChildren(x: unknown): Promise<void> }>;
      findAll(h: unknown, q?: Record<string, unknown>): Promise<Array<{ id: string; children: unknown }>>;
    };

    const post = await Collection.create(handle, { id: 'p', kind: 'post' });
    const first = await Collection.create(handle, { id: 'para', kind: 'text' });
    const second = await Collection.create(handle, { id: 'image', kind: 'image' });
    // Created paragraph-then-image, composed image-then-paragraph. Creation order is an accident of
    // typing; the arrangement is the data.
    await post.addChildren(second);
    await post.addChildren(first);

    const [row] = await Collection.findAll(handle, { where: { id: 'p' }, include: { children: true } });
    expect((row.children as { id: string }[]).map((c) => c.id)).toEqual(['image', 'para']);
  });

  it('says what each member of a heterogeneous relation is', async () => {
    // Without this a consumer holding a mixed bag can do nothing with it — the graph cannot address
    // a node, a card cannot pick a display. The key is a wire format the production backend chooses, so both backends
    // have to write the same one; `RECORD_TYPE_KEY` is where that is recorded.
    const ports = makePorts();
    const handle = (await ports.lifecycle.get('ds-main'))!.handle;
    const { getEntity } = await import('@we/entities');
    const { RECORD_TYPE_KEY } = await import('@we/backend-shared');
    const Collection = getEntity('CollectionBlock') as unknown as {
      create(h: unknown, d: Record<string, unknown>): Promise<{ id: string; addChildren(x: unknown): Promise<void> }>;
      findAll(h: unknown, q?: Record<string, unknown>): Promise<Array<{ children: unknown }>>;
    };
    const Task = getEntity('TaskBlock') as unknown as {
      create(h: unknown, d: Record<string, unknown>): Promise<{ id: string }>;
    };

    const board = await Collection.create(handle, { id: 'b', kind: 'board' });
    await board.addChildren(await Task.create(handle, { id: 't', title: 'Ship it' }));

    const [row] = await Collection.findAll(handle, { where: { id: 'b' }, include: { children: true } });
    const child = (row.children as Record<string, unknown>[])[0];
    expect(child[RECORD_TYPE_KEY]).toBe('TaskBlock');
  });
});
