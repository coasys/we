/**
 * The space store's unread part: the containers holding something newer than this agent's marker,
 * marking one read, the messages naming this agent, and the accounts it has muted — kept in the root
 * dataset, so they follow the agent from space to space.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { CollectionBlock, MutedAgent } from '@we/entities';
import { afterEach, describe, expect, it } from 'vitest';

import { createSpaceUnread, type SpaceUnread } from '../src/shared/stores/space/unread';
import { reactivityPorts } from './support/engines';
import { flush, ME, type SpaceHarness, spaceHarness } from './support/spaceParts';

const SOMEBODY = 'did:key:z6MkSomebodyElse';

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  async function build(): Promise<{ h: SpaceHarness; unread: SpaceUnread }> {
    const h = await spaceHarness(makePort(), [
      { id: 'ds-root', name: 'we-root' },
      { id: 'ds-a', name: 'Allotment' },
      { id: 'ds-b', name: 'Bakery' },
    ]);
    let unread!: SpaceUnread;
    disposers.push(h.reactivity.root(() => (unread = createSpaceUnread(h.ctx))));
    h.datasets.setRoot('ds-root');
    await flush();
    return { h, unread };
  }

  /** A channel in the space with one post in it, the post naming whoever `mentions` lists. */
  async function channelWithPost(h: SpaceHarness, mentions: string[] = []) {
    const handle = (await h.datasets.get('ds-a')).handle;
    const post = await CollectionBlock.create(handle, { kind: 'post', mentions });
    const channel = await CollectionBlock.create(handle, { kind: 'channel', children: [post.id] });
    return { channel: channel.id, post: post.id };
  }

  it('says which containers hold something unread, and stops once one is marked read', async () => {
    const { h, unread } = await build();
    const { channel } = await channelWithPost(h);
    h.datasets.show('ds-a');
    await flush();
    expect(unread.members.unreadNodeIds()).toEqual([channel]);
    await unread.members.markRead(channel);
    expect(unread.members.readMarkers().map((m) => m.nodeId)).toEqual([channel]);
    expect(unread.members.unreadNodeIds()).toEqual([]);
    // Another space's containers are its own read.
    h.datasets.show('ds-b');
    await flush();
    expect(unread.members.unreadNodeIds()).toEqual([]);
    expect(unread.members.readMarkers().map((m) => m.nodeId)).toEqual([channel]);
  });

  it('finds the messages naming this agent', async () => {
    const { h, unread } = await build();
    const { post } = await channelWithPost(h, [ME]);
    await channelWithPost(h, [SOMEBODY]);
    h.datasets.show('ds-a');
    await flush();
    expect(unread.members.myMentions().map((m) => m.id)).toEqual([post]);
    h.datasets.show(null);
    await flush();
    expect(unread.members.myMentions()).toEqual([]);
  });

  it('mutes and unmutes an account, in the root dataset', async () => {
    const { h, unread } = await build();
    const root = (await h.datasets.get('ds-root')).handle;
    await unread.members.setAgentMuted(SOMEBODY, true, 'too loud');
    await unread.members.setAgentMuted(SOMEBODY, true);
    expect(unread.members.mutedDids()).toEqual([SOMEBODY]);
    expect((await MutedAgent.findAll(root)).map((m) => m.did)).toEqual([SOMEBODY]);
    await unread.members.setAgentMuted(SOMEBODY, false);
    expect(unread.members.mutedDids()).toEqual([]);
    expect(await MutedAgent.findAll(root)).toEqual([]);
    expect(h.toasts.said).toEqual([]);
  });

  it('reads the markers and mutes this agent already has when the root dataset arrives', async () => {
    const { h, unread } = await build();
    await unread.members.setAgentMuted(SOMEBODY, true);
    h.datasets.setRoot(null);
    await flush();
    expect(unread.members.mutedDids()).toEqual([]);
    h.datasets.setRoot('ds-root');
    await flush();
    expect(unread.members.mutedDids()).toEqual([SOMEBODY]);
  });
});
