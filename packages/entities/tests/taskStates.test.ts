/**
 * The default task-state vocabulary.
 *
 * Small, but what is asserted here is what lets everything outside a board reason about work whose
 * states a community has renamed — so it is worth pinning rather than assuming.
 */
import { DEFAULT_TASK_STATES } from '@we/entities';
import { describe, expect, it } from 'vitest';

describe('the default task states', () => {
  it('covers all three semantics, so "is this outstanding" is always answerable', () => {
    expect(DEFAULT_TASK_STATES.map((s) => s.semantic).sort()).toEqual(['active', 'done', 'open']);
  });

  it('has exactly one done state, since that is the one anything outside a board reads', () => {
    expect(DEFAULT_TASK_STATES.filter((s) => s.semantic === 'done')).toHaveLength(1);
  });

  it('has unique slugs, which are what a task stores and a column binds to', () => {
    const slugs = DEFAULT_TASK_STATES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
