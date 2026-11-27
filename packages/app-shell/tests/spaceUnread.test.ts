/**
 * The space store's unread part: the containers holding something newer than this agent's marker,
 * marking one read, the messages naming this agent, and the accounts it has muted — kept in the root
 * dataset, so they follow the agent from space to space.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { CollectionBlock, MutedAgent, ReadMarker } from '@we/entities';
import { afterEach, describe, expect, it } from 'vitest';

import { createSpaceUnread, type SpaceUnread } from '../src/shared/stores/space/unread';
import { reactivityPorts } from './support/engines';
import { flush, ME, type SpaceHarness, spaceHarness } from './support/spaceParts';

const SOMEBODY = 'did:key:z6MkSomebodyElse';
const later = () => new Promise((resolve) => setTimeout(resolve, 5));

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

  it('keeps one marker per container, moved forward each time it is read', async () => {
    const { h, unread } = await build();
    const { channel } = await channelWithPost(h);
    h.datasets.show('ds-a');
    await flush();
    await unread.members.markRead(channel);
    const first = unread.members.readMarkers()[0].lastReadAt;
    await later();
    await unread.members.markRead(channel);
    const root = (await h.datasets.get('ds-root')).handle;
    expect((await ReadMarker.findAll(root)).map((m) => m.nodeId)).toEqual([channel]);
    expect(unread.members.readMarkers()).toHaveLength(1);
    expect(String(unread.members.readMarkers()[0].lastReadAt) > String(first)).toBe(true);
  });

  it('counts a container unread again when something lands in it after the marker', async () => {
    const { h, unread } = await build();
    const { channel } = await channelWithPost(h);
    h.datasets.show('ds-a');
    await flush();
    await unread.members.markRead(channel);
    expect(unread.members.unreadNodeIds()).toEqual([]);
    await later();
    const handle = (await h.datasets.get('ds-a')).handle;
    const reply = await CollectionBlock.create(handle, { kind: 'post' });
    const held = await CollectionBlock.findOne(handle, { where: { id: channel } });
    await CollectionBlock.update(handle, channel, { children: [...(held?.children ?? []), reply.id] });
    // The containers are read once per space: entering it again reads them afresh.
    h.datasets.show('ds-b');
    await flush();
    h.datasets.show('ds-a');
    await flush();
    expect(unread.members.unreadNodeIds()).toEqual([channel]);
  });

  it('marks a container in a space other than the one on screen, by name', async () => {
    const { h, unread } = await build();
    const { channel } = await channelWithPost(h);
    await unread.members.markRead(channel, 'ds-a');
    const root = (await h.datasets.get('ds-root')).handle;
    expect((await ReadMarker.findAll(root)).map((m) => [m.nodeId, m.spaceUuid])).toEqual([[channel, 'ds-a']]);
  });

  it('says nothing and writes nothing without the root dataset', async () => {
    const { h, unread } = await build();
    h.datasets.setRoot(null);
    await flush();
    await unread.members.markRead('channel-1', 'ds-a');
    await unread.members.setAgentMuted(SOMEBODY, true);
    expect(unread.members.readMarkers()).toEqual([]);
    expect(unread.members.mutedDids()).toEqual([]);
    expect(h.toasts.said).toEqual([]);
  });

  it('holds why an account was muted beside it', async () => {
    const { unread } = await build();
    await unread.members.setAgentMuted(SOMEBODY, true, 'too loud');
    expect(unread.members.mutedAgents().map((m) => [m.did, m.description])).toEqual([[SOMEBODY, 'too loud']]);
  });
});
