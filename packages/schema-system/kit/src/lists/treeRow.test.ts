/**
 * A tree row. What it must get right is where things go: the row's content in the default slot,
 * nested rows in `children` — said by each nested row itself, since a row an `$each` draws has no
 * parent fragment to stamp it — and a caret only when there is something to open.
 */
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { treeRow } from './treeRow.ts';

type Node = { type: string; slot?: string; props?: Record<string, unknown>; children?: Node[] };

const row = (opts: Parameters<typeof treeRow>[0]) => treeRow(opts) as Node;

describe('a tree row', () => {
  it('is a tree item carrying the value the tree reports', () => {
    const item = row({ value: 'channel|general', label: 'General', icon: 'hash' });

    expect(item.type).toBe('we-tree-item');
    expect(item.props?.value).toBe('channel|general');
    expect(item.slot).toBeUndefined();
  });

  it('puts itself in its parent’s children slot when nested', () => {
    expect(row({ value: 'a', label: 'A', nested: true }).slot).toBe('children');
  });

  it('has a caret only with rows under it, or when told it will', () => {
    const child = treeRow({ value: 'b', label: 'B', nested: true });

    expect(row({ value: 'a', label: 'A' }).props?.expandable).toBeUndefined();
    expect(row({ value: 'a', label: 'A', children: [child as SchemaNode] }).props?.expandable).toBe(true);
    expect(row({ value: 'a', label: 'A', expandable: { $: 'local.more' } }).props?.expandable).toEqual({
      $: 'local.more',
    });
  });

  it('draws a face in place of a glyph when given one', () => {
    const item = row({
      value: 'person|did:x',
      label: 'Ann',
      icon: 'user',
      avatar: { src: '', name: 'Ann', hash: 'did:x' },
    });
    const lead = (item.children?.[0].children ?? [])[0];

    expect(lead.type).toBe('we-avatar');
  });
});
