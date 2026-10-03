/**
 * A reverse relation reads the same link from the other end — `inReplyTo` is `comments`, seen from
 * the reply. Nothing writes one directly, so this backend has to derive it from the forward write,
 * and for a while it did not: `inReplyTo` was empty on every record, a reply listed as a post of its
 * own, and a thread had no shape. The shared conformance suite catches that through the templates'
 * queries; these pin the writes it depends on, unlinking included.
 */
import { getEntity } from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryBackendPorts } from '../src/lifecycle';

interface Record_ {
  id: string;
  addComments(child: unknown): Promise<void>;
  removeComments(child: unknown): Promise<void>;
  setComments(children: unknown[]): Promise<void>;
}

const Collection = () =>
  getEntity('CollectionBlock') as unknown as {
    create(dataset: unknown, data: Record<string, unknown>): Promise<Record_>;
    findAll(dataset: unknown, query: Record<string, unknown>): Promise<Array<{ id: string; inReplyTo?: unknown }>>;
  };

let dataset: unknown;

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => 'did:test:me' },
    { agent: { id: 'did:test:me', unlocked: true }, datasets: [{ id: 'ds', name: 'Main' }] },
  );
  dataset = (await ports.lifecycle.get('ds'))!.handle;
});

const parentOf = async (id: string) => {
  const [row] = await Collection().findAll(dataset, { where: { id } });
  return row.inReplyTo;
};

describe('inReplyTo, derived from comments', () => {
  it('names the record a reply was added to', async () => {
    const post = await Collection().create(dataset, { kind: 'post' });
    const reply = await Collection().create(dataset, { kind: 'comment' });
    await post.addComments(reply);
    expect(await parentOf(reply.id)).toBe(post.id);
  });

  it('is cleared when the reply is removed, so a query for top-level records finds it again', async () => {
    const post = await Collection().create(dataset, { kind: 'post' });
    const reply = await Collection().create(dataset, { kind: 'comment' });
    await post.addComments(reply);
    await post.removeComments(reply);
    expect(await parentOf(reply.id)).toBeUndefined();
    const topLevel = await Collection().findAll(dataset, { where: { inReplyTo: { none: {} } } });
    expect(topLevel.map((r) => r.id).sort()).toEqual([post.id, reply.id].sort());
  });

  it('follows a whole-list write, and leaves a reply that has since moved where it moved to', async () => {
    const first = await Collection().create(dataset, { kind: 'post' });
    const second = await Collection().create(dataset, { kind: 'post' });
    const reply = await Collection().create(dataset, { kind: 'comment' });
    await first.setComments([reply]);
    expect(await parentOf(reply.id)).toBe(first.id);

    await second.addComments(reply);
    await first.setComments([]);
    expect(await parentOf(reply.id)).toBe(second.id);
  });
});
