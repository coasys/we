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
    expect(view.dids).toEqual([ANA, ME]);
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
    involvementOptimism.settle(() => false);
    involvementOptimism.settle(() => false);
    expect(involvementOptimism.overlay()).toHaveLength(1);
    involvementOptimism.settle(() => true);
    expect(involvementOptimism.overlay()).toHaveLength(0);
  });

  it('goes when somebody else overtakes it, rather than waiting for data that will never agree', () => {
    // Held as off, seen as on at the first draw; then the pair moves — but not to what was written.
    involvementOptimism.ports.hold('t1', ANA, 'assignee', false);
    involvementOptimism.settle(() => true);
    expect(involvementOptimism.overlay()).toHaveLength(1);
    // A peer's own write landing counts as an answer later than ours.
    involvementOptimism.ports.hold('t1', ME, 'reviewer', true);
    involvementOptimism.settle((_node, agent) => agent === ANA);
    involvementOptimism.settle((_node, agent) => agent === ANA);
    involvementOptimism.settle(() => false);
    expect(involvementOptimism.overlay().map((h) => h.agent)).toEqual([ME]);
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
