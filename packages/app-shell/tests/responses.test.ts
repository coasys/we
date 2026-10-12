/**
 * A response goes into its thread and into the feed it lives in — against the in-memory backend, so
 * the walk runs over real records and real links rather than a fake that agrees with it.
 *
 * The two rules being pinned, from `@shared/responses`:
 * - the thread's subject is the first thing above a response that is not itself one;
 * - a response lives in the nearest feed above that subject, documents skipped.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity, PREDICATES } from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import { completeResponse } from '../src/shared/responses';

interface Node {
  id: string;
  children?: string[];
  thread?: string[];
}
type Model = {
  create(dataset: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<Node>;
  findOne(dataset: unknown, query: Record<string, unknown>): Promise<Node | null>;
};
const model = (name: string) => getEntity(name) as unknown as Model;

let dataset: unknown;

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => 'did:test:me' },
    { agent: { id: 'did:test:me', unlocked: true }, datasets: [{ id: 'ds', name: 'Main' }] },
  );
  dataset = (await ports.lifecycle.get('ds'))!.handle;
});

const inside = (id: string) => ({ parent: { id, predicate: PREDICATES.CHILDREN } });
const answering = (id: string) => ({ parent: { id, predicate: PREDICATES.RESPONSE } });

/** Write a response the way the host does — the link that makes it one, then the filing. */
async function respond(entity: string, to: Node, fields: Record<string, unknown> = {}): Promise<Node> {
  const node = await model(entity).create(dataset, fields, answering(to.id));
  await completeResponse(dataset as never, node.id, to.id);
  return node;
}

const reread = async (entity: string, node: Node) =>
  (await model(entity).findOne(dataset, { where: { id: node.id } }))!;

describe('a response, filed', () => {
  it('a reply to a line in a call is in the line’s thread and is one of the call’s lines', async () => {
    const space = await model('CollectionBlock').create(dataset, { kind: 'space', mode: 'feed' });
    const call = await model('CollectionBlock').create(dataset, { kind: 'call', mode: 'feed' }, inside(space.id));
    const line = await model('TextBlock').create(dataset, { text: 'lunch at 1?' }, inside(call.id));

    const reply = await respond('TextBlock', line, { text: 'yes' });
    const answer = await respond('TextBlock', reply, { text: 'great' });

    // Both are in the line's thread — the subject is the first thing that is not itself a response.
    expect((await reread('TextBlock', line)).thread).toEqual(expect.arrayContaining([reply.id, answer.id]));
    // And both are lines of the call they were said in.
    expect((await reread('CollectionBlock', call)).children).toEqual([line.id, reply.id, answer.id]);
  });

  it('a comment on a post lives in the post’s channel, not in the post', async () => {
    const channel = await model('CollectionBlock').create(dataset, { kind: 'channel', mode: 'feed' });
    const post = await model('CollectionBlock').create(dataset, { kind: 'post', mode: 'document' }, inside(channel.id));

    const comment = await respond('CollectionBlock', post, { kind: 'reply' });

    expect((await reread('CollectionBlock', post)).thread).toEqual([comment.id]);
    // The post is a document — its parts are its author's — so the comment goes up to the channel.
    expect((await reread('CollectionBlock', post)).children ?? []).not.toContain(comment.id);
    expect((await reread('CollectionBlock', channel)).children).toContain(comment.id);
  });

  it('a call about a task lives where the task does, in the space collection', async () => {
    // A space collection made before it was written as a feed still counts as one, by its kind.
    const space = await model('CollectionBlock').create(dataset, { kind: 'space' });
    const task = await model('TaskBlock').create(dataset, { title: 'Ship it' }, inside(space.id));

    const call = await respond('CollectionBlock', task, { kind: 'call', mode: 'feed' });

    expect((await reread('TaskBlock', task)).thread).toEqual([call.id]);
    expect((await reread('CollectionBlock', space)).children).toEqual([task.id, call.id]);
  });

  it('a response to something in no feed is still in its thread, and filed nowhere', async () => {
    const canvas = await model('CollectionBlock').create(dataset, { kind: 'canvas' });

    const comment = await respond('CollectionBlock', canvas, { kind: 'reply' });

    expect((await reread('CollectionBlock', canvas)).thread).toEqual([comment.id]);
    expect((await reread('CollectionBlock', canvas)).children ?? []).not.toContain(comment.id);
  });
});
