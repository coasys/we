/**
 * A typed message's mentions are on the message, against the in-memory backend.
 *
 * The Feed writes a message as a composition (`composition.ts` in `@we/messages`): a `CollectionBlock`
 * holding a `TextBlock` with the words and marks, and a group of the files sent with them. A woken
 * agent is woken on the record that carries the `we://mention` link and is told of the files up to two
 * containment levels below it. On the `TextBlock`, the group would be its sibling and the agent would
 * hear of no file; on the message, message → group → file is two levels.
 *
 * The records kernel here makes the host's calls (`TemplateProvider`'s `createEntity`, `linkEntity`,
 * `updateEntity`, `findEntities`), with the host's own mention helpers, over real records and links.
 */
import { linkNewMentions, type MentionWriter, prepareMentionUpdate } from '@shared/lineMentions';
import { findEntityRows, moduleQueryAsOrm } from '@shared/recordsRead';
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity } from '@we/entities';
import { createFeedStore } from '@we/module-feed';
import { markAction, markState } from '@we/module-shared';
import { beforeEach, describe, expect, it } from 'vitest';

type Row = Record<string, unknown> & { id: string };
type Model = MentionWriter & {
  create(dataset: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<Row>;
  update(dataset: unknown, id: string, data: Record<string, unknown>): Promise<unknown>;
  delete(dataset: unknown, id: string): Promise<unknown>;
  findOne(dataset: unknown, query: Record<string, unknown>): Promise<Row | null>;
};
const model = (name: string) => getEntity(name) as unknown as Model;

const ANN = 'did:test:ann';
let dataset: unknown;

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => 'did:test:me' },
    { agent: { id: 'did:test:me', unlocked: true }, datasets: [{ id: 'ds', name: 'Main' }] },
  );
  dataset = (await ports.lifecycle.get('ds'))!.handle;
});

/** The Feed's store over a records kernel that writes as the host does. */
function feedOver(space: string) {
  const messages = model('CollectionBlock');
  const records = {
    create: async (entity: string, fields: Record<string, unknown>, options: Record<string, unknown> = {}) => {
      const { dataset: _named, ...rest } = options;
      const created = await model(entity).create(dataset, fields, Object.keys(rest).length ? rest : undefined);
      await linkNewMentions(model(entity), dataset, entity, created.id, fields, rest.parent, messages);
      return created.id;
    },
    link: async (entity: string, id: string, relation: string, value: string) => {
      await model(entity).addRelation(dataset, id, relation, value);
    },
    update: async (entity: string, id: string, fields: Record<string, unknown>) => {
      const mentions = await prepareMentionUpdate(model(entity), dataset, entity, id, fields, messages);
      await model(entity).update(dataset, id, mentions.fields);
      await mentions.after();
    },
    remove: async (entity: string, id: string) => {
      await model(entity).delete(dataset, id);
    },
    find: async (entity: string, query: unknown) => findEntityRows(entity, dataset, moduleQueryAsOrm(query)),
    subscribe: () => () => {},
  };
  const signal = <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    return [() => value, (next: T) => (value = next)];
  };
  return createFeedStore({
    signal,
    effect: (fn: () => void) => fn(),
    state: markState,
    action: markAction,
    onDispose: () => {},
    dataset: () => 'ds',
    datasetUri: () => 'ds',
    datasetId: () => 'ds',
    spaceRoot: () => space,
    settings: () => ({}),
    identities: { get: () => undefined, fetch: () => {} },
    selfId: () => 'did:test:me',
    notify: () => {},
    kernels: {
      records,
      interpretation: { targets: () => [], proposals: async () => [], proposalsRevision: () => 0 },
    },
  } as never) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
}

const reread = async (entity: string, id: string) => (await model(entity).findOne(dataset, { where: { id } }))!;
const childrenOf = async (id: string) => ((await reread('CollectionBlock', id))?.children as string[]) ?? [];

describe('a typed message that mentions somebody', () => {
  it('has its mention link on the message, with the file it was sent with two containment levels below', async () => {
    const space = await model('CollectionBlock').create(dataset, { kind: 'space', mode: 'feed' });
    const feed = feedOver(space.id);
    const marks = JSON.stringify([{ start: 0, end: 4, type: 'mention', did: ANN }]);
    const plan = new File(['%PDF'], 'plan.pdf', { type: 'application/pdf' });

    await feed.sendToFeed('@Ann the plan', marks, [plan]);

    const [messageId] = await childrenOf(space.id);
    const message = await reread('CollectionBlock', messageId);
    expect(message).toMatchObject({ kind: 'message', mentions: [ANN] });

    const [wordsId, groupId] = await childrenOf(messageId);
    // The words carry the mark, and no link of their own: the message is what mentions Ann.
    expect(await reread('TextBlock', wordsId)).toMatchObject({ marks, mentions: [] });
    const [fileId] = await childrenOf(groupId);
    expect(await reread('FileBlock', fileId)).toMatchObject({ name: 'plan.pdf' });

    // An edit that names Ann away takes the link off the message, and leaves the words' own empty.
    await feed.editUtterance(messageId, 'the plan', 'typed');
    expect((await reread('CollectionBlock', messageId)).mentions).toEqual([]);
    expect(await reread('TextBlock', wordsId)).toMatchObject({ text: 'the plan', mentions: [] });
  });
});
