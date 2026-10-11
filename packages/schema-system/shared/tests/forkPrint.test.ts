/**
 * Whether a copied part has changed since it was copied — the question giving it back has to answer
 * before saying what it would cost.
 */
import { describe, expect, it } from 'vitest';

import { partForkChanged, partForkPrint } from '../src/forkPrint';
import type { SchemaNode } from '../src/types';

/** A feed copied with the lines inside it, each level fingerprinted as the copy would. */
function copy(): { feed: SchemaNode; lines: SchemaNode } {
  const lines: SchemaNode = {
    id: 'l1aaaaaaaa',
    type: 'Column',
    forkedFrom: 'part:t.lines',
    forkedPart: { placement: { id: 't.lines' }, print: '' },
    children: [{ id: 'a1aaaaaaaa', type: 'we-avatar', props: { size: 'sm' } }],
  };
  const feed: SchemaNode = {
    id: 'f1aaaaaaaa',
    type: 'Column',
    forkedFrom: 'part:t.feed',
    forkedPart: { placement: { id: 't.feed', subject: { $: 'local.call' } }, print: '' },
    children: [{ id: 'h1aaaaaaaa', type: 'we-text', children: ['Transcript'] }, lines],
  };
  lines.forkedPart!.print = partForkPrint(lines);
  feed.forkedPart!.print = partForkPrint(feed);
  return { feed, lines };
}

describe('a copied part’s fingerprint', () => {
  it('reads as unchanged straight after copying', () => {
    const { feed, lines } = copy();
    expect(partForkChanged(feed)).toBe(false);
    expect(partForkChanged(lines)).toBe(false);
  });

  it('marks only the level an edit is in', () => {
    // The avatar is the lines'; the feed holds the lines but did not change.
    const { feed, lines } = copy();
    (lines.children![0] as SchemaNode).props = { size: 'lg' };
    expect(partForkChanged(lines)).toBe(true);
    expect(partForkChanged(feed)).toBe(false);
  });

  it('marks the feed for an edit to its own nodes, and not the lines', () => {
    const { feed, lines } = copy();
    (feed.children![0] as SchemaNode).children = ['What was said'];
    expect(partForkChanged(feed)).toBe(true);
    expect(partForkChanged(lines)).toBe(false);
  });

  it('counts a node added, removed or moved as a change', () => {
    const { feed } = copy();
    feed.children!.push({ id: 'n1aaaaaaaa', type: 'we-divider' });
    expect(partForkChanged(feed)).toBe(true);

    const second = copy();
    second.feed.children!.reverse();
    expect(partForkChanged(second.feed)).toBe(true);
  });

  it('ignores ids and the order props were written in, which say nothing about content', () => {
    const { feed } = copy();
    (feed.children![0] as SchemaNode).id = 'z9zzzzzzzz';
    feed.props = undefined;
    expect(partForkChanged(feed)).toBe(false);

    const a: SchemaNode = { type: 'Row', props: { gap: '100', p: '200' } };
    const b: SchemaNode = { type: 'Row', props: { p: '200', gap: '100' } };
    expect(partForkPrint(a)).toBe(partForkPrint(b));
  });

  it('is not changed for a node that was never copied', () => {
    expect(partForkChanged({ type: 'Column' })).toBe(false);
  });
});
