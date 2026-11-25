/**
 * The space store's involvements part: the kinds of involvement a space names, read per space; naming
 * and retiring one; joining a record's roster; and reactions drawn before they land, taken back when
 * refused, and every hold forgotten with the space.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { CollectionBlock, SignalType } from '@we/entities';
import { afterEach, describe, expect, it } from 'vitest';

import { createInvolvementOptimism } from '../src/shared/involvementOptimism';
import { createSignalOptimism } from '../src/shared/signalOptimism';
import { createSpaceInvolvements, type SpaceInvolvements } from '../src/shared/stores/space/involvements';
import { flush, ME, reactivityPorts, type SpaceHarness, spaceHarness } from './support/spaceParts';

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  interface Built {
    h: SpaceHarness;
    involvements: SpaceInvolvements;
    signalOptimism: ReturnType<typeof createSignalOptimism>;
    orderResets: { count: number };
  }

  async function build(): Promise<Built> {
    const h = await spaceHarness(makePort(), [
      { id: 'ds-a', name: 'Allotment' },
      { id: 'ds-b', name: 'Bakery' },
    ]);
    const { reactivity } = h;
    const orderResets = { count: 0 };
    const signalOptimism = createSignalOptimism(reactivity.signal);
    let involvements!: SpaceInvolvements;
    disposers.push(
      reactivity.root(() => {
        involvements = createSpaceInvolvements({
          ...h.ctx,
          involvementOptimism: createInvolvementOptimism(reactivity.signal),
          signalOptimism,
          signalOrder: { reset: () => void orderResets.count++ },
        });
      }),
    );
    return { h, involvements, signalOptimism, orderResets };
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

  it('draws a reaction on the press and keeps it once stored', async () => {
    const { h, involvements, signalOptimism } = await build();
    h.datasets.show('ds-a');
    await flush();
    const handle = (await h.datasets.get('ds-a')).handle;
    const post = await CollectionBlock.create(handle, { kind: 'post' });
    const like = await SignalType.create(handle, { name: 'Like', slug: 'like', mode: 'toggle' });
    const giving = involvements.members.upsertSignal(post.id, like.id, 1);
    expect(signalOptimism.overlay()).toEqual([{ record: post.id, type: like.id, value: 1 }]);
    await giving;
    expect(h.toasts.said).toEqual([]);
  });

  it('forgets every hold and settled order when the space changes', async () => {
    const { h, involvements, signalOptimism, orderResets } = await build();
    h.datasets.show('ds-a');
    await flush();
    const resetsInA = orderResets.count;
    signalOptimism.hold('post-1', 'like', 1);
    h.datasets.show('ds-b');
    await flush();
    expect(signalOptimism.overlay()).toEqual([]);
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
});
