/**
 * What a step's requirement can ask for. A reply is a `CollectionBlock` of kind `reply`, so "a
 * comment" asked as a `TextBlock` matched nothing in response to a record, and asked as any
 * `CollectionBlock` would let a call held about the record count as one.
 */
import { describe, expect, it } from 'vitest';

import { guardSubjectOf, subjectOfGuard } from '../src/shared/guardSubjects';

describe('guard subjects', () => {
  it('reads a comment as a reply post, and a call as a call', () => {
    expect(guardSubjectOf('comment')).toEqual({ entity: 'CollectionBlock', where: { kind: 'reply' } });
    expect(guardSubjectOf('call')).toEqual({ entity: 'CollectionBlock', where: { kind: 'call' } });
    expect(guardSubjectOf('task')).toEqual({ entity: 'TaskBlock' });
  });

  it('takes anything else as an entity name', () => {
    expect(guardSubjectOf('Sighting')).toEqual({ entity: 'Sighting' });
  });

  it('recognises a stored requirement only when its conditions match exactly', () => {
    expect(subjectOfGuard({ entity: 'CollectionBlock', where: { kind: 'reply' } })?.key).toBe('comment');
    expect(subjectOfGuard({ entity: 'CollectionBlock' })).toBeUndefined();
    expect(subjectOfGuard({ entity: 'CollectionBlock', where: { kind: 'reply', slug: 'x' } })).toBeUndefined();
  });
});
