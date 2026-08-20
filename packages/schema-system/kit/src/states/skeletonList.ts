import type { SchemaNode } from '@we/schema-shared';

export interface SkeletonListOptions {
  /** How many placeholder cards to sketch. */
  count?: number;
  /** Height of each placeholder card. */
  height?: string;
}

/**
 * The shape of a list that hasn't answered yet.
 *
 * A query-backed list has three states, not two: loading, empty, and full.
 * Collapsing loading into empty made every reload assert "there's nothing
 * here" for the beat before the first result set arrived — a placeholder
 * flashing something false. This is the third state: neutral pulsing blocks
 * where the cards will be, held until the query's `<key>Loaded` flips.
 */
export function skeletonList(opts: SkeletonListOptions = {}): SchemaNode {
  const count = opts.count ?? 3;
  return {
    type: 'Column',
    props: { gap: '400', width: '100%' },
    children: Array.from({ length: count }, () => ({
      type: 'we-skeleton',
      props: { height: opts.height ?? '140px', width: '100%' },
    })),
  };
}
