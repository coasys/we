/**
 * A response goes into its thread, and nowhere else — against the in-memory backend, so the walk runs
 * over real records and real links rather than a fake that agrees with it.
 *
 * The two rules being pinned, from `@shared/responses`:
 * - the thread's subject is the first thing above a response that is not itself one;
 * - a response is never a child of anything — where it was said is derived from its subject.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity } from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import { completeResponse, respondsThrough } from '../src/shared/responses';

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

const inside = (id: string) => ({ parent: { id, relation: 'children', entity: 'CollectionBlock' } });
const answering = (id: string) => ({ parent: { id, relation: 'responses' } });

/** Write a response the way the host does — the link that makes it one, then the thread link. */
async function respond(entity: string, to: Node, fields: Record<string, unknown> = {}): Promise<Node> {
  const node = await model(entity).create(dataset, fields, answering(to.id));
  await completeResponse(dataset as never, node.id, to.id);
  return node;
}

const reread = async (entity: string, node: Node) =>
  (await model(entity).findOne(dataset, { where: { id: node.id } }))!;

describe('a response, threaded', () => {
  it('a reply to a line in a call is in the line’s thread, and not one of the call’s children', async () => {
    const space = await model('CollectionBlock').create(dataset, { kind: 'space', mode: 'feed' });
    const call = await model('CollectionBlock').create(dataset, { kind: 'call', mode: 'feed' }, inside(space.id));
    const line = await model('TextBlock').create(dataset, { text: 'lunch at 1?' }, inside(call.id));

    const reply = await respond('TextBlock', line, { text: 'yes' });
    const answer = await respond('TextBlock', reply, { text: 'great' });

    // Both are in the line's thread — the subject is the first thing that is not itself a response.
    expect((await reread('TextBlock', line)).thread).toEqual(expect.arrayContaining([reply.id, answer.id]));
    // The call holds only what was said in it at the top level; the replies are reached through the line.
    expect((await reread('CollectionBlock', call)).children).toEqual([line.id]);
  });

  it('a comment on a post is in the post’s thread, and in no collection', async () => {
    const channel = await model('CollectionBlock').create(dataset, { kind: 'channel', mode: 'feed' });
    const post = await model('CollectionBlock').create(dataset, { kind: 'post', mode: 'document' }, inside(channel.id));

    const comment = await respond('CollectionBlock', post, { kind: 'reply' });

    expect((await reread('CollectionBlock', post)).thread).toEqual([comment.id]);
    expect((await reread('CollectionBlock', post)).children ?? []).not.toContain(comment.id);
    expect((await reread('CollectionBlock', channel)).children).toEqual([post.id]);
  });

  it('a call about a task is in the task’s thread, and the space holds only the task', async () => {
    const space = await model('CollectionBlock').create(dataset, { kind: 'space', mode: 'feed' });
    const task = await model('TaskBlock').create(dataset, { title: 'Ship it' }, inside(space.id));

    const call = await respond('CollectionBlock', task, { kind: 'call', mode: 'feed' });

    expect((await reread('TaskBlock', task)).thread).toEqual([call.id]);
    expect((await reread('CollectionBlock', space)).children).toEqual([task.id]);
  });
});

describe('which writes are responses', () => {
  it('reads the subject off a parent naming `responses`', () => {
    expect(respondsThrough(answering('post-1'))).toBe('post-1');
  });

  it('answers empty for a parent through any other relation, or none', () => {
    expect(respondsThrough(inside('channel-1'))).toBe('');
    expect(respondsThrough({})).toBe('');
    expect(respondsThrough(undefined)).toBe('');
  });
});
