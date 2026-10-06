/**
 * What a delete takes with it, counted by the host before it asks — against the in-memory backend,
 * so the walk runs over real records and real `comments` links rather than a fake that agrees with it.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity } from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import { collectionFacts } from '../src/shared/destructiveFacts';

interface Node {
  id: string;
  addComments(child: unknown): Promise<void>;
}
const Collection = () =>
  getEntity('CollectionBlock') as unknown as { create(dataset: unknown, data: Record<string, unknown>): Promise<Node> };

let dataset: unknown;

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => 'did:test:me' },
    { agent: { id: 'did:test:me', unlocked: true }, datasets: [{ id: 'ds', name: 'Main' }] },
  );
  dataset = (await ports.lifecycle.get('ds'))!.handle;
});

async function reply(to: Node): Promise<Node> {
  const node = await Collection().create(dataset, { kind: 'comment' });
  await to.addComments(node);
  return node;
}

describe('what a delete takes with it', () => {
  it('counts every response under a reply, however deep, and knows it is a reply', async () => {
    const post = await Collection().create(dataset, { kind: 'post' });
    const answered = await reply(post);
    const first = await reply(answered);
    await reply(answered);
    await reply(first);

    expect(await collectionFacts(dataset, answered.id)).toEqual({ reply: true, responses: 3 });
  });

  it('says a post is not a reply, and counts the thread under it', async () => {
    const post = await Collection().create(dataset, { kind: 'post' });
    await reply(await reply(post));

    expect(await collectionFacts(dataset, post.id)).toEqual({ reply: false, responses: 2 });
  });

  it('answers with nothing for a record it cannot find, rather than failing the question', async () => {
    expect(await collectionFacts(dataset, 'nowhere')).toEqual({});
    expect(await collectionFacts(undefined, 'nowhere')).toEqual({});
  });
});
