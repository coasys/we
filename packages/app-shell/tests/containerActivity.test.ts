/**
 * Unread dots and mentions, from one read of a space's containers.
 *
 * The two used to be two whole-space reads. What they compute did not change; what they read did,
 * so this pins the computation on its own, against rows shaped the way the one read returns them.
 */
import { mentionsOf, unreadContainerIds } from '@shared/containerActivity';
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
});
