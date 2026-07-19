import { describe, expect, it } from 'vitest';

import { resolveQueryProp } from './query';

// Neutral authoring grammar: `entity` + `dataset` (no AD4M `model`/`perspective`).
describe('resolveQueryProp — neutral entity/dataset grammar', () => {
  it('reads entity + dataset into the descriptor', () => {
    const d = resolveQueryProp({ $query: { entity: 'Post', dataset: '$currentDataset', where: { a: 1 } } });
    expect(d.entity).toBe('Post');
    expect(d.dataset).toBe('$currentDataset');
    expect(d.params).toEqual({ where: { a: 1 } });
  });

  it('does not leak entity/dataset/include/subscribe into params', () => {
    const d = resolveQueryProp({
      $query: { entity: 'Post', dataset: 'D', subscribe: false, include: { a: true }, order: { x: 'asc' } },
    });
    expect(d.params).toEqual({ order: { x: 'asc' } });
    expect(d.subscribe).toBe(false);
    expect(d.include).toEqual({ a: true });
  });
});
