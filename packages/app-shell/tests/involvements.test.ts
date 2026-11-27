/**
 * Who is on what: the vocabulary, the read and the writes.
 *
 * The rules worth holding are the ones a template cannot be trusted to keep — nobody answers for
 * anybody else, an agent gives one answer per record, a toggle cannot undo itself — and the ones
 * that fail silently when they break: a renamed kind that stops being found, a duplicate that
 * shows a face twice, a tick that vanishes for a second after the click.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity } from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  type InvolvementTypeView,
  parseAppliesTo,
  relationId,
  resolveInvolvementTypes,
} from '../src/shared/involvements';
import { involvement } from '../src/shared/sources/involvement';
import { involvementMenu } from '../src/shared/sources/involvementMenu';
import { SEEDED_INVOLVEMENT_TYPES } from './seededVocabulary';
import { testOperations } from './support/operations';

const ME = 'did:key:me';
const ANA = 'did:key:ana';

const kind = (over: Partial<InvolvementTypeView> & { slug: string }): InvolvementTypeView => ({
  id: over.slug,
  name: over.slug,
  semantic: 'responsible',
  reflexive: false,
  appliesTo: [],
  icon: '',
  color: '',
  retired: false,
  ...over,
});

describe('the vocabulary', () => {
  it('is nothing at all for a space with no kinds — there are no defaults standing in', () => {
    expect(resolveInvolvementTypes([])).toEqual([]);
  });

  it('starts a new space with the kinds its starter writes', () => {
    const kinds = SEEDED_INVOLVEMENT_TYPES;
    expect(kinds.map((k) => k.slug)).toEqual(['assignee', 'reviewer', 'going', 'maybe', 'not-going']);
    // These keep "Going" out of a task's assign menu, and assignment out of an RSVP.
    expect(kinds.find((k) => k.slug === 'assignee')?.appliesTo).toEqual(['TaskBlock']);
    expect(kinds.find((k) => k.slug === 'going')?.reflexive).toBe(true);
  });

  it('orders by what each kind means, in the order written among kinds meaning the same', () => {
    const shepherd = kind({ slug: 'shepherd', semantic: 'reviewing' });
    const kinds = resolveInvolvementTypes([...SEEDED_INVOLVEMENT_TYPES, shepherd]);
    expect(kinds.map((k) => k.slug).slice(0, 3)).toEqual(['assignee', 'reviewer', 'shepherd']);
  });

  it('reads the stored entity list, and an empty one as every entity', () => {
    expect(parseAppliesTo('TaskBlock, EventBlock')).toEqual(['TaskBlock', 'EventBlock']);
    expect(parseAppliesTo('')).toEqual([]);
    expect(parseAppliesTo(undefined)).toEqual([]);
  });
});

describe('who is on each record', () => {
  const types = SEEDED_INVOLVEMENT_TYPES;
  const rows = [
    { id: 'i1', node: 't1', agent: ANA, kind: 'assignee' },
    { id: 'i2', node: 't1', agent: ME, kind: 'reviewer' },
    { id: 'i3', node: { id: 'e1' }, agent: ME, kind: 'going' },
    { id: 'i4', node: 'e1', agent: ANA, kind: 'not-going' },
  ];

  it('groups by meaning, whichever shape the relation arrived in', () => {
    const view = involvement({ rows, types, me: ME });
    expect(view.byNode.t1.responsible).toEqual([ANA]);
    expect(view.byNode.t1.reviewing).toEqual([ME]);
    expect(view.byNode.e1.committed).toEqual([ME]);
    expect(view.byNode.e1.declined).toEqual([ANA]);
  });

  it('leaves somebody who declined out of what a filter matches', () => {
    const view = involvement({ rows, types, me: ME });
    expect(view.byNode.e1.dids).toEqual([ME]);
    // Everyone on anything, the viewer first since they were named.
    expect(view.dids).toEqual([ME, ANA]);
  });

  it("answers with the viewer's own reply, and nobody else's", () => {
    const view = involvement({ rows, types, me: ME });
    expect(view.answers).toEqual({ e1: 'going' });
  });

  it('draws a duplicate left by two people pressing at once as one involvement', () => {
    const view = involvement({ rows: [...rows, { id: 'i5', node: 't1', agent: ANA, kind: 'assignee' }], types });
    expect(view.byNode.t1.people.filter((p) => p.did === ANA)).toHaveLength(1);
    expect(view.byNode.t1.pairs).toContain(`${ANA}|assignee`);
  });

  it('keeps a renamed kind in the group it means, and an unknown one visible', () => {
    const renamed = resolveInvolvementTypes([kind({ slug: 'assignee', name: 'Owner' })]);
    const view = involvement({ rows: [...rows, { node: 't1', agent: ME, kind: 'mystery' }], types: renamed });
    expect(view.byNode.t1.people.find((p) => p.kind === 'assignee')?.name).toBe('Owner');
    // A person's part shown oddly beats a person silently missing from the work.
    expect(view.byNode.t1.responsible).toEqual([ANA, ME]);
  });

  it('answers with nothing, rather than failing, for input that is not there yet', () => {
    expect(involvement(undefined)).toEqual({ byNode: {}, answers: {}, dids: [] });
    expect(involvement({ rows: null, types: null })).toEqual({ byNode: {}, answers: {}, dids: [] });
  });
});

describe('the writes', () => {
  /*
    Against the in-memory backend, with the space's kinds as records: the writes are declared
    operations, and what they find is the vocabulary the space actually holds.
  */
  interface Row {
    id: string;
    agent: string;
    kind: string;
    node: unknown;
  }
  type Model = {
    findAll(d: unknown, q?: Record<string, unknown>): Promise<Row[]>;
    create(d: unknown, data: Record<string, unknown>): Promise<Row>;
  };
  const Involvement = () => getEntity('Involvement') as unknown as Model;
  let dataset: unknown;
  let notices: string[];

  const types = SEEDED_INVOLVEMENT_TYPES;
  // As a template invokes them: through the host, which queues them by their serial key and says a
  // declared error in its own words.
  const options = () => ({ dataset, invoker: ME, notify: (message: string) => notices.push(message) });
  const actions = () => ({
    setInvolvement: (node: string, agent: string, kind: string, on: boolean) =>
      testOperations.invoke('core.setInvolvement', { node, agent, kind, on }, options()).catch(() => undefined),
    respond: (node: string, kind: string) =>
      testOperations.invoke('core.respond', { node, kind }, options()).catch(() => undefined),
  });
  const table = async () =>
    (await Involvement().findAll(dataset, { order: { createdAt: 'asc' } })).map((r) => ({
      agent: r.agent,
      kind: r.kind,
      node: relationId(r.node),
    }));

  beforeEach(async () => {
    notices = [];
    const ports = createInMemoryBackendPorts(
      { selfId: () => ME },
      { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-involved', name: 'Involved' }] },
    );
    dataset = (await ports.lifecycle.get('ds-involved'))!.handle;
    const InvolvementType = getEntity('InvolvementType') as unknown as Model;
    for (const kind of types)
      await InvolvementType.create(dataset, {
        name: kind.name,
        slug: kind.slug,
        semantic: kind.semantic,
        reflexive: kind.reflexive,
      });
  });

  it('assigns somebody else, and cannot assign them twice by pressing twice', async () => {
    await actions().setInvolvement('t1', ANA, 'assignee', true);
    await actions().setInvolvement('t1', ANA, 'assignee', true);
    expect(await table()).toEqual([{ agent: ANA, kind: 'assignee', node: 't1' }]);
  });

  it('takes every copy off, so a duplicate does not outlive the person removing it', async () => {
    await Involvement().create(dataset, { agent: ANA, kind: 'assignee', node: 't1' });
    await Involvement().create(dataset, { agent: ANA, kind: 'assignee', node: 't1' });
    await Involvement().create(dataset, { agent: ANA, kind: 'assignee', node: 't2' });
    await actions().setInvolvement('t1', ANA, 'assignee', false);
    expect((await table()).map((r) => r.node)).toEqual(['t2']);
  });

  it('writes quick presses in order, so the last one is what is stored', async () => {
    // Not awaited between presses, as a person double-clicking does not wait.
    const a = actions();
    await Promise.all([
      a.setInvolvement('t1', ME, 'reviewer', true),
      a.setInvolvement('t1', ME, 'reviewer', false),
      a.setInvolvement('t1', ME, 'reviewer', true),
    ]);
    expect((await table()).map((r) => [r.agent, r.kind])).toEqual([[ME, 'reviewer']]);
    await Promise.all([
      a.setInvolvement('t1', ME, 'reviewer', false),
      a.setInvolvement('t1', ME, 'reviewer', true),
      a.setInvolvement('t1', ME, 'reviewer', false),
    ]);
    expect(await table()).toEqual([]);
  });

  it('refuses to answer for somebody else', async () => {
    await actions().setInvolvement('e1', ANA, 'going', true);
    expect(await table()).toEqual([]);
    expect(notices).toEqual(['Only the person it is about can give that answer.']);
  });

  it('gives an agent one answer per record, replacing the last', async () => {
    await actions().respond('e1', 'maybe');
    await actions().respond('e1', 'going');
    expect((await table()).map((r) => r.kind)).toEqual(['going']);
    await actions().respond('e1', '');
    expect(await table()).toEqual([]);
  });

  it('routes an answer given through setInvolvement to the same one-answer rule', async () => {
    await actions().respond('e1', 'maybe');
    await actions().setInvolvement('e1', ME, 'going', true);
    expect((await table()).map((r) => r.kind)).toEqual(['going']);
    await actions().setInvolvement('e1', ME, 'going', false);
    expect(await table()).toEqual([]);
  });

  it('leaves what an answer is not about alone', async () => {
    await actions().setInvolvement('e1', ME, 'reviewer', true);
    await actions().respond('e1', 'going');
    await actions().respond('e1', 'not-going');
    await actions().respond('e2', 'going');
    expect((await table()).map((r) => `${r.node}:${r.kind}`).sort()).toEqual([
      'e1:not-going',
      'e1:reviewer',
      'e2:going',
    ]);
  });

  it('refuses an assignment given as an answer, and a kind the space does not have', async () => {
    await actions().respond('e1', 'assignee');
    await actions().setInvolvement('t1', ANA, 'shepherd', true);
    expect(await table()).toEqual([]);
    expect(notices).toEqual([
      'That is not an answer anybody can give to this.',
      'That is not a kind of involvement this space has.',
    ]);
  });
});

describe('the people on a card, as faces and as a picker', () => {
  const types = SEEDED_INVOLVEMENT_TYPES;
  const profiles = [
    { did: 'did:key:zed', name: 'Zed' },
    { did: ANA, name: 'Ana', avatar: 'ana.png' },
    { did: ME, name: 'Me' },
    { did: 'did:key:bo', name: 'Bo' },
  ];
  const members = profiles.map((p) => p.did);
  const rows = [
    { node: 't1', agent: 'did:key:zed', kind: 'assignee' },
    { node: 't1', agent: ANA, kind: 'reviewer' },
    { node: 't2', agent: ANA, kind: 'assignee' },
  ];

  it('rings a reviewer and nobody else, so a card and a picker agree who is checking the work', () => {
    const view = involvement({ rows, types });
    expect(view.byNode.t1.people.map((p) => [p.did, p.tone])).toEqual([
      ['did:key:zed', ''],
      [ANA, 'warning'],
    ]);
  });

  it('can count only some records, and leads with the viewer', () => {
    const everyone = involvement({ rows: [...rows, { node: 't2', agent: ME, kind: 'assignee' }], types, me: ME });
    expect(everyone.dids[0]).toBe(ME);
    const justT1 = involvement({ rows, types, nodes: ['t1'] });
    expect(justT1.dids).toEqual(['did:key:zed', ANA]);
  });

  it('offers the kinds anybody may give on this entity, holders ticked and first, then the viewer, then by name', () => {
    const entries = involvementMenu({ node: 't1', entity: 'TaskBlock', rows, types, members, profiles, me: ME }) as {
      type?: string;
      id: string;
      label: string;
      collapsed?: boolean;
      items?: { id: string; checked: boolean; kind: string; avatar: { tone: string } }[];
    }[];
    expect(entries[0]).toMatchObject({ id: ME, kind: 'assignee', label: 'Assign to me' });
    const [assigned, reviewing] = entries.slice(1);
    expect(entries.slice(1).map((g) => g.id)).toEqual(['assignee', 'reviewer']);
    expect(assigned.items!.map((i) => i.id)).toEqual(['did:key:zed', ME, ANA, 'did:key:bo']);
    expect(assigned.items![0].checked).toBe(true);
    // Every group open and closable, and a reviewer wears the reviewer's ring there too.
    expect(entries.slice(1).every((g) => g.collapsed === false && (g as { collapsible?: boolean }).collapsible)).toBe(
      true,
    );
    expect(reviewing.items![0]).toMatchObject({ id: ANA, checked: true, avatar: { tone: 'warning' } });
  });

  it('drops "Assign to me" once the viewer is on it', () => {
    const entries = involvementMenu({
      node: 't2',
      entity: 'TaskBlock',
      rows: [...rows, { node: 't2', agent: ME, kind: 'assignee' }],
      types,
      members,
      profiles,
      me: ME,
    }) as { id: string; collapsed?: boolean }[];
    expect(entries.map((e) => e.id)).toEqual(['assignee', 'reviewer']);
  });

  it('never offers an answer somebody gives about themselves, or a kind meant for another entity', () => {
    const entries = involvementMenu({ node: 'e1', entity: 'EventBlock', rows, types, members, profiles, me: ME });
    expect(entries).toEqual([]);
  });

  it('still lists somebody who holds a part and has left the space', () => {
    const entries = involvementMenu({
      node: 't1',
      entity: 'TaskBlock',
      rows,
      types,
      members: members.filter((did) => did !== 'did:key:zed'),
      profiles: [...profiles.filter((p) => p.did !== 'did:key:zed'), { did: 'did:key:zed', name: 'Zed (left)' }],
      me: ME,
    }) as { items?: { label: string; checked: boolean }[] }[];
    expect(entries[1].items![0]).toMatchObject({ label: 'Zed (left)', checked: true });
  });
});

describe('the person a conversation named', () => {
  const types = SEEDED_INVOLVEMENT_TYPES;
  const profiles = [
    { did: 'did:key:jw', name: 'James Weir' },
    { did: 'did:key:jb', name: 'James Brown' },
    { did: ANA, name: 'Ana Ruiz' },
    { did: ME, name: 'Me' },
  ];
  const members = profiles.map((p) => p.did);
  const menu = (said: string, rows: { node: string; agent: string; kind: string }[] = []) =>
    involvementMenu({ node: 't1', entity: 'TaskBlock', rows, types, members, profiles, me: ME, said }) as {
      id: string;
      label: string;
    }[];

  it('is offered first, by first name or whole name, when exactly one member answers to it', () => {
    expect(menu('ana')[0]).toMatchObject({ id: ANA, label: 'Assign Ana Ruiz — named in the conversation' });
    expect(menu('James Weir')[0].id).toBe('did:key:jw');
  });

  it('is not offered as a guess between two people, or once somebody is doing the work', () => {
    expect(menu('James')[0].label).toBe('Assign to me');
    expect(menu('Ana', [{ node: 't1', agent: 'did:key:jw', kind: 'assignee' }])[0].id).not.toBe(ANA);
  });
});
