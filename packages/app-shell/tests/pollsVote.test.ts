/**
 * `polls.vote`, the polls module's declared operation, run against the in-memory backend: one vote per
 * person per poll, changed in place, and a doubled vote healed to one by the next press.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntityForDataset, registerOperations, runOperation, unregisterOperations } from '@we/entities';
import { POLLS_MANIFEST } from '@we/module-polls';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ME = 'did:test:me';

interface Row {
  id: string;
  [field: string]: unknown;
}
type Model = {
  findAll(d: unknown, q?: Record<string, unknown>): Promise<Row[]>;
  create(d: unknown, data: Record<string, unknown>): Promise<Row>;
};

let dataset: unknown;
let author = ME;
const Vote = () => getEntityForDataset('Vote', dataset) as unknown as Model;

beforeEach(async () => {
  author = ME;
  const ports = createInMemoryBackendPorts(
    { selfId: () => author },
    { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-polls', name: 'Polls' }] },
  );
  ports.schemas.declare(POLLS_MANIFEST, { moduleId: 'polls' });
  dataset = (await ports.lifecycle.get('ds-polls'))!.handle;
  registerOperations('polls', POLLS_MANIFEST.operations, { version: POLLS_MANIFEST.version });
});

afterEach(() => unregisterOperations('polls'));

const vote = (option: string, poll = 'poll-1') =>
  runOperation('polls.vote', { poll, option }, { dataset, invoker: ME });
const votes = async () =>
  (await Vote().findAll(dataset, { order: { createdAt: 'asc' } })).map((v) => `${v.author}:${v.pollId}:${v.option}`);

describe('polls.vote', () => {
  it('makes a vote the first time and changes it the second', async () => {
    await vote('tea');
    await vote('coffee');
    expect(await votes()).toEqual([`${ME}:poll-1:coffee`]);
  });

  it('heals two votes by one person on one poll to one', async () => {
    await Vote().create(dataset, { pollId: 'poll-1', option: 'tea' });
    await Vote().create(dataset, { pollId: 'poll-1', option: 'tea' });
    await vote('coffee');
    expect(await votes()).toEqual([`${ME}:poll-1:coffee`]);
  });

  it('heals a duplicate even when the choice is the one already held', async () => {
    await Vote().create(dataset, { pollId: 'poll-1', option: 'tea' });
    await Vote().create(dataset, { pollId: 'poll-1', option: 'tea' });
    await vote('tea');
    expect(await votes()).toEqual([`${ME}:poll-1:tea`]);
  });

  it('leaves other polls and other people’s votes alone', async () => {
    author = 'did:test:other';
    await Vote().create(dataset, { pollId: 'poll-1', option: 'tea' });
    author = ME;
    await vote('tea', 'poll-2');
    await vote('coffee');
    expect((await votes()).sort()).toEqual(
      ['did:test:other:poll-1:tea', `${ME}:poll-1:coffee`, `${ME}:poll-2:tea`].sort(),
    );
  });
});
