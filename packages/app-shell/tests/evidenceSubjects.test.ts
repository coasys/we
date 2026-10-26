/**
 * What a step's requirement can ask for. A reply is a `CollectionBlock` of kind `reply`, so "a
 * comment" asked as a `TextBlock` matched nothing in response to a record, and asked as any
 * `CollectionBlock` would let a call held about the record count as one.
 */
import { describe, expect, it } from 'vitest';

import { evidenceSubjectOf, subjectOfEvidence } from '../src/shared/evidenceSubjects';

describe('requirement entities', () => {
  it('reads a comment as a reply post, and a call as a call', () => {
    expect(evidenceSubjectOf('comment')).toEqual({ entity: 'CollectionBlock', where: { kind: 'reply' } });
    expect(evidenceSubjectOf('call')).toEqual({ entity: 'CollectionBlock', where: { kind: 'call' } });
    expect(evidenceSubjectOf('task')).toEqual({ entity: 'TaskBlock' });
  });

  it('takes anything else as an entity name', () => {
    expect(evidenceSubjectOf('Sighting')).toEqual({ entity: 'Sighting' });
  });

  it('recognises a stored requirement only when its conditions match exactly', () => {
    expect(subjectOfEvidence({ entity: 'CollectionBlock', where: { kind: 'reply' } })?.key).toBe('comment');
    expect(subjectOfEvidence({ entity: 'CollectionBlock' })).toBeUndefined();
    expect(subjectOfEvidence({ entity: 'CollectionBlock', where: { kind: 'reply', slug: 'x' } })).toBeUndefined();
  });
});
