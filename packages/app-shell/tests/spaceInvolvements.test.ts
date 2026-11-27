/**
 * The space store's involvements part: the kinds of involvement a space names, read per space; naming
 * and retiring one; joining a record's roster; and what is drawn ahead of the data forgotten with the
 * space.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { CollectionBlock, Involvement, SignalType } from '@we/entities';
import { afterEach, describe, expect, it } from 'vitest';

import { createSpaceInvolvements, type SpaceInvolvements } from '../src/shared/stores/space/involvements';
import { reactivityPorts } from './support/engines';
import { testPredictions } from './support/operations';
import { flush, ME, type SpaceHarness, spaceHarness } from './support/spaceParts';

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    testPredictions.clear();
  });

  interface Built {
    h: SpaceHarness;
    involvements: SpaceInvolvements;
    orderResets: { count: number };
  }

  async function build(): Promise<Built> {
    const h = await spaceHarness(makePort(), [
      { id: 'ds-a', name: 'Allotment' },
      { id: 'ds-b', name: 'Bakery' },
    ]);
    const { reactivity } = h;
    const orderResets = { count: 0 };
    let involvements!: SpaceInvolvements;
    disposers.push(
      reactivity.root(() => {
        involvements = createSpaceInvolvements({
          ...h.ctx,
          signalOrder: { reset: () => void orderResets.count++ },
        });
      }),
    );
    return { h, involvements, orderResets };
  }

  it('reads the kinds per space, offers the ones in use, and names a new one', async () => {
    const { h, involvements } = await build();
    expect(involvements.members.involvementTypesLoaded()).toBe(true);
    expect(involvements.members.involvementTypes()).toEqual([]);
    h.datasets.show('ds-a');
    await flush();
    expect(involvements.members.involvementTypesLoaded()).toBe(true);
    await involvements.members.createInvolvementType({ name: 'Shepherd', semantic: 'responsible' });
    await involvements.members.createInvolvementType({ name: 'Reviewer', semantic: 'reviewing' });
    expect(involvements.members.involvementTypes().map((kind) => kind.slug)).toEqual(['shepherd', 'reviewer']);
    await involvements.members.setInvolvementTypeRetired('reviewer', true);
    expect(involvements.members.offeredInvolvementTypes().map((kind) => kind.slug)).toEqual(['shepherd']);
    h.datasets.show('ds-b');
    await flush();
    expect(involvements.members.involvementTypes()).toEqual([]);
  });

  it('forgets every prediction and settled order when the space changes', async () => {
    const { h, involvements, orderResets } = await build();
    h.datasets.show('ds-a');
    await flush();
    const resetsInA = orderResets.count;
    const handle = (await h.datasets.get('ds-a')).handle;
    testPredictions.predict(handle, 'press', [{ kind: 'delete', entity: 'Signal', id: 's1' }]);
    h.datasets.show('ds-b');
    await flush();
    expect(testPredictions.for(handle)).toEqual([]);
    expect(orderResets.count).toBeGreaterThan(resetsInA);
    expect(involvements.members.involvementTypesLoaded()).toBe(true);
  });

  it('puts this agent alone on a record’s roster, and takes it off', async () => {
    const { h, involvements } = await build();
    h.datasets.show('ds-a');
    await flush();
    const handle = (await h.datasets.get('ds-a')).handle;
    const event = await CollectionBlock.create(handle, { kind: 'event' });
    await involvements.members.setAttending(event.id, true);
    expect((await CollectionBlock.findOne(handle, { where: { id: event.id } }))?.participants).toEqual([ME]);
    await involvements.members.setAttending(event.id, false);
    expect((await CollectionBlock.findOne(handle, { where: { id: event.id } }))?.participants ?? []).toEqual([]);
  });

  it('puts somebody on a record under a kind, and takes them off', async () => {
    const { h, involvements } = await build();
    h.datasets.show('ds-a');
    await flush();
    const handle = (await h.datasets.get('ds-a')).handle;
    await involvements.members.createInvolvementType({ name: 'Shepherd', semantic: 'responsible' });
    const task = await CollectionBlock.create(handle, { kind: 'post' });
    const rows = async () =>
      ((await Involvement.findAll(handle, {})) as Involvement[]).map((row) => [row.agent, row.kind]);
    await involvements.members.setInvolvement(task.id, 'did:key:z6MkAnna', 'shepherd', true);
    expect(await rows()).toEqual([['did:key:z6MkAnna', 'shepherd']]);
    await involvements.members.setInvolvement(task.id, 'did:key:z6MkAnna', 'shepherd', false);
    expect(await rows()).toEqual([]);
    expect(h.toasts.said).toEqual([]);
  });

  it('changes a kind it has and keeps its slug, and refuses a second of one name', async () => {
    const { h, involvements } = await build();
    h.datasets.show('ds-a');
    await flush();
    await involvements.members.createInvolvementType({ name: 'Shepherd', semantic: 'responsible' });
    await involvements.members.updateInvolvementType('shepherd', {
      name: 'Steward',
      semantic: 'reviewing',
      appliesTo: 'TaskBlock, EventBlock',
    });
    expect(involvements.members.involvementTypes()).toMatchObject([
      { slug: 'shepherd', name: 'Steward', semantic: 'reviewing' },
    ]);
    await involvements.members.createInvolvementType({ name: 'Shepherd' });
    expect(h.toasts.said).toHaveLength(1);
    expect(involvements.members.involvementTypes()).toHaveLength(1);
  });

  it('retires a reaction type and brings it back, leaving it readable throughout', async () => {
    const { h, involvements } = await build();
    h.datasets.show('ds-a');
    await flush();
    const handle = (await h.datasets.get('ds-a')).handle;
    const like = await SignalType.create(handle, { slug: 'like', name: 'Like' });
    const retired = async () => (await SignalType.findOne(handle, { where: { id: like.id } }))?.retired;
    await involvements.members.setSignalTypeRetired(like.id, true);
    expect(await retired()).toBe(true);
    await involvements.members.setSignalTypeRetired(like.id, false);
    expect(await retired()).toBe(false);
  });

  it('leaves the roster alone for a record that is not there', async () => {
    const { h, involvements } = await build();
    h.datasets.show('ds-a');
    await flush();
    await involvements.members.setAttending('nothing-here', true);
    expect(h.toasts.said).toEqual([]);
  });
});
