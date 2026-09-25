/**
 * Who is on what: the vocabulary, the read, the writes and the overlay between them.
 *
 * The rules worth holding are the ones a template cannot be trusted to keep — nobody answers for
 * anybody else, an agent gives one answer per record, a toggle cannot undo itself — and the ones
 * that fail silently when they break: a renamed kind that stops being found, a duplicate that
 * shows a face twice, a tick that vanishes for a second after the click.
 */
import { type EntityClass, registerEntity, unregisterEntity } from '@we/entities';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { involvementOptimism } from '../src/shared/involvementOptimism';
import {
  createInvolvementActions,
  type InvolvementTypeView,
  parseAppliesTo,
  resolveInvolvementTypes,
} from '../src/shared/involvements';
import { applyPendingInvolvements, involvement } from '../src/shared/sources/involvement';
import { involvementMenu } from '../src/shared/sources/involvementMenu';

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
  defined: true,
  ...over,
});

describe('the vocabulary', () => {
  it('stands in with the defaults until a space names its own', () => {
    const kinds = resolveInvolvementTypes([]);
    expect(kinds.map((k) => k.slug)).toEqual(['assignee', 'reviewer', 'going', 'maybe', 'not-going']);
    expect(kinds.every((k) => !k.defined)).toBe(true);
    // The defaults keep "Going" out of a task's assign menu, and assignment out of an RSVP.
    expect(kinds.find((k) => k.slug === 'assignee')?.appliesTo).toEqual(['TaskBlock']);
    expect(kinds.find((k) => k.slug === 'going')?.reflexive).toBe(true);
  });

  it('lets a record with a default slug replace that default rather than sit beside it', () => {
    const owner = kind({ slug: 'assignee', name: 'Owner' });
    const kinds = resolveInvolvementTypes([owner]);
    expect(kinds.filter((k) => k.slug === 'assignee')).toEqual([owner]);
  });

  it('orders by what each kind means, the community’s own first among kinds meaning the same', () => {
    const shepherd = kind({ slug: 'shepherd', semantic: 'reviewing' });
    const kinds = resolveInvolvementTypes([shepherd]);
    expect(kinds.map((k) => k.slug).slice(0, 3)).toEqual(['assignee', 'shepherd', 'reviewer']);
  });

  it('reads the stored entity list, and an empty one as every entity', () => {
    expect(parseAppliesTo('TaskBlock, EventBlock')).toEqual(['TaskBlock', 'EventBlock']);
    expect(parseAppliesTo('')).toEqual([]);
    expect(parseAppliesTo(undefined)).toEqual([]);
  });
});

describe('who is on each record', () => {
  const types = resolveInvolvementTypes([]);
  const rows = [
    { id: 'i1', node: 't1', agent: ANA, kind: 'assignee' },
    { id: 'i2', node: ['t1'], agent: ME, kind: 'reviewer' },
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

describe('a write shown before it lands', () => {
  it('adds a held pair nobody has seen yet, and removes every copy of one taken off', () => {
    const observed = [
      { node: 't1', agent: ANA, kind: 'assignee' },
      { node: 't1', agent: ANA, kind: 'assignee' },
    ];
    const pending = [
      { node: 't1', agent: ANA, kind: 'assignee', on: false },
      { node: 't1', agent: ME, kind: 'reviewer', on: true },
    ];
    expect(applyPendingInvolvements(observed, pending)).toEqual([{ node: 't1', agent: ME, kind: 'reviewer' }]);
  });

  beforeEach(() => involvementOptimism.reset());

  it('stays up across a draw that has not caught up, and goes once the data moves', () => {
    involvementOptimism.ports.hold('t1', ME, 'assignee', true);
    involvementOptimism.ports.done('t1', ME, 'assignee');
    involvementOptimism.settle(() => false);
    involvementOptimism.settle(() => false);
    expect(involvementOptimism.overlay()).toHaveLength(1);
    involvementOptimism.settle(() => true);
    expect(involvementOptimism.overlay()).toHaveLength(0);
  });

  it('goes when somebody else overtakes it, rather than waiting for data that will never agree', () => {
    // Held as off, seen as on at the first draw; then the pair moves — but not to what was written.
    involvementOptimism.ports.hold('t1', ANA, 'assignee', false);
    involvementOptimism.ports.done('t1', ANA, 'assignee');
    involvementOptimism.settle(() => true);
    expect(involvementOptimism.overlay()).toHaveLength(1);
    // A peer's own write landing counts as an answer later than ours.
    involvementOptimism.ports.hold('t1', ME, 'reviewer', true);
    involvementOptimism.ports.done('t1', ME, 'reviewer');
    involvementOptimism.settle((_node, agent) => agent === ANA);
    involvementOptimism.settle((_node, agent) => agent === ANA);
    involvementOptimism.settle(() => false);
    expect(involvementOptimism.overlay().map((h) => h.agent)).toEqual([ME]);
  });

  it('takes no answer from a surface whose query has not answered yet', () => {
    /*
      The inspector mounting mid-write read an empty list and released a hold on the card: an off
      hold read as agreed with, and the card drew the stale row for the rest of the round trip.
    */
    const held = [{ node: 't1', agent: ME, kind: 'assignee' }];
    involvementOptimism.ports.hold('t1', ME, 'assignee', false);
    involvementOptimism.ports.done('t1', ME, 'assignee');
    involvementOptimism.settleFromRows(held);
    involvementOptimism.settleFromRows([]);
    involvementOptimism.settleFromRows(undefined);
    expect(involvementOptimism.overlay()).toHaveLength(1);
    // The removal coming back is what releases it.
    involvementOptimism.settleFromRows([{ node: 't2', agent: ME, kind: 'assignee' }]);
    expect(involvementOptimism.overlay()).toHaveLength(0);
  });

  it('stands through on, off and on again until the last write returns', () => {
    /*
      The first press's echo arriving while the third is on screen read as the data having moved,
      and the card blinked back to the first answer before the later writes caught it up.
    */
    const hold = (on: boolean) => involvementOptimism.ports.hold('t1', ME, 'reviewer', on);
    const done = () => involvementOptimism.ports.done('t1', ME, 'reviewer');
    const rows = (present: boolean) =>
      present ? [{ node: 't1', agent: ME, kind: 'reviewer' }] : [{ node: 't9', agent: ME, kind: 'assignee' }];
    hold(true);
    involvementOptimism.settleFromRows(rows(false));
    hold(false);
    hold(true);
    done(); // the on landed
    involvementOptimism.settleFromRows(rows(true));
    done(); // the off landed
    involvementOptimism.settleFromRows(rows(false));
    expect(involvementOptimism.overlay()).toEqual([expect.objectContaining({ kind: 'reviewer', on: true })]);
    done(); // the last on landed, and the rows say so
    involvementOptimism.settleFromRows(rows(true));
    expect(involvementOptimism.overlay()).toHaveLength(0);
  });

  it('keeps a later press when an earlier write fails', () => {
    involvementOptimism.ports.hold('t1', ME, 'reviewer', true);
    involvementOptimism.ports.hold('t1', ME, 'reviewer', false);
    involvementOptimism.ports.release('t1', ME, 'reviewer');
    expect(involvementOptimism.overlay()).toEqual([expect.objectContaining({ on: false })]);
  });

  it('is withdrawn when the write is refused', () => {
    involvementOptimism.ports.hold('t1', ME, 'assignee', true);
    involvementOptimism.ports.release('t1', ME, 'assignee');
    expect(involvementOptimism.overlay()).toHaveLength(0);
  });
});

describe('the writes', () => {
  interface Row {
    id: string;
    agent: string;
    kind: string;
    node: string;
    delete: (batch?: string) => Promise<void>;
  }
  let table: Row[];
  let notices: string[];
  let serial = 0;

  const Fake = {
    findAll: async (_dataset: unknown, query?: { where?: { agent?: string } }) =>
      table.filter((row) => !query?.where?.agent || row.agent === query.where.agent),
    create: async (_dataset: unknown, fields: { agent: string; kind: string; node: string[] }) => {
      const row: Row = {
        id: `i${++serial}`,
        agent: fields.agent,
        kind: fields.kind,
        node: fields.node[0],
        delete: async () => {
          table = table.filter((r) => r !== row);
        },
      };
      table.push(row);
      return row;
    },
  };

  const types = resolveInvolvementTypes([]);
  const actions = () =>
    createInvolvementActions({
      dataset: () => ({}),
      me: () => ME,
      types: () => types,
      notify: (message) => notices.push(message),
    });

  beforeEach(() => {
    table = [];
    notices = [];
    registerEntity('Involvement', Fake as unknown as EntityClass);
  });
  afterEach(() => unregisterEntity('Involvement'));

  it('assigns somebody else, and cannot assign them twice by pressing twice', async () => {
    await actions().setInvolvement('t1', ANA, 'assignee', true);
    await actions().setInvolvement('t1', ANA, 'assignee', true);
    expect(table.map((r) => [r.agent, r.kind, r.node])).toEqual([[ANA, 'assignee', 't1']]);
  });

  it('takes every copy off, so a duplicate does not outlive the person removing it', async () => {
    await Fake.create({}, { agent: ANA, kind: 'assignee', node: ['t1'] });
    await Fake.create({}, { agent: ANA, kind: 'assignee', node: ['t1'] });
    await Fake.create({}, { agent: ANA, kind: 'assignee', node: ['t2'] });
    await actions().setInvolvement('t1', ANA, 'assignee', false);
    expect(table.map((r) => r.node)).toEqual(['t2']);
  });

  it('writes quick presses in order, so the last one is what is stored', async () => {
    // Not awaited between presses, as a person double-clicking does not wait.
    const a = actions();
    await Promise.all([
      a.setInvolvement('t1', ME, 'reviewer', true),
      a.setInvolvement('t1', ME, 'reviewer', false),
      a.setInvolvement('t1', ME, 'reviewer', true),
    ]);
    expect(table.map((r) => [r.agent, r.kind])).toEqual([[ME, 'reviewer']]);
    await Promise.all([
      a.setInvolvement('t1', ME, 'reviewer', false),
      a.setInvolvement('t1', ME, 'reviewer', true),
      a.setInvolvement('t1', ME, 'reviewer', false),
    ]);
    expect(table).toEqual([]);
  });

  it('refuses to answer for somebody else', async () => {
    await actions().setInvolvement('e1', ANA, 'going', true);
    expect(table).toEqual([]);
    expect(notices).toHaveLength(1);
  });

  it('gives an agent one answer per record, replacing the last', async () => {
    await actions().respond('e1', 'maybe');
    await actions().respond('e1', 'going');
    expect(table.map((r) => r.kind)).toEqual(['going']);
    await actions().respond('e1', '');
    expect(table).toEqual([]);
  });

  it('leaves what an answer is not about alone', async () => {
    await actions().setInvolvement('e1', ME, 'reviewer', true);
    await actions().respond('e1', 'going');
    await actions().respond('e1', 'not-going');
    expect(table.map((r) => r.kind).sort()).toEqual(['not-going', 'reviewer']);
  });

  it('refuses an assignment given as an answer, and a kind the space does not have', async () => {
    await actions().respond('e1', 'assignee');
    await actions().setInvolvement('t1', ANA, 'shepherd', true);
    expect(table).toEqual([]);
    expect(notices).toHaveLength(2);
  });
});

describe('the people on a card, as faces and as a picker', () => {
  const types = resolveInvolvementTypes([]);
  const members = [
    { did: 'did:key:zed', name: 'Zed' },
    { did: ANA, name: 'Ana', avatar: 'ana.png' },
    { did: ME, name: 'Me' },
    { did: 'did:key:bo', name: 'Bo' },
  ];
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
    const entries = involvementMenu({ node: 't1', entity: 'TaskBlock', rows, types, members, me: ME }) as {
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
      me: ME,
    }) as { id: string; collapsed?: boolean }[];
    expect(entries.map((e) => e.id)).toEqual(['assignee', 'reviewer']);
  });

  it('never offers an answer somebody gives about themselves, or a kind meant for another entity', () => {
    const entries = involvementMenu({ node: 'e1', entity: 'EventBlock', rows, types, members, me: ME });
    expect(entries).toEqual([]);
  });

  it('still lists somebody who holds a part and has left the space', () => {
    const entries = involvementMenu({
      node: 't1',
      entity: 'TaskBlock',
      rows,
      types,
      members: members.filter((m) => m.did !== 'did:key:zed'),
      profiles: [{ did: 'did:key:zed', name: 'Zed (left)' }],
      me: ME,
    }) as { items?: { label: string; checked: boolean }[] }[];
    expect(entries[1].items![0]).toMatchObject({ label: 'Zed (left)', checked: true });
  });
});

describe('the person a conversation named', () => {
  const types = resolveInvolvementTypes([]);
  const members = [
    { did: 'did:key:jw', name: 'James Weir' },
    { did: 'did:key:jb', name: 'James Brown' },
    { did: ANA, name: 'Ana Ruiz' },
    { did: ME, name: 'Me' },
  ];
  const menu = (said: string, rows: { node: string; agent: string; kind: string }[] = []) =>
    involvementMenu({ node: 't1', entity: 'TaskBlock', rows, types, members, me: ME, said }) as {
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
