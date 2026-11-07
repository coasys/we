/**
 * Unread dots and mentions, from one read of a space's containers.
 *
 * The two used to be two whole-space reads. What they compute did not change; what they read did,
 * so this pins the computation on its own, against rows shaped the way the one read returns them.
 */
import { mentionsOf, mergeMentions, unreadContainerIds } from '@shared/containerActivity';
import { describe, expect, it } from 'vitest';

describe('unread containers', () => {
  const rows = [
    { id: 'never-opened', $latestChild: { createdAt: '2026-09-02T00:00:00Z' } },
    { id: 'read-since', $latestChild: { createdAt: '2026-09-02T00:00:00Z' } },
    { id: 'new-since', $latestChild: { createdAt: '2026-09-03T00:00:00Z' } },
    { id: 'empty' },
  ];
  const markers = [
    { nodeId: 'read-since', lastReadAt: '2026-09-02T12:00:00Z' },
    { nodeId: 'new-since', lastReadAt: '2026-09-02T12:00:00Z' },
  ];

  it('counts a never-opened container with content, and one with content newer than its marker', () => {
    expect(unreadContainerIds(rows, markers)).toEqual(['never-opened', 'new-since']);
  });

  it('follows the markers alone — marking read needs no new read of the space', () => {
    const later = [...markers, { nodeId: 'never-opened', lastReadAt: '2026-09-04T00:00:00Z' }].map((m) =>
      m.nodeId === 'new-since' ? { ...m, lastReadAt: '2026-09-04T00:00:00Z' } : m,
    );
    expect(unreadContainerIds(rows, later)).toEqual([]);
  });

  it('counts a reply to something in a container as new in that container', () => {
    // A comment is a child of nothing: it is in its post's thread, and the post is in the channel.
    const channel = [
      { id: 'channel', $latestChild: { createdAt: '2026-09-01T00:00:00Z' } },
      { id: 'post', partOf: 'channel', $latestReply: { createdAt: '2026-09-03T00:00:00Z' } },
    ];
    const read = [
      { nodeId: 'channel', lastReadAt: '2026-09-02T00:00:00Z' },
      { nodeId: 'post', lastReadAt: '2026-09-04T00:00:00Z' },
    ];
    expect(unreadContainerIds(channel, read)).toEqual(['channel']);
    // And read again after it, nothing is new.
    expect(unreadContainerIds(channel, [{ nodeId: 'channel', lastReadAt: '2026-09-04T00:00:00Z' }])).toEqual([]);
  });
});

describe('mentions', () => {
  const me = 'did:key:me';
  const rows = [
    { id: 'old', author: 'did:key:a', createdAt: 100, mentions: [me] },
    { id: 'other', author: 'did:key:b', createdAt: 300, mentions: ['did:key:c'] },
    { id: 'new', author: 'did:key:b', createdAt: 200, mentions: ['did:key:c', me] },
    { id: 'none', author: 'did:key:c', createdAt: 400 },
  ];

  it('finds the nodes naming this agent, newest first', () => {
    expect(mentionsOf(rows, me)).toEqual([
      { id: 'new', author: 'did:key:b', createdAt: 200 },
      { id: 'old', author: 'did:key:a', createdAt: 100 },
    ]);
  });

  it('finds a mention of my other computer, or of my person, and lists a message naming two of them once', () => {
    /*
      `me.dids`: this device, the laptop, the person. Somebody picking me from a member list now names
      the person; a mention written before my devices were linked names the laptop. Both are mine.
    */
    const laptop = 'did:key:z6MkTestLaptop';
    const person = 'did:scid:test:1:QmTestMe';
    const mine = [
      ...rows,
      { id: 'to-laptop', author: 'did:key:a', createdAt: 500, mentions: [laptop] },
      { id: 'to-person', author: 'did:key:b', createdAt: 600, mentions: [person] },
      { id: 'to-both', author: 'did:key:c', createdAt: 700, mentions: [me, person] },
    ];
    expect(mentionsOf(mine, [me, laptop, person]).map((row) => row.id)).toEqual([
      'to-both',
      'to-person',
      'to-laptop',
      'new',
      'old',
    ]);
    // One DID is still only that one.
    expect(mentionsOf(mine, laptop).map((row) => row.id)).toEqual(['to-laptop']);
  });
});

describe('one lookup per DID that is me, as one list', () => {
  const row = (id: string, createdAt: number) => ({ id, author: 'did:key:a', createdAt });

  it('merges newest first, a message found twice once, and keeps what the lookup said about it', () => {
    const byDevice = [row('b', 200), { ...row('a', 100), verdict: 'cantCheck' as const }];
    const byPerson = [row('c', 300), row('b', 200)];
    expect(mergeMentions([byDevice, byPerson])).toEqual([
      row('c', 300),
      row('b', 200),
      { ...row('a', 100), verdict: 'cantCheck' },
    ]);
  });

  it('keeps to the limit one lookup had, and is nothing for no answers', () => {
    const many = Array.from({ length: 40 }, (_, i) => row(`m${i}`, i));
    const more = Array.from({ length: 40 }, (_, i) => row(`n${i}`, 100 + i));
    expect(mergeMentions([many, more])).toHaveLength(50);
    expect(mergeMentions([many, more])[0].id).toBe('n39');
    expect(mergeMentions([])).toEqual([]);
  });
});
